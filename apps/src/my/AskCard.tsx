import { useState } from "react";
import { askNeedsHold, type Ask } from "@nudge/shared";
import { getClient } from "../lib/hub";
import { HoldButton } from "../lib/HoldButton";
import { Ms, toast, toastError } from "../lib/ui";

const ICON: Record<Ask["kind"], string> = { email: "send", app: "apps", claude: "terminal", build: "construction", week: "event_available", reminder: "push_pin", task: "event_available" };
const VERB: Partial<Record<Ask["kind"], string>> = { email: "hold to get it ready", app: "hold to do it", claude: "hold to hand it over", build: "hold to build it" };

/**
 * A question from the assistant. It shows exactly what would happen (for an email: who, the
 * subject and every word), and anything that leaves the house needs a press-and-hold.
 */
export function AskCard({ a }: { a: Ask }) {
  const client = getClient("owner")!;
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const p = a.payload as Record<string, unknown>;
  const detail =
    a.kind === "email" ? `To: ${String(p.toName ?? "")} <${String(p.to ?? "")}>\nSubject: ${String(p.subject ?? "")}\n\n${String(p.body ?? "")}`
    : a.kind === "app" ? JSON.stringify(p.args ?? {}, null, 2)
    : a.kind === "claude" ? String(p.task ?? "")
    : a.kind === "build" ? String((p.request as { brief?: string } | undefined)?.brief ?? "")
    : "";

  const answer = async (yes: boolean, held = false) => {
    setGone(true);
    try {
      await client.send("POST", `/api/asks/${a.id}/answer`, { yes, held });
      toast(yes ? "check_circle" : "close", !yes ? "cancelled" : a.kind === "email" ? "ready on your computer — you press send" : a.kind === "build" ? "building it" : "done");
      void client.snapshot();
    } catch (e) {
      setGone(false);
      toastError(e);
    }
  };

  return (
    <div style={{ padding: 14, borderRadius: 16, background: "var(--c-17110d)", boxShadow: "inset 0 0 0 1px var(--c-ff4d1755)", marginBottom: 12, animation: gone ? "popOut .3s ease-in both" : "rise .45s cubic-bezier(.32,.72,0,1) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 9, letterSpacing: ".14em", color: "var(--c-ff4d17)" }}>
        <Ms style={{ fontSize: 14 }}>{ICON[a.kind]}</Ms>
        {a.head}
      </div>
      <div style={{ fontSize: 15, margin: "6px 0 8px" }}>{a.line}</div>
      {a.rows.map((r) => (
        <div key={r.k} style={{ display: "flex", gap: 10, fontSize: 11, lineHeight: "20px" }}>
          <span style={{ width: 54, flex: "none", color: "var(--c-8e8e97)", letterSpacing: ".1em", fontSize: 9 }}>{r.k}</span>
          <span style={{ color: "var(--c-c9c8c2)", minWidth: 0, overflowWrap: "anywhere" }}>{r.v}</span>
        </div>
      ))}
      {detail && (
        <>
          <span className="tap" onClick={() => setOpen(!open)} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, letterSpacing: ".12em", color: "var(--c-8e8e97)", marginTop: 8 }}>
            {open ? "HIDE" : "SEE EXACTLY WHAT"} <Ms style={{ fontSize: 13, transform: open ? "rotate(180deg)" : "none", transition: "transform .3s" }}>expand_more</Ms>
          </span>
          {open && <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 11, lineHeight: 1.45, color: "var(--c-dedad4)", background: "var(--c-0b0b0d)", borderRadius: 10, padding: 10, margin: "8px 0 0", maxHeight: 260, overflow: "auto", animation: "aFade .3s" }}>{detail}</pre>}
        </>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {askNeedsHold(a) ? (
          <HoldButton label={VERB[a.kind] ?? "hold to confirm"} onConfirm={() => void answer(true, true)} />
        ) : (
          <button className="tap" onClick={() => void answer(true)} style={btn(true)}>yes</button>
        )}
        <button className="tap" onClick={() => void answer(false)} style={{ ...btn(false), flex: askNeedsHold(a) ? "0 0 72px" : 1 }}>no</button>
      </div>
      {a.kind === "email" && <div style={{ fontSize: 9, color: "var(--c-5f5f67)", marginTop: 8, lineHeight: 1.4 }}>Nothing is sent from here. It opens ready in Outlook on your computer; you press send.</div>}
    </div>
  );
}

const btn = (primary: boolean): React.CSSProperties => ({
  flex: 1, border: 0, borderRadius: 13, padding: "13px 12px", font: "inherit", fontSize: 12,
  background: primary ? "var(--c-ff4d17)" : "var(--c-1e1e26)", color: primary ? "var(--c-0b0b0d)" : "var(--c-c9c8c2)",
});
