import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Pool } from "pg";
import { PG_POOL } from "../db/database.module";
import { ACHIEVEMENTS, Goal, MISSIONS, Progress } from "./missions";
import { istDate, levelFor, periodStart } from "./rules";
import { RewardsService } from "./rewards.service";

@Injectable()
export class MissionsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(RewardsService) private readonly rewards: RewardsService,
  ) {}

  async progress(userId: string, now = new Date()): Promise<Progress> {
    const dayStart = periodStart("daily", now)!;
    const r = (
      await this.pool.query(
        `select count(*)::int games, count(*) filter (where placement = 1 and humans >= 2)::int wins,
                coalesce(sum(captures),0)::int captures, coalesce(sum(home),0)::int home,
                count(*) filter (where created_at >= $2)::int games_today,
                count(*) filter (where created_at >= $2 and placement = 1 and humans >= 2)::int wins_today,
                coalesce(sum(captures) filter (where created_at >= $2),0)::int captures_today,
                coalesce(sum(home) filter (where created_at >= $2),0)::int home_today
           from game_log where user_id = $1`,
        [userId, dayStart],
      )
    ).rows[0];
    const s = (await this.pool.query("select xp, streak from user_stats where user_id = $1", [userId])).rows[0];
    return {
      gamesToday: r.games_today, winsToday: r.wins_today, capturesToday: r.captures_today, homeToday: r.home_today,
      games: r.games, wins: r.wins, captures: r.captures, home: r.home,
      streak: s?.streak ?? 0, level: levelFor(s?.xp ?? 0).level,
    };
  }

  private async view(userId: string, goals: Goal[], refFor: (g: Goal) => string, reason: string, now: Date) {
    const p = await this.progress(userId, now);
    const claimed = new Set(
      (await this.pool.query("select ref from ledger where user_id = $1 and reason = $2", [userId, reason])).rows.map((x) => x.ref as string),
    );
    return goals.map((g) => {
      const value = Math.min(g.value(p), g.target);
      return {
        id: g.id, title: g.title, target: g.target, progress: value,
        coins: g.coins, xp: g.xp,
        done: value >= g.target, claimed: claimed.has(refFor(g)),
      };
    });
  }

  missions(userId: string, now = new Date()) {
    const day = istDate(now);
    return this.view(userId, MISSIONS, (g) => `${day}:${g.id}`, "mission", now);
  }

  achievements(userId: string, now = new Date()) {
    return this.view(userId, ACHIEVEMENTS, (g) => g.id, "achievement", now);
  }

  private async claim(userId: string, goals: Goal[], id: string, reason: "mission" | "achievement", now: Date) {
    const goal = goals.find((g) => g.id === id);
    if (!goal) throw new NotFoundException("Unknown goal");
    const p = await this.progress(userId, now);
    if (goal.value(p) < goal.target) throw new BadRequestException("Not completed yet");
    const ref = reason === "mission" ? `${istDate(now)}:${goal.id}` : goal.id;
    const ok = await this.rewards.tx((c) => this.rewards.credit(c, userId, { coins: goal.coins, xp: goal.xp }, reason, ref, goal.title));
    if (!ok) throw new BadRequestException("Already claimed");
    return { coins: goal.coins, xp: goal.xp, wallet: await this.rewards.wallet(userId, now) };
  }

  claimMission(userId: string, id: string, now = new Date()) { return this.claim(userId, MISSIONS, id, "mission", now); }
  claimAchievement(userId: string, id: string, now = new Date()) { return this.claim(userId, ACHIEVEMENTS, id, "achievement", now); }
}
