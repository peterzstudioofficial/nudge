import { useEffect, useState } from "react";
import type { Snapshot } from "@nudge/shared";

interface NudgeBridge {
  state(): Promise<{ snap: Snapshot | null; online: boolean; paired: boolean; hub: string | null }>;
  hub<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  pair(hub: string, code: string, name: string): Promise<boolean>;
  signIn(): Promise<boolean>;
  win(action: "min" | "max" | "close" | "hide"): Promise<void>;
  open(what: "agent" | "notes" | "tasks"): Promise<void>;
  snoozeBedtime(): Promise<void>;
  copy(text: string): Promise<void>;
  on(channel: "snapshot" | "online" | "nudge" | "sign" | "bedtime" | "agent-changed", cb: (data: unknown) => void): () => void;
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
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  return { snap, online };
}
