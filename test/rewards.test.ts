import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { dailyBonus, gameReward, istDate, levelFor, periodStart } from "../src/rewards/rules";
import { startTestDb, TestDb } from "./pg-helper";

describe("reward rules", () => {
  it("levels", () => {
    assert.equal(levelFor(0).level, 1);
    assert.equal(levelFor(99).level, 1);
    assert.equal(levelFor(100).level, 2);
    assert.equal(levelFor(400).level, 3);
    assert.equal(levelFor(150).nextLevelXp, 400);
  });
  it("game rewards and bot cap", () => {
    assert.deepEqual(gameReward(1, 2, 0), { coins: 30, xp: 50 });
    assert.deepEqual(gameReward(1, 1, 0), { coins: 0, xp: 10 });
    assert.deepEqual(gameReward(1, 1, 10), { coins: 0, xp: 0 });
  });
  it("daily streak grows then caps", () => {
    assert.equal(dailyBonus(1).coins, 50);
    assert.equal(dailyBonus(7).coins, 110);
    assert.equal(dailyBonus(20).coins, 110);
  });
  it("India dates and week start", () => {
    assert.equal(istDate(new Date("2026-11-23T20:00:00Z")), "2026-11-24"); // 01:30 IST next day
    // Monday 2026-11-23: week starts Mon 00:00 IST = Sun 18:30 UTC
    assert.equal(periodStart("weekly", new Date("2026-11-25T10:00:00Z"))!.toISOString(), "2026-11-22T18:30:00.000Z");
    assert.equal(periodStart("all", new Date()), null);
  });
});

const db: TestDb | null = startTestDb();
describe("wallet and points api", { skip: !db && "no PostgreSQL available (set TEST_DATABASE_URL)" }, () => {
  let app: INestApplication;
  let base = "";
  const prevJwt = config.jwtSecret;
  before(async () => {
    config.databaseUrl = db!.url;
    config.internalApiKey = "internal-secret";
    config.disableScheduler = true;
    config.jwtSecret = "";
    app = await createApp({ logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace("[::1]", "localhost");
  });
  after(async () => { config.jwtSecret = prevJwt; await app.close(); db?.stop(); });

  const result = (gameId: string, placements: any[]) =>
    fetch(`${base}/api/internal/results`, { method: "POST", headers: { "content-type": "application/json", "x-internal-key": "internal-secret" }, body: JSON.stringify({ gameId, placements }) });
  const get = (path: string) => fetch(`${base}/api${path}`);

  it("rewards humans once per game, ignores repeats and bots", async () => {
    const p = [{ userId: "a", placement: 1, isBot: false }, { userId: "b", placement: 2, isBot: false }, { userId: "bot1", placement: 3, isBot: true }];
    assert.equal((await result("g1", p)).status, 200);
    assert.equal(((await (await result("g1", p)).json()) as any).status, "duplicate");
    const a = (await (await get("/me/wallet?userId=a")).json()) as any;
    assert.equal(a.coins, 30 + 25); // win + first win of the day
    assert.equal(a.xp, 50 + 10);
    assert.equal(a.wins, 1);
    const b = (await (await get("/me/wallet?userId=b")).json()) as any;
    assert.equal(b.coins, 15);
    assert.equal(((await (await get("/me/wallet?userId=bot1")).json()) as any).coins, 0);
  });

  it("vs-bots games give xp only", async () => {
    await result("g2", [{ userId: "c", placement: 1, isBot: false }, { userId: "bot", placement: 2, isBot: true }]);
    const c = (await (await get("/me/wallet?userId=c")).json()) as any;
    assert.equal(c.coins, 0);
    assert.equal(c.xp, 10);
  });

  it("daily bonus once a day, history, leaderboards", async () => {
    const first = await fetch(`${base}/api/me/daily-bonus?userId=d`, { method: "POST" });
    assert.equal(first.status, 200);
    assert.equal(((await first.json()) as any).streak, 1);
    assert.equal((await fetch(`${base}/api/me/daily-bonus?userId=d`, { method: "POST" })).status, 400);
    const w = (await (await get("/me/wallet?userId=d")).json()) as any;
    assert.equal(w.dailyAvailable, false);
    assert.equal(w.coins, 50);
    const h = (await (await get("/me/history?userId=a")).json()) as any[];
    assert.ok(h.length >= 2);
    const lb = (await (await get("/leaderboard/daily?userId=b")).json()) as any;
    assert.equal(lb.rows[0].userId, "a");
    assert.equal(lb.me.userId ?? "b", "b");
    assert.equal(lb.me.rank, 2);
    assert.equal((await get("/leaderboard/yearly")).status, 400);
  });
});

const db2: TestDb | null = startTestDb();
describe("missions and achievements", { skip: !db2 && "no PostgreSQL available (set TEST_DATABASE_URL)" }, () => {
  let app: INestApplication;
  let base = "";
  const prevJwt = config.jwtSecret;
  const INTERNAL = { "x-internal-key": "internal-secret", "content-type": "application/json" };
  const api = (path: string, init?: RequestInit) => fetch(`${base}/api${path}`, init);
  const result = (gameId: string, userId: string, placement: number, captures: number, home: number) =>
    api("/internal/results", {
      method: "POST", headers: INTERNAL,
      body: JSON.stringify({ gameId, placements: [
        { userId, placement, isBot: false, captures, home },
        { userId: userId + "-opp", placement: placement === 1 ? 2 : 1, isBot: false, captures: 0, home: 0 },
      ] }),
    });
  before(async () => {
    config.jwtSecret = "";
    config.databaseUrl = db2!.url;
    config.internalApiKey = "internal-secret";
    config.disableScheduler = true;
    app = await createApp({ logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace("[::1]", "localhost");
  });
  after(async () => { config.jwtSecret = prevJwt; await app?.close(); db2?.stop(); });

  it("tracks progress and pays each mission once", async () => {
    await result("mg1", "mu", 1, 3, 4);
    await result("mg2", "mu", 2, 2, 1);
    const list = (await (await api("/me/missions?userId=mu")).json()) as any[];
    const by = Object.fromEntries(list.map((m) => [m.id, m]));
    assert.equal(by.play3.progress, 2);
    assert.equal(by.win1.done, true);
    assert.equal(by.capture5.done, true);
    assert.equal(by.home4.done, true);
    assert.equal((await api("/me/missions/play3/claim?userId=mu", { method: "POST" })).status, 400);
    const claim = await api("/me/missions/win1/claim?userId=mu", { method: "POST" });
    assert.equal(claim.status, 200);
    assert.equal((await api("/me/missions/win1/claim?userId=mu", { method: "POST" })).status, 400);
    assert.equal((await api("/me/missions/nope/claim?userId=mu", { method: "POST" })).status, 404);
  });

  it("achievements unlock from lifetime stats", async () => {
    const list = (await (await api("/me/achievements?userId=mu")).json()) as any[];
    assert.equal(list.find((a) => a.id === "first_game").done, true);
    assert.equal(list.find((a) => a.id === "games_25").done, false);
    const claim = await api("/me/achievements/first_win/claim?userId=mu", { method: "POST" });
    assert.equal(claim.status, 200);
    const w = (await (await api("/me/wallet?userId=mu")).json()) as any;
    assert.ok(w.coins >= 50);
  });
});
