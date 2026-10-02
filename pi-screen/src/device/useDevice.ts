import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { HubClient, localKV, type LedFrame } from "@nudge/shared";
import { Device } from "./device";
import { buildVm } from "./vm";

let singleton: Device | null = null;

/** One device per page. Loopback pages need no token: the hub treats the Pi itself as the wall. */
export function getDevice(): Device {
  if (!singleton) {
    const params = new URLSearchParams(location.search);
    const base = params.get("hub") || location.origin;
    const client = new HubClient({ baseUrl: base, token: params.get("token"), kv: localKV("nudge-wall:") });
    singleton = new Device(client);
    singleton.start();
  }
  return singleton;
}

export function useDevice(size: { w: number; h: number }) {
  const d = useMemo(getDevice, []);
  // The device's own once-a-second beat re-renders clocks and countdowns; nothing else polls.
  useSyncExternalStore(d.subscribe, () => d.s);
  const built = buildVm(d, size);
  useLedOutput(d, built.panel);
  return { d, ...built };
}

/** Send the LED picture to the GPIO daemon (through the hub) when it changes. */
function useLedOutput(d: Device, panel: ReturnType<typeof buildVm>["panel"]) {
  const key = panel.pat + ":" + panel.barPct + ":" + panel.leds.map((l) => l.bg + l.o + l.anim).join("|") + panel.dialLed + panel.touchRing;
  useEffect(() => {
    const frame: LedFrame = {
      cells: panel.leds.map((l) => ({ c: l.bg === "#d2d0c8" ? "#000000" : l.bg, o: l.bg === "#d2d0c8" ? 0 : l.o, anim: l.anim.split(" ")[0] })),
      bar: { pct: panel.barPct, on: panel.barOn, lit: panel.barLit },
      dialLed: panel.dialLed,
      touchRing: panel.touchRing,
    };
    d.client.wsSend({ type: "leds", frame });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Fit the logical 240-pt-tall screen to whatever display is plugged in. */
export function useFit(minW = 320, baseH = 240) {
  const measure = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    let scale = vh / baseH;
    if (vw / scale < minW) scale = vw / minW;
    return { scale, w: vw / scale, h: vh / scale };
  };
  const [fit, setFit] = useState(measure);
  useEffect(() => {
    const on = () => setFit(measure());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return fit;
}
