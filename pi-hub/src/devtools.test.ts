import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { Db } from "./db";
import { Hub } from "./hub";
import { Auth } from "./auth";
import { registerDevtools, devState } from "./devtools";
import type { Ctx } from "./context";

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nudge-dev-")), "devtools");

async function app(caller: { role: string } | null = null) {
  const db = new Db(":memory:");
  const hub = new Hub(db);
  const ctx = { hub, auth: new Auth(db), school: { status: () => ({}), refresh: async () => {} }, agent: { available: () => false } } as unknown as Ctx;
  const a = Fastify();
  a.decorateRequest("caller", null);
  a.addHook("onRequest", async (req) => void ((req as unknown as { caller: unknown }).caller = caller));
  registerDevtools(a, ctx, file);
  await a.ready();
  return a;
}

describe("dev tools", () => {
  it("don't exist unless switched on at the Pi, and expire", async () => {
    fs.rmSync(file, { force: true });
    const a = await app();
    expect((await a.inject({ url: "/api/dev/status", remoteAddress: "127.0.0.1" })).statusCode).toBe(404);
    expect((await a.inject({ url: "/dev", remoteAddress: "127.0.0.1" })).statusCode).toBe(404);
    fs.writeFileSync(file, JSON.stringify({ until: Date.now() - 1000, code: "123456" }));
    expect(devState(file).on).toBe(false);
    // an expiry far in the future is capped at 24 hours
    fs.writeFileSync(file, JSON.stringify({ until: Date.now() + 90 * 86400_000, code: "123456" }));
    expect(devState(file).until).toBeLessThanOrEqual(Date.now() + 24 * 3600_000 + 1000);
  });

  it("work from the Pi itself; elsewhere only an owner with the code", async () => {
    fs.writeFileSync(file, JSON.stringify({ until: Date.now() + 3600_000, code: "482915" }));
    const local = await app();
    expect((await local.inject({ url: "/api/dev/status", remoteAddress: "127.0.0.1" })).statusCode).toBe(200);
    // a web page on the Pi (has an Origin) is not "the Pi itself"
    expect((await local.inject({ url: "/api/dev/status", remoteAddress: "127.0.0.1", headers: { origin: "https://evil.example" } })).statusCode).toBe(404);
    const parent = await app({ role: "parent" });
    expect((await parent.inject({ url: "/api/dev/status", remoteAddress: "100.101.102.103", headers: { "x-nudge-dev": "482915" } })).statusCode).toBe(404);
    const owner = await app({ role: "owner" });
    expect((await owner.inject({ url: "/api/dev/status", remoteAddress: "100.101.102.103" })).statusCode).toBe(404);
    expect((await owner.inject({ url: "/api/dev/status", remoteAddress: "100.101.102.103", headers: { "x-nudge-dev": "000000" } })).statusCode).toBe(404);
    expect((await owner.inject({ url: "/api/dev/status", remoteAddress: "100.101.102.103", headers: { "x-nudge-dev": "482915" } })).statusCode).toBe(200);
    fs.rmSync(file);
  });
});
