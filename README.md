# ludo-api

REST API for the Ludo tournament app. It handles everything that is not live gameplay: login, profiles, tournaments, the tournament scheduler, leaderboards, prizes and admin endpoints.

**Stack:** Node.js 20+, TypeScript, NestJS, PostgreSQL, Redis (BullMQ for jobs and leaderboards).

## Responsibilities

- Phone OTP login (Firebase token verification) and user profiles
- Create and schedule tournaments, lock entries, collect game results
- Points, ranks and prize tables; leaderboards in Redis
- Admin endpoints for `ludo-admin-panel`
- Database migrations for PostgreSQL

## Getting started

```bash
cp .env.example .env
npm install
npm run dev        # http://localhost:3000/api/health
```

Other scripts: `npm run build`, `npm run start:prod`, `npm run typecheck`.

## Status

Skeleton only. A health endpoint exists; auth, tournaments, leaderboards and prizes are planned modules (see `src/app.module.ts`).

## Related repositories

`ludo-mobile-app`, `ludo-game-server`, `ludo-admin-panel`

## Tournament flow

1. Admin creates a tournament (`POST /api/admin/tournaments`, header `x-admin-key`) with start/end time, players per game, points per placement and prize tiers. Entry is free.
2. Players register (`POST /api/tournaments/:id/entries`). The scheduler (or `POST /api/admin/tick`) moves tournaments `scheduled → running → finished`.
3. ludo-game-server checks `GET /api/internal/tournaments/:id/eligibility/:userId` and reports finished games to `POST /api/internal/games` (header `x-internal-key`). Results are idempotent per `gameId`; games need ≥ 2 real players; only registered players score.
4. At the end, ranks are fixed (points, then wins, then earliest registration) and prize awards are created for players who played. Admin lists them (`GET /api/admin/tournaments/:id/awards`) and marks them handed over (`POST .../awards/:userId/delivered`).

Tournaments are free to enter with prizes funded by you or a sponsor. Do not add paid entry or a wallet before getting legal advice under India's Online Gaming Act 2025.

## Tournament rules (set by the admin)

Each tournament has a `rules` object (all optional), validated on create:

| Rule | Meaning |
|---|---|
| `points` | Points by placement (existing field) |
| `winBonus` | Extra points for 1st place in a game |
| `capturePoints` | Points per opponent pawn captured |
| `homePoints` | Points per own pawn that reached home |
| `maxGames` | Only a player's first N games count |
| `maxGamesPerDay` | Counted games per player per day (India time) |
| `bestN` | Only the best N game scores are added up |
| `minHumans` | Real players needed in a game for it to count (default 2) |
| `minLevel` | Player level needed to play (checked at game join) |
| `tiebreak` | `wins`, `fewest_games` or `earliest` |

Every counted game is stored in `tournament_scores`; the leaderboard total is recomputed from it, so best-N is always exact.

## Missions, achievements and friends

- `GET /api/me/missions`, `POST /api/me/missions/:id/claim` - four daily missions (reset at midnight India time).
- `GET /api/me/achievements`, `POST /api/me/achievements/:id/claim` - lifetime achievements. Both pay free coins and XP, once.
- `GET/POST /api/me/friends`, `DELETE /api/me/friends/:id` - personal 6 character player code; adding a code makes both players friends.
- Progress comes from `game_log`, which the game server fills through `POST /api/internal/results` (placement, captures, pawns home).

## Deploy on Render

1. In Render: New → Blueprint → pick this repo. It creates `ludo-api` and the `ludo-db` PostgreSQL database; migrations run on start.
2. When asked, set `INTERNAL_API_KEY` to a long random string (keep a copy for the game server). `ADMIN_API_KEY` is generated; read it under the service's Environment tab.
3. Check `https://<your-api>.onrender.com/api/health`.

Free Render services sleep when idle (first request is slow) and the free database expires after a while: use paid plans before real users.

## Player login

`POST /api/auth/register {phone, password, name}` and `POST /api/auth/login {phone, password}` return `{token, user}`
(10-digit Indian mobile + password, scrypt-hashed; 10 wrong tries locks a number for 15 minutes). `GET /api/auth/me` reads the token.
Set the same `JWT_SECRET` here and on `ludo-game-server`. With it set, tournament entry takes the player from the
`Authorization: Bearer` token. With it empty (local dev) the old trust-the-userId behaviour stays. OTP by SMS can replace the
password later without changing the token format.

### Google login

`POST /api/auth/google {idToken}` verifies a Google ID token with Google (`tokeninfo`), checks it was issued for one of
`GOOGLE_CLIENT_IDS`, and creates or finds the user (same token format as the password login). In Google Cloud Console create an
OAuth client of type "Web application" (add your game server URL under Authorized JavaScript origins); for the Flutter app also create an
Android client (package name + SHA-1) and put all IDs in `GOOGLE_CLIENT_IDS`. `MAX_SIGNUPS_PER_IP_PER_DAY` (default 5) limits account farming.
Admin award lists include each winner's phone and email so you can send the prize.
