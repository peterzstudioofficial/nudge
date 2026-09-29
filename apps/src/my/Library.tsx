import { useRef, useState } from "react";
import { getClient, loadPairing, useHubGet } from "../lib/hub";
import { Ms, Sheet, toast, toastError } from "../lib/ui";

interface LibDoc {
  id: string;
  title: string;
  kind: "pdf" | "word" | "slides" | "text";
  bytes: number;
  pages: number;
  chars: number;
  addedAt: number;
}

const ICON: Record<LibDoc["kind"], string> = { pdf: "picture_as_pdf", word: "description", slides: "slideshow", text: "article" };

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
        const res = await fetch(`${p.hub}/api/library?name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { authorization: "Bearer " + p.token, "content-type": "application/octet-stream" }, body: f });
        const j = (await res.json().catch(() => ({}))) as { error?: string; pages?: number };
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
  const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

  return (
    <Sheet open={open} onClose={onClose} title="documents" dark>
      <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--c-8e8e97)", marginBottom: 12 }}>
        Give the assistant revision guides, the syllabus, scripts or worksheets. The wall reads them once, for free, and nothing leaves the house; answers say which page they came from.
      </div>
      <input ref={input} type="file" multiple accept=".pdf,.docx,.pptx,.txt,.md,.html,.csv,.srt,.fountain,application/pdf,text/*" style={{ display: "none" }} onChange={(e) => void upload(e.target.files)} />
      <button className="tap" disabled={!!busy} onClick={() => input.current?.click()} style={{ width: "100%", height: 48, border: 0, borderRadius: 14, background: busy ? "var(--c-13131a)" : "var(--c-ff4d17)", color: busy ? "var(--c-8e8e97)" : "var(--c-0b0b0d)", font: "inherit", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}>
        <Ms style={{ fontSize: 18, animation: busy ? "spin 1.2s linear infinite" : "none" }}>{busy ? "progress_activity" : "upload_file"}</Ms>
        {busy ? `reading ${busy.slice(0, 28)}…` : "add a document"}
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "46vh", overflow: "auto" }}>
        {!list.length && <span style={{ fontSize: 11, color: "var(--c-6d6d77)", padding: "10px 2px" }}>nothing yet. PDF, Word, PowerPoint or text.</span>}
        {list.map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 12, background: "var(--c-13131a)", animation: gone.includes(d.id) ? "popOut .3s ease-in both" : "aUp .3s ease-out both" }}>
            <Ms style={{ fontSize: 18, flex: "none", color: "var(--c-ff4d17)" }}>{ICON[d.kind]}</Ms>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--c-dedad4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
              <div style={{ fontSize: 8, letterSpacing: ".12em", color: "var(--c-6d6d77)", marginTop: 3 }}>
                {d.pages} {d.kind === "slides" ? "SLIDE" : "PAGE"}{d.pages === 1 ? "" : "S"} · {size(d.bytes)}
              </div>
            </div>
            <span className="tap" onClick={() => void del(d)} aria-label="remove">
              <Ms style={{ fontSize: 16, color: "var(--c-5f5f67)" }}>close</Ms>
            </span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
