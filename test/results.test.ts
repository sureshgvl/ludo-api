import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { TournamentsService } from "../src/tournaments/tournaments.service";
import { startTestDb, TestDb } from "./pg-helper";

const db: TestDb | null = startTestDb();

describe("results, scheduler and prizes", { skip: !db && "no PostgreSQL available (set TEST_DATABASE_URL)" }, () => {
  let app: INestApplication;
  let service: TournamentsService;
  let base = "";
  const ADMIN = { "x-admin-key": "admin-secret", "content-type": "application/json" };
  const INTERNAL = { "x-internal-key": "internal-secret", "content-type": "application/json" };
  const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const api = (path: string, init?: RequestInit) => fetch(`${base}/api${path}`, init);
  const post = (path: string, body: unknown, headers: Record<string, string>) =>
    api(path, { method: "POST", headers, body: JSON.stringify(body) });

  async function tournament(extra: Record<string, unknown> = {}) {
    const res = await post("/admin/tournaments", { name: "Cup", startsAt: hours(-1), endsAt: hours(4), ...extra }, ADMIN);
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()) as any;
  }
  const register = (id: string, userId: string, name = userId) =>
    post(`/tournaments/${id}/entries`, { userId, name }, { "content-type": "application/json" });
  const game = (tournamentId: string, gameId: string, placements: [string, number, boolean?][]) =>
    post("/internal/games", {
      tournamentId,
      gameId,
      placements: placements.map(([userId, placement, isBot]) => ({ userId, placement, isBot: !!isBot })),
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
    service = app.get(TournamentsService);
  });
  after(async () => {
    await app?.close();
    db?.stop();
  });

  it("internal endpoints need the internal key", async () => {
    const t = await tournament();
    assert.equal((await api(`/internal/tournaments/${t.id}/eligibility/u1`)).status, 401);
    assert.equal((await post("/internal/games", {}, { "content-type": "application/json" })).status, 401);
    assert.equal((await post("/internal/games", {}, { ...INTERNAL, "x-internal-key": "nope" })).status, 401);
  });

  it("reports who may play a counted game", async () => {
    const running = await tournament();
    await register(running.id, "in");
    const ask = async (id: string, user: string) =>
      (await (await api(`/internal/tournaments/${id}/eligibility/${user}`, { headers: INTERNAL })).json()) as any;

    assert.deepEqual(await ask(running.id, "in"), { eligible: true, reason: null, playersPerGame: 2 });
    assert.equal((await ask(running.id, "out")).reason, "not_registered");
    const future = await tournament({ startsAt: hours(2), endsAt: hours(6) });
    assert.equal((await ask(future.id, "in")).reason, "not_running");
    assert.equal((await ask("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90", "in")).reason, "not_found");
  });

  it("awards points by placement and ranks the leaderboard", async () => {
    const t = await tournament();
    for (const u of ["a", "b", "c"]) await register(t.id, u);

    const r1 = (await (await game(t.id, "g1", [["a", 1], ["b", 2]])).json()) as any;
    assert.equal(r1.status, "applied");
    assert.deepEqual(r1.applied, [{ userId: "a", points: 10, total: 10 }, { userId: "b", points: 4, total: 4 }]);
    await game(t.id, "g2", [["c", 1], ["b", 2]]);
    await game(t.id, "g3", [["a", 1], ["c", 2]]);

    const rows = await board(t.id);
    assert.deepEqual(rows.map((r) => [r.userId, r.points, r.wins, r.gamesPlayed, r.rank]), [
      ["a", 20, 2, 2, 1],
      ["c", 14, 1, 2, 2],
      ["b", 8, 0, 2, 3],
    ]);
  });

  it("never counts the same game twice", async () => {
    const t = await tournament();
    await register(t.id, "a");
    await register(t.id, "b");
    await game(t.id, "dup", [["a", 1], ["b", 2]]);
    const again = (await (await game(t.id, "dup", [["a", 1], ["b", 2]])).json()) as any;
    assert.equal(again.status, "duplicate");
    assert.equal((await board(t.id))[0].points, 10);
  });

  it("ignores games against bots, unregistered players and finished tournaments", async () => {
    const t = await tournament();
    await register(t.id, "a");
    const bots = (await (await game(t.id, "bot-game", [["a", 1], ["bot-2", 2, true]])).json()) as any;
    assert.deepEqual(bots, { status: "ignored", reason: "not_enough_humans" });
    assert.equal((await board(t.id))[0].points, 0);

    // a registered player vs an unregistered one: only the registered player scores
    const mixed = (await (await game(t.id, "mixed", [["a", 1], ["stranger", 2]])).json()) as any;
    assert.deepEqual(mixed.applied.map((x: any) => x.userId), ["a"]);

    const unknown = (await (await game("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90", "x", [["a", 1], ["b", 2]])).json()) as any;
    assert.equal(unknown.reason, "tournament_not_found");

    const future = await tournament({ startsAt: hours(2), endsAt: hours(6) });
    const early = (await (await game(future.id, "early", [["a", 1], ["b", 2]])).json()) as any;
    assert.equal(early.reason, "not_running");
  });

  it("rejects malformed results", async () => {
    const t = await tournament();
    assert.equal((await game(t.id, "bad", [["a", 1], ["b", 3]])).status, 400); // gap in placements
    assert.equal((await game(t.id, "bad", [["a", 1], ["a", 2]])).status, 400); // same player twice
    assert.equal((await game(t.id, "bad", [["a", 1], ["b", 2], ["c", 3], ["d", 4]])).status, 400); // wrong size
  });

  it("breaks ties by wins, then by who registered first", async () => {
    const t = await tournament({ playersPerGame: 4, points: [10, 6, 3, 1] });
    for (const u of ["p", "q", "r", "s"]) await register(t.id, u);
    // p: 1st (10), q: 2nd (6), r: 3rd (3), s: 4th (1); then q wins and p is 2nd...
    await game(t.id, "t1", [["p", 1], ["q", 2], ["r", 3], ["s", 4]]);
    await game(t.id, "t2", [["q", 1], ["p", 2], ["s", 3], ["r", 4]]);
    // p: 16 pts 1 win, q: 16 pts 1 win -> p registered first
    const rows = await board(t.id);
    assert.deepEqual(rows.slice(0, 2).map((r) => r.userId), ["p", "q"]);
    assert.equal(rows[0].points, rows[1].points);
  });

  it("starts and finishes tournaments on time and creates prize awards", async () => {
    const t = await tournament({
      startsAt: hours(2),
      endsAt: hours(6),
      prizes: [
        { rankFrom: 1, rankTo: 1, prize: "Gold hamper" },
        { rankFrom: 2, rankTo: 3, prize: "Voucher 200" },
      ],
    });
    for (const u of ["x", "y", "z"]) await register(t.id, u, `Player ${u}`);

    // other tests' future tournaments fall in this window too, so only require at least ours
    const startTick = await service.tick(new Date(Date.now() + 3 * 3600_000));
    assert.ok(startTick.started >= 1);
    assert.equal(startTick.finished, 0);
    assert.equal(((await (await api(`/tournaments/${t.id}`)).json()) as any).status, "running");

    await game(t.id, "w1", [["x", 1], ["y", 2]]);
    await game(t.id, "w2", [["x", 1], ["y", 2]]);

    const end = new Date(Date.now() + 7 * 3600_000);
    const done = await service.tick(end);
    assert.ok(done.finished >= 1);
    assert.equal(((await (await api(`/tournaments/${t.id}`)).json()) as any).status, "finished");

    // z never played, so no prize even though a tier covers rank 3
    const awards = (await (await api(`/tournaments/${t.id}/awards`)).json()) as any[];
    assert.deepEqual(awards.map((a) => [a.userId, a.rank, a.prize, a.status]), [
      ["x", 1, "Gold hamper", "pending"],
      ["y", 2, "Voucher 200", "pending"],
    ]);

    // finishing twice does nothing; late games are ignored
    assert.equal((await service.tick(end)).finished, 0);
    const late = (await (await game(t.id, "late", [["x", 1], ["y", 2]])).json()) as any;
    assert.equal(late.reason, "not_running");

    // admin hands over a prize
    assert.equal((await api(`/admin/tournaments/${t.id}/awards`)).status, 401);
    const listed = (await (await api(`/admin/tournaments/${t.id}/awards`, { headers: ADMIN })).json()) as any[];
    assert.equal(listed.length, 2);
    const delivered = (await (await post(`/admin/tournaments/${t.id}/awards/x/delivered`, {}, ADMIN)).json()) as any;
    assert.equal(delivered.status, "delivered");
    assert.ok(delivered.deliveredAt);
    assert.equal((await post(`/admin/tournaments/${t.id}/awards/nobody/delivered`, {}, ADMIN)).status, 404);
  });
});
