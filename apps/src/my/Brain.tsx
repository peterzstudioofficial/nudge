import { useState } from "react";
import type { Memory } from "@nudge/shared";
import { getClient, useHubGet } from "../lib/hub";
import { Ms, Sheet, inputStyle, toast, toastError } from "../lib/ui";

/**
 * What Nudge knows about you. Every line the assistant remembers is here, to add to or delete.
 * It lives on the wall only.
 */
export function BrainSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = getClient("owner")!;
  const { data, reload } = useHubGet<Memory[]>(client, "/api/brain", [open]);
  const [text, setText] = useState("");
  const [gone, setGone] = useState<string[]>([]);
  const add = async () => {
    const t = text.trim();
    if (t.length < 4) return;
    try {
      await client.send("POST", "/api/brain", { text: t });
      setText("");
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const del = async (m: Memory) => {
    setGone((g) => [...g, m.id]);
    try {
      await client.send("DELETE", `/api/brain/${m.id}`);
      window.setTimeout(reload, 320);
    } catch (e) {
      setGone((g) => g.filter((x) => x !== m.id));
      toastError(e);
    }
  };
  const wipe = async () => {
    if (!confirm("Forget everything Nudge has learned about you?")) return;
    await client.send("DELETE", "/api/brain").catch(toastError);
    toast("neurology", "forgotten");
    reload();
  };
  const list = data ?? [];
  return (
    <Sheet open={open} onClose={onClose} title="what nudge knows" dark>
      <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--c-8e8e97)", marginBottom: 12 }}>
        The assistant uses these so you don't have to explain yourself twice. They stay on the wall. It never keeps passwords, money, health or addresses.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} maxLength={200} placeholder="e.g. prefers revising in the morning" style={{ ...inputStyle(true), flex: 1 }} />
        <button className="tap" onClick={() => void add()} style={{ border: 0, borderRadius: 12, width: 46, background: "var(--c-ff4d17)", color: "var(--c-0b0b0d)" }}>
          <Ms style={{ fontSize: 18 }}>add</Ms>
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "48vh", overflow: "auto" }}>
        {data && !data.length && <span style={{ fontSize: 11, color: "var(--c-6d6d77)", padding: "10px 2px" }}>nothing yet — it learns as you ask.</span>}
        {list.map((m) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 11, background: "var(--c-13131a)", animation: gone.includes(m.id) ? "popOut .3s ease-in both" : "aUp .3s ease-out both" }}>
            <Ms style={{ fontSize: 14, flex: "none", color: m.source === "told" ? "var(--c-ff4d17)" : "var(--c-6d6d77)" }}>{m.source === "told" ? "record_voice_over" : "neurology"}</Ms>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.35, color: "var(--c-dedad4)" }}>{m.text}</span>
            <span className="tap" onClick={() => void del(m)} aria-label="forget this">
              <Ms style={{ fontSize: 15, color: "var(--c-5f5f67)" }}>close</Ms>
            </span>
          </div>
        ))}
      </div>
      {list.length > 0 && (
        <div className="tap" onClick={() => void wipe()} style={{ fontSize: 9, letterSpacing: ".14em", color: "var(--c-6d6d77)", textAlign: "center", marginTop: 14 }}>FORGET EVERYTHING</div>
      )}
    </Sheet>
  );
}
