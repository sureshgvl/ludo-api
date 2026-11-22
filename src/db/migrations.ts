/** Ordered, append-only list of schema migrations. Never edit an applied one; add a new entry. */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_tournaments",
    sql: `
      create table tournaments (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        description text not null default '',
        status text not null default 'scheduled'
          check (status in ('scheduled', 'running', 'finished', 'cancelled')),
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        max_players integer,
        players_per_game integer not null check (players_per_game in (2, 4)),
        points integer[] not null,
        created_at timestamptz not null default now(),
        finished_at timestamptz,
        check (ends_at > starts_at)
      );

      create table prize_tiers (
        tournament_id uuid not null references tournaments(id) on delete cascade,
        rank_from integer not null,
        rank_to integer not null,
        prize text not null,
        primary key (tournament_id, rank_from),
        check (rank_to >= rank_from)
      );

      create table tournament_entries (
        tournament_id uuid not null references tournaments(id) on delete cascade,
        user_id text not null,
        name text not null,
        points integer not null default 0,
        games_played integer not null default 0,
        wins integer not null default 0,
        joined_at timestamptz not null default now(),
        last_game_at timestamptz,
        primary key (tournament_id, user_id)
      );
      create index tournament_entries_rank_idx
        on tournament_entries (tournament_id, points desc, wins desc, joined_at);
    `,
  },
  {
    id: "002_results_and_prizes",
    sql: `
      -- One row per game already counted, so a retried report never scores twice.
      create table tournament_games (
        tournament_id uuid not null references tournaments(id) on delete cascade,
        game_id text not null,
        placements jsonb not null,
        recorded_at timestamptz not null default now(),
        primary key (tournament_id, game_id)
      );

      create table prize_awards (
        tournament_id uuid not null references tournaments(id) on delete cascade,
        user_id text not null,
        rank integer not null,
        prize text not null,
        status text not null default 'pending' check (status in ('pending', 'delivered')),
        created_at timestamptz not null default now(),
        delivered_at timestamptz,
        primary key (tournament_id, user_id)
      );
    `,
  },
];
