import { useState } from "react";
import type { Snapshot, ToolInfo } from "@nudge/shared";
import { getClient, useHubGet } from "../lib/hub";
import { Ms, Sheet, inputStyle, toast, toastError } from "../lib/ui";
import { openTool } from "../lib/native";

/**
 * Tools the assistant built for you. Tap one to open it; on Android it opens in Chrome, which
 * offers "Install app" so it lands on the home screen like any other app.
 * Big jobs wait here for your yes, with their cost.
 */
export function ToolsTab({ snap }: { snap: Snapshot }) {
  const client = getClient("owner")!;
  const { data } = useHubGet<{ origin: string }>(client, "/api/tools", [snap.tools.length]);
  const [asking, setAsking] = useState(false);
  const builds = snap.asks.filter((a) => a.kind === "build");
  const jobs = snap.jobs.filter((j) => j.status !== "done" || Date.now() - j.updatedAt < 3600_000);

  const answer = async (id: string, yes: boolean) => {
    try {
      await client.send("POST", `/api/asks/${id}/answer`, { yes });
      toast(yes ? "rocket_launch" : "close", yes ? "started" : "cancelled");
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const open = (t: ToolInfo) => data && void openTool(`${data.origin}/t/${t.id}/`).catch(toastError);
  const remove = async (t: ToolInfo) => {
    if (!confirm(`Delete "${t.title}"? If it's installed, uninstall it from your home screen too.`)) return;
    await client.send("DELETE", `/api/tools/${t.id}`).catch(toastError);
    void client.snapshot();
  };

  return (
    <div style={{ padding: "4px 14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      {builds.map((a) => (
        <div key={a.id} style={{ padding: 14, borderRadius: 16, background: "#17110d", boxShadow: "inset 0 0 0 1px #ff4d1755" }}>
          <div style={{ fontSize: 9, letterSpacing: ".14em", color: "#ff4d17" }}>{a.head}</div>
          <div style={{ fontSize: 15, margin: "6px 0 8px" }}>{a.line}</div>
          {a.rows.map((r) => (
            <div key={r.k} style={{ display: "flex", gap: 10, fontSize: 11, lineHeight: "20px" }}>
              <span style={{ width: 54, color: "#8e8e97", letterSpacing: ".1em", fontSize: 9 }}>{r.k}</span>
              <span style={{ color: "#c9c8c2" }}>{r.v}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="tap" onClick={() => void answer(a.id, true)} style={btn(true)}>yes, build it</button>
            <button className="tap" onClick={() => void answer(a.id, false)} style={btn(false)}>no</button>
          </div>
        </div>
      ))}

      {jobs.map((j) => (
        <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: "#101017" }}>
          <Ms style={{ fontSize: 18, color: j.status === "failed" ? "#e5484d" : j.status === "done" ? "#6fcf97" : "#ff4d17", animation: ["running", "waiting", "queued"].includes(j.status) ? "aBreath 2.4s ease-in-out infinite" : "none" }}>
            {j.status === "failed" ? "error" : j.status === "done" ? "check_circle" : j.status === "waiting" ? "schedule" : "construction"}
          </Ms>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12 }}>{j.title}</div>
            <div style={{ fontSize: 10, color: "#8e8e97" }}>{j.error ?? j.note}</div>
          </div>
          {["queued", "waiting", "running"].includes(j.status) && (
            <span className="tap" onClick={() => void client.send("POST", `/api/jobs/${j.id}/cancel`).then(() => client.snapshot()).catch(toastError)}>
              <Ms style={{ fontSize: 16, color: "#5f5f67" }}>close</Ms>
            </span>
          )}
        </div>
      ))}

      {snap.tools.map((t) => (
        <div key={t.id} className="tap" onClick={() => open(t)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 14px", borderRadius: 16, background: "#101017" }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, background: "#ff4d17", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ms style={{ fontSize: 22, color: "#0b0b0d" }}>{t.icon}</Ms>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14 }}>{t.title}</div>
            <div style={{ fontSize: 10, color: "#8e8e97", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
            <div style={{ fontSize: 8, letterSpacing: ".14em", color: "#5f5f67", marginTop: 3 }}>{t.target === "school" ? "FOR SCHOOL" : t.target === "phone" ? "FOR YOUR PHONE" : "PHONE + LAPTOP"} · V{t.version}</div>
          </div>
          <span className="tap" onClick={(e) => (e.stopPropagation(), void remove(t))}>
            <Ms style={{ fontSize: 16, color: "#43434c" }}>delete</Ms>
          </span>
        </div>
      ))}

      {!snap.tools.length && !jobs.length && !builds.length && (
        <div style={{ padding: "26px 8px", fontSize: 11, color: "#8e8e97", lineHeight: 1.6 }}>
          No tools yet. Ask the assistant ("build me a line-learner for my musical scenes, for later") or tap below. Big jobs always show their cost and wait for your yes.
        </div>
      )}
      <button className="tap" onClick={() => setAsking(true)} style={{ ...btn(false), height: 46, marginTop: 4 }}>
        <Ms style={{ fontSize: 16, verticalAlign: "-3px", marginRight: 6 }}>add</Ms>ask for a tool
      </button>
      <div style={{ fontSize: 9, color: "#5f5f67", lineHeight: 1.6, padding: "0 4px" }}>
        Tools run on your wall, work offline and can't reach the internet. Tap one, then "Install app" to put it on your home screen.
      </div>
      <NewTool open={asking} onClose={() => setAsking(false)} />
    </div>
  );
}

const btn = (primary: boolean) => ({
  flex: 1, height: 40, borderRadius: 12, border: 0, fontFamily: "inherit", fontSize: 12, letterSpacing: ".04em",
  background: primary ? "#ff4d17" : "#1a1a22", color: primary ? "#0b0b0d" : "#e9e8e3",
});

function NewTool({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = getClient("owner")!;
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [target, setTarget] = useState<"phone" | "school" | "any">("phone");
  const [when, setWhen] = useState<"now" | "later">("later");
  const [where, setWhere] = useState<"pi" | "computer">("pi");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const inp = inputStyle(true);

  const submit = async () => {
    if (title.trim().length < 2 || brief.trim().length < 10) return toast("edit", "give it a name and say what it should do");
    setBusy(true);
    try {
      const attachments = await Promise.all(
        files.slice(0, 4).map(async (f) => ({ name: f.name, mime: f.type || "application/octet-stream", data: await toBase64(f) })),
      );
      await client.send("POST", "/api/tools/request", { title: title.trim(), brief: brief.trim(), target, when, where, attachments });
      toast("help", "check the cost and say yes");
      setTitle("");
      setBrief("");
      setFiles([]);
      onClose();
      void client.snapshot();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const pick = <T extends string>(v: T, set: (x: T) => void, opts: [T, string][]) => (
    <div style={{ display: "flex", gap: 6 }}>
      {opts.map(([k, label]) => (
        <span key={k} className="tap" onClick={() => set(k)} style={{ flex: 1, textAlign: "center", padding: "9px 4px", borderRadius: 10, fontSize: 11, background: v === k ? "#ff4d17" : "#1a1a22", color: v === k ? "#0b0b0d" : "#c9c8c2" }}>{label}</span>
      ))}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="ask for a tool" dark>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input style={inp} placeholder="name, e.g. line learner" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
        <textarea style={{ ...inp, height: 120, resize: "none", paddingTop: 10 }} placeholder="what should it do? screens, features, what it keeps…" value={brief} maxLength={6000} onChange={(e) => setBrief(e.target.value)} />
        {pick(target, setTarget, [["phone", "phone"], ["school", "school"], ["any", "both"]])}
        {pick(when, setWhen, [["later", "later · half price"], ["now", "now"]])}
        {pick(where, setWhere, [["pi", "the wall builds it"], ["computer", "claude code on pc"]])}
        <label style={{ fontSize: 11, color: "#8e8e97" }}>
          attach files (optional, e.g. a PDF of the topics)
          <input type="file" multiple style={{ display: "block", marginTop: 6, fontSize: 11 }} onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        </label>
        <button className="tap" disabled={busy} onClick={() => void submit()} style={{ ...btn(true), height: 44, opacity: busy ? 0.5 : 1 }}>{busy ? "sending…" : "check the cost"}</button>
        <div style={{ fontSize: 9, color: "#5f5f67", lineHeight: 1.6 }}>
          Nothing starts until you say yes. Attached files are used for this build only, then deleted.
        </div>
      </div>
    </Sheet>
  );
}

function toBase64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

