import { useEffect, useRef, useState } from "react";
import type { JobBrief, Snapshot, ToolInfo } from "@nudge/shared";
import { getClient, useHubGet } from "../lib/hub";
import { openTool } from "../lib/native";
import { glyphFlash } from "../lib/glyph";
import { D, Ms, Sheet, haptic, inputStyle, toast, toastError } from "../lib/ui";

/**
 * The pieces shared by the Tools tab and the Ask tab: a tool's icon, its "keep / goes in 5 days"
 * pill, the sheet of things you can do with it (open, install, open on the computer, keep), the
 * live build card, and the studio-logo sheet.
 */

export interface ToolsInfo {
  origin: string;
  pcOnline: boolean;
  logo: boolean;
}
export function useToolsInfo(snap: Snapshot, also: unknown = null) {
  const client = getClient("owner")!;
  return useHubGet<ToolsInfo>(client, "/api/tools", [snap.tools.length, snap.tools[0]?.updatedAt, snap.jobs.length, also]).data;
}

export const toolUrl = (info: ToolsInfo | null, t: ToolInfo) => (info ? `${info.origin}/t/${t.id}/` : null);
export function launch(info: ToolsInfo | null, t: ToolInfo) {
  const url = toolUrl(info, t);
  if (!url) return toast("wifi_off", "can't reach the wall right now");
  haptic();
  void openTool(url).catch(toastError);
}

/** Days until a tool tidies itself away (null = kept). */
export function daysLeft(t: ToolInfo, now = Date.now()): number | null {
  if (t.keep || t.expiresAt == null) return null;
  return Math.max(0, Math.ceil((t.expiresAt - now) / 86400_000));
}

export function ToolIcon({ t, size = 44, pop = false }: { t: Pick<ToolInfo, "icon">; size?: number; pop?: boolean }) {
  return (
    <div
      style={{
        flex: "none", width: size, height: size, borderRadius: size * 0.3, background: "var(--c-ff4d17)", display: "flex", alignItems: "center", justifyContent: "center",
        animation: pop ? "popIn .55s cubic-bezier(.34,1.56,.64,1) both" : "none",
      }}
    >
      <Ms style={{ fontSize: size * 0.5, color: "var(--c-0b0b0d)" }}>{t.icon}</Ms>
    </div>
  );
}

export function KeepPill({ t }: { t: ToolInfo }) {
  const d = daysLeft(t);
  const soon = d !== null && d <= 1;
  return (
    <span style={{ fontSize: 8, letterSpacing: ".14em", padding: "3px 7px", borderRadius: 7, background: d === null ? "var(--c-1a1a22)" : soon ? "var(--c-ff4d1722)" : "var(--c-1a1a22)", color: d === null ? "var(--c-8e8e97)" : soon ? "var(--c-ff4d17)" : "var(--c-6d6d77)", whiteSpace: "nowrap", transition: "background-color .35s, color .35s" }}>
      {d === null ? "KEPT" : d === 0 ? "GOES TODAY" : d === 1 ? "GOES TOMORROW" : `${d} DAYS LEFT`}
    </span>
  );
}

export async function setKeep(t: ToolInfo, keep: boolean) {
  const client = getClient("owner")!;
  haptic(keep ? "confirm" : "tick");
  try {
    await client.send("PATCH", `/api/tools/${t.id}`, { keep });
    toast(keep ? "bookmark_added" : "schedule", keep ? `keeping ${t.title.toLowerCase()}` : "it'll tidy itself away in a week");
    void client.snapshot();
  } catch (e) {
    toastError(e);
  }
}

/** A small iOS-style switch. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span role="switch" aria-checked={on} aria-label={label} tabIndex={0} className="tap" onClick={() => onChange(!on)} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onChange(!on)}
      style={{ flex: "none", width: 42, height: 26, borderRadius: 13, padding: 3, background: on ? "var(--c-ff4d17)" : "var(--c-2a2a33)", transition: "background-color .3s cubic-bezier(.32,.72,0,1)", cursor: "pointer" }}>
      <span style={{ display: "block", width: 20, height: 20, borderRadius: 10, background: on ? "var(--c-0b0b0d)" : "var(--c-8e8e97)", transform: on ? "translateX(16px)" : "none", transition: "transform .32s cubic-bezier(.32,.72,0,1), background-color .3s" }} />
    </span>
  );
}

/* --------------------------------- actions --------------------------------- */

/** Everything you can do with one tool. */
export function ToolSheet({ t, info, onClose, onImprove }: { t: ToolInfo | null; info: ToolsInfo | null; onClose: () => void; onImprove: (t: ToolInfo) => void }) {
  const client = getClient("owner")!;
  // keep the last tool while the sheet slides away
  const [shown, setShown] = useState<ToolInfo | null>(t);
  useEffect(() => void (t && setShown(t)), [t]);
  const x = t ?? shown;
  if (!x) return null;
  const live = t ? t : x;

  const toComputer = async (install: boolean) => {
    haptic("confirm");
    try {
      await client.send("POST", `/api/tools/${x.id}/computer`, { install });
      toast("desktop_windows", install ? "adding it to your computer's desktop" : "opening on your computer");
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete "${x.title}"? If it's installed, remove it from your home screen too.`)) return;
    onClose();
    await client.send("DELETE", `/api/tools/${x.id}`).catch(toastError);
    void client.snapshot();
  };
  const d = daysLeft(live);
  const row = (icon: string, label: string, sub: string, on: () => void, disabled = false) => (
    <div className="tap" role="button" aria-disabled={disabled} onClick={disabled ? undefined : on} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", opacity: disabled ? 0.38 : 1 }}>
      <Ms style={{ fontSize: 19, color: "var(--c-c9c8c2)" }}>{icon}</Ms>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5 }}>{label}</div>
        <div style={{ fontSize: 9.5, color: "var(--c-6d6d77)", marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );

  return (
    <Sheet open={!!t} onClose={onClose} title={x.title.toLowerCase()} dark>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "2px 2px 10px" }}>
          <ToolIcon t={x} size={56} pop />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--c-b6b5af)" }}>{x.description}</div>
            <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
              <KeepPill t={live} />
              <span style={{ fontSize: 8, letterSpacing: ".14em", color: "var(--c-5f5f67)" }}>V{x.version}</span>
            </div>
          </div>
        </div>
        <button className="tap" onClick={() => (launch(info, x), onClose())} style={{ height: 48, borderRadius: 14, border: 0, background: "var(--c-ff4d17)", color: "var(--c-0b0b0d)", font: "inherit", fontSize: 12, letterSpacing: ".06em", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Ms style={{ fontSize: 18 }}>open_in_new</Ms>open
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 4px 8px" }}>
          <Ms style={{ fontSize: 19, color: live.keep ? "var(--c-ff4d17)" : "var(--c-c9c8c2)", transition: "color .3s" }}>{live.keep ? "bookmark" : "bookmark_border"}</Ms>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5 }}>keep it</div>
            <div style={{ fontSize: 9.5, color: "var(--c-6d6d77)", marginTop: 1 }}>{d === null ? "it stays until you delete it" : `otherwise it tidies itself away ${d <= 1 ? (d === 0 ? "today" : "tomorrow") : `in ${d} days`}`}</div>
          </div>
          <Switch on={live.keep} label="keep it" onChange={(v) => void setKeep(live, v)} />
        </div>

        {row("install_mobile", "add to home screen", "opens in Chrome, then tap install app", () => (launch(info, x), onClose()))}
        {row("desktop_windows", "open on my computer", info?.pcOnline ? "opens in its own window there" : "turn on your computer (with Nudge running)", () => void toComputer(false), !info?.pcOnline)}
        {row("add_to_home_screen", "put it on my computer's desktop", info?.pcOnline ? "a shortcut that opens it like an app" : "needs your computer on", () => void toComputer(true), !info?.pcOnline)}
        {row("auto_fix_high", "change something…", "a new version, cost shown first", () => (onClose(), onImprove(x)))}
        <div className="tap" role="button" onClick={() => void remove()} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", color: "var(--c-e5484d)" }}>
          <Ms style={{ fontSize: 19 }}>delete</Ms>
          <span style={{ fontSize: 12.5 }}>delete</span>
        </div>
      </div>
    </Sheet>
  );
}

/* -------------------------------- build card -------------------------------- */

const STAGES = ["planning", "building", "testing", "almost there"];

/**
 * A build in progress, inline in the chat and the Tools tab: a calm progress line while it works,
 * then the new tool pops in, ready to open (with a tap of haptics and the Glyphs on a Nothing phone).
 */
export function BuildCard({ job, snap, info }: { job: JobBrief; snap: Snapshot; info: ToolsInfo | null }) {
  const client = getClient("owner")!;
  const tool = job.toolId ? snap.tools.find((t) => t.id === job.toolId) ?? null : null;
  const working = ["queued", "running", "waiting"].includes(job.status);
  const prev = useRef(job.status);
  const [justDone, setJustDone] = useState(false);
  // A gentle stage label that moves along while the sandbox works (the hub only knows "running").
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (job.status !== "running") return;
    const started = job.updatedAt;
    const tick = () => setStage(Math.min(STAGES.length - 1, Math.floor((Date.now() - started) / 35_000)));
    tick();
    const iv = window.setInterval(tick, 5000);
    return () => window.clearInterval(iv);
  }, [job.status, job.updatedAt]);
  useEffect(() => {
    if (prev.current !== "done" && job.status === "done") {
      setJustDone(true);
      haptic("confirm");
      glyphFlash();
      const tm = window.setTimeout(() => setJustDone(false), 2400);
      prev.current = job.status;
      return () => window.clearTimeout(tm);
    }
    prev.current = job.status;
  }, [job.status]);

  const failed = job.status === "failed" || job.status === "cancelled";
  const label = job.status === "running" ? STAGES[stage] : job.status === "waiting" ? "queued at half price" : job.status === "queued" ? (job.when === "later" ? "waiting for tonight" : "starting") : job.status === "done" ? "ready" : job.status === "cancelled" ? "cancelled" : "didn't finish";

  return (
    <div style={{ borderRadius: 18, background: "var(--c-101017)", overflow: "hidden", animation: "rise .5s cubic-bezier(.32,.72,0,1) both", boxShadow: justDone ? "0 0 0 1px var(--c-ff4d1766)" : "0 0 0 1px var(--c-1c1c23)", transition: "box-shadow .6s cubic-bezier(.32,.72,0,1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px" }}>
        {tool ? (
          <ToolIcon t={tool} size={40} pop={justDone} />
        ) : (
          <div style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--c-1a1a22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ms style={{ fontSize: 20, color: failed ? "var(--c-e5484d)" : "var(--c-ff4d17)", animation: working ? "aBreath 2.4s ease-in-out infinite" : "none" }}>{failed ? "error" : job.status === "waiting" ? "schedule" : "construction"}</Ms>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.title}</div>
          <div key={label} style={{ fontSize: 9.5, color: failed ? "var(--c-e5484d)" : "var(--c-8e8e97)", marginTop: 2, animation: "aSwap .35s cubic-bezier(.32,.72,0,1) both" }}>
            {failed && job.error ? job.error : label}
            {job.ownLook ? " · your look" : ""}
          </div>
        </div>
        {working && (
          <span className="tap" role="button" aria-label="cancel the build" onClick={() => void client.send("POST", `/api/jobs/${job.id}/cancel`).then(() => client.snapshot()).catch(toastError)}>
            <Ms style={{ fontSize: 16, color: "var(--c-5f5f67)" }}>close</Ms>
          </span>
        )}
        {tool && (
          <button className="tap" onClick={() => launch(info, tool)} style={{ flex: "none", border: 0, borderRadius: 12, padding: "9px 14px", background: "var(--c-ff4d17)", color: "var(--c-0b0b0d)", font: "inherit", fontSize: 11, letterSpacing: ".04em", animation: justDone ? "popIn .5s .15s cubic-bezier(.34,1.56,.64,1) both" : "none" }}>
            open
          </button>
        )}
      </div>
      {working && (
        <div style={{ height: 2, background: "var(--c-1a1a22)", overflow: "hidden" }}>
          <div style={{ width: "38%", height: "100%", background: "linear-gradient(90deg, var(--c-ff4d1700), var(--c-ff4d17), var(--c-ff4d1700))", animation: job.status === "running" ? "nShimmer 1.6s cubic-bezier(.45,0,.55,1) infinite" : "none", opacity: job.status === "running" ? 1 : 0.25 }} />
        </div>
      )}
      {tool && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderTop: "1px solid var(--c-1a1a22)", animation: "aFade .4s ease-out both" }}>
          <span style={{ flex: 1, fontSize: 9.5, color: "var(--c-6d6d77)" }}>{tool.keep ? "kept for good" : "stays a week · keep it?"}</span>
          <Switch on={tool.keep} label="keep it" onChange={(v) => void setKeep(tool, v)} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- logo ---------------------------------- */

type Mark = { mime: string; bytes: number; w: number; h: number; at: number; preview: string } | null;
const SLOTS = [
  { slot: "logo", label: "logo", hint: "the round mark", h: 64 },
  { slot: "wordmark", label: "wordmark", hint: "the wide one", h: 34 },
] as const;

/** A one-colour mark drawn in the text colour, so a black or a white logo shows on either theme. */
function MarkPreview({ m, h }: { m: Mark; h: number }) {
  if (!m) return <span style={{ fontSize: 10, color: "var(--c-5f5f67)" }}>none yet</span>;
  const mask = `url("${m.preview}") center/contain no-repeat`;
  return <span key={m.at} role="img" aria-label="preview" style={{ display: "block", height: h, aspectRatio: `${m.w}/${m.h}`, maxWidth: "100%", background: "var(--c-f4f3ef)", WebkitMask: mask, mask, animation: "popIn .5s cubic-bezier(.34,1.56,.64,1) both" }} />;
}

/** The studio's marks the builder may use (only where they fit). Owner only; checked on the hub. */
export function BrandSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = getClient("owner")!;
  const { data, reload } = useHubGet<{ name: string | null; logo: Mark; wordmark: Mark }>(client, open ? "/api/brand" : null, [open]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<"logo" | "wordmark">("logo");
  useEffect(() => void setName(data?.name ?? ""), [data?.name]);

  const upload = async (f: File) => {
    if (f.size > 512 * 1024) return toast("image", "too big (512 KB max)");
    setBusy(slot);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      });
      await client.send("PUT", `/api/brand/${slot}`, { name: name.trim() || "my studio", mime: f.type || "application/octet-stream", data: b64 });
      haptic("confirm");
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };
  const remove = async (s: string) => {
    await client.send("DELETE", `/api/brand/${s}`).catch(toastError);
    reload();
  };

  return (
    <Sheet open={open} onClose={onClose} title="your logo" dark>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input style={{ ...inputStyle(true), width: "100%" }} placeholder="studio name" aria-label="studio name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <input ref={file} type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        {SLOTS.map((x) => {
          const m = data?.[x.slot] ?? null;
          return (
            <div key={x.slot} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, background: "var(--c-101017)" }}>
              <div style={{ flex: 1, minWidth: 0, height: 72, display: "flex", alignItems: "center" }}>
                <MarkPreview m={m} h={x.h} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <span className="tap" role="button" onClick={() => (setSlot(x.slot), file.current?.click())} style={{ fontSize: 11, color: "var(--c-ff4d17)", opacity: busy === x.slot ? 0.5 : 1 }}>
                  {busy === x.slot ? "checking…" : m ? `replace ${x.label}` : `add ${x.label}`}
                </span>
                {m ? (
                  <span className="tap" role="button" onClick={() => void remove(x.slot)} style={{ fontSize: 10, color: "var(--c-6d6d77)" }}>remove</span>
                ) : (
                  <span style={{ fontSize: 9, color: "var(--c-5f5f67)" }}>{x.hint}</span>
                )}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 9.5, color: "var(--c-5f5f67)", lineHeight: 1.6 }}>
          One-colour PNG or SVG with a transparent background, up to 512 KB. Tools show it in their own text colour, only where it fits.
        </div>
      </div>
    </Sheet>
  );
}
