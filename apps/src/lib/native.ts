/**
 * Bridge to the Android app's native side (phone lock, opening allowed apps, Google Keep).
 * Everything here is optional: in a browser or on the desktop it's simply not there.
 */
export interface NudgeNative {
  configure(o: { hub: string; token: string }): Promise<void>;
  lockStatus(): Promise<{ usageAccess: boolean; overlay: boolean; enabled: boolean; sessionActive: boolean; launchedForLock: boolean }>;
  openUsageSettings(): Promise<void>;
  openOverlaySettings(): Promise<void>;
  setLock(o: { enabled: boolean }): Promise<void>;
  openApp(o: { which: "call" | "chat" | "map" | "school"; url?: string }): Promise<void>;
  shareToKeep(o: { title: string; text: string }): Promise<void>;
  openInBrowser(o: { url: string }): Promise<void>;
  setBars?(o: { light: boolean; color: string }): Promise<void>;
  addListener(ev: "lock", cb: (d: { blocked?: string }) => void): Promise<{ remove: () => void }>;
}

let cached: NudgeNative | null | undefined;

export function native(): NudgeNative | null {
  if (cached !== undefined) return cached;
  const C = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; registerPlugin?: (n: string) => unknown } }).Capacitor;
  cached = C?.isNativePlatform?.() && C.getPlatform?.() === "android" && C.registerPlugin ? (C.registerPlugin("NudgeNative") as NudgeNative) : null;
  return cached;
}

/** Send a note to Google Keep: the Android app hands it straight to Keep; browsers use the share sheet. */
export async function sendToKeep(title: string, text: string): Promise<"sent" | "copied"> {
  const n = native();
  if (n) {
    await n.shareToKeep({ title, text });
    return "sent";
  }
  if (navigator.share) {
    await navigator.share({ title, text });
    return "sent";
  }
  await navigator.clipboard.writeText(`${title}\n\n${text}`);
  window.open("https://keep.google.com/", "_blank", "noopener");
  return "copied";
}

/** Open a built tool in the real browser (Chrome on Android), where it can be installed as an app. */
export async function openTool(url: string): Promise<void> {
  const n = native();
  if (n) return n.openInBrowser({ url });
  window.open(url, "_blank", "noopener");
}

