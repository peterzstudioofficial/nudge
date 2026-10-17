import { useEffect, useState } from "react";
import type { Snapshot } from "@nudge/shared";

interface NudgeBridge {
  state(): Promise<{ snap: Snapshot | null; online: boolean; paired: boolean; hub: string | null }>;
  hub<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  pair(hub: string, code: string, name: string): Promise<boolean>;
  signIn(): Promise<boolean>;
  win(action: "min" | "max" | "close" | "hide"): Promise<void>;
  open(what: "notes" | "tasks"): Promise<void>;
  toastDone(): Promise<void>;
  scale(k: number): Promise<void>;
  toastAction(a: string): Promise<void>;
  snoozeBedtime(): Promise<void>;
  copy(text: string): Promise<void>;
  on(channel: "snapshot" | "online" | "nudge" | "sign" | "bedtime" | "toast" | "scale", cb: (data: unknown) => void): () => void;
}

declare global {
  interface Window {
    nudge: NudgeBridge;
  }
}

export const bridge = (): NudgeBridge => window.nudge;

export function useHubState() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    void bridge().state().then((s) => {
      setSnap(s.snap);
      setOnline(s.online);
    });
    const a = bridge().on("snapshot", (s) => setSnap(s as Snapshot));
    const b = bridge().on("online", (o) => setOnline(!!o));
    return () => {
      a();
      b();
    };
  }, []);
  // every second only while there is a session; otherwise twice a minute is plenty
  const [, force] = useState(0);
  const counting = !!snap?.session; // running, paused or on a break: all show a live clock
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), counting ? 1000 : 30_000);
    return () => clearInterval(iv);
  }, [counting]);
  return { snap, online };
}
