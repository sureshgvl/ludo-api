import { BadRequestException } from "@nestjs/common";

export interface PrizeTierInput {
  rankFrom: number;
  rankTo: number;
  prize: string;
}

/** The scoring and fair-play algorithm of a tournament, set by the admin. */
export interface TournamentRules {
  winBonus: number; // extra points for 1st place in a game
  capturePoints: number; // per opponent pawn captured
  homePoints: number; // per own pawn that reached home
  bestN: number | null; // only the best N game scores count
  maxGames: number | null; // at most this many games count per player
  maxGamesPerDay: number | null; // at most this many games count per player per day (India time)
  minHumans: number; // real players needed in a game for it to count
  minLevel: number; // player level needed to play
  tiebreak: "wins" | "fewest_games" | "earliest";
}

export const DEFAULT_RULES: TournamentRules = {
  winBonus: 0,
  capturePoints: 0,
  homePoints: 0,
  bestN: null,
  maxGames: null,
  maxGamesPerDay: null,
  minHumans: 2,
  minLevel: 1,
  tiebreak: "wins",
};

export function normalizeRules(raw: unknown): TournamentRules {
  const o = isObject(raw) ? raw : {};
  return { ...DEFAULT_RULES, ...(o as Partial<TournamentRules>) };
}

export function parseRules(input: unknown, playersPerGame: number): TournamentRules {
  if (input === undefined || input === null) return { ...DEFAULT_RULES };
  if (!isObject(input)) bad("rules must be an object");
  const r: TournamentRules = { ...DEFAULT_RULES };
  const num = (k: string, min: number, max: number): number | undefined => {
    const v = input[k];
    if (v === undefined || v === null || v === "") return undefined;
    if (!isInt(v, min, max)) bad(`rules.${k} must be a whole number from ${min} to ${max}`);
    return v;
  };
  r.winBonus = num("winBonus", 0, 1000) ?? 0;
  r.capturePoints = num("capturePoints", 0, 100) ?? 0;
  r.homePoints = num("homePoints", 0, 100) ?? 0;
  r.bestN = num("bestN", 1, 10000) ?? null;
  r.maxGames = num("maxGames", 1, 100000) ?? null;
  r.maxGamesPerDay = num("maxGamesPerDay", 1, 1000) ?? null;
  r.minHumans = num("minHumans", 1, playersPerGame) ?? 2;
  if (r.minHumans > playersPerGame) bad("rules.minHumans cannot be more than players per game");
  r.minLevel = num("minLevel", 1, 100) ?? 1;
  const tb = input.tiebreak;
  if (tb !== undefined && tb !== null && tb !== "") {
    if (tb !== "wins" && tb !== "fewest_games" && tb !== "earliest") bad("rules.tiebreak must be wins, fewest_games or earliest");
    r.tiebreak = tb;
  }
  if (r.bestN !== null && r.maxGames !== null && r.bestN > r.maxGames) bad("rules.bestN cannot be more than rules.maxGames");
  return r;
}

export interface CreateTournamentInput {
  name: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  playersPerGame: 2 | 4;
  maxPlayers: number | null;
  points: number[];
  prizes: PrizeTierInput[];
  rules: TournamentRules;
}

const DEFAULT_POINTS: Record<number, number[]> = { 2: [10, 4], 4: [10, 6, 3, 1] };

function bad(message: string): never {
  throw new BadRequestException(message);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseDate(v: unknown, field: string): Date {
  const d = typeof v === "string" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) bad(`${field} must be an ISO date-time string`);
  return d;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

export function parseCreateTournament(input: unknown, now: Date): CreateTournamentInput {
  if (!isObject(input)) bad("Body must be a JSON object");

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) bad("name is required (max 80 characters)");

  const description = input.description === undefined ? "" : input.description;
  if (typeof description !== "string" || description.length > 500) bad("description must be text up to 500 characters");

  const startsAt = parseDate(input.startsAt, "startsAt");
  const endsAt = parseDate(input.endsAt, "endsAt");
  if (endsAt <= startsAt) bad("endsAt must be after startsAt");
  if (endsAt <= now) bad("endsAt must be in the future");

  const playersPerGame = input.playersPerGame === undefined ? 2 : input.playersPerGame;
  if (playersPerGame !== 2 && playersPerGame !== 4) bad("playersPerGame must be 2 or 4");

  let maxPlayers: number | null = null;
  if (input.maxPlayers !== undefined && input.maxPlayers !== null) {
    if (!isInt(input.maxPlayers, 2, 100000)) bad("maxPlayers must be a whole number between 2 and 100000");
    maxPlayers = input.maxPlayers;
  }

  let points = DEFAULT_POINTS[playersPerGame];
  if (input.points !== undefined) {
    const p = input.points;
    if (!Array.isArray(p) || p.length !== playersPerGame || !p.every((n) => isInt(n, 0, 1000))) {
      bad(`points must list ${playersPerGame} whole numbers, best placement first`);
    }
    for (let i = 1; i < p.length; i++) {
      if (p[i] > p[i - 1]) bad("points must not increase with worse placements");
    }
    points = p as number[];
  }

  const prizes: PrizeTierInput[] = [];
  if (input.prizes !== undefined) {
    if (!Array.isArray(input.prizes) || input.prizes.length > 20) bad("prizes must be a list of up to 20 tiers");
    for (const raw of input.prizes) {
      if (!isObject(raw)) bad("each prize tier must be an object");
      const { rankFrom, rankTo, prize } = raw;
      if (!isInt(rankFrom, 1, 1000) || !isInt(rankTo, 1, 1000) || rankTo < rankFrom) {
        bad("prize tiers need whole-number rankFrom <= rankTo (1 to 1000)");
      }
      if (typeof prize !== "string" || !prize.trim() || prize.length > 100) bad("prize must be text up to 100 characters");
      prizes.push({ rankFrom, rankTo, prize: prize.trim() });
    }
    prizes.sort((a, b) => a.rankFrom - b.rankFrom);
    for (let i = 1; i < prizes.length; i++) {
      if (prizes[i].rankFrom <= prizes[i - 1].rankTo) bad("prize tiers must not overlap");
    }
  }

  const rules = parseRules(input.rules, playersPerGame);
  return { name, description, startsAt, endsAt, playersPerGame, maxPlayers, points, prizes, rules };
}

export function parseEntry(input: unknown): { userId: string; name: string } {
  if (!isObject(input)) bad("Body must be a JSON object");
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!userId || userId.length > 64) bad("userId is required (max 64 characters)");
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 20) : "";
  return { userId, name: name || "Player" };
}

export interface GameResultInput {
  gameId: string;
  tournamentId: string;
  placements: { userId: string; placement: number; isBot: boolean; captures: number; home: number }[];
}

export function parseGameResult(input: unknown): GameResultInput {
  if (!isObject(input)) bad("Body must be a JSON object");
  const gameId = typeof input.gameId === "string" ? input.gameId.trim() : "";
  if (!gameId || gameId.length > 100) bad("gameId is required (max 100 characters)");
  const tournamentId = typeof input.tournamentId === "string" ? input.tournamentId : "";
  if (!isUuid(tournamentId)) bad("tournamentId must be a tournament id");
  const raw = input.placements;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) bad("placements must list 2 to 4 players");
  const placements = raw.map((p) => {
    if (!isObject(p)) bad("each placement must be an object");
    const userId = typeof p.userId === "string" ? p.userId.trim() : "";
    if (!userId || userId.length > 64) bad("each placement needs a userId");
    if (!isInt(p.placement, 1, 4)) bad("placement must be a whole number from 1 to 4");
    const captures = p.captures === undefined ? 0 : p.captures;
    const home = p.home === undefined ? 0 : p.home;
    if (!isInt(captures, 0, 50) || !isInt(home, 0, 4)) bad("captures and home must be small whole numbers");
    return { userId, placement: p.placement, isBot: p.isBot === true, captures, home };
  });
  const sorted = placements.map((p) => p.placement).sort((a, b) => a - b);
  if (!sorted.every((v, i) => v === i + 1)) bad("placements must be 1..n with no gaps or repeats");
  if (new Set(placements.map((p) => p.userId)).size !== placements.length) bad("a player appears twice");
  return { gameId, tournamentId, placements };
}

const UUID =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID.test(v);
}
