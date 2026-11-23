import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { PG_POOL } from "../db/database.module";
import {
  dailyBonus,
  FIRST_WIN_BONUS,
  gameReward,
  istDate,
  levelFor,
  periodStart,
  previousDate,
  GameReward,
} from "./rules";

export interface WalletView {
  userId: string;
  coins: number;
  xp: number;
  level: number;
  levelStartXp: number;
  nextLevelXp: number;
  games: number;
  wins: number;
  streak: number;
  dailyAvailable: boolean;
  dailyCoins: number;
}

export interface GameResultInput {
  gameId: string;
  placements: { userId: string; placement: number; isBot: boolean }[];
}

function parseResult(input: unknown): GameResultInput {
  const o = input as any;
  if (!o || typeof o !== "object" || typeof o.gameId !== "string" || !o.gameId || !Array.isArray(o.placements)) {
    throw new BadRequestException("gameId and placements are required");
  }
  const placements = o.placements.map((p: any) => {
    if (!p || typeof p.userId !== "string" || !Number.isInteger(p.placement) || p.placement < 1 || p.placement > 4) {
      throw new BadRequestException("invalid placement");
    }
    return { userId: p.userId, placement: p.placement as number, isBot: !!p.isBot };
  });
  if (placements.length < 2 || placements.length > 4) throw new BadRequestException("2 to 4 players expected");
  return { gameId: o.gameId.slice(0, 80), placements };
}

@Injectable()
export class RewardsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /** Adds one ledger entry once per (user, reason, ref). Returns false when it was already there. */
  private async credit(c: PoolClient, userId: string, r: GameReward, reason: string, ref: string, note = ""): Promise<boolean> {
    const ins = await c.query(
      "insert into ledger (user_id, coins, xp, reason, ref, note) values ($1,$2,$3,$4,$5,$6) on conflict do nothing returning id",
      [userId, r.coins, r.xp, reason, ref, note],
    );
    if (ins.rowCount === 0) return false;
    await c.query(
      `insert into user_stats (user_id, coins, xp) values ($1,$2,$3)
       on conflict (user_id) do update set coins = user_stats.coins + $2, xp = user_stats.xp + $3`,
      [userId, r.coins, r.xp],
    );
    return true;
  }

  /** A finished game (any game, tournament or not). Safe to send twice. */
  async recordGame(input: unknown, now = new Date()) {
    const g = parseResult(input);
    const humans = g.placements.filter((p) => !p.isBot);
    const today = istDate(now);
    const dayStart = periodStart("daily", now)!;
    return this.tx(async (c) => {
      const granted: { userId: string; coins: number; xp: number }[] = [];
      for (const p of humans) {
        const botToday = (
          await c.query("select count(*)::int n from ledger where user_id=$1 and reason='game_bot' and created_at >= $2", [p.userId, dayStart])
        ).rows[0].n as number;
        const reward = gameReward(p.placement, humans.length, botToday);
        const reason = humans.length >= 2 ? "game" : "game_bot";
        const first = await this.credit(c, p.userId, reward, reason, g.gameId, `Place ${p.placement}`);
        if (!first) continue; // this game was already counted
        await c.query(
          "update user_stats set games = games + 1, wins = wins + $2 where user_id = $1",
          [p.userId, p.placement === 1 ? 1 : 0],
        );
        let coins = reward.coins;
        let xp = reward.xp;
        if (p.placement === 1 && humans.length >= 2 && (await this.credit(c, p.userId, FIRST_WIN_BONUS, "first_win", today, "First win of the day"))) {
          coins += FIRST_WIN_BONUS.coins;
          xp += FIRST_WIN_BONUS.xp;
        }
        granted.push({ userId: p.userId, coins, xp });
      }
      return { status: granted.length ? "applied" : "duplicate", granted };
    });
  }

  async wallet(userId: string, now = new Date()): Promise<WalletView> {
    const s = (await this.pool.query("select * from user_stats where user_id = $1", [userId])).rows[0];
    const xp = s?.xp ?? 0;
    const streak = s?.streak ?? 0;
    const today = istDate(now);
    const claimed = (await this.pool.query("select 1 from ledger where user_id=$1 and reason='daily' and ref=$2", [userId, today])).rowCount! > 0;
    const nextStreak = claimed ? streak : await this.streakIfClaimedToday(userId, today);
    return {
      userId,
      coins: s?.coins ?? 0,
      xp,
      ...levelFor(xp),
      games: s?.games ?? 0,
      wins: s?.wins ?? 0,
      streak,
      dailyAvailable: !claimed,
      dailyCoins: dailyBonus(nextStreak).coins,
    };
  }

  private async streakIfClaimedToday(userId: string, today: string): Promise<number> {
    const y = (await this.pool.query("select 1 from ledger where user_id=$1 and reason='daily' and ref=$2", [userId, previousDate(today)])).rowCount! > 0;
    const s = (await this.pool.query("select streak from user_stats where user_id=$1", [userId])).rows[0];
    return y ? (s?.streak ?? 0) + 1 : 1;
  }

  async claimDaily(userId: string, now = new Date()) {
    const today = istDate(now);
    const result = await this.tx(async (c) => {
      const y = (await c.query("select 1 from ledger where user_id=$1 and reason='daily' and ref=$2", [userId, previousDate(today)])).rowCount! > 0;
      const s = (await c.query("select streak from user_stats where user_id=$1 for update", [userId])).rows[0];
      const streak = y ? (s?.streak ?? 0) + 1 : 1;
      const reward = dailyBonus(streak);
      const ok = await this.credit(c, userId, reward, "daily", today, `Daily bonus, day ${streak}`);
      if (!ok) return null;
      await c.query("update user_stats set streak = $2, last_daily = $3 where user_id = $1", [userId, streak, today]);
      return { ...reward, streak };
    });
    if (!result) throw new BadRequestException("Already claimed today");
    return { ...result, wallet: await this.wallet(userId, now) };
  }

  async history(userId: string, limit = 50) {
    const r = await this.pool.query(
      "select coins, xp, reason, note, created_at from ledger where user_id=$1 order by id desc limit $2",
      [userId, Math.min(Math.max(limit, 1), 200)],
    );
    return r.rows.map((x) => ({ coins: x.coins, xp: x.xp, reason: x.reason, note: x.note, at: x.created_at }));
  }

  async leaderboard(period: "daily" | "weekly" | "all", userId?: string, now = new Date(), limit = 50) {
    const since = periodStart(period, now);
    const rows = (
      await this.pool.query(
        `select l.user_id, coalesce(u.name, 'Player') as name, sum(l.xp)::int as xp
           from ledger l left join users u on u.id = l.user_id
          where ($1::timestamptz is null or l.created_at >= $1) and l.xp > 0
          group by l.user_id, u.name
          order by xp desc, l.user_id asc limit $2`,
        [since, limit],
      )
    ).rows.map((r, i) => ({ rank: i + 1, userId: r.user_id, name: r.name, xp: r.xp, level: levelFor(Math.max(r.xp, 0)).level }));
    let me: { rank: number; xp: number } | null = null;
    if (userId) {
      const m = (
        await this.pool.query(
          `with t as (select user_id, sum(xp)::int xp from ledger where ($1::timestamptz is null or created_at >= $1) and xp > 0 group by user_id)
           select xp, (select count(*)::int + 1 from t t2 where t2.xp > t.xp) as rank from t where user_id = $2`,
          [since, userId],
        )
      ).rows[0];
      if (m) me = { rank: m.rank, xp: m.xp };
    }
    return { period, since, rows, me };
  }
}
