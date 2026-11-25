import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { Pool } from "pg";
import { PG_POOL } from "../db/database.module";
import { levelFor } from "../rewards/rules";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_FRIENDS = 100;

function makeCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

@Injectable()
export class FriendsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The player's shareable code, created the first time it is needed. */
  async myCode(userId: string): Promise<string> {
    const cur = await this.pool.query("select friend_code from users where id = $1", [userId]);
    if (cur.rowCount === 0) throw new NotFoundException("Player not found");
    if (cur.rows[0].friend_code) return cur.rows[0].friend_code;
    for (let i = 0; i < 10; i++) {
      const code = makeCode();
      try {
        const r = await this.pool.query(
          "update users set friend_code = $2 where id = $1 and friend_code is null returning friend_code",
          [userId, code],
        );
        if (r.rowCount) return r.rows[0].friend_code;
        return (await this.pool.query("select friend_code from users where id = $1", [userId])).rows[0].friend_code;
      } catch (e: any) {
        if (e.code !== "23505") throw e; // code taken, try another
      }
    }
    throw new BadRequestException("Could not create a code, try again");
  }

  async list(userId: string) {
    const code = await this.myCode(userId);
    const rows = (
      await this.pool.query(
        `select u.id, u.name, u.friend_code, coalesce(s.xp, 0) as xp, coalesce(s.wins, 0) as wins
           from friends f join users u on u.id = f.friend_id left join user_stats s on s.user_id = u.id
          where f.user_id = $1 order by u.name asc`,
        [userId],
      )
    ).rows.map((r) => ({ userId: r.id, name: r.name, code: r.friend_code, level: levelFor(r.xp).level, wins: r.wins }));
    return { code, friends: rows };
  }

  /** Adding a friend by code makes both players friends. */
  async add(userId: string, rawCode: unknown) {
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new BadRequestException("Enter the 6 character player code");
    const other = await this.pool.query("select id, name from users where friend_code = $1", [code]);
    if (other.rowCount === 0) throw new NotFoundException("No player has that code");
    const friendId = other.rows[0].id as string;
    if (friendId === userId) throw new BadRequestException("That is your own code");
    const count = (await this.pool.query("select count(*)::int n from friends where user_id = $1", [userId])).rows[0].n as number;
    if (count >= MAX_FRIENDS) throw new BadRequestException(`You can have up to ${MAX_FRIENDS} friends`);
    await this.pool.query(
      "insert into friends (user_id, friend_id) values ($1,$2), ($2,$1) on conflict do nothing",
      [userId, friendId],
    );
    return { userId: friendId, name: other.rows[0].name };
  }

  async remove(userId: string, friendId: string) {
    await this.pool.query(
      "delete from friends where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)",
      [userId, friendId],
    );
    return { removed: true };
  }
}
