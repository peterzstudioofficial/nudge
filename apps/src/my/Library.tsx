import { useRef, useState } from "react";
import { getClient, loadPairing, useHubGet, useSnapshot } from "../lib/hub";

const useSnapshotSettings = () => useSnapshot(getClient("owner")!).snap?.settings;
import { Ms, Sheet, toast, toastError } from "../lib/ui";

interface LibDoc {
  id: string;
  title: string;
  kind: "pdf" | "word" | "slides" | "text" | "image";
  ocr?: boolean;
  bytes: number;
  pages: number;
  chars: number;
  addedAt: number;
}

const ICON: Record<LibDoc["kind"], string> = { pdf: "picture_as_pdf", word: "description", slides: "slideshow", text: "article", image: "photo_camera" };

/**
 * Documents the assistant can read: revision guides, the syllabus, a script, worksheets.
 * The text is read on the wall once (free, nothing leaves the house); after that a question only
 * carries the few passages it needs, with the page they came from.
 */
export function LibrarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = getClient("owner")!;
  const { data, reload } = useHubGet<LibDoc[]>(client, "/api/library", [open]);
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    const p = loadPairing("owner");
    if (!files?.length || !p) return;
    for (const f of [...files]) {
      setBusy(f.name);
      try {
        const send = (ocr: boolean) => fetch(`${p.hub}/api/library?name=${encodeURIComponent(f.name)}${ocr ? "&ocr=1" : ""}`, { method: "POST", headers: { authorization: "Bearer " + p.token, "content-type": "application/octet-stream" }, body: f });
        let res = await send(false);
        let j = (await res.json().catch(() => ({}))) as { error?: string; pages?: number; needsOcr?: boolean; estUsd?: number };
        // A scan or a photo: reading it costs a little, so it's your call.
        if (res.status === 402 && j.needsOcr) {
          const cost = (j.estUsd ?? 0) < 0.01 ? "less than a penny" : `about $${(j.estUsd ?? 0).toFixed(2)}`;
          if (!confirm(`"${f.name}" is a scan or photo, so the wall can't read it by itself.\n\nRead it with OCR on OpenRouter for ${cost}? Nothing is kept there.`)) continue;
          setBusy(`${f.name} (OCR)`);
          res = await send(true);
          j = (await res.json().catch(() => ({}))) as typeof j;
        }
        if (!res.ok) throw new Error(j.error || "couldn't add that");
        toast("library_add", `read ${j.pages} page${j.pages === 1 ? "" : "s"}`);
      } catch (e) {
        toastError(e);
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    reload();
  };
  const del = async (d: LibDoc) => {
    if (!confirm(`Remove "${d.title}"? The assistant won't be able to read it any more.`)) return;
    setGone((g) => [...g, d.id]);
    await client.send("DELETE", `/api/library/${d.id}`).catch(toastError);
    window.setTimeout(reload, 320);
  };
  const list = data ?? [];
  const snap = useSnapshotSettings();
  const better = snap?.ragEmbed === "openrouter";
  const toggleBetter = async () => {
    try {
      await client.send("PATCH", "/api/settings", { ragEmbed: better ? "local" : "openrouter" });
      void client.snapshot();
      toast("travel_explore", better ? "search back on the wall" : "sharper search on — re-reading in the background");
    } catch (e) {
      toastError(e);
    }
  };
  const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

  return (
    <Sheet open={open} onClose={onClose} title="documents" dark>
      <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--c-8e8e97)", marginBottom: 12 }}>
        Give the assistant revision guides, the syllabus, scripts or worksheets. The wall reads them once, for free, and nothing leaves the house; answers say which page they came from.
      </div>
      <input ref={input} type="file" multiple accept=".pdf,.docx,.pptx,.txt,.md,.html,.csv,.srt,.fountain,.jpg,.jpeg,.png,.webp,application/pdf,text/*,image/*" style={{ display: "none" }} onChange={(e) => void upload(e.target.files)} />
      <button className="tap" disabled={!!busy} onClick={() => input.current?.click()} style={{ width: "100%", height: 48, border: 0, borderRadius: 14, background: busy ? "var(--c-13131a)" : "var(--c-ff4d17)", color: busy ? "var(--c-8e8e97)" : "var(--c-0b0b0d)", font: "inherit", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}>
        <Ms style={{ fontSize: 18, animation: busy ? "spin 1.2s linear infinite" : "none" }}>{busy ? "progress_activity" : "upload_file"}</Ms>
        {busy ? `reading ${busy.slice(0, 28)}…` : "add a document"}
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "46vh", overflow: "auto" }}>
        {!list.length && <span style={{ fontSize: 11, color: "var(--c-6d6d77)", padding: "10px 2px" }}>nothing yet. PDF, Word, PowerPoint, text, or a photo of a page.</span>}
        {list.map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 12, background: "var(--c-13131a)", animation: gone.includes(d.id) ? "popOut .3s ease-in both" : "aUp .3s ease-out both" }}>
            <Ms style={{ fontSize: 18, flex: "none", color: "var(--c-ff4d17)" }}>{ICON[d.kind]}</Ms>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--c-dedad4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
              <div style={{ fontSize: 8, letterSpacing: ".12em", color: "var(--c-6d6d77)", marginTop: 3 }}>
                {d.pages} {d.kind === "slides" ? "SLIDE" : "PAGE"}{d.pages === 1 ? "" : "S"} · {size(d.bytes)}{d.ocr ? " · OCR" : ""}
              </div>
            </div>
            <span className="tap" onClick={() => void del(d)} aria-label="remove">
              <Ms style={{ fontSize: 16, color: "var(--c-5f5f67)" }}>close</Ms>
            </span>
          </div>
        ))}
      </div>
      <div className="tap" onClick={() => void toggleBetter()} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "12px 2px", boxShadow: "inset 0 1px 0 var(--c-1c1c23)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--c-dedad4)" }}>sharper search</div>
          <div style={{ fontSize: 9, lineHeight: 1.45, color: "var(--c-6d6d77)", marginTop: 3 }}>
            {better ? "Meaning-matching runs on OpenRouter (zero retention, about 2p per 1,000 pages)." : "Runs on the wall for free. Switch on for a stronger match via OpenRouter (zero retention, about 2p per 1,000 pages)."}
          </div>
        </div>
        <span style={{ width: 30, height: 4, borderRadius: 2, flex: "none", overflow: "hidden", background: "var(--c-22222a)" }}>
          <span style={{ display: "block", width: 15, height: 4, borderRadius: 2, background: better ? "var(--c-ff4d17)" : "var(--c-8e8e97)", transform: `translateX(${better ? 15 : 0}px)`, transition: "transform .42s cubic-bezier(.22,1,.28,1),background-color .35s" }} />
        </span>
      </div>
    </Sheet>
  );
}
