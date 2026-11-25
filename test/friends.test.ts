import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { PG_POOL } from "../src/db/database.module";
import { startTestDb, TestDb } from "./pg-helper";

const db: TestDb | null = startTestDb();
describe("friends", { skip: !db && "no PostgreSQL available (set TEST_DATABASE_URL)" }, () => {
  let app: INestApplication;
  let base = "";
  const prevJwt = config.jwtSecret;
  const api = (path: string, init?: RequestInit) => fetch(`${base}/api${path}`, { headers: { "content-type": "application/json" }, ...init });
  before(async () => {
    config.jwtSecret = "";
    config.databaseUrl = db!.url;
    config.disableScheduler = true;
    app = await createApp({ logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace("[::1]", "localhost");
    const pool = (app as any).get(PG_POOL) as import("pg").Pool;
    await pool.query("insert into users (id, name) values ('fa','Asha'), ('fb','Bala')");
  });
  after(async () => { config.jwtSecret = prevJwt; await app?.close(); db?.stop(); });

  it("adds a friend by code, both ways", async () => {
    const b = (await (await api("/me/friends?userId=fb")).json()) as any;
    assert.match(b.code, /^[A-Z0-9]{6}$/);
    const add = await api("/me/friends?userId=fa", { method: "POST", body: JSON.stringify({ code: b.code.toLowerCase() }) });
    assert.equal(add.status, 200);
    const a = (await (await api("/me/friends?userId=fa")).json()) as any;
    assert.equal(a.friends[0].name, "Bala");
    const b2 = (await (await api("/me/friends?userId=fb")).json()) as any;
    assert.equal(b2.friends[0].name, "Asha");
  });
  it("rejects bad, own and unknown codes", async () => {
    const a = (await (await api("/me/friends?userId=fa")).json()) as any;
    const post = (code: string) => api("/me/friends?userId=fa", { method: "POST", body: JSON.stringify({ code }) });
    assert.equal((await post("xx")).status, 400);
    assert.equal((await post(a.code)).status, 400);
    assert.equal((await post("ZZZZZZ")).status, 404);
  });
  it("removes both ways", async () => {
    assert.equal((await api("/me/friends/fb?userId=fa", { method: "DELETE" })).status, 200);
    assert.equal(((await (await api("/me/friends?userId=fb")).json()) as any).friends.length, 0);
  });
});
