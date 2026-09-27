import { describe, expect, it, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { Auth } from "./auth";
import type { Ctx } from "./context";
import { Db } from "./db";
import { Hub } from "./hub";
import { buildServer } from "./server";
import { Keys } from "./keys";
import { Vault } from "./school/vault";
import { vi } from "vitest";

let app: FastifyInstance;
let hub: Hub;
let auth: Auth;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nudge-test-"));

beforeAll(async () => {
  const db = new Db(":memory:");
  hub = new Hub(db);
  auth = new Auth(db);
  const ctx: Ctx = {
    cfg: { dev: false, dataDir: dir, port: 0, localPort: 0, host: "127.0.0.1", tlsCert: null, tlsKey: null, screenDir: null, appsDir: null, chromium: null, allowLan: false, openrouterKey: null, geminiKey: null, composioKey: null },
    hub,
    auth,
    weather: { current: () => null, refresh: async () => {} },
    news: { headline: () => "", refresh: async () => {} },
    school: { status: () => ({ signedIn: false, needsSignIn: false, lastRun: null, lastOk: null, lastError: null, running: false, itemCount: 0 }), refresh: async () => {}, setSession: async () => {}, clearSession: async () => {} },
    agent: { available: () => false, run: () => "", stop: () => {} },
    hw: { input: () => {}, leds: () => {} },
    keys: new Keys(hub, new Vault(dir), { openrouter: null }),
  };
  app = await buildServer(ctx);
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const inject = (method: string, url: string, opts: { token?: string; body?: unknown; ip?: string; idem?: string } = {}) =>
  app.inject({
    method: method as "GET",
    url,
    remoteAddress: opts.ip ?? "100.101.102.103",
    headers: {
      ...(opts.token ? { authorization: "Bearer " + opts.token } : {}),
      ...(opts.idem ? { "idempotency-key": opts.idem } : {}),
    },
    payload: opts.body as object | undefined,
  });

describe("network + auth", () => {
  it("rejects the public internet", async () => {
    const r = await inject("GET", "/api/health", { ip: "8.8.8.8" });
    expect(r.statusCode).toBe(403);
  });
  it("rejects unpaired tailnet devices", async () => {
    expect((await inject("GET", "/api/state")).statusCode).toBe(401);
  });
  it("treats the Pi itself as the wall", async () => {
    const r = await inject("GET", "/api/state", { ip: "127.0.0.1" });
    expect(r.statusCode).toBe(200);
    expect(r.json().role).toBe("screen");
  });
  it("does not trust a web page on the Pi as the wall", async () => {
    const r = await app.inject({ method: "GET", url: "/api/state", remoteAddress: "127.0.0.1", headers: { origin: "https://evil.example", host: "127.0.0.1:8787" } });
    expect(r.statusCode).toBe(401);
  });
  it("pairs with a one-time code and rejects reuse and guessing", async () => {
    const { code } = auth.createCode("owner", "test");
    const r = await inject("POST", "/api/pair", { body: { code, name: "peter's phone" } });
    expect(r.statusCode).toBe(200);
    const token = r.json().token as string;
    expect((await inject("GET", "/api/state", { token })).json().role).toBe("owner");
    expect((await inject("POST", "/api/pair", { body: { code, name: "again" } })).statusCode).toBe(401);
    for (let i = 0; i < 5; i++) await inject("POST", "/api/pair", { body: { code: "000000", name: "x" }, ip: "100.64.0.9" });
    expect((await inject("POST", "/api/pair", { body: { code: "123456", name: "x" }, ip: "100.64.0.9" })).statusCode).toBe(429);
  });
  it("stops the owner from planning tasks or minting parent codes", async () => {
    const { code } = auth.createCode("owner", "test");
    const token = (await inject("POST", "/api/pair", { body: { code, name: "p" } })).json().token;
    expect((await inject("POST", "/api/tasks", { token, body: { name: "sneaky" } })).statusCode).toBe(403);
    expect((await inject("POST", "/api/pairing-codes", { token, body: { role: "parent" } })).statusCode).toBe(403);
    expect((await inject("POST", "/api/session/end", { token })).statusCode).toBe(403);
  });
  it("lets a parent plan tasks", async () => {
    const { code } = auth.createCode("parent", "test");
    const token = (await inject("POST", "/api/pair", { body: { code, name: "dad" } })).json().token;
    const r = await inject("POST", "/api/tasks", { token, body: { name: "chemistry q1-8", subject: "chem", mins: 25, when: "tomorrow" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().source).toBe("parent");
  });
});

describe("idempotency", () => {
  it("applies a replayed write once", async () => {
    const before = hub.listNotes().length;
    const a = await inject("POST", "/api/notes", { ip: "127.0.0.1", idem: "k-1", body: { label: "idea", body: "x" } });
    const b = await inject("POST", "/api/notes", { ip: "127.0.0.1", idem: "k-1", body: { label: "idea", body: "x" } });
    expect(a.json().id).toBe(b.json().id);
    expect(b.headers["idempotent-replay"]).toBe("1");
    expect(hub.listNotes().length).toBe(before + 1);
  });
});

describe("school setup", () => {
  it("imports a setup file and keeps staff away from parents", async () => {
    const owner = auth.pair(auth.createCode("owner", "test").code, "phone", "100.1.1.1").token;
    const parent = auth.pair(auth.createCode("parent", "test").code, "dad", "100.1.1.2").token;
    const pack = {
      timetable: { A1: [{ subject: "drama", span: 2, teacher: "NEC", room: "O45" }] },
      teachers: [{ name: "Nicola Clements", role: "Teacher of Drama" }],
      birthdays: [{ name: "Genna", date: "09-17" }],
      settings: { yearGroup: "5th Year" },
    };
    expect((await inject("POST", "/api/config/import", { token: parent, body: pack })).statusCode).toBe(403);
    const r = await inject("POST", "/api/config/import", { token: owner, body: pack });
    expect(r.statusCode).toBe(200);
    expect(r.json().imported).toEqual(expect.arrayContaining(["timetable", "1 staff", "1 birthdays"]));
    expect((await inject("GET", "/api/config/teachers", { token: parent })).statusCode).toBe(403);
    const t = await inject("GET", "/api/config/teachers", { token: owner });
    expect(t.json().matches).toEqual([{ code: "NEC", subject: "drama", name: "Nicola Clements" }]);
  });

  it("refuses a calendar upload that isn't a PDF", async () => {
    const owner = auth.pair(auth.createCode("owner", "test").code, "phone2", "100.1.1.3").token;
    const r = await app.inject({ method: "POST", url: "/api/config/calendar", remoteAddress: "100.101.102.103", headers: { authorization: "Bearer " + owner, "content-type": "application/pdf" }, payload: Buffer.from("hello") });
    expect(r.statusCode).toBe(400);
  });
});

describe("connect OpenRouter (PKCE)", () => {
  it("only returns to this hub's own page, swaps the code once, and keeps the key on the hub", async () => {
    const owner = auth.pair(auth.createCode("owner", "test").code, "or-phone", "100.101.102.103").token;
    const host = { host: "nudge.tail.ts.net" };
    const start = (callback: string) =>
      app.inject({ method: "POST", url: "/api/ai/openrouter/start", remoteAddress: "100.101.102.103", headers: { authorization: "Bearer " + owner, ...host }, payload: { callback } });
    expect((await start("https://evil.example/app/admin.html")).statusCode).toBe(400);
    const r = await start("https://nudge.tail.ts.net/app/admin.html");
    expect(r.statusCode).toBe(200);
    const url = new URL(r.json().url);
    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-v1-fromoauth" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const fin = await inject("POST", "/api/ai/openrouter/finish", { token: owner, body: { code: "abc123" } });
      expect(fin.statusCode).toBe(200);
      const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
      expect(sent.code).toBe("abc123");
      expect(sent.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // the verifier is single-use
      expect((await inject("POST", "/api/ai/openrouter/finish", { token: owner, body: { code: "abc123" } })).statusCode).toBe(400);
    } finally {
      vi.unstubAllGlobals();
    }
    // stored sealed, never in plain text
    expect(JSON.stringify(hub.db.kvGet("openrouterKey", null))).not.toContain("fromoauth");
  });
});

