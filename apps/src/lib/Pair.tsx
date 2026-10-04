import { useState } from "react";
import { type AppKey, defaultHub, pair } from "./hub";
import { Btn, D, inputStyle, Ms } from "./ui";

/** First run: connect this device to the wall with the 6-digit code it shows. */
export function Pair({ app, dark, title, onDone, onLocal }: { app: AppKey; dark: boolean; title: string; onDone: () => void; onLocal?: () => void }) {
  const [hub, setHub] = useState(defaultHub());
  // Opened from the QR code on the wall: the code is in the link, so it's one tap.
  const [fromQr] = useState(() => {
    const c = new URLSearchParams(location.search).get("pair");
    if (c) history.replaceState(history.state, "", location.pathname);
    return c && /^\d{6}$/.test(c) ? c : "";
  });
  const [code, setCode] = useState(fromQr ? `${fromQr.slice(0, 3)} ${fromQr.slice(3)}` : "");
  const [name, setName] = useState(guessName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const how =
    app === "parent"
      ? "First parent: on the wall hold key 3, press key 1 (PAIR), then key 2 (PARENT). After that, new parent codes can only be made from a parent app (settings › devices)."
      : "On the wall: hold key 3 for a second, then press key 1 (PAIR). Type the six numbers it shows.";

  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      // "nudge.tail1234.ts.net" or "192.168.1.40:8787" typed without the https:// still works
      const h = hub.trim().replace(/\/+$/, "");
      const base = !h ? location.origin : /^https?:\/\//.test(h) ? h : /^(\d+\.){3}\d+(:\d+)?$/.test(h) ? `http://${h}` : `https://${h}`;
      await pair(app, base, code.replace(/\s/g, ""), name.trim() || "device");
      onDone();
    } catch (e) {
      setErr((e as Error).message || "that didn't work");
    } finally {
      setBusy(false);
    }
  };

  const muted = dark ? "var(--c-8e8e97)" : "var(--c-6f6f78)";
  return (
    <div className="page" style={{ padding: "calc(40px + env(safe-area-inset-top)) 22px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: D, fontSize: 44, lineHeight: 0.9 }}>{title}</span>
        <span style={{ flex: 1 }} />
        <Ms style={{ fontSize: 22, color: "var(--c-ff4d17)" }}>link</Ms>
      </div>
      <span style={{ fontSize: 11, lineHeight: 1.55, color: muted }}>{fromQr ? "Scanned from the wall. Name this phone and connect." : how}</span>
      {!defaultHub() && (
        <input style={inputStyle(dark)} value={hub} onChange={(e) => setHub(e.target.value)} placeholder="hub address, e.g. https://nudge.tail1234.ts.net" autoCapitalize="off" autoCorrect="off" inputMode="url" />
      )}
      <input
        style={{ ...inputStyle(dark), height: 64, fontFamily: "Doto, monospace", fontWeight: 900, fontSize: 30, letterSpacing: 6, textAlign: "center" }}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
        placeholder="000 000"
        inputMode="numeric"
        autoFocus={!fromQr}
      />
      <input style={inputStyle(dark)} value={name} onChange={(e) => setName(e.target.value)} placeholder="name this device" />
      {err && <span style={{ fontSize: 11, color: "var(--c-ff4d17)" }}>{err}</span>}
      <Btn primary disabled={busy || code.replace(/\D/g, "").length !== 6} onClick={go}>
        {busy ? "connecting…" : "connect to the wall"}
      </Btn>
      <span style={{ fontSize: 9, lineHeight: 1.5, color: muted }}>
        The code works once and only for ten minutes. This device gets its own key, which you can remove from the wall's device list any time.
      </span>
      {onLocal && (
        <span className="tap" onClick={onLocal} style={{ alignSelf: "center", marginTop: 6, fontSize: 11, color: muted, textDecoration: "underline", textUnderlineOffset: 3 }}>
          no wall yet? keep notes on this phone
        </span>
      )}
    </div>
  );
}

function guessName(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android phone";
  if (/iphone|ipad/i.test(ua)) return "iphone";
  if (/windows/i.test(ua)) return "windows pc";
  if (/mac/i.test(ua)) return "mac";
  return "device";
}
