import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { runMigrations } from "../src/db/database.module";
import { startTestDb, TestDb } from "./pg-helper";

const db: TestDb | null = startTestDb();

describe("tournaments API", { skip: !db && "no PostgreSQL available (set TEST_DATABASE_URL)" }, () => {
  let app: INestApplication;
  let base = "";
  const ADMIN = { "x-admin-key": "admin-secret", "content-type": "application/json" };
  const JSON_HEADERS = { "content-type": "application/json" };

  const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const api = (path: string, init?: RequestInit) => fetch(`${base}/api${path}`, init);
  const post = (path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
    api(path, { method: "POST", headers, body: JSON.stringify(body) });

  async function createTournament(extra: Record<string, unknown> = {}) {
    const res = await post("/admin/tournaments", {
      name: "Diwali Cup",
      startsAt: hours(1),
      endsAt: hours(5),
      ...extra,
    }, ADMIN);
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()) as any;
  }

  before(async () => {
    config.databaseUrl = db!.url;
    config.adminApiKey = "admin-secret";
    config.internalApiKey = "internal-secret";
    config.disableScheduler = true;
    app = await createApp({ logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace("[::1]", "localhost");
  });

  after(async () => {
    await app?.close();
    db?.stop();
  });

  it("migrations are idempotent", async () => {
    const pool = new Pool({ connectionString: db!.url });
    assert.deepEqual(await runMigrations(pool), []);
    await pool.end();
  });

  it("admin endpoints need the admin key", async () => {
    const body = { name: "x", startsAt: hours(1), endsAt: hours(2) };
    assert.equal((await post("/admin/tournaments", body)).status, 401);
    assert.equal((await post("/admin/tournaments", body, { ...ADMIN, "x-admin-key": "wrong" })).status, 401);
  });

  it("rejects invalid tournaments with a clear message", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ name: "", startsAt: hours(1), endsAt: hours(2) }, /name is required/],
      [{ name: "x", startsAt: hours(3), endsAt: hours(2) }, /endsAt must be after startsAt/],
      [{ name: "x", startsAt: hours(-3), endsAt: hours(-2) }, /in the future/],
      [{ name: "x", startsAt: hours(1), endsAt: hours(2), playersPerGame: 3 }, /2 or 4/],
      [{ name: "x", startsAt: hours(1), endsAt: hours(2), points: [10, 4, 1] }, /points must list 2/],
      [{ name: "x", startsAt: hours(1), endsAt: hours(2), points: [4, 10] }, /must not increase/],
      [{ name: "x", startsAt: hours(1), endsAt: hours(2), prizes: [{ rankFrom: 1, rankTo: 3, prize: "a" }, { rankFrom: 3, rankTo: 4, prize: "b" }] }, /must not overlap/],
    ];
    for (const [body, message] of cases) {
      const res = await post("/admin/tournaments", body, ADMIN);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(((await res.json()) as any).message, message);
    }
  });

  it("creates a scheduled tournament with default points and sorted prize tiers", async () => {
    const t = await createTournament({
      description: "Free entry",
      prizes: [
        { rankFrom: 2, rankTo: 3, prize: "Voucher 200" },
        { rankFrom: 1, rankTo: 1, prize: "Voucher 1000" },
      ],
    });
    assert.equal(t.status, "scheduled");
    assert.equal(t.playersPerGame, 2);
    assert.deepEqual(t.points, [10, 4]);
    assert.deepEqual(t.prizes.map((p: any) => p.rankFrom), [1, 2]);
    assert.equal(t.entryCount, 0);

    const fetched = (await (await api(`/tournaments/${t.id}`)).json()) as any;
    assert.equal(fetched.name, "Diwali Cup");
    const listed = (await (await api("/tournaments?status=scheduled")).json()) as any[];
    assert.ok(listed.some((x) => x.id === t.id));
  });

  it("a tournament that has already started is running", async () => {
    const t = await createTournament({ startsAt: hours(-1), endsAt: hours(2), playersPerGame: 4 });
    assert.equal(t.status, "running");
    assert.deepEqual(t.points, [10, 6, 3, 1]);
  });

  it("returns 404 for unknown tournaments and 400 for unknown status filters", async () => {
    assert.equal((await api("/tournaments/not-a-uuid")).status, 404);
    assert.equal((await api("/tournaments/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")).status, 404);
    assert.equal((await api("/tournaments?status=bogus")).status, 400);
  });

  it("registers players idempotently and reports their standing", async () => {
    const t = await createTournament();
    const first = await post(`/tournaments/${t.id}/entries`, { userId: "u1", name: "Asha" });
    assert.equal(first.status, 201);
    await post(`/tournaments/${t.id}/entries`, { userId: "u1", name: "Asha K" });
    await post(`/tournaments/${t.id}/entries`, { userId: "u2", name: "Ben" });

    const standing = (await (await api(`/tournaments/${t.id}/entries/u1`)).json()) as any;
    assert.equal(standing.name, "Asha K");
    assert.equal(standing.rank, 1);
    assert.equal(standing.points, 0);
    assert.equal(((await (await api(`/tournaments/${t.id}`)).json()) as any).entryCount, 2);
    assert.equal((await api(`/tournaments/${t.id}/entries/nobody`)).status, 404);
    assert.equal((await post(`/tournaments/${t.id}/entries`, { name: "no id" })).status, 400);

    const board = (await (await api(`/tournaments/${t.id}/leaderboard?limit=1`)).json()) as any[];
    assert.equal(board.length, 1);
  });

  it("enforces maxPlayers but lets registered players update their entry", async () => {
    const t = await createTournament({ maxPlayers: 2 });
    await post(`/tournaments/${t.id}/entries`, { userId: "a" });
    await post(`/tournaments/${t.id}/entries`, { userId: "b" });
    assert.equal((await post(`/tournaments/${t.id}/entries`, { userId: "c" })).status, 409);
    assert.equal((await post(`/tournaments/${t.id}/entries`, { userId: "a", name: "Renamed" })).status, 201);
  });

  it("allows withdrawing only before the tournament starts", async () => {
    const future = await createTournament();
    await post(`/tournaments/${future.id}/entries`, { userId: "w1" });
    assert.equal((await api(`/tournaments/${future.id}/entries/w1`, { method: "DELETE" })).status, 204);
    assert.equal((await api(`/tournaments/${future.id}/entries/w1`)).status, 404);

    const running = await createTournament({ startsAt: hours(-1), endsAt: hours(2) });
    await post(`/tournaments/${running.id}/entries`, { userId: "w2" });
    assert.equal((await api(`/tournaments/${running.id}/entries/w2`, { method: "DELETE" })).status, 409);
  });

  it("cancelling closes registration", async () => {
    const t = await createTournament();
    const res = await post(`/admin/tournaments/${t.id}/cancel`, {}, ADMIN);
    assert.equal(((await res.json()) as any).status, "cancelled");
    assert.equal((await post(`/tournaments/${t.id}/entries`, { userId: "late" })).status, 409);
    assert.equal((await post(`/admin/tournaments/${t.id}/cancel`, {}, ADMIN)).status, 409);
  });
});
