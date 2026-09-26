import { useCallback, useEffect, useState } from "react";
import type { AgentThread, Ask } from "@nudge/shared";
import { bridge, useHubState } from "./bridge";

/** The Nudge agent window, from "Desktop Windows.dc.html" (NUDGE AGENT). Asks before anything is sent. */

const D = "'ZCOOL QingKe HuangYou', sans-serif";
const Ms = ({ children, style }: { children: string; style?: React.CSSProperties }) => <span className="ms" style={style}>{children}</span>;

export function Agent() {
  const { snap } = useHubState();
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"ask" | "act">("act");
  const [focus, setFocus] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setThreads(await bridge().hub<AgentThread[]>("GET", "/api/agent/threads"));
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    void load();
    const off = bridge().on("agent-changed", () => void load());
    const iv = window.setInterval(load, 4000);
    return () => {
      off();
      clearInterval(iv);
    };
  }, [load]);

  const t = threads.find((x) => x.id === sel) ?? null;
  const busy = t?.status === "working";
  const ask: Ask | undefined = t?.askId ? snap?.asks.find((a) => a.id === t.askId) : undefined;
  const asking = t?.status === "asking" && !!ask;

  const send = async (text?: string) => {
    const prompt = (text ?? draft).trim();
    if (!prompt) return;
    setErr("");
    try {
      const r = await bridge().hub<{ id: string }>("POST", "/api/agent/threads", { prompt, mode });
      setDraft("");
      setSel(r.id);
      void load();
    } catch (e) {
      setErr(String((e as Error).message || e).replace(/^Error invoking remote method 'hub': (HubError: )?/, ""));
    }
  };
  const stop = async () => {
    if (!t) return;
    await bridge().hub("POST", `/api/agent/threads/${t.id}/stop`).catch(() => {});
    void load();
  };
  const answer = async (yes: boolean) => {
    if (!ask) return;
    await bridge().hub("POST", `/api/asks/${ask.id}/answer`, { yes }).catch(() => {});
    void load();
  };

  const suggestions = [
    { icon: "mail", label: "reply to my teacher about the latest deadline" },
    { icon: "event_note", label: "plan next week around my tests" },
    { icon: "school", label: "explain le chatelier in three lines" },
  ];
  const statusLine = !t ? "" : t.status === "stopped" ? "stopped" : t.status === "done" ? "done" : t.status === "error" ? t.error ?? "something went wrong" : asking ? "needs your ok" : "working · " + (t.steps[t.steps.length - 1]?.text ?? "starting");
  const statusFg = !t || t.status === "done" || t.status === "stopped" ? "#9a9aa3" : t.status === "error" ? "#ff8355" : "#ff4d17";
  const code = t?.log.find((l) => l.code)?.code;

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", background: "#0c0c0c", boxShadow: "inset 0 0 0 1px #ffffff14" }}>
      <div className="drag" style={{ width: 172, flex: "none", background: "#080808", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", padding: "12px 10px", gap: 2 }}>
        <span style={{ fontFamily: "Doto, monospace", fontWeight: 900, fontSize: 13, letterSpacing: 2, padding: "4px 8px 12px" }}>NUDGE</span>
        <div className="nodrag" onClick={() => setSel(null)} style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 10px", borderRadius: 9, cursor: "pointer", background: "#ff4d17" }}>
          <Ms style={{ fontSize: 17, color: "#0b0b0d" }}>add</Ms>
          <span style={{ fontSize: 12, color: "#0b0b0d" }}>new task</span>
        </div>
        <span style={{ fontSize: 10, letterSpacing: ".14em", color: "#8e8e97", padding: "16px 10px 6px" }}>RECENT</span>
        <div className="nodrag" style={{ flex: 1, overflowY: "auto" }}>
          {threads.map((c) => (
            <div key={c.id} onClick={() => setSel(c.id)} style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px", borderRadius: 9, cursor: "pointer", background: c.id === sel ? "#161616" : "transparent" }}>
              <span style={{ width: 6, height: 6, flex: "none", borderRadius: "50%", background: c.status === "stopped" || c.status === "error" ? "#8e8e97" : c.status === "done" ? "#f4f3ef" : "#ff4d17" }} />
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: c.id === sel ? "#f4f3ef" : "#b6b5af" }}>{c.prompt}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="drag" style={{ flex: "none", height: 40, display: "flex", alignItems: "center", paddingLeft: 20, borderBottom: "1px solid #1a1a1a" }}>
          <span style={{ fontSize: 12, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#c9c8c2" }}>{t ? t.prompt : "new task"}</span>
          {([["remove", "min", "#1d1d25"], ["crop_square", "max", "#1d1d25"], ["close", "close", "#c42b1c"]] as const).map(([icon, act, hover]) => (
            <div key={act} className="nodrag" onClick={() => bridge().win(act)} onMouseEnter={(e) => (e.currentTarget.style.background = hover)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")} style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Ms style={{ fontSize: 15, color: "#8e8e97" }}>{icon}</Ms>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          {!t && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, animation: "wStep .35s ease-out" }}>
              <span style={{ fontFamily: D, fontSize: 44, lineHeight: 1 }}>what's next?</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {suggestions.map((g) => (
                  <div key={g.label} onClick={() => send(g.label)} style={{ display: "flex", flexDirection: "column", gap: 18, padding: 14, borderRadius: 12, background: "#151515", cursor: "pointer" }}>
                    <Ms style={{ fontSize: 20, color: "#ff4d17" }}>{g.icon}</Ms>
                    <span style={{ fontSize: 12, lineHeight: 1.35, color: "#e6e5e0" }}>{g.label}</span>
                  </div>
                ))}
              </div>
              {!snap?.settings.ai && <span style={{ fontSize: 11, color: "#8e8e97" }}>The assistant is switched off in the app settings.</span>}
            </div>
          )}
          {t && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ alignSelf: "flex-end", maxWidth: "78%", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", background: "#222", fontSize: 13, lineHeight: 1.45, userSelect: "text" }}>{t.prompt}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <Ms style={{ fontSize: 17, color: statusFg, animation: busy ? "wSpin 1s linear infinite" : "none" }}>{t.status === "stopped" ? "stop_circle" : t.status === "done" ? "check_circle" : t.status === "error" ? "error" : asking ? "front_hand" : "progress_activity"}</Ms>
                <span style={{ fontSize: 12, flex: 1, color: statusFg }}>{statusLine}</span>
                {busy && (
                  <div onClick={stop} style={{ height: 26, display: "flex", alignItems: "center", gap: 5, padding: "0 10px", borderRadius: 13, cursor: "pointer", boxShadow: "inset 0 0 0 1px #2e2e2e" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: "#f4f3ef" }} />
                    <span style={{ fontSize: 11 }}>stop</span>
                  </div>
                )}
              </div>
              {t.steps.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 4, borderLeft: "2px solid #1c1c1c" }}>
                  {t.steps.map((s, i) => {
                    const current = busy && i === t.steps.length - 1;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: 10 }}>
                        <Ms style={{ fontSize: 15, color: current ? "#ff4d17" : "#ff4d17", animation: current ? "wSpin 1s linear infinite" : "none" }}>{current ? "progress_activity" : "check"}</Ms>
                        <span style={{ fontSize: 12, flex: 1, minWidth: 0, color: current ? "#f4f3ef" : "#b6b5af" }}>{s.text}</span>
                        <span style={{ fontSize: 10, letterSpacing: ".1em", color: "#8e8e97" }}>{s.meta}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {t.log.map((l, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, animation: "wStep .3s ease-out both", animationDelay: `${i * 0.06}s` }}>
                  <span style={{ fontSize: 13, lineHeight: 1.55, color: "#e6e5e0", textWrap: "pretty", userSelect: "text", whiteSpace: "pre-wrap" }}>{l.text}</span>
                  {l.code && (
                    <div style={{ position: "relative", padding: "12px 14px", borderRadius: 10, background: "#151515", boxShadow: "inset 0 0 0 1px #1f1f1f" }}>
                      <span style={{ display: "block", fontSize: 12, lineHeight: 1.55, paddingRight: 60, whiteSpace: "pre-wrap", userSelect: "text" }}>{l.code}</span>
                      <div onClick={() => { void bridge().copy(l.code!); setCopied(true); setTimeout(() => setCopied(false), 1600); }} style={{ position: "absolute", right: 8, top: 8, height: 24, display: "flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 7, cursor: "pointer", background: "#222" }}>
                        <Ms style={{ fontSize: 13, color: "#c9c8c2" }}>{copied ? "check" : "content_copy"}</Ms>
                        <span style={{ fontSize: 10, color: "#c9c8c2" }}>{copied ? "copied" : "copy"}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {asking && ask && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 12px 12px 14px", borderRadius: 12, background: "#f4f3ef", color: "#111114", animation: "wDrop .45s cubic-bezier(.32,.72,0,1)" }}>
                  <span style={{ fontSize: 9, letterSpacing: ".16em", color: "#6f6f78" }}>{ask.head}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, flex: 1, minWidth: 0, lineHeight: 1.35 }}>{ask.line}</span>
                    <div onClick={() => answer(true)} style={{ height: 32, display: "flex", alignItems: "center", gap: 5, padding: "0 12px", borderRadius: 9, cursor: "pointer", background: "#111114", color: "#f4f3ef" }}>
                      <Ms style={{ fontSize: 15 }}>check</Ms><span style={{ fontSize: 12 }}>{ask.kind === "email" ? "open to send" : "yes"}</span>
                    </div>
                    <div onClick={() => { void answer(false); setDraft(`change it: `); }} style={{ height: 32, display: "flex", alignItems: "center", gap: 5, padding: "0 12px", borderRadius: 9, cursor: "pointer", background: "#dcd8d0" }}>
                      <Ms style={{ fontSize: 15 }}>edit</Ms><span style={{ fontSize: 12 }}>edit</span>
                    </div>
                  </div>
                  {ask.kind === "email" && <span style={{ fontSize: 10, color: "#6f6f78" }}>Opens in Outlook, filled in. You press send — Nudge never sends mail itself.</span>}
                </div>
              )}
              {t.output && t.status === "done" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 12px", borderRadius: 12, boxShadow: "inset 0 0 0 1px #242424", animation: "wIn .34s ease-out" }}>
                  <Ms style={{ fontSize: 18, color: "#ff4d17" }}>{t.output.icon}</Ms>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 12 }}>{t.output.file}</span>
                    <span style={{ fontSize: 10, letterSpacing: ".1em", color: "#8e8e97" }}>{t.output.meta}</span>
                  </div>
                  {t.output.noteId && (
                    <div onClick={() => bridge().open("notes")} style={{ height: 28, display: "flex", alignItems: "center", gap: 4, padding: "0 10px", borderRadius: 8, cursor: "pointer", background: "#1a1a1a" }}>
                      <Ms style={{ fontSize: 14, color: "#c9c8c2" }}>open_in_new</Ms><span style={{ fontSize: 11, color: "#c9c8c2" }}>open</span>
                    </div>
                  )}
                  {code && (
                    <div onClick={() => void bridge().copy(code)} style={{ height: 28, display: "flex", alignItems: "center", gap: 4, padding: "0 10px", borderRadius: 8, cursor: "pointer", background: "#1a1a1a" }}>
                      <Ms style={{ fontSize: 14, color: "#c9c8c2" }}>content_copy</Ms><span style={{ fontSize: 11, color: "#c9c8c2" }}>copy</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: "none", padding: "0 16px 14px" }}>
          {err && <div style={{ fontSize: 11, color: "#ff8355", padding: "0 6px 8px" }}>{err}</div>}
          <div style={{ borderRadius: 16, background: "#161616", boxShadow: `inset 0 0 0 1px ${focus ? "#ff4d17" : "#262626"}`, padding: "6px 6px 6px 16px", display: "flex", alignItems: "center", gap: 8, transition: "box-shadow .2s" }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder="what should nudge do?" style={{ flex: 1, minWidth: 0, height: 40, border: 0, outline: 0, background: "transparent", fontSize: 13, color: "#f4f3ef" }} />
            <div style={{ display: "flex", padding: 2, borderRadius: 10, background: "#0c0c0c" }}>
              {([["ask", "chat_bubble", "answers only"], ["act", "bolt", "can do things, asks before sending"]] as const).map(([id, icon, tip]) => (
                <div key={id} title={tip} onClick={() => setMode(id)} style={{ height: 30, display: "flex", alignItems: "center", gap: 4, padding: "0 10px", borderRadius: 8, cursor: "pointer", background: mode === id ? "#262626" : "transparent", transition: "background-color .25s" }}>
                  <Ms style={{ fontSize: 14, color: mode === id ? "#f4f3ef" : "#9a9aa3" }}>{icon}</Ms>
                  <span style={{ fontSize: 11, color: mode === id ? "#f4f3ef" : "#9a9aa3" }}>{id}</span>
                </div>
              ))}
            </div>
            <div onClick={() => (busy ? void stop() : void send())} style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: busy ? "#f4f3ef" : draft.trim() ? "#ff4d17" : "#262626", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background-color .2s" }}>
              <Ms style={{ fontSize: 20, color: busy || draft.trim() ? "#0b0b0d" : "#8e8e97" }}>{busy ? "stop" : "arrow_upward"}</Ms>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
