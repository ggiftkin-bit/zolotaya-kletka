-- Книга мира. Одна карта на всех.
-- Клетка общая. Фишка — своя.
-- Применять после migrations/auth/0001_auth.sql как migrations/0002_world.sql.

create table if not exists world (
  id text primary key,
  seed text not null,
  width integer not null default 96,
  height integer not null default 96,
  season text not null default 'spring',
  year integer not null default 1,
  week integer not null default 1,
  day integer not null default 1,
  tick_of_day integer not null default 0,
  phase text not null default 'day',
  weather text not null default 'clear',
  clock bigint not null default 0,
  clock_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into world (id, seed)
values ('kletka', 'kletka-seed-01')
on conflict (id) do nothing;

-- Одна строка — одна клетка. Slim-пакет как в сейве v8 (поле slim).
-- ver — чтобы два человека не перетёрли одну рубку вслепую.
create table if not exists tile (
  world_id text not null references world (id) on delete cascade,
  x integer not null,
  y integer not null,
  slim jsonb not null default '{}'::jsonb,
  ver integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (world_id, x, y)
);

create index if not exists tile_world_updated_idx on tile (world_id, updated_at);
create index if not exists tile_world_xy_idx on tile (world_id, x, y);

-- Фишка человека. user_id — тот же текст, что у входа (dev-user / grok / потом телеграм).
create table if not exists pawn (
  user_id text not null,
  world_id text not null references world (id) on delete cascade,
  name text not null default 'Испытатель',
  color text not null default '#6b3a2a',
  x integer not null default 48,
  y integer not null default 48,
  body jsonb not null default '{}'::jsonb,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (world_id, user_id)
);

create index if not exists pawn_world_seen_idx on pawn (world_id, seen_at);

-- Отпечаток тумана: что человек уже видел. Не живая клетка — память.
create table if not exists pawn_memory (
  world_id text not null references world (id) on delete cascade,
  user_id text not null,
  x integer not null,
  y integer not null,
  slim jsonb not null default '{}'::jsonb,
  seen_at timestamptz not null default now(),
  primary key (world_id, user_id, x, y)
);

create index if not exists pawn_memory_user_idx on pawn_memory (world_id, user_id, seen_at);

-- Дело на клетке. Для сверки и поиска бага, не для боя.
create table if not exists deed (
  id bigserial primary key,
  world_id text not null references world (id) on delete cascade,
  user_id text not null,
  kind text not null,
  x integer not null,
  y integer not null,
  payload jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists deed_world_at_idx on deed (world_id, at desc);
create index if not exists deed_cell_idx on deed (world_id, x, y, at desc);
