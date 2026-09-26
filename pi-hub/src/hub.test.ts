import { describe, expect, it } from "vitest";
import { Db } from "./db";
import { Hub } from "./hub";
import { HttpError } from "./errors";
import { decide, cookieAllowed } from "./school/guard";
import { normaliseCookies } from "./school/reader";
import { mailTime } from "./school/extract";

function setup(start = new Date(2026, 8, 28, 16, 0).getTime()) {
  let now = start;
  const hub = new Hub(new Db(":memory:"), { clock: () => now });
  const tick = (sec: number) => (now += sec * 1000);
  const task = hub.addTask({ date: hub.todayKey(), name: "quadratics", subject: "maths", phase: "home", mins: 25, note: "", when: "date" }, "parent");
  return { hub, tick, task };
}

describe("sessions and points", () => {
  it("gives +1 for starting once, never twice", () => {
    const { hub, task, tick } = setup();
    expect(hub.start(task.id).points).toBe(1);
    tick(60);
    hub.switchAway("switch");
    expect(hub.start(task.id).points).toBe(0);
    expect(hub.lifetime()).toBe(1);
  });

  it("keeps progress when switching and resumes from it", () => {
    const { hub, task, tick } = setup();
    hub.start(task.id);
    tick(494);
    expect(hub.switchAway("switch").kept).toBe(494);
    const s = hub.start(task.id).session;
    expect(s.workedSec).toBe(494);
  });

  it("refuses an early claim and awards +3 on a real one", () => {
    const { hub, task, tick } = setup();
    hub.start(task.id);
    tick(30);
    expect(() => hub.claim()).toThrow(HttpError);
    tick(25 * 60);
    const r = hub.claim();
    expect(r.awarded).toBe(3);
    expect(hub.lifetime()).toBe(4);
    expect(hub.tasks.get(task.id)!.done).toBe(true);
    expect(hub.session()).toBeNull();
  });

  it("only allows a break after five minutes", () => {
    const { hub, task, tick } = setup();
    hub.start(task.id);
    tick(120);
    expect(() => hub.takeBreak()).toThrow(/break in 3 min/);
    tick(200);
    expect(hub.takeBreak().state).toBe("break");
  });

  it("pauses time while paused", () => {
    const { hub, task, tick } = setup();
    hub.start(task.id);
    tick(100);
    hub.pause();
    tick(1000);
    hub.resume();
    tick(50);
    hub.pause();
    expect(hub.session()!.workedSec).toBe(150);
  });

  it("recovers from a power cut without counting the downtime", () => {
    let now = new Date(2026, 8, 28, 16, 0).getTime();
    const db = new Db(":memory:");
    const hub = new Hub(db, { clock: () => now });
    const t = hub.addTask({ date: hub.todayKey(), name: "x", subject: "maths", phase: "home", mins: 25, note: "", when: "date" }, "parent");
    hub.start(t.id);
    now += 60_000;
    hub.heartbeat();
    now += 3 * 3600_000; // power cut for 3 hours
    const hub2 = new Hub(db, { clock: () => now });
    const s = hub2.session()!;
    expect(s.state).toBe("paused");
    expect(s.workedSec).toBe(60);
  });
});

describe("rules", () => {
  it("caps parent tasks per day", () => {
    const { hub } = setup();
    const date = hub.todayKey();
    for (let i = 0; i < 4; i++) hub.addTask({ date, name: "t" + i, subject: "maths", phase: "home", mins: 10, note: "", when: "date" }, "parent");
    expect(() => hub.addTask({ date, name: "sixth", subject: "maths", phase: "home", mins: 10, note: "", when: "date" }, "parent")).toThrow(/enough for one day/);
  });

  it("allows two skips a day", () => {
    const { hub, task } = setup();
    hub.skipTask(task.id);
    hub.skipTask(task.id);
    expect(() => hub.skipTask(task.id)).toThrow(/no skips left/);
  });

  it("only lets parents change parent settings", () => {
    const { hub } = setup();
    expect(() => hub.updateSettings("owner", { pointsClaim: 100 })).toThrow(HttpError);
    expect(hub.updateSettings("parent", { pointsClaim: 4 }).pointsClaim).toBe(4);
    expect(() => hub.updateSettings("parent", { schoolPages: [] })).toThrow(HttpError);
  });

  it("carries leftover points into the next reward and never deducts", () => {
    const { hub } = setup();
    hub.setReward({ name: "cinema trip", goal: 5, icon: "redeem", next: [{ name: "headphones", goal: 60, icon: "headphones" }] });
    for (let i = 0; i < 7; i++) hub.points.put({ id: "p" + i, ts: hub.now(), delta: 1, reason: "bonus", taskId: null });
    hub.setReward({ name: "cinema trip", goal: 5, icon: "redeem" });
    expect(hub.rewardState().reward.unlockedAt).not.toBeNull();
    const next = hub.ackReward();
    expect(next.name).toBe("headphones");
    expect(hub.rewardState().bank).toBe(2);
    expect(hub.lifetime()).toBe(7);
  });

  it("asks never send email themselves", () => {
    const { hub } = setup();
    const ask = hub.createAsk({ kind: "email", head: "", line: "email mr hale?", rows: [], payload: { to: "a@b.c", subject: "s", body: "b" }, threadId: null });
    hub.answerAsk(ask.id, true, "test");
    const h = hub.pendingHandoffs();
    expect(h).toHaveLength(1);
    expect(h[0].payload.to).toBe("a@b.c");
  });
});

describe("school guard", () => {
  const req = (method: string, url: string, resourceType = "fetch") => decide({ method, url, resourceType });
  it("blocks anything that sends or changes mail", () => {
    expect(req("POST", "https://outlook.office.com/owa/service.svc?action=SendItem&app=Mail")).toBe("block");
    expect(req("POST", "https://outlook.office.com/owa/service.svc?action=UpdateItem")).toBe("block");
    expect(req("POST", "https://graph.microsoft.com/v1.0/me/sendMail")).toBe("block");
    expect(req("DELETE", "https://outlook.office.com/api/v2.0/me/messages/1")).toBe("block");
    expect(req("PATCH", "https://graph.microsoft.com/v1.0/me/messages/1")).toBe("block");
    expect(req("POST", "https://school.sharepoint.com/_api/web/lists/items(1)/recycle")).toBe("block");
  });
  it("allows reading", () => {
    expect(req("GET", "https://school.sharepoint.com/sites/y10/SitePages/Home.aspx", "document")).toBe("allow");
    expect(req("POST", "https://outlook.office.com/owa/service.svc?action=FindConversation")).toBe("allow");
    expect(req("POST", "https://school.sharepoint.com/sites/y10/_api/web/GetList('x')/RenderListDataAsStream")).toBe("allow");
  });
  it("blocks non-Microsoft hosts and skips heavy assets", () => {
    expect(req("GET", "https://evil.example.com/x.js", "script")).toBe("block");
    expect(req("GET", "https://school.sharepoint.com/logo.png", "image")).toBe("skip");
  });
  it("only accepts Microsoft cookies", () => {
    expect(cookieAllowed(".login.microsoftonline.com")).toBe(true);
    expect(cookieAllowed(".google.com")).toBe(false);
    const c = normaliseCookies([
      { name: "ESTSAUTH", value: "x", domain: ".login.microsoftonline.com", path: "/", secure: true, httpOnly: true, sameSite: "no_restriction", expirationDate: 1900000000 },
      { name: "SID", value: "y", domain: ".google.com" },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].sameSite).toBe("None");
  });
  it("reads Outlook times", () => {
    const now = new Date(2026, 8, 25, 18, 0);
    expect(new Date(mailTime("16:04", now)).getHours()).toBe(16);
    expect(new Date(mailTime("Mon 12:30", now)).getDay()).toBe(1);
  });
});
