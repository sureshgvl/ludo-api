import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Pool } from "pg";
import { config } from "../config";
import { PG_POOL } from "../db/database.module";
import { signToken } from "./jwt";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export function normalizePhone(v: unknown): string {
  const digits = typeof v === "string" ? v.replace(/[\s-]/g, "").replace(/^\+?91/, "") : "";
  if (!/^[6-9]\d{9}$/.test(digits)) throw new BadRequestException("Enter a valid 10-digit Indian mobile number");
  return digits;
}

export interface AuthResult { token: string; user: { id: string; name: string; phone: string } }

@Injectable()
export class AuthService {
  private failures = new Map<string, { n: number; until: number }>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private issue(u: { id: string; name: string; phone: string }): AuthResult {
    if (!config.jwtSecret) throw new BadRequestException("Login is not configured on the server (JWT_SECRET missing)");
    return { token: signToken({ sub: u.id, name: u.name }, config.jwtSecret), user: { id: u.id, name: u.name, phone: u.phone } };
  }

  async register(input: any): Promise<AuthResult> {
    const phone = normalizePhone(input?.phone);
    const password = typeof input?.password === "string" ? input.password : "";
    if (password.length < 6 || password.length > 100) throw new BadRequestException("Password must be 6 to 100 characters");
    const name = typeof input?.name === "string" ? input.name.trim().slice(0, 20) : "";
    if (!name) throw new BadRequestException("Name is required (max 20 characters)");
    const salt = randomBytes(16);
    const hash = `${salt.toString("hex")}:${(await scrypt(password, salt, 32)).toString("hex")}`;
    const id = randomUUID();
    try {
      await this.pool.query("insert into users (id, phone, name, password_hash) values ($1, $2, $3, $4)", [id, phone, name, hash]);
    } catch (e: any) {
      if (e.code === "23505") throw new ConflictException("This mobile number is already registered. Log in instead.");
      throw e;
    }
    return this.issue({ id, name, phone });
  }

  async login(input: any): Promise<AuthResult> {
    const phone = normalizePhone(input?.phone);
    const password = typeof input?.password === "string" ? input.password : "";
    const f = this.failures.get(phone);
    if (f && f.n >= 10 && f.until > Date.now()) throw new UnauthorizedException("Too many attempts. Try again in a few minutes.");
    const r = await this.pool.query("select id, name, phone, password_hash from users where phone = $1", [phone]);
    let ok = false;
    if (r.rowCount) {
      const [saltHex, hashHex] = String(r.rows[0].password_hash).split(":");
      const got = await scrypt(password, Buffer.from(saltHex, "hex"), 32);
      const want = Buffer.from(hashHex, "hex");
      ok = got.length === want.length && timingSafeEqual(got, want);
    }
    if (!ok) {
      const n = (f && f.until > Date.now() ? f.n : 0) + 1;
      this.failures.set(phone, { n, until: Date.now() + 15 * 60_000 });
      throw new UnauthorizedException("Wrong mobile number or password");
    }
    this.failures.delete(phone);
    return this.issue(r.rows[0]);
  }
}
