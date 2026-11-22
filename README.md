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
