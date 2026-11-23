import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { startTestDb, TestDb } from "./pg-helper";

const db: TestDb | null = startTestDb();

describe("login accounts", { skip: !db && "no PostgreSQL available (set TEST_DATABASE_URL)" }, () => {
  let app: INestApplication;
  let base = "";
  const prev = config.jwtSecret;
  before(async () => {
    config.databaseUrl = db!.url;
    config.adminApiKey = "admin-secret";
    config.disableScheduler = true;
    config.jwtSecret = "test-jwt-secret";
    app = await createApp({ logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace("[::1]", "localhost");
  });
  after(async () => { config.jwtSecret = prev; await app.close(); });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("registers, rejects duplicates and bad logins, logs in, and gates tournament entry", async () => {
    const phone = "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
    const r = await post("/auth/register", { phone, password: "secret1", name: "Asha" });
    assert.equal(r.status, 201, await r.clone().text());
    const reg = (await r.json()) as any;
    assert.ok(reg.token);
    assert.equal((await post("/auth/register", { phone, password: "secret1", name: "Dup" })).status, 409);
    assert.equal((await post("/auth/login", { phone, password: "wrong!!" })).status, 401);
    const l = await post("/auth/login", { phone, password: "secret1" });
    assert.equal(l.status, 200);
    const login = (await l.json()) as any;
    assert.equal(login.user.id, reg.user.id);
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${login.token}` } });
    assert.equal(((await me.json()) as any).name, "Asha");

    const t = await post("/admin/tournaments", { name: "Auth Cup", startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 3600_000 * 4).toISOString() }, { "x-admin-key": "admin-secret" });
    const tid = ((await t.json()) as any).id;
    assert.equal((await post(`/tournaments/${tid}/entries`, { userId: "someone-else", name: "X" })).status, 401);
    const e = await post(`/tournaments/${tid}/entries`, { userId: "someone-else", name: "X" }, { authorization: `Bearer ${login.token}` });
    assert.equal(e.status, 201);
    assert.equal(((await e.json()) as any).userId, reg.user.id); // body userId ignored
  });
});

describe("google login", { skip: !db && "no PostgreSQL available (set TEST_DATABASE_URL)" }, () => {
  let app: INestApplication;
  let base = "";
  const prev = config.jwtSecret;
  before(async () => {
    config.databaseUrl = db!.url;
    config.adminApiKey = "admin-secret";
    config.disableScheduler = true;
    config.jwtSecret = "test-jwt-secret";
    app = await createApp({ logger: false });
    const { AuthService } = await import("../src/auth/auth.service");
    app.get(AuthService).googleVerifier = async (t: string) => {
      if (t === "bad") throw new (await import("@nestjs/common")).UnauthorizedException("Google login could not be verified");
      return { sub: "g-" + t, email: t + "@example.com", name: "Gita Google With A Very Long Name" };
    };
    await app.listen(0);
    base = (await app.getUrl()).replace("[::1]", "localhost");
  });
  after(async () => { config.jwtSecret = prev; await app.close(); db?.stop(); });
  const post = (path: string, body: unknown) =>
    fetch(`${base}/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("creates an account on first Google login and returns the same one next time", async () => {
    const a = (await (await post("/auth/google", { idToken: "one" })).json()) as any;
    assert.ok(a.token);
    assert.equal(a.user.name.length, 20);
    const b = (await (await post("/auth/google", { idToken: "one" })).json()) as any;
    assert.equal(a.user.id, b.user.id);
    const c = (await (await post("/auth/google", { idToken: "two" })).json()) as any;
    assert.notEqual(a.user.id, c.user.id);
  });
  it("rejects a token Google does not accept, and a missing one", async () => {
    assert.equal((await post("/auth/google", { idToken: "bad" })).status, 401);
    assert.equal((await post("/auth/google", {})).status, 400);
  });
  it("a Google-only account cannot log in with a password", async () => {
    assert.equal((await post("/auth/login", { phone: "9876543210", password: "whatever1" })).status, 401);
  });
});
