import { useState } from "react";
import { bridge } from "./bridge";

const D = "'ZCOOL QingKe HuangYou', sans-serif";

/** First run on a computer: connect to the wall with a code from “pair a computer”. */
export function Pair() {
  const [hub, setHub] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("windows pc");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inp: React.CSSProperties = { height: 46, borderRadius: 12, border: 0, outline: 0, padding: "0 14px", background: "#17171d", color: "#f4f3ef", fontSize: 13, boxShadow: "inset 0 0 0 1px #26262e" };
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await bridge().pair(hub, code, name.trim() || "windows pc");
    } catch (e) {
      setErr(String((e as Error).message).replace(/^Error invoking remote method 'pair': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ padding: "34px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ fontFamily: D, fontSize: 40, lineHeight: 0.9 }}>nudge</span>
      <span style={{ fontSize: 11, lineHeight: 1.55, color: "#8e8e97" }}>
        Connect this computer to the wall. On the wall hold key 3, then press key 1 (PAIR) — or use “pair a computer” in the setup page — and type the six numbers here.
      </span>
      <input style={inp} value={hub} onChange={(e) => setHub(e.target.value)} placeholder="hub address — https://nudge.your-tailnet.ts.net" />
      <input style={{ ...inp, height: 62, fontFamily: "Doto, monospace", fontWeight: 900, fontSize: 28, letterSpacing: 6, textAlign: "center" }} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))} placeholder="000 000" />
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="name this computer" />
      {err && <span style={{ fontSize: 11, color: "#ff8355" }}>{err}</span>}
      <button disabled={busy || code.replace(/\D/g, "").length !== 6 || !hub} onClick={go} style={{ height: 50, borderRadius: 14, border: 0, background: busy || code.replace(/\D/g, "").length !== 6 || !hub ? "#13131a" : "#ff4d17", color: "#0b0b0d", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>
        {busy ? "connecting…" : "connect"}
      </button>
      <span style={{ fontSize: 9, lineHeight: 1.5, color: "#5f5f67" }}>The key this computer gets is stored encrypted for your Windows account only.</span>
    </div>
  );
}
