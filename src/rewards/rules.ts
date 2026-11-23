/** Reward rules for free virtual coins and XP. Coins have no cash value and cannot be bought or withdrawn. */

export const IST_OFFSET_MS = 5.5 * 3600_000;

/** Calendar date (YYYY-MM-DD) in India time. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Start (as a UTC instant) of today / this week (Monday) in India time. */
export function periodStart(period: "daily" | "weekly" | "all", now: Date): Date | null {
  if (period === "all") return null;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  if (period === "weekly") ist.setUTCDate(ist.getUTCDate() - ((ist.getUTCDay() + 6) % 7));
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

export function levelFor(xp: number): { level: number; levelStartXp: number; nextLevelXp: number } {
  let level = 1;
  while (xp >= 100 * level * level) level++;
  return { level, levelStartXp: level === 1 ? 0 : 100 * (level - 1) * (level - 1), nextLevelXp: 100 * level * level };
}

export interface GameReward {
  coins: number;
  xp: number;
}

const HUMAN_XP = [50, 30, 20, 10];
const HUMAN_COINS = [30, 15, 10, 5];
const BOT_XP = [10, 5, 3, 2];
export const BOT_GAMES_PER_DAY_FOR_XP = 10;
export const MIN_HUMANS_FOR_FULL_REWARD = 2;

/**
 * Reward for one finished game. Games against bots give small XP only (no coins) and are
 * capped per day, so they cannot be farmed.
 */
export function gameReward(placement: number, humans: number, botGamesToday: number): GameReward {
  const i = Math.min(Math.max(placement, 1), 4) - 1;
  if (humans >= MIN_HUMANS_FOR_FULL_REWARD) return { coins: HUMAN_COINS[i], xp: HUMAN_XP[i] };
  if (botGamesToday >= BOT_GAMES_PER_DAY_FOR_XP) return { coins: 0, xp: 0 };
  return { coins: 0, xp: BOT_XP[i] };
}

export const FIRST_WIN_BONUS: GameReward = { coins: 25, xp: 10 };

/** Daily login bonus grows with the streak, up to 7 days. */
export function dailyBonus(streak: number): GameReward {
  return { coins: 50 + 10 * (Math.min(Math.max(streak, 1), 7) - 1), xp: 10 };
}
