import { describe, expect, it } from "vitest";
import type { BuildRequest } from "@nudge/shared";
import { Db } from "../db";
import { Hub } from "../hub";
import { builderService, estimateBuild, htmlFromText, iconFor } from "./builder";
import type { OrClient } from "./openrouter";
import { buildToolsServer, iconPng, injectHead } from "../tools-server";
import type { Ctx } from "../context";

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const APP = "<!doctype html><html><head><title>Cards</title></head><body><script>1</script></body></html>";

function fakeOr(over: Partial<OrClient> = {}) {
  const calls: { responses: Record<string, unknown>[]; uploaded: string[]; deleted: string[]; batches: Record<string, unknown>[] } = { responses: [], uploaded: [], deleted: [], batches: [] };
  const or: OrClient = {
    uploadFile: async (name) => (calls.uploaded.push(name), `or_file_${calls.uploaded.length}`),
    deleteFile: async (id) => void calls.deleted.push(id),
    responses: async (body) => (calls.responses.push(body), { text: "Flashcards for chemistry.\nTap to flip.", cost: 0.021, containerIds: ["cntr_1"], files: [], commands: 4 }),
    containerFiles: async () => [
      { id: "cf_1", path: "/workspace/out/index.html", bytes: APP.length },
      { id: "cf_2", path: "/workspace/scratch/test.js", bytes: 10 },
    ],
    containerFile: async () => new TextEncoder().encode(APP),
    createBatch: async (body) => (calls.batches.push(body), { id: "batch_1", status: "validating" }),
    getBatch: async () => ({ status: "completed", error: null, text: "```html\n" + APP + "\n```\nFlashcards.", cost: 0.002 }),
    ...over,
  };
  return { or, calls };
}

const req = (o: Partial<BuildRequest> = {}): BuildRequest => ({ title: "Chem cards", brief: "Flashcards for GCSE chemistry, flip on tap, shuffle, track which ones I got wrong.", target: "phone", when: "now", where: "pi", toolId: null, attachments: [], ...o });

describe("tool builder", () => {
  it("builds now in OpenRouter's sandbox (no internet, zero retention) and saves the app", async () => {
    const hub = new Hub(new Db(":memory:"));
    const { or, calls } = fakeOr();
    const said: string[] = [];
    builderService({ hub, or, log: () => {}, say: (_i, l) => said.push(l) });
    hub.db.blobPut("attach:a1", "application/pdf", new Uint8Array([37, 80, 68, 70]));
    const job = hub.startJob(req({ attachments: [{ id: "a1", name: "topics.pdf", mime: "application/pdf" }] }), 0.03, null);
    await wait(40);
    const j = hub.jobs.get(job.id)!;
    expect(j.status).toBe("done");
    const tool = hub.tools.get(j.toolId!)!;
    expect(tool.title).toBe("Chem cards");
    expect(new TextDecoder().decode(hub.toolFile(tool.id, "index.html")!.data)).toBe(APP);
    expect(hub.toolFile(tool.id, "scratch/test.js")).toBeNull(); // only out/ is kept
    const body = calls.responses[0] as Record<string, any>;
    expect(body.tools[0]).toMatchObject({ type: "openrouter:bash", parameters: { environment: { type: "container_auto", network_policy: { type: "disabled" }, file_ids: ["or_file_1"] } } });
    expect(body.provider).toMatchObject({ zdr: true, data_collection: "deny" });
    expect(body.stop_server_tools_when).toContainEqual({ type: "max_cost", max_cost_in_dollars: 0.25 });
    // attachments are deleted from OpenRouter and the hub afterwards
    expect(calls.deleted).toEqual(["or_file_1"]);
    expect(hub.db.blobGet("attach:a1")).toBeNull();
    expect(said[0]).toContain("is ready");
  });

  it("builds later with Batch (half price) and picks the result up", async () => {
    const hub = new Hub(new Db(":memory:"));
    const { or, calls } = fakeOr();
    const b = builderService({ hub, or, log: () => {}, say: () => {} });
    const job = hub.startJob(req({ when: "later" }), 0.002, null);
    await wait();
    expect(hub.jobs.get(job.id)!.status).toBe("waiting");
    expect(calls.batches[0]).toMatchObject({ endpoint: "/v1/chat/completions", completion_window: "24h", model: "deepseek/deepseek-v4.1-flash" });
    await b.poll();
    const j = hub.jobs.get(job.id)!;
    expect(j.status).toBe("done");
    expect(hub.toolFile(j.toolId!, "index.html")).toBeTruthy();
  });

  it("falls back to an overnight sandbox build when batch isn't available", async () => {
    const hub = new Hub(new Db(":memory:"));
    const { or, calls } = fakeOr({ createBatch: async () => { throw new Error("model has no batch endpoint"); } });
    let hour = 15;
    const b = builderService({ hub, or, log: () => {}, say: () => {}, now: () => new Date(2026, 8, 28, hour) });
    const job = hub.startJob(req({ when: "later" }), 0.002, null);
    await wait();
    expect(hub.jobs.get(job.id)!.note).toBe("will build tonight");
    await b.poll();
    expect(calls.responses).toHaveLength(0); // not in the afternoon
    hour = 2;
    await b.poll();
    await wait(40);
    expect(hub.jobs.get(job.id)!.status).toBe("done");
  });

  it("a build only starts after a yes on the confirm", async () => {
    const hub = new Hub(new Db(":memory:"));
    const { or, calls } = fakeOr();
    builderService({ hub, or, log: () => {}, say: () => {} });
    const ask = hub.createAsk({ kind: "build", head: "", line: "", rows: [], payload: { request: req(), estUsd: 0.03 }, threadId: null });
    await wait();
    expect(calls.responses).toHaveLength(0);
    hub.answerAsk(ask.id, false, "owner");
    await wait();
    expect(hub.jobs.all()).toHaveLength(0);
    const ask2 = hub.createAsk({ kind: "build", head: "", line: "", rows: [], payload: { request: req(), estUsd: 0.03 }, threadId: null });
    hub.answerAsk(ask2.id, true, "owner");
    await wait(40);
    expect(hub.jobs.all()[0].status).toBe("done");
  });

  it("helpers: html extraction, cost estimates, icons", () => {
    expect(htmlFromText("here:\n```html\n" + APP + "\n```")).toBe(APP);
    expect(htmlFromText("no app here")).toBeNull();
    expect(estimateBuild({ when: "later", where: "pi", brief: "x" })).toBeLessThan(estimateBuild({ when: "now", where: "pi", brief: "x" }));
    expect(estimateBuild({ when: "now", where: "computer", brief: "x" })).toBe(0);
    expect(estimateBuild({ when: "now", where: "pi", brief: "x".repeat(2000) })).toBeLessThan(0.1);
    expect(iconFor("line learner for the musical rehearsal")).toBe("theater_comedy");
  });
});

describe("tools server", () => {
  async function serve() {
    const hub = new Hub(new Db(":memory:"));
    const t = hub.putTool({ title: "Chem cards", description: "flashcards", icon: "quiz", target: "phone", jobId: null }, { "index.html": { mime: "text/html", data: new TextEncoder().encode(APP) } });
    const ctx = { cfg: { dev: false, allowLan: false, tlsCert: null, tlsKey: null }, hub } as unknown as Ctx;
    const app = await buildToolsServer(ctx);
    return { app, t };
  }

  it("serves a tool on its own origin with no internet access, installable as an app", async () => {
    const { app, t } = await serve();
    const get = (url: string, ip = "100.101.102.103") => app.inject({ method: "GET", url, remoteAddress: ip });
    expect((await get(`/t/${t.id}/`, "8.8.8.8")).statusCode).toBe(403);
    const page = await get(`/t/${t.id}/`);
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("connect-src 'self'");
    expect(page.body).toContain('rel="manifest"');
    expect(page.body).toContain("beforeinstallprompt");
    const m = (await get(`/t/${t.id}/manifest.webmanifest`)).json();
    expect(m).toMatchObject({ name: "Chem cards", display: "standalone", start_url: "./" });
    const icon = await get(`/t/${t.id}/icon-192.png`);
    expect(icon.statusCode).toBe(200);
    expect(icon.rawPayload.subarray(1, 4).toString()).toBe("PNG");
    expect((await get(`/t/${t.id}/sw.js`)).body).toContain("caches");
    expect((await get(`/t/nope/`)).statusCode).toBe(404);
    expect((await get(`/t/${t.id}/../../api/state`)).statusCode).not.toBe(200);
  });

  it("head injection works with or without a <head>", () => {
    expect(injectHead("<html><body>x</body></html>")).toContain("<head>");
    expect(injectHead("<p>bare</p>")).toContain("manifest");
    expect(iconPng(192).length).toBeGreaterThan(100);
  });
});
