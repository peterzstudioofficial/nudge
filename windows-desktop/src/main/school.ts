import { BrowserWindow, Notification, session, shell } from "electron";
import type { HubClient, Handoff } from "@nudge/shared";

/**
 * School sign-in and email hand-off.
 *
 * Sign-in: a real Microsoft login window (so MFA and "stay signed in" work normally). When it
 * reaches Outlook, the Microsoft cookies are sent — once, over the paired, encrypted connection —
 * to the hub, which reads school pages and mail with them. Your password is never seen or stored.
 *
 * Hand-off: when you approve an email the assistant drafted, it opens here in Outlook on the
 * web, filled in, for YOU to press send. Nudge itself never sends email.
 */

const PARTITION = "persist:school";
const OUTLOOK = "https://outlook.office.com/mail/";
const MS_DOMAINS = /(^|\.)(microsoftonline\.com|live\.com|office\.com|office365\.com|outlook\.com|sharepoint\.com|microsoft\.com|msauth\.net|msftauth\.net)$/i;

export async function signInToSchool(client: HubClient, parent?: BrowserWindow): Promise<boolean> {
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    parent,
    title: "Sign in to school — Nudge",
    autoHideMenuBar: true,
    backgroundColor: "#f4f3ef",
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Links that open new windows (help pages etc.) go to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(OUTLOOK);

  return new Promise<boolean>((resolve) => {
    let done = false;
    const check = async () => {
      if (done || win.isDestroyed()) return;
      const url = win.webContents.getURL();
      if (!/^https:\/\/outlook\.(office|office365)\.com\/mail/i.test(url)) return;
      done = true;
      const ses = session.fromPartition(PARTITION);
      const all = await ses.cookies.get({});
      const cookies = all.filter((c) => c.domain && MS_DOMAINS.test(c.domain.replace(/^\./, "")));
      try {
        await client.request("POST", "/api/school/session", { cookies, userAgent: win.webContents.getUserAgent() });
        new Notification({ title: "Nudge", body: "You're in. The wall is reading school now." }).show();
        resolve(true);
      } catch {
        new Notification({ title: "Nudge", body: "Couldn't reach the wall to finish signing in." }).show();
        resolve(false);
      }
      setTimeout(() => !win.isDestroyed() && win.close(), 1200);
    };
    win.webContents.on("did-navigate", check);
    win.webContents.on("did-navigate-in-page", check);
    win.on("closed", () => !done && resolve(false));
  });
}

/** Open an approved email draft in Outlook, filled in, for Peter to send himself. */
export async function openDraft(client: HubClient, h: Extract<Handoff, { kind: "compose" }>): Promise<void> {
  const q = new URLSearchParams({ to: h.payload.to, subject: h.payload.subject, body: h.payload.body });
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    title: "Draft ready — press send when you're happy",
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await win.loadURL(`https://outlook.office.com/mail/deeplink/compose?${q.toString()}`);
  await client.request("POST", `/api/handoffs/${h.id}/done`).catch(() => {});
  new Notification({ title: "Nudge", body: `Email to ${h.payload.to} is ready. Check it, then press send.` }).show();
}
