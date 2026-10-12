import { useEffect, useState } from "react";
import type { Snapshot, ToolInfo } from "@nudge/shared";
import { getClient } from "../lib/hub";
import { Ms, Sheet, haptic, inputStyle, toast, toastError } from "../lib/ui";
import { AskCard } from "./AskCard";
import { BrandSheet, BuildCard, KeepPill, Switch, ToolIcon, ToolSheet, launch, useToolsInfo } from "./ToolKit";

/**
 * Tools the assistant built for you. Tap one to open it; hold (or tap ⋯) for the rest: add it to
 * your home screen, open it on your computer, keep it for good. Tools you don't keep tidy
 * themselves away a week after their last build. Big jobs wait here for your yes, with their cost.
 */
export function ToolsTab({ snap }: { snap: Snapshot }) {
  const info = useToolsInfo(snap);
  const [asking, setAsking] = useState<{ improve: ToolInfo | null } | null>(null);
  const [picked, setPicked] = useState<ToolInfo | null>(null);
  const [brand, setBrand] = useState(false);
  const builds = snap.asks.filter((a) => a.kind === "build");
  // finished builds show up as the tool itself (glowing for a moment); failures stay for an hour
  const jobs = snap.jobs.filter((j) => j.status !== "done" && (!["failed", "cancelled"].includes(j.status) || Date.now() - j.updatedAt < 3600_000));
  const fresh = (t: ToolInfo) => Date.now() - t.updatedAt < 120_000;
  // keep the sheet's tool current as the snapshot changes (keep switch, new version)
  const live = picked ? snap.tools.find((t) => t.id === picked.id) ?? null : null;

  return (
    <div style={{ padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      {builds.map((a) => <AskCard key={a.id} a={a} />)}
      {jobs.map((j) => <BuildCard key={j.id} job={j} snap={snap} info={info} />)}

      {snap.tools.map((t, i) => (
        <Row key={t.id} t={t} i={i} fresh={fresh(t)} onOpen={() => launch(info, t)} onMore={() => (haptic(), setPicked(t))} />
      ))}

      {!snap.tools.length && !jobs.length && !builds.length && (
        <div style={{ padding: "26px 8px", fontSize: 11, color: "var(--c-8e8e97)", lineHeight: 1.6, animation: "aUp .4s cubic-bezier(.32,.72,0,1) both" }}>
          No tools yet. Ask the assistant ("make me a line-learner for my musical scenes") or tap below. They come out in the Nudge style unless you ask for your own look, and big jobs always show their cost and wait for your yes.
        </div>
      )}
      <button className="tap" onClick={() => setAsking({ improve: null })} style={{ ...btn(false), flex: "none", height: 46, marginTop: 4 }}>
        <Ms style={{ fontSize: 16, verticalAlign: "-3px", marginRight: 6 }}>add</Ms>ask for a tool
      </button>
      <div className="tap" role="button" onClick={() => setBrand(true)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", fontSize: 10.5, color: "var(--c-8e8e97)" }}>
        <Ms style={{ fontSize: 16, color: "var(--c-6d6d77)" }}>verified</Ms>
        <span style={{ flex: 1 }}>{info?.logo ? "your logo: tools can use it where it fits" : "add your logo (optional)"}</span>
        <Ms style={{ fontSize: 15, color: "var(--c-43434c)" }}>chevron_right</Ms>
      </div>
      <div style={{ fontSize: 9, color: "var(--c-5f5f67)", lineHeight: 1.6, padding: "0 4px" }}>
        Tools run on your wall, work offline and can't reach the internet. Ones you don't keep tidy themselves away after a week.
      </div>
      <NewTool open={!!asking} improve={asking?.improve ?? null} onClose={() => setAsking(null)} />
      <ToolSheet t={live} info={info} onClose={() => setPicked(null)} onImprove={(t) => setAsking({ improve: t })} />
      <BrandSheet open={brand} onClose={() => setBrand(false)} />
    </div>
  );
}

/** One tool. Tap opens it; a long press (or ⋯) opens everything else. */
function Row({ t, i, fresh, onOpen, onMore }: { t: ToolInfo; i: number; fresh: boolean; onOpen: () => void; onMore: () => void }) {
  const [held, setHeld] = useState<number | null>(null);
  const [longed, setLonged] = useState(false);
  const down = () => {
    setLonged(false);
    setHeld(window.setTimeout(() => (setLonged(true), setHeld(null), onMore()), 480));
  };
  const up = () => held !== null && (window.clearTimeout(held), setHeld(null));
  useEffect(() => () => void (held !== null && window.clearTimeout(held)), [held]);
  return (
    <div
      className="tap"
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => !longed && onOpen()}
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 18, background: "var(--c-101017)", userSelect: "none",
        boxShadow: fresh ? "0 0 0 1px var(--c-ff4d1755)" : "0 0 0 1px var(--c-ff4d1700)",
        transform: held !== null ? "scale(.975)" : "none",
        transition: "transform .4s cubic-bezier(.32,.72,0,1), box-shadow .8s cubic-bezier(.32,.72,0,1)",
        animation: `aUp .45s ${Math.min(i, 8) * 40}ms cubic-bezier(.32,.72,0,1) both`,
      }}
    >
      <ToolIcon t={t} pop={fresh} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{t.title}</div>
        <div style={{ fontSize: 10, color: "var(--c-8e8e97)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
          <KeepPill t={t} />
          <span style={{ fontSize: 8, letterSpacing: ".14em", color: "var(--c-5f5f67)" }}>{t.target === "school" ? "FOR SCHOOL" : t.target === "phone" ? "PHONE" : "PHONE + LAPTOP"} · V{t.version}</span>
        </div>
      </div>
      <span className="tap" role="button" aria-label={`more for ${t.title}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), onMore())} style={{ padding: 6, margin: -6 }}>
        <Ms style={{ fontSize: 18, color: "var(--c-5f5f67)" }}>more_horiz</Ms>
      </span>
    </div>
  );
}

const btn = (primary: boolean) => ({
  flex: 1, height: 40, borderRadius: 12, border: 0, fontFamily: "inherit", fontSize: 12, letterSpacing: ".04em",
  background: primary ? "var(--c-ff4d17)" : "var(--c-1a1a22)", color: primary ? "var(--c-0b0b0d)" : "var(--c-e9e8e3)",
});

function NewTool({ open, improve, onClose }: { open: boolean; improve: ToolInfo | null; onClose: () => void }) {
  const client = getClient("owner")!;
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [target, setTarget] = useState<"phone" | "school" | "any">("phone");
  const [when, setWhen] = useState<"now" | "later">("later");
  const [where, setWhere] = useState<"pi" | "computer">("pi");
  const [look, setLook] = useState<"nudge" | "own">("nudge");
  const [style, setStyle] = useState("");
  const [keep, setKeep] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const inp = inputStyle(true);
  useEffect(() => {
    if (!open) return;
    setTitle(improve?.title ?? "");
    setTarget(improve?.target ?? "phone");
    setKeep(improve?.keep ?? false);
    setBrief("");
  }, [open, improve?.id]);

  const submit = async () => {
    if (title.trim().length < 2 || brief.trim().length < 10) return toast("edit", improve ? "say what to change" : "give it a name and say what it should do");
    if (look === "own" && style.trim().length < 3) return toast("palette", "describe the look you want");
    setBusy(true);
    try {
      const attachments = await Promise.all(
        files.slice(0, 4).map(async (f) => ({ name: f.name, mime: f.type || "application/octet-stream", data: await toBase64(f) })),
      );
      await client.send("POST", "/api/tools/request", {
        title: title.trim(), brief: brief.trim(), target, when, where, toolId: improve?.id ?? null,
        style: look === "own" ? style.trim() : null, keep, attachments,
      });
      haptic("confirm");
      toast("help", "check the cost and say yes");
      setTitle("");
      setBrief("");
      setStyle("");
      setLook("nudge");
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
    <div style={{ display: "flex", gap: 6, padding: 3, borderRadius: 12, background: "var(--c-13131a)" }}>
      {opts.map(([k, label]) => (
        <span key={k} className="tap" onClick={() => (haptic(), set(k))} style={{ flex: 1, textAlign: "center", padding: "9px 4px", borderRadius: 9, fontSize: 11, background: v === k ? "var(--c-ff4d17)" : "transparent", color: v === k ? "var(--c-0b0b0d)" : "var(--c-c9c8c2)", transition: "background-color .3s cubic-bezier(.32,.72,0,1), color .3s" }}>{label}</span>
      ))}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title={improve ? `change ${improve.title.toLowerCase()}` : "ask for a tool"} dark>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!improve && <input style={{ ...inp, width: "100%" }} placeholder="name, e.g. line learner" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />}
        <textarea style={{ ...inp, height: 120, resize: "none", paddingTop: 10 }} placeholder={improve ? "what should change? (it keeps what works and your saved data)" : "what should it do? screens, features, what it keeps…"} value={brief} maxLength={6000} onChange={(e) => setBrief(e.target.value)} />
        {pick(look, setLook, [["nudge", "nudge style"], ["own", "my own look"]])}
        <div style={{ display: "grid", gridTemplateRows: look === "own" ? "1fr" : "0fr", transition: "grid-template-rows .4s cubic-bezier(.32,.72,0,1)" }}>
          <div style={{ overflow: "hidden" }}>
            <input style={{ ...inp, width: "100%", opacity: look === "own" ? 1 : 0, transition: "opacity .3s" }} tabIndex={look === "own" ? 0 : -1} placeholder="e.g. light, pastel, big rounded type, like a film poster" value={style} maxLength={400} onChange={(e) => setStyle(e.target.value)} />
          </div>
        </div>
        {!improve && pick(target, setTarget, [["phone", "phone"], ["school", "school"], ["any", "both"]])}
        {pick(when, setWhen, [["later", "later · half price"], ["now", "now"]])}
        {pick(where, setWhere, [["pi", "the wall builds it"], ["computer", "claude code on pc"]])}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 2px" }}>
          <div style={{ flex: 1, fontSize: 11 }}>
            keep it for good
            <div style={{ fontSize: 9.5, color: "var(--c-6d6d77)", marginTop: 1 }}>{keep ? "stays until you delete it" : "otherwise it tidies itself away after a week"}</div>
          </div>
          <Switch on={keep} label="keep it for good" onChange={setKeep} />
        </div>
        <label style={{ fontSize: 11, color: "var(--c-8e8e97)" }}>
          attach files (optional, e.g. a PDF of the topics)
          <input type="file" multiple style={{ display: "block", marginTop: 6, fontSize: 11 }} onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        </label>
        <button className="tap" disabled={busy} onClick={() => void submit()} style={{ ...btn(true), flex: "none", height: 46, opacity: busy ? 0.5 : 1 }}>{busy ? "sending…" : "check the cost"}</button>
        <div style={{ fontSize: 9, color: "var(--c-5f5f67)", lineHeight: 1.6 }}>
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

