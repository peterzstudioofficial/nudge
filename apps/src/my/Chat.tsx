import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentThread, Snapshot } from "@nudge/shared";
import { getClient } from "../lib/hub";
import { openTool } from "../lib/native";
import { D, Ms, haptic, toast, toastError } from "../lib/ui";
import { AskCard } from "./AskCard";
import { BuildCard, useToolsInfo, type ToolsInfo } from "./ToolKit";

/**
 * Talk to the assistant from the phone. Same assistant as the wall (same tools, same rules:
 * anything that leaves the house is only a proposal that waits for a held yes). Questions asked at
 * the wall or on the computer show up here too, so it's one conversation history.
 */

const SUGGEST = [
  "what's due this week?",
  "plan my chemistry revision",
  "what did school send today?",
  "email mr hale asking for an extension",
  "remind me to pack my PE kit at 8",
  "what's on my bag list?",
];
const VOICE = "(voice)";
/** what the small tools button starts a question with */
const MAKE = "make me a tool that ";
/** a follow-up carries on from the last answer for this long */
const FOLLOW_MS = 20 * 60_000;

const answerOf = (t: AgentThread) => [...t.log].reverse().find((l) => l.icon === "lightbulb")?.text ?? "";

export function ChatTab({ snap }: { snap: Snapshot }) {
  const client = getClient("owner")!;
  const [threads, setThreads] = useState<AgentThread[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [fresh, setFresh] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const tools = useToolsInfo(snap);
  // The subtle way in to building something: start the sentence, then they finish it.
  const startTool = () => {
    haptic();
    setText(MAKE);
    requestAnimationFrame(() => {
      const b = box.current;
      if (!b) return;
      b.focus();
      b.setSelectionRange(MAKE.length, MAKE.length);
    });
  };

  const load = async () => {
    try {
      const list = await client.send<AgentThread[]>("GET", "/api/agent/threads");
      setThreads([...(list ?? [])].reverse());
    } catch {
      setThreads((t) => t ?? []);
    }
  };
  // Everything changes the snapshot's rev; reload then (cheap), and tick while something's working.
  useEffect(() => void load(), [snap.rev]);
  const working = threads?.some((t) => t.status === "working");
  useEffect(() => {
    if (!working) return;
    const iv = window.setInterval(() => void load(), 900);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);
  const count = threads?.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: count > 1 ? "smooth" : "auto" });
  }, [count, threads?.at(-1)?.status]);

  // Carry on from the last answer from here or the computer (not a wall question) if it's recent.
  const last = threads?.filter((t) => t.origin !== "wall").at(-1);
  const follow = !fresh && last && last.status !== "working" && Date.now() - last.updatedAt < FOLLOW_MS ? last : null;

  const send = async (prompt: string) => {
    const p = prompt.trim();
    if (!p || sending) return;
    setSending(true);
    haptic();
    try {
      await client.send("POST", "/api/agent/threads", { prompt: p, mode: "act", follow: follow?.id ?? null });
      setText("");
      setFresh(false);
      if (box.current) box.current.style.height = "";
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      setSending(false);
    }
  };
  const stop = async (id: string) => {
    await client.send("POST", `/api/agent/threads/${id}/stop`).catch(toastError);
    void load();
  };

  const off = !snap.settings.ai;
  return (
    <div style={{ padding: "0 18px 150px" }}>
      {off && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, background: "var(--c-13131a)", marginBottom: 14 }}>
          <Ms style={{ fontSize: 18, color: "var(--c-ff4d17)" }}>smart_toy</Ms>
          <span style={{ flex: 1, fontSize: 11, lineHeight: 1.45, color: "var(--c-b6b5af)" }}>The assistant is off.</span>
          <button className="tap" onClick={() => void client.send("PATCH", "/api/settings", { ai: true }).then(() => client.snapshot()).catch(toastError)} style={{ border: 0, borderRadius: 10, padding: "8px 12px", background: "var(--c-ff4d17)", color: "var(--c-0b0b0d)", font: "inherit", fontSize: 10 }}>
            turn on
          </button>
        </div>
      )}

      {threads && !threads.length && (
        <div style={{ padding: "18px 2px 6px", animation: "aUp .35s ease-out both" }}>
          <div style={{ fontFamily: D, fontSize: 24, lineHeight: 1.05, color: "var(--c-f4f3ef)" }}>ask about school, your week, your notes and documents.</div>
          <div style={{ fontSize: 10, lineHeight: 1.6, color: "var(--c-8e8e97)", marginTop: 10 }}>
            Plans revision, drafts emails, sets reminders, builds small apps. Anything that sends or changes your week waits for your yes.
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {(threads ?? []).map((t) => (
          <Turn key={t.id} t={t} snap={snap} tools={tools} onStop={() => void stop(t.id)} onRetry={() => void send(t.prompt)} />
        ))}
      </div>
      <div ref={end} />

      {/* the composer, pinned above the gesture bar (outside the sliding tab, which would carry it along) */}
      {createPortal(<div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "min(100%, 520px)", padding: "10px 14px calc(12px + env(safe-area-inset-bottom))", background: "linear-gradient(to top, var(--c-0a0a0c) 70%, var(--c-0a0a0c00))", pointerEvents: "auto" }}>
          {(!threads?.length || !text) && !sending && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, scrollbarWidth: "none" }}>
              {(follow ? ["shorter", "more detail", "put it on the wall", "save it to my notes"] : SUGGEST).map((s) => (
                <button key={s} className="tap" onClick={() => void send(s)} disabled={off} style={{ flex: "none", border: 0, borderRadius: 14, padding: "7px 11px", background: "var(--c-13131a)", color: "var(--c-b6b5af)", font: "inherit", fontSize: 10, whiteSpace: "nowrap" }}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {follow && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px 7px", fontSize: 9, color: "var(--c-6d6d77)" }}>
              <Ms style={{ fontSize: 12 }}>subdirectory_arrow_right</Ms>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>carrying on from "{follow.prompt === VOICE ? "a spoken question" : follow.prompt}"</span>
              <span className="tap" role="button" aria-label="start fresh" onClick={() => setFresh(true)} style={{ color: "var(--c-8e8e97)" }}>
                new topic
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, padding: 6, borderRadius: 22, background: "var(--c-13131a)", boxShadow: "inset 0 0 0 1px var(--c-1c1c23)" }}>
            <button
              className="tap"
              aria-label="make a tool"
              title="make a tool"
              disabled={off}
              onClick={startTool}
              style={{
                flex: "none", width: text ? 0 : 32, height: 36, marginRight: text ? -4 : 0, border: 0, padding: 0, borderRadius: "50%", background: "transparent", color: "var(--c-6d6d77)",
                display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", opacity: text ? 0 : 1,
                transition: "width .35s cubic-bezier(.32,.72,0,1), opacity .25s, margin .35s cubic-bezier(.32,.72,0,1)",
              }}
            >
              <Ms style={{ fontSize: 19 }}>widgets</Ms>
            </button>
            <textarea
              ref={box}
              value={text}
              rows={1}
              disabled={off}
              placeholder={off ? "assistant is off" : "ask nudge…"}
              onChange={(e) => {
                setText(e.target.value.slice(0, 2000));
                e.target.style.height = "auto";
                e.target.style.height = Math.min(120, e.target.scrollHeight) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              style={{ flex: 1, minWidth: 0, resize: "none", border: 0, outline: "none", background: "transparent", color: "var(--c-f4f3ef)", font: "inherit", fontSize: 13, lineHeight: 1.4, padding: "8px 8px" }}
            />
            <button
              className="tap"
              aria-label="send"
              disabled={!text.trim() || sending || off}
              onClick={() => void send(text)}
              style={{ flex: "none", width: 36, height: 36, borderRadius: "50%", border: 0, display: "flex", alignItems: "center", justifyContent: "center", background: text.trim() && !sending ? "var(--c-ff4d17)" : "var(--c-22222a)", color: "var(--c-0b0b0d)", transition: "background-color .25s" }}
            >
              <Ms style={{ fontSize: 19, animation: sending ? "spin 1s linear infinite" : "none" }}>{sending ? "progress_activity" : "arrow_upward"}</Ms>
            </button>
          </div>
        </div>
      </div>, document.body)}
    </div>
  );
}

const WHERE: Record<AgentThread["origin"], string> = { wall: "AT THE WALL", desktop: "ON THE COMPUTER", app: "" };

function Turn({ t, snap, tools, onStop, onRetry }: { t: AgentThread; snap: Snapshot; tools: ToolsInfo | null; onStop: () => void; onRetry: () => void }) {
  const builds = snap.jobs.filter((j) => j.threadId === t.id);
  const answer = answerOf(t);
  const sources = t.log.find((l) => l.icon === "public")?.text.split("\n").map((l) => {
    const [title, url] = l.split(" — ");
    return { title: title?.trim() ?? url, url: url?.trim() ?? "" };
  }).filter((s) => /^https?:\/\//.test(s.url)) ?? [];
  const notice = [...t.log].reverse().find((l) => l.icon === "block" || l.icon === "lock")?.text;
  const ask = t.askId ? snap.asks.find((a) => a.id === t.askId) : null;
  const time = new Date(t.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      haptic();
      toast("content_copy", "copied");
    } catch {
      toast("content_copy", "couldn't copy");
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, animation: "aUp .3s ease-out both" }}>
      <div style={{ alignSelf: "flex-end", maxWidth: "84%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <div style={{ padding: "10px 14px", borderRadius: "18px 18px 6px 18px", background: "var(--c-22222a)", color: "var(--c-f4f3ef)", fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {t.prompt === VOICE ? <i style={{ color: "var(--c-8e8e97)" }}>spoken at the wall</i> : t.prompt}
        </div>
        <span style={{ fontSize: 8, letterSpacing: ".14em", color: "var(--c-5c5c66)" }}>{[WHERE[t.origin], time].filter(Boolean).join(" · ")}</span>
      </div>

      <div style={{ maxWidth: "92%", display: "flex", flexDirection: "column", gap: 8 }}>
        {t.status === "working" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 2px" }}>
            {(t.steps.length ? t.steps.slice(-3) : [{ text: "thinking", meta: "", done: false }]).map((s, i, arr) => {
              const live = !s.done && i === arr.length - 1;
              return (
                <div key={s.text + i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: live ? "var(--c-f4f3ef)" : "var(--c-8e8e97)", animation: "aFade .25s ease-out both" }}>
                  <Ms style={{ fontSize: 14, color: live ? "var(--c-ff4d17)" : "var(--c-6d6d77)", animation: live ? "spin 1.1s linear infinite" : "none" }}>{live ? "progress_activity" : "check"}</Ms>
                  <span>{s.text}</span>
                  {s.meta && <span style={{ fontSize: 8, letterSpacing: ".12em", color: "var(--c-5c5c66)" }}>{s.meta}</span>}
                </div>
              );
            })}
            <span className="tap" role="button" onClick={onStop} style={{ alignSelf: "flex-start", fontSize: 10, color: "var(--c-8e8e97)", padding: "4px 0" }}>
              stop
            </span>
          </div>
        )}

        {answer && <Answer text={answer} onCopy={() => void copy()} />}
        {!answer && notice && t.status !== "working" && <div style={{ fontSize: 12, color: "var(--c-b6b5af)", padding: "2px" }}>{notice}</div>}

        {sources.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 2 }}>
            {sources.map((s) => (
              <span key={s.url} className="tap" role="link" onClick={() => void openTool(s.url)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, color: "var(--c-8e8e97)", overflow: "hidden" }}>
                <Ms style={{ fontSize: 12, color: "var(--c-6d6d77)" }}>public</Ms>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
              </span>
            ))}
          </div>
        )}

        {t.status === "asking" && (ask ? <AskCard a={ask} /> : <div style={{ fontSize: 10, color: "var(--c-8e8e97)" }}>waiting for your yes on the wall or Today</div>)}

        {builds.map((j) => <BuildCard key={j.id} job={j} snap={snap} info={tools} />)}

        {t.output && t.status !== "working" && (
          <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 7, padding: "7px 11px", borderRadius: 12, background: "var(--c-13131a)", fontSize: 10, color: "var(--c-b6b5af)" }}>
            <Ms style={{ fontSize: 14, color: "var(--c-ff4d17)" }}>{t.output.icon}</Ms>
            <span>{t.output.file}</span>
            <span style={{ fontSize: 8, letterSpacing: ".14em", color: "var(--c-6d6d77)" }}>{t.output.meta}</span>
          </div>
        )}

        {t.status === "error" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "var(--c-b6b5af)" }}>
            <Ms style={{ fontSize: 15, color: "var(--c-ff4d17)" }}>error</Ms>
            <span style={{ flex: 1 }}>{friendlyError(t.error)}</span>
            {t.prompt !== VOICE && (
              <span className="tap" role="button" onClick={onRetry} style={{ color: "var(--c-ff4d17)", fontSize: 10 }}>
                try again
              </span>
            )}
          </div>
        )}
        {t.status === "stopped" && !answer && <span style={{ fontSize: 10, color: "var(--c-6d6d77)" }}>stopped</span>}
      </div>
    </div>
  );
}

/** The answer, with light formatting: paragraphs, "- " lists, **bold** kept as plain text, links tappable. */
function Answer({ text, onCopy }: { text: string; onCopy: () => void }) {
  const blocks = useMemo(() => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").split(/\n{2,}/), [text]);
  return (
    <div style={{ position: "relative", padding: "2px 2px 0", color: "var(--c-dedad4)", fontSize: 13, lineHeight: 1.55 }}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        const list = lines.every((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l));
        return list ? (
          <ul key={i} style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            {lines.map((l, k) => (
              <li key={k} style={{ marginBottom: 2 }}>
                <Linked s={l.replace(/^\s*([-•*]|\d+[.)])\s+/, "")} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            <Linked s={b} />
          </p>
        );
      })}
      <span className="tap" role="button" aria-label="copy" onClick={onCopy} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, color: "var(--c-6d6d77)" }}>
        <Ms style={{ fontSize: 13 }}>content_copy</Ms> copy
      </span>
    </div>
  );
}

function Linked({ s }: { s: string }) {
  const parts = s.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <span key={i} className="tap" role="link" onClick={() => void openTool(p)} style={{ color: "var(--c-ff4d17)", overflowWrap: "anywhere" }}>
            {p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function friendlyError(e: string | null): string {
  const m = (e ?? "").toLowerCase();
  if (/budget/.test(m)) return "this month's AI budget is used up (raise it in setup).";
  if (/key|401|unauthor/.test(m)) return "the assistant isn't set up on the wall (no OpenRouter key).";
  if (/fetch|network|timeout|econn/.test(m)) return "couldn't reach the AI just now.";
  return e ? `couldn't answer: ${e.slice(0, 90)}` : "something went wrong.";
}
