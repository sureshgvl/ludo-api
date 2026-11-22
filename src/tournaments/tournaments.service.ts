import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { PG_POOL } from "../db/database.module";
import { isUuid, parseCreateTournament, parseEntry, parseGameResult, PrizeTierInput } from "./validation";

/** A game only counts when at least this many real players took part (stops farming points against bots). */
export const MIN_HUMANS_PER_GAME = 2;

export interface AwardView {
  tournamentId: string;
  userId: string;
  name: string;
  rank: number;
  prize: string;
  status: "pending" | "delivered";
  deliveredAt: string | null;
}

export type RecordResult =
  | { status: "applied"; applied: { userId: string; points: number; total: number }[] }
  | { status: "duplicate" }
  | { status: "ignored"; reason: "tournament_not_found" | "not_running" | "not_enough_humans" };

export type TournamentStatus = "scheduled" | "running" | "finished" | "cancelled";

export interface TournamentView {
  id: string;
  name: string;
  description: string;
  status: TournamentStatus;
  startsAt: string;
  endsAt: string;
  maxPlayers: number | null;
  playersPerGame: number;
  points: number[];
  entryCount: number;
  prizes: PrizeTierInput[];
}

export interface EntryView {
  userId: string;
  name: string;
  points: number;
  gamesPlayed: number;
  wins: number;
  rank: number | null;
}

const TOURNAMENT_SELECT = `
  select t.*, (select count(*)::int from tournament_entries e where e.tournament_id = t.id) as entry_count
  from tournaments t`;

function toTournament(row: any, prizes: PrizeTierInput[]): TournamentView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    maxPlayers: row.max_players,
    playersPerGame: row.players_per_game,
    points: row.points,
    entryCount: row.entry_count,
    prizes,
  };
}

@Injectable()
export class TournamentsService {
  constructor(@Inject(PG_POOL) protected readonly pool: Pool) {}

  protected async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async create(input: unknown, now = new Date()): Promise<TournamentView> {
    const v = parseCreateTournament(input, now);
    const status: TournamentStatus = v.startsAt <= now ? "running" : "scheduled";
    const id = await this.inTransaction(async (client) => {
      const res = await client.query(
        `insert into tournaments
           (name, description, status, starts_at, ends_at, max_players, players_per_game, points)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [v.name, v.description, status, v.startsAt, v.endsAt, v.maxPlayers, v.playersPerGame, v.points],
      );
      for (const p of v.prizes) {
        await client.query(
          "insert into prize_tiers (tournament_id, rank_from, rank_to, prize) values ($1, $2, $3, $4)",
          [res.rows[0].id, p.rankFrom, p.rankTo, p.prize],
        );
      }
      return res.rows[0].id as string;
    });
    return this.get(id);
  }

  private async prizesFor(id: string): Promise<PrizeTierInput[]> {
    const res = await this.pool.query(
      "select rank_from, rank_to, prize from prize_tiers where tournament_id = $1 order by rank_from",
      [id],
    );
    return res.rows.map((r) => ({ rankFrom: r.rank_from, rankTo: r.rank_to, prize: r.prize }));
  }

  async get(id: string): Promise<TournamentView> {
    if (!isUuid(id)) throw new NotFoundException("Tournament not found");
    const res = await this.pool.query(`${TOURNAMENT_SELECT} where t.id = $1`, [id]);
    if (res.rowCount === 0) throw new NotFoundException("Tournament not found");
    return toTournament(res.rows[0], await this.prizesFor(id));
  }

  async list(status?: string): Promise<TournamentView[]> {
    if (status !== undefined && !["scheduled", "running", "finished", "cancelled"].includes(status)) {
      throw new BadRequestException("Unknown status");
    }
    const res = await this.pool.query(
      `${TOURNAMENT_SELECT} ${status ? "where t.status = $1" : ""} order by t.starts_at desc limit 50`,
      status ? [status] : [],
    );
    const out: TournamentView[] = [];
    for (const row of res.rows) out.push(toTournament(row, await this.prizesFor(row.id)));
    return out;
  }

  async cancel(id: string): Promise<TournamentView> {
    await this.get(id);
    const res = await this.pool.query(
      "update tournaments set status = 'cancelled' where id = $1 and status in ('scheduled', 'running')",
      [id],
    );
    if (res.rowCount === 0) throw new ConflictException("Only a scheduled or running tournament can be cancelled");
    return this.get(id);
  }

  async register(id: string, input: unknown): Promise<EntryView> {
    const { userId, name } = parseEntry(input);
    if (!isUuid(id)) throw new NotFoundException("Tournament not found");
    await this.inTransaction(async (client) => {
      const t = await client.query("select status, max_players from tournaments where id = $1 for update", [id]);
      if (t.rowCount === 0) throw new NotFoundException("Tournament not found");
      if (!["scheduled", "running"].includes(t.rows[0].status)) {
        throw new ConflictException("Registration is closed for this tournament");
      }
      const existing = await client.query(
        "select 1 from tournament_entries where tournament_id = $1 and user_id = $2",
        [id, userId],
      );
      if (existing.rowCount === 0 && t.rows[0].max_players !== null) {
        const count = await client.query("select count(*)::int as n from tournament_entries where tournament_id = $1", [id]);
        if (count.rows[0].n >= t.rows[0].max_players) throw new ConflictException("Tournament is full");
      }
      await client.query(
        `insert into tournament_entries (tournament_id, user_id, name) values ($1, $2, $3)
         on conflict (tournament_id, user_id) do update set name = excluded.name`,
        [id, userId, name],
      );
    });
    return (await this.entry(id, userId))!;
  }

  async withdraw(id: string, userId: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundException("Tournament not found");
    await this.inTransaction(async (client) => {
      const t = await client.query("select status from tournaments where id = $1 for update", [id]);
      if (t.rowCount === 0) throw new NotFoundException("Tournament not found");
      if (t.rows[0].status !== "scheduled") throw new ConflictException("You can only withdraw before the tournament starts");
      await client.query("delete from tournament_entries where tournament_id = $1 and user_id = $2", [id, userId]);
    });
  }

  /** One player's standing, or null if they are not registered. */
  async entry(id: string, userId: string): Promise<EntryView | null> {
    if (!isUuid(id)) throw new NotFoundException("Tournament not found");
    const res = await this.pool.query(
      `select * from (
         select user_id, name, points, games_played, wins,
                row_number() over (order by points desc, wins desc, joined_at asc, user_id asc)::int as rank
         from tournament_entries where tournament_id = $1
       ) ranked where user_id = $2`,
      [id, userId],
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return { userId: r.user_id, name: r.name, points: r.points, gamesPlayed: r.games_played, wins: r.wins, rank: r.rank };
  }

  /** Can this user play a counted game in this tournament right now? Used by the game server. */
  async eligibility(id: string, userId: string) {
    if (!isUuid(id)) return { eligible: false, reason: "not_found", playersPerGame: null };
    const t = await this.pool.query("select status, players_per_game from tournaments where id = $1", [id]);
    if (t.rowCount === 0) return { eligible: false, reason: "not_found", playersPerGame: null };
    const playersPerGame = t.rows[0].players_per_game as number;
    if (t.rows[0].status !== "running") return { eligible: false, reason: "not_running", playersPerGame };
    const e = await this.pool.query(
      "select 1 from tournament_entries where tournament_id = $1 and user_id = $2",
      [id, userId],
    );
    if (e.rowCount === 0) return { eligible: false, reason: "not_registered", playersPerGame };
    return { eligible: true, reason: null, playersPerGame };
  }

  /**
   * Counts a finished game: awards points by placement to registered human players.
   * Safe to call twice for the same game (the second call is a no-op).
   */
  async recordGame(input: unknown): Promise<RecordResult> {
    const g = parseGameResult(input);
    return this.inTransaction(async (client): Promise<RecordResult> => {
      const t = await client.query(
        "select status, players_per_game, points from tournaments where id = $1 for update",
        [g.tournamentId],
      );
      if (t.rowCount === 0) return { status: "ignored", reason: "tournament_not_found" };
      if (t.rows[0].status !== "running") return { status: "ignored", reason: "not_running" };
      if (g.placements.length !== t.rows[0].players_per_game) {
        throw new BadRequestException(`This tournament is played with ${t.rows[0].players_per_game} players per game`);
      }
      const humans = g.placements.filter((p) => !p.isBot);
      if (humans.length < MIN_HUMANS_PER_GAME) return { status: "ignored", reason: "not_enough_humans" };

      const seen = await client.query(
        `insert into tournament_games (tournament_id, game_id, placements) values ($1, $2, $3)
         on conflict do nothing returning game_id`,
        [g.tournamentId, g.gameId, JSON.stringify(g.placements)],
      );
      if (seen.rowCount === 0) return { status: "duplicate" };

      const scale: number[] = t.rows[0].points;
      const applied: { userId: string; points: number; total: number }[] = [];
      for (const p of humans) {
        const points = scale[p.placement - 1] ?? 0;
        const res = await client.query(
          `update tournament_entries
             set points = points + $3, games_played = games_played + 1,
                 wins = wins + $4, last_game_at = now()
           where tournament_id = $1 and user_id = $2
           returning points`,
          [g.tournamentId, p.userId, points, p.placement === 1 ? 1 : 0],
        );
        if (res.rowCount) applied.push({ userId: p.userId, points, total: res.rows[0].points });
      }
      return { status: "applied", applied };
    });
  }

  /**
   * Moves tournaments through their lifecycle for the given time: scheduled -> running
   * at the start, running -> finished at the end (ranks fixed, prize awards created).
   */
  async tick(now = new Date()): Promise<{ started: number; finished: number }> {
    const started = await this.pool.query(
      `update tournaments set status = 'running'
       where status = 'scheduled' and starts_at <= $1 and ends_at > $1`,
      [now],
    );
    const finished = await this.inTransaction(async (client) => {
      const due = await client.query(
        `select id from tournaments
         where status in ('scheduled', 'running') and ends_at <= $1
         for update skip locked`,
        [now],
      );
      for (const row of due.rows) await this.finalize(client, row.id, now);
      return due.rowCount ?? 0;
    });
    return { started: started.rowCount ?? 0, finished };
  }

  private async finalize(client: PoolClient, id: string, now: Date): Promise<void> {
    const tiers = (
      await client.query("select rank_from, rank_to, prize from prize_tiers where tournament_id = $1", [id])
    ).rows;
    const ranked = (
      await client.query(
        `select user_id, games_played,
                row_number() over (order by points desc, wins desc, joined_at asc, user_id asc)::int as rank
         from tournament_entries where tournament_id = $1 order by rank`,
        [id],
      )
    ).rows;
    for (const r of ranked) {
      if (r.games_played === 0) continue; // prizes go to players who actually played
      const tier = tiers.find((t) => r.rank >= t.rank_from && r.rank <= t.rank_to);
      if (!tier) continue;
      await client.query(
        "insert into prize_awards (tournament_id, user_id, rank, prize) values ($1, $2, $3, $4)",
        [id, r.user_id, r.rank, tier.prize],
      );
    }
    await client.query("update tournaments set status = 'finished', finished_at = $2 where id = $1", [id, now]);
  }

  async awards(id: string): Promise<AwardView[]> {
    await this.get(id);
    const res = await this.pool.query(
      `select a.*, e.name from prize_awards a
       join tournament_entries e on e.tournament_id = a.tournament_id and e.user_id = a.user_id
       where a.tournament_id = $1 order by a.rank`,
      [id],
    );
    return res.rows.map((r) => ({
      tournamentId: r.tournament_id,
      userId: r.user_id,
      name: r.name,
      rank: r.rank,
      prize: r.prize,
      status: r.status,
      deliveredAt: r.delivered_at ? r.delivered_at.toISOString() : null,
    }));
  }

  async markAwardDelivered(id: string, userId: string): Promise<AwardView> {
    await this.get(id);
    const res = await this.pool.query(
      `update prize_awards set status = 'delivered', delivered_at = coalesce(delivered_at, now())
       where tournament_id = $1 and user_id = $2 returning user_id`,
      [id, userId],
    );
    if (res.rowCount === 0) throw new NotFoundException("No prize award for that player");
    return (await this.awards(id)).find((a) => a.userId === userId)!;
  }

  async leaderboard(id: string, limit = 50): Promise<EntryView[]> {
    await this.get(id);
    const n = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);
    const res = await this.pool.query(
      `select user_id, name, points, games_played, wins,
              row_number() over (order by points desc, wins desc, joined_at asc, user_id asc)::int as rank
       from tournament_entries where tournament_id = $1
       order by rank limit $2`,
      [id, n],
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      points: r.points,
      gamesPlayed: r.games_played,
      wins: r.wins,
      rank: r.rank,
    }));
  }
}
