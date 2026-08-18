-- Puzzle content, denormalized as JSON: the app always reads/renders one whole
-- grid at a time, so a single JSONB column per puzzle is simpler than joined
-- word/clue tables and mirrors exactly the shape src/types/puzzle.ts consumes.
create table if not exists puzzles (
  id text primary key,
  title text not null,
  rows integer not null,
  cols integer not null,
  words jsonb not null,       -- WordEntry[]
  clue_cells jsonb not null,  -- ClueCellPlacement[]
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists puzzle_completions (
  id uuid primary key default gen_random_uuid(),
  puzzle_id text not null references puzzles(id) on delete cascade,
  player_name text not null,
  duration_seconds integer,
  completed_at timestamptz not null default now()
);

alter table puzzles enable row level security;
alter table puzzle_completions enable row level security;

-- Anon (browser) clients may only read published puzzles.
create policy "Published puzzles are publicly readable"
  on puzzles for select
  using (published = true);

-- Anon clients may log a completion, but never read others' completions back
-- (leaderboards should be served from a server-side aggregate, not this table directly).
create policy "Anyone can record a completion"
  on puzzle_completions for insert
  with check (true);

-- Puzzle authoring (insert/update/delete on `puzzles`) is intentionally left
-- with no anon policy — do it from the Supabase dashboard/SQL editor, or from
-- scripts/generate-clues.mjs using the service role key, never the anon key.
