/** Daily missions (reset at midnight India time) and lifetime achievements. */

export interface Progress {
  gamesToday: number;
  winsToday: number;
  capturesToday: number;
  homeToday: number;
  games: number; // lifetime
  wins: number;
  captures: number;
  home: number;
  streak: number;
  level: number;
}

export interface Goal {
  id: string;
  title: string;
  target: number;
  coins: number;
  xp: number;
  value: (p: Progress) => number;
}

export const MISSIONS: Goal[] = [
  { id: "play3", title: "Play 3 games", target: 3, coins: 30, xp: 20, value: (p) => p.gamesToday },
  { id: "win1", title: "Win a game", target: 1, coins: 50, xp: 30, value: (p) => p.winsToday },
  { id: "capture5", title: "Capture 5 pawns", target: 5, coins: 40, xp: 25, value: (p) => p.capturesToday },
  { id: "home4", title: "Bring 4 pawns home", target: 4, coins: 40, xp: 25, value: (p) => p.homeToday },
];

export const ACHIEVEMENTS: Goal[] = [
  { id: "first_game", title: "First steps: play a game", target: 1, coins: 20, xp: 20, value: (p) => p.games },
  { id: "first_win", title: "Winner: win a game", target: 1, coins: 50, xp: 50, value: (p) => p.wins },
  { id: "games_25", title: "Regular: play 25 games", target: 25, coins: 100, xp: 80, value: (p) => p.games },
  { id: "games_100", title: "Veteran: play 100 games", target: 100, coins: 300, xp: 250, value: (p) => p.games },
  { id: "wins_10", title: "Champion: win 10 games", target: 10, coins: 150, xp: 120, value: (p) => p.wins },
  { id: "wins_50", title: "Legend: win 50 games", target: 50, coins: 500, xp: 400, value: (p) => p.wins },
  { id: "captures_25", title: "Hunter: capture 25 pawns", target: 25, coins: 100, xp: 80, value: (p) => p.captures },
  { id: "home_20", title: "Homecoming: 20 pawns home", target: 20, coins: 100, xp: 80, value: (p) => p.home },
  { id: "streak_7", title: "Loyal: 7 day streak", target: 7, coins: 150, xp: 100, value: (p) => p.streak },
  { id: "level_5", title: "Rising star: reach level 5", target: 5, coins: 200, xp: 0, value: (p) => p.level },
];
