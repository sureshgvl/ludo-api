import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { PG_POOL } from "../db/database.module";
import { isUuid, parseCreateTournament, parseEntry, PrizeTierInput } from "./validation";

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
