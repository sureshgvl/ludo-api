import { BadRequestException } from "@nestjs/common";

export interface PrizeTierInput {
  rankFrom: number;
  rankTo: number;
  prize: string;
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

  return { name, description, startsAt, endsAt, playersPerGame, maxPlayers, points, prizes };
}

export function parseEntry(input: unknown): { userId: string; name: string } {
  if (!isObject(input)) bad("Body must be a JSON object");
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!userId || userId.length > 64) bad("userId is required (max 64 characters)");
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 20) : "";
  return { userId, name: name || "Player" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID.test(v);
}
