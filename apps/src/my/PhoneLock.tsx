import { useEffect, useState } from "react";
import type { Snapshot } from "@nudge/shared";
import { loadPairing } from "../lib/hub";
import { native } from "../lib/native";
import { D, DOTO, Ms, toast } from "../lib/ui";

/**
 * Phone lock (Nudge Apps › desktop › "phone lock"). Shown over any other app while a focus
 * session runs on the wall. Calls, messages, maps and school always open; everything else waits.
 */
const OPEN = [
  { icon: "call", which: "call" },
  { icon: "chat", which: "chat" },
  { icon: "map", which: "map" },
  { icon: "school", which: "school" },
] as const;

export function usePhoneLock(snap: Snapshot | null): [boolean, () => void] {
  const [shown, setShown] = useState(false);
  const n = native();
  // Tell the native side where the hub is and this phone's key, so it can check for sessions.
  useEffect(() => {
    const p = loadPairing("owner");
    if (n && p) void n.configure({ hub: p.hub, token: p.token }).catch(() => {});
  }, [n]);
  useEffect(() => {
    if (!n) return;
    let off: { remove: () => void } | null = null;
    void n.addListener("lock", () => setShown(true)).then((h) => (off = h));
    const check = () => void n.lockStatus().then((s) => s.launchedForLock && setShown(true)).catch(() => {});
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      off?.remove();
      document.removeEventListener("visibilitychange", check);
    };
  }, [n]);
  const active = !!snap?.session && snap.session.state !== "paused";
  useEffect(() => {
    if (!active) setShown(false);
  }, [active]);
  return [shown && active, () => setShown(false)];
}

export function PhoneLock({ snap, onHide }: { snap: Snapshot; onHide: () => void }) {
  const n = native();
  const task = snap.tasks.find((t) => t.id === snap.session?.taskId);
  const school = snap.settings.schoolPages[0]?.url;
  const go = async (which: (typeof OPEN)[number]["which"]) => {
    try {
      await n?.openApp({ which, url: which === "school" ? school : undefined });
    } catch (e) {
      toast("block", String((e as Error).message || e).slice(0, 40));
    }
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "var(--c-0a0a0c)", display: "flex", flexDirection: "column", padding: "max(22px, env(safe-area-inset-top)) 18px 24px", animation: "aFade .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, height: 44, borderBottom: "1px solid var(--c-16161c)", marginBottom: 18 }}>
        <Ms style={{ fontSize: 15, color: "var(--c-8e8e97)" }}>smartphone</Ms>
        <span style={{ fontSize: 10 }}>phone lock</span>
        <span style={{ flex: 1 }} />
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--c-ff4d17)", animation: "aBreath 3s ease-in-out infinite" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 22 }}>
        <span style={{ fontFamily: D, fontSize: 40, lineHeight: 0.9 }}>not now :)</span>
        {task && <span style={{ fontSize: 11, color: "var(--c-8e8e97)" }}>{task.name} is on the wall</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 11, marginBottom: 17 }}>
        {OPEN.map((a) => (
          <div key={a.which} className="tap" onClick={() => void go(a.which)} style={{ aspectRatio: "1", borderRadius: 11, background: "var(--c-13131a)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ms style={{ fontSize: 20, color: "var(--c-c9c8c2)" }}>{a.icon}</Ms>
          </div>
        ))}
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={{ aspectRatio: "1", borderRadius: 11, background: "var(--c-101015)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.55 }}>
            <Ms style={{ fontSize: 20, color: "var(--c-5a2a1e)" }}>lock</Ms>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <Ms style={{ fontSize: 13, lineHeight: 1.3, color: "var(--c-43434c)" }}>call</Ms>
        <span style={{ fontSize: 9, lineHeight: 1.45, color: "var(--c-8e8e97)" }}>Calls, messages and maps never lock. Nothing here can be turned off from the phone during a session.</span>
      </div>
      <span style={{ flex: 1 }} />
      <div className="tap" onClick={onHide} style={{ height: 44, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-13131a)", color: "var(--c-8e8e97)", fontSize: 10 }}>
        see today's list
      </div>
      <span style={{ display: "none", fontFamily: DOTO }} />
    </div>
  );
}

/** Settings row logic: turning it on walks through the two permissions Android needs. */
export async function togglePhoneLock(on: boolean): Promise<string> {
  const n = native();
  if (!n) return "only in the Android app";
  const s = await n.lockStatus();
  if (!on) {
    await n.setLock({ enabled: false });
    return "phone lock off";
  }
  if (!s.usageAccess) {
    await n.openUsageSettings();
    return "turn on usage access for nudge, then tap again";
  }
  if (!s.overlay) {
    await n.openOverlaySettings();
    return "allow “display over other apps”, then tap again";
  }
  await n.setLock({ enabled: true });
  return "phone lock on";
}
