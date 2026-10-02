import { useEffect, useRef, useState } from "react";
import { glyphCell, glyphFrameAt, LIGHT_MOMENTS, type Glyph, type LightMoment, type LightPack } from "@nudge/shared";
import { getClient, useHubGet, useSnapshot } from "../lib/hub";
import { Ms, Sheet, toast, toastError } from "../lib/ui";

const MOMENT_NAME: Record<LightMoment, string> = {
  idle: "resting", award: "points won", unlock: "reward unlocked", listen: "a question", voice: "talking", alarm: "morning alarm", bag: "packing", timer: "timer",
};

/** A glyph as a tiny 5×5 grid. Still unless it's the one picked (nothing animates in the background). */
function Mini({ g, live, size = 5 }: { g: Glyph; live?: boolean; size?: number }) {
  const [f, setF] = useState(0);
  const t0 = useRef(Date.now());
  useEffect(() => {
    setF(0);
    if (!live || g.frames.length < 2) return;
    t0.current = Date.now();
    const iv = window.setInterval(() => setF(glyphFrameAt(g, Date.now() - t0.current)), 1000 / g.fps / 2);
    return () => window.clearInterval(iv);
  }, [g, live]);
  return (
    <span style={{ display: "grid", gridTemplateColumns: `repeat(5,${size}px)`, gap: size * 0.45 }}>
      {Array.from({ length: 25 }, (_, i) => {
        const c = glyphCell(g, f, i);
        return <span key={i} style={{ width: size, height: size, borderRadius: "50%", background: c || "var(--c-22222a)", boxShadow: c ? (live ? `0 0 ${size}px ${c}88, inset 0 0 0 .5px var(--c-0000002e)` : "inset 0 0 0 .5px var(--c-0000002e)") : "none" }} />;
      })}
    </span>
  );
}

/**
 * The wall's 5×5 lights: try any glyph on the wall, scroll a word, pick glyphs for wall moments,
 * and add packs (a JSON file of glyphs — see docs/lights.md; Claude can make one for you).
 */
export function LightsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = getClient("owner")!;
  const { data, reload } = useHubGet<{ builtins: Glyph[]; packs: LightPack[] }>(client, "/api/lights", [open]);
  const settings = useSnapshot(client).snap?.settings;
  const map = settings?.lightMap ?? {};
  const [picked, setPicked] = useState<string | null>(null);
  const [moment, setMoment] = useState<LightMoment | null>(null);
  const [word, setWord] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const all: { ref: string; g: Glyph }[] = [
    ...(data?.builtins ?? []).map((g) => ({ ref: g.name, g })),
    ...(data?.packs ?? []).flatMap((p) => p.glyphs.map((g) => ({ ref: `${p.name}/${g.name}`, g }))),
  ];
  const play = async (body: { ref?: string; text?: string }) => {
    try {
      await client.send("POST", "/api/lights/play", { ...body, secs: 8 });
      toast("light_mode", "on the wall");
    } catch (e) {
      toastError(e);
    }
  };
  const tapGlyph = async (ref: string) => {
    setPicked(ref);
    if (moment) {
      await client.send("PATCH", "/api/settings", { lightMap: { ...map, [moment]: ref } }).catch(toastError);
      void client.snapshot();
      toast("light_mode", `${ref} for ${MOMENT_NAME[moment]}`);
      setMoment(null);
      return;
    }
    void play({ ref });
  };
  const clearMoment = async (m: LightMoment) => {
    const next = { ...map };
    delete next[m];
    await client.send("PATCH", "/api/settings", { lightMap: next }).catch(toastError);
    void client.snapshot();
    setMoment(null);
  };
  const addPack = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const pack = JSON.parse(await f.text()) as unknown;
      const r = await client.send<LightPack>("POST", "/api/lights/packs", pack);
      if (r) toast("library_add", `added ${r.glyphs.length} glyph${r.glyphs.length === 1 ? "" : "s"} (${r.name})`);
      reload();
    } catch (e) {
      toastError(e instanceof SyntaxError ? new Error("that file isn't JSON") : e);
    }
    if (file.current) file.current.value = "";
  };
  const removePack = async (name: string) => {
    if (!confirm(`Remove the "${name}" pack?`)) return;
    await client.send("DELETE", `/api/lights/packs/${name}`).catch(toastError);
    reload();
  };

  return (
    <Sheet open={open} onClose={onClose} title="lights" dark>
      <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--c-8e8e97)", marginBottom: 12 }}>
        {moment ? `Pick a glyph for "${MOMENT_NAME[moment]}".` : "Tap one to play it on the wall. Never during a focus session or at night."}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(64px,1fr))", gap: 8, maxHeight: "34vh", overflow: "auto", paddingBottom: 4 }}>
        {all.map(({ ref, g }) => (
          <div key={ref} className="tap" onClick={() => void tapGlyph(ref)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 4px 8px", borderRadius: 12, background: picked === ref ? "var(--c-1c1c23)" : "var(--c-13131a)", boxShadow: moment ? "inset 0 0 0 1px var(--c-ff4d17)" : "none" }}>
            <Mini g={g} live={picked === ref} />
            <span style={{ fontSize: 8, letterSpacing: ".06em", color: "var(--c-8e8e97)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ref}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input value={word} onChange={(e) => setWord(e.target.value.slice(0, 24))} placeholder="scroll a word…" style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 12, border: 0, background: "var(--c-13131a)", color: "var(--c-dedad4)", padding: "0 12px", font: "inherit", fontSize: 12 }} />
        <button className="tap" disabled={!word.trim()} onClick={() => void play({ text: word })} style={{ height: 40, padding: "0 14px", border: 0, borderRadius: 12, background: word.trim() ? "var(--c-ff4d17)" : "var(--c-13131a)", color: word.trim() ? "var(--c-0b0b0d)" : "var(--c-5c5c66)", font: "inherit", fontSize: 11 }}>play</button>
      </div>

      <div style={{ fontSize: 8, letterSpacing: ".24em", color: "var(--c-6d6d77)", margin: "18px 0 4px" }}>MOMENTS</div>
      {LIGHT_MOMENTS.map((m) => (
        <div key={m} className="tap" onClick={() => setMoment(moment === m ? null : m)} style={{ display: "flex", alignItems: "center", gap: 10, height: 40, boxShadow: "inset 0 -1px 0 var(--c-17171d)" }}>
          <span style={{ flex: 1, fontSize: 12, color: moment === m ? "var(--c-ff4d17)" : "var(--c-dedad4)" }}>{MOMENT_NAME[m]}</span>
          <span style={{ fontSize: 9, letterSpacing: ".1em", color: "var(--c-8e8e97)" }}>{map[m] ? map[m]!.toUpperCase() : "BUILT IN"}</span>
          {map[m] && (
            <span className="tap" onClick={(e) => { e.stopPropagation(); void clearMoment(m); }} aria-label="back to built in">
              <Ms style={{ fontSize: 15, color: "var(--c-5f5f67)" }}>close</Ms>
            </span>
          )}
        </div>
      ))}

      <div style={{ fontSize: 8, letterSpacing: ".24em", color: "var(--c-6d6d77)", margin: "18px 0 6px" }}>PACKS</div>
      {(data?.packs ?? []).map((p) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, height: 38 }}>
          <Ms style={{ fontSize: 16, color: "var(--c-ff4d17)" }}>grid_view</Ms>
          <span style={{ flex: 1, fontSize: 12, color: "var(--c-dedad4)" }}>{p.name}</span>
          <span style={{ fontSize: 9, color: "var(--c-6d6d77)" }}>{p.glyphs.length} GLYPHS</span>
          <span className="tap" onClick={() => void removePack(p.name)} aria-label="remove">
            <Ms style={{ fontSize: 15, color: "var(--c-5f5f67)" }}>close</Ms>
          </span>
        </div>
      ))}
      <input ref={file} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => void addPack(e.target.files)} />
      <button className="tap" onClick={() => file.current?.click()} style={{ width: "100%", height: 44, marginTop: 6, border: 0, borderRadius: 13, background: "var(--c-13131a)", color: "var(--c-8e8e97)", font: "inherit", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Ms style={{ fontSize: 16 }}>upload_file</Ms> add a pack (.json)
      </button>
    </Sheet>
  );
}
