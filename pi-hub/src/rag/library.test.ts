import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { Db } from "../db";
import { Hub } from "../hub";
import { PersonalIndex } from "./index";
import { addDoc, chunk, docPages, extractPages, listDocs, removeDoc } from "./library";

/** A real two-page PDF with text, built by hand (correct xref offsets). */
function pdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((t, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("library", () => {
  it("reads PDFs page by page, Word, PowerPoint and text, all on the Pi", async () => {
    const p = await extractPages(pdf(["Le Chatelier says equilibrium shifts to oppose a change.", "Haber process uses an iron catalyst."]), "pdf");
    expect(p.map((x) => x.n)).toEqual([1, 2]);
    expect(p[1].text).toContain("iron catalyst");
    const docx = zipSync({ "word/document.xml": strToU8('<w:document><w:body><w:p><w:r><w:t>Fagin &amp; the boys</w:t></w:r></w:p><w:p><w:r><w:t>Act two</w:t></w:r></w:p></w:body></w:document>') });
    expect((await extractPages(docx, "word"))[0].text).toBe("Fagin & the boys\nAct two");
    const pptx = zipSync({ "ppt/slides/slide2.xml": strToU8("<a:t>second</a:t>"), "ppt/slides/slide1.xml": strToU8("<a:t>first</a:t><a:t>slide</a:t>") });
    expect(await extractPages(pptx, "slides")).toEqual([{ n: 1, text: "first slide" }, { n: 2, text: "second" }]);
    expect((await extractPages(strToU8("<html><body><p>Hi</p><script>x()</script></body></html>"), "text"))[0].text).toBe("Hi");
  });

  it("splits long text into overlapping passages at sentence ends", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = chunk(text, 200, 40);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.every((c) => c.length <= 200)).toBe(true);
    expect(parts[0].endsWith(".")).toBe(true);
  });

  it("finds the right page, cites it, and only volunteers confident matches", async () => {
    const hub = new Hub(new Db(":memory:"));
    const doc = await addDoc(hub, { name: "chem_revision-guide.pdf", mime: "application/pdf", data: pdf(["Atoms and moles: one mole is 6.02 x 10^23 particles.", "Le Chatelier: equilibrium shifts to oppose a change in conditions."]) });
    expect(doc).toMatchObject({ title: "chem revision guide", kind: "pdf", pages: 2 });
    expect(docPages(hub, doc.id)).toHaveLength(2);
    const index = new PersonalIndex(hub);
    const hits = await index.search("equilibrium shifts oppose change");
    expect(hits[0]).toMatchObject({ kind: "document", title: "chem revision guide · p. 2" });
    expect((await index.relevant("how does equilibrium shift with a change")).map((h) => h.title)).toContain("chem revision guide · p. 2");
    expect(await index.relevant("what's for dinner tonight")).toEqual([]);
    removeDoc(hub, doc.id);
    expect(listDocs(hub)).toEqual([]);
    expect((await index.search("equilibrium")).some((h) => h.kind === "document")).toBe(false);
  });

  it("refuses files it can't read, and scanned PDFs with no text", async () => {
    const hub = new Hub(new Db(":memory:"));
    await expect(addDoc(hub, { name: "photo.jpg", mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) })).rejects.toThrow(/PDF, Word/);
    await expect(addDoc(hub, { name: "scan.pdf", mime: "application/pdf", data: pdf([""]) })).rejects.toThrow(/no text/);
  });
});
