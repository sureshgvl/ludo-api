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
  {
    id: "003_users",
    sql: `
      create table users (
        id text primary key,
        phone text not null unique,
        name text not null,
        password_hash text not null,
        created_at timestamptz not null default now()
      );
    `,
  },
  {
    id: "004_google_login",
    sql: `
      alter table users alter column phone drop not null;
      alter table users alter column password_hash drop not null;
      alter table users add column google_sub text unique;
      alter table users add column email text;
      create index users_email_idx on users (email);
    `,
  },
  {
    id: "005_rewards",
    sql: `
      create table ledger (
        id bigserial primary key,
        user_id text not null,
        coins integer not null default 0,
        xp integer not null default 0,
        reason text not null,
        ref text not null,
        note text not null default '',
        created_at timestamptz not null default now(),
        unique (user_id, reason, ref)
      );
      create index ledger_user_idx on ledger (user_id, created_at desc);
      create index ledger_time_idx on ledger (created_at);

      create table user_stats (
        user_id text primary key,
        coins integer not null default 0 check (coins >= 0),
        xp integer not null default 0,
        games integer not null default 0,
        wins integer not null default 0,
        streak integer not null default 0,
        last_daily date
      );
    `,
  },
  {
    id: "006_tournament_rules",
    sql: `
      alter table tournaments add column rules jsonb not null default '{}'::jsonb;
      alter table tournament_entries add column tiebreak_value integer not null default 0;
      update tournament_entries set tiebreak_value = wins;
      create table tournament_scores (
        tournament_id uuid not null references tournaments(id) on delete cascade,
        user_id text not null,
        game_id text not null,
        placement integer not null,
        points integer not null,
        captures integer not null default 0,
        home integer not null default 0,
        created_at timestamptz not null default now(),
        primary key (tournament_id, game_id, user_id)
      );
      create index tournament_scores_user_idx on tournament_scores (tournament_id, user_id, points desc);
    `,
  },
  {
    id: "007_game_log",
    sql: `
      create table game_log (
        user_id text not null,
        game_id text not null,
        placement integer not null,
        humans integer not null,
        captures integer not null default 0,
        home integer not null default 0,
        created_at timestamptz not null default now(),
        primary key (user_id, game_id)
      );
      create index game_log_user_time on game_log (user_id, created_at desc);
    `,
  },
];
