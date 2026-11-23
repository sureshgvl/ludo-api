import { createHmac, timingSafeEqual } from "node:crypto";

export interface TokenClaims { sub: string; name: string; exp: number }

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Minimal HS256 token. The same secret (JWT_SECRET) is configured on ludo-game-server to verify it. */
export function signToken(claims: Omit<TokenClaims, "exp">, secret: string, ttlSeconds = 30 * 86400, now = Date.now()): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + ttlSeconds }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function verifyToken(token: unknown, secret: string, now = Date.now()): TokenClaims | null {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const c = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (head.alg !== "HS256" || typeof c.sub !== "string" || typeof c.exp !== "number" || c.exp * 1000 < now) return null;
    return { sub: c.sub, name: typeof c.name === "string" ? c.name : "Player", exp: c.exp };
  } catch {
    return null;
  }
}
