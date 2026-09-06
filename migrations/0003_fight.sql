-- Пошаговая встреча двух живых фишек. Одна открытая на пару.
create table if not exists fight (
  world_id text not null references world (id) on delete cascade,
  id text not null,
  x integer not null,
  y integer not null,
  a_id text not null,
  b_id text not null,
  turn_id text not null,
  a_hp integer not null,
  b_hp integer not null,
  a_snap jsonb not null default '{}'::jsonb,
  b_snap jsonb not null default '{}'::jsonb,
  last_hit jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (world_id, id)
);

create index if not exists fight_open_idx on fight (world_id, status, updated_at desc);
create index if not exists fight_who_a_idx on fight (world_id, a_id, status);
create index if not exists fight_who_b_idx on fight (world_id, b_id, status);
