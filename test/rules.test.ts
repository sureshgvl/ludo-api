import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { gameScore } from "../src/tournaments/tournaments.service";
import { DEFAULT_RULES, parseRules } from "../src/tournaments/validation";
import { startTestDb, TestDb } from "./pg-helper";

describe("rules parsing and scoring", () => {
  it("defaults", () => {
    assert.deepEqual(parseRules(undefined, 4), DEFAULT_RULES);
  });
  it("rejects bad values", () => {
    assert.throws(() => parseRules({ capturePoints: -1 }, 4));
    assert.throws(() => parseRules({ minHumans: 3 }, 2));
    assert.throws(() => parseRules({ tiebreak: "random" }, 4));
    assert.throws(() => parseRules({ bestN: 5, maxGames: 3 }, 4));
  });
  it("scores a game", () => {
    const rules = { ...DEFAULT_RULES, winBonus: 5, capturePoints: 2, homePoints: 1 };
    assert.equal(gameScore([10, 6, 3, 1], rules, { placement: 1, captures: 3, home: 4 }), 10 + 5 + 6 + 4);
    assert.equal(gameScore([10, 6, 3, 1], rules, { placement: 2, captures: 1, home: 2 }), 6 + 2 + 2);
  });
});

const db: TestDb | null = startTestDb();

describe("rules in tournaments", { skip: !db && "no PostgreSQL available (set TEST_DATABASE_URL)" }, () => {
  let app: INestApplication;
  let base = "";
  const ADMIN = { "x-admin-key": "admin-secret", "content-type": "application/json" };
  const INTERNAL = { "x-internal-key": "internal-secret", "content-type": "application/json" };
  const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const api = (path: string, init?: RequestInit) => fetch(`${base}/api${path}`, init);
  const post = (path: string, body: unknown, headers: Record<string, string>) =>
    api(path, { method: "POST", headers, body: JSON.stringify(body) });
  const make = async (rules: Record<string, unknown>) => {
    const res = await post("/admin/tournaments", { name: "R", startsAt: hours(-1), endsAt: hours(4), playersPerGame: 2, rules }, ADMIN);
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()) as any;
  };
  const reg = (id: string, u: string) => post(`/tournaments/${id}/entries`, { userId: u, name: u }, { "content-type": "application/json" });
  const play = (id: string, g: string, a: any, b: any) =>
    post("/internal/games", {
      tournamentId: id, gameId: g,
      placements: [
        { userId: a.u, placement: 1, isBot: false, captures: a.c ?? 0, home: a.h ?? 0 },
        { userId: b.u, placement: 2, isBot: !!b.bot, captures: b.c ?? 0, home: b.h ?? 0 },
      ],
    }, INTERNAL);
  const board = async (id: string) => (await (await api(`/tournaments/${id}/leaderboard`)).json()) as any[];

  before(async () => {
    config.databaseUrl = db!.url;
    config.adminApiKey = "admin-secret";
    config.internalApiKey = "internal-secret";
    config.disableScheduler = true;
    app = await createApp({ logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace("[::1]", "localhost");
  });
  after(async () => { await app?.close(); db?.stop(); });

  it("stores and returns rules", async () => {
    const t = await make({ winBonus: 5, capturePoints: 2 });
    assert.equal(t.rules.winBonus, 5);
    assert.equal(t.rules.capturePoints, 2);
    assert.equal(t.rules.minHumans, 2);
  });

  it("adds capture, home and win points", async () => {
    const t = await make({ winBonus: 5, capturePoints: 2, homePoints: 1 });
    await reg(t.id, "a"); await reg(t.id, "b");
    await play(t.id, "g1", { u: "a", c: 2, h: 4 }, { u: "b", c: 1, h: 1 });
    const b = await board(t.id);
    const pts = Object.fromEntries(b.map((r) => [r.userId, r.points]));
    assert.equal(pts.a, 10 + 5 + 4 + 4);
    assert.equal(pts.b, 4 + 2 + 1);
  });

  it("caps games per player and counts only the best N", async () => {
    const t = await make({ maxGames: 3, bestN: 2 });
    await reg(t.id, "a"); await reg(t.id, "b");
    for (let i = 1; i <= 4; i++) await play(t.id, `m${i}`, { u: "a" }, { u: "b" });
    const b = await board(t.id);
    const a = b.find((r) => r.userId === "a");
    assert.equal(a.gamesPlayed, 3);
    assert.equal(a.points, 20); // best 2 of 3 games, 10 each
  });

  it("limits games per day", async () => {
    const t = await make({ maxGamesPerDay: 1 });
    await reg(t.id, "a"); await reg(t.id, "b");
    await play(t.id, "d1", { u: "a" }, { u: "b" });
    await play(t.id, "d2", { u: "a" }, { u: "b" });
    const a = (await board(t.id)).find((r) => r.userId === "a");
    assert.equal(a.gamesPlayed, 1);
  });

  it("requires a minimum level", async () => {
    const t = await make({ minLevel: 3 });
    await reg(t.id, "newbie");
    const e = await (await api(`/internal/tournaments/${t.id}/eligibility/newbie`, { headers: INTERNAL })).json() as any;
    assert.equal(e.eligible, false);
    assert.equal(e.reason, "level_too_low");
  });

  it("can require more real players", async () => {
    const t = await make({ minHumans: 2 });
    await reg(t.id, "a");
    const res = await play(t.id, "bot1", { u: "a" }, { u: "bot", bot: true });
    assert.equal(((await res.json()) as any).reason, "not_enough_humans");
  });
});
