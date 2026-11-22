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
