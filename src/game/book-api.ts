import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { MAP_H, MAP_W } from "./constants";
import { slimTile, type SlimTile } from "./save";
import { generateWorld } from "./worldgen";
import {
  FOG_FETCH,
  WORLD_ID,
  WORLD_SEED,
  fightPairId,
  type BookFight,
  type BookSnapshot,
  type FightSnap,
  type MemoryPacket,
  type OtherPawn,
  type PawnBody,
  type TilePacket,
  type WorldClock,
} from "./book";

const slimSchema: z.ZodType<SlimTile> = z.any();

const clockSchema = z.object({
  season: z.enum(["spring", "summer", "autumn", "winter"]),
  year: z.number(),
  week: z.number(),
  day: z.number(),
  tickOfDay: z.number(),
  phase: z.enum(["day", "night"]),
  weather: z.enum(["clear", "rain", "snow"]),
  clock: z.number(),
});

const pawnInSchema = z.object({
  name: z.string(),
  color: z.string(),
  x: z.number(),
  y: z.number(),
  body: z.any() as z.ZodType<PawnBody>,
});

const tileInSchema = z.object({
  x: z.number(),
  y: z.number(),
  slim: slimSchema,
  ver: z.number(),
});

type WorldRow = {
  seed: string;
  season: string;
  year: number;
  week: number;
  day: number;
  tick_of_day: number;
  phase: string;
  weather: string;
  clock: number;
};

type TileRow = {
  x: number;
  y: number;
  slim: SlimTile;
  ver: number;
  updated_at: string;
};

type PawnDb = {
  name: string;
  color: string;
  x: number;
  y: number;
  body: PawnBody | null;
};

type OtherDb = {
  user_id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  body: PawnBody | null;
};

let birthLock: Promise<void> | null = null;

function asClock(row: WorldRow): WorldClock {
  return {
    season: (row.season as WorldClock["season"]) || "spring",
    year: row.year ?? 1,
    week: row.week ?? 1,
    day: row.day ?? 1,
    tickOfDay: row.tick_of_day ?? 0,
    phase: row.phase === "night" ? "night" : "day",
    weather: (row.weather as WorldClock["weather"]) || "clear",
    clock: Number(row.clock) || 0,
  };
}

function asSlim(raw: unknown): SlimTile {
  if (!raw || typeof raw !== "object") return { b: "plains" };
  return raw as SlimTile;
}

function pawnAsOther(r: OtherDb): OtherPawn {
  const body = r.body && typeof r.body === "object" ? r.body : null;
  return {
    id: r.user_id,
    name: r.name,
    color: r.color,
    x: r.x,
    y: r.y,
    hp: typeof body?.hp === "number" ? body.hp : 100,
    life: body?.life === "down" ? "down" : "alive",
    hand: body?.hand ?? null,
    body: body?.body ?? null,
    shield: body?.shield ?? null,
    helm: body?.helm ?? null,
  };
}

function asSnap(raw: unknown, fallback: FightSnap): FightSnap {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Partial<FightSnap>;
  return {
    name: o.name || fallback.name,
    color: o.color || fallback.color,
    hp: typeof o.hp === "number" ? o.hp : fallback.hp,
    hand: o.hand ?? fallback.hand,
    body: o.body ?? fallback.body,
    shield: o.shield ?? fallback.shield,
    helm: o.helm ?? fallback.helm,
  };
}

function emptySnap(): FightSnap {
  return { name: "чужой", color: "#6b3a2a", hp: 100, hand: null, body: null, shield: null, helm: null };
}

type FightRow = {
  id: string;
  x: number;
  y: number;
  a_id: string;
  b_id: string;
  turn_id: string;
  a_hp: number;
  b_hp: number;
  a_snap: unknown;
  b_snap: unknown;
  last_hit: unknown;
  status: string;
};

function asFight(row: FightRow): BookFight {
  const last = row.last_hit && typeof row.last_hit === "object" ? (row.last_hit as { by?: string; dmg?: number }) : null;
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    aId: row.a_id,
    bId: row.b_id,
    turnId: row.turn_id,
    aHp: row.a_hp,
    bHp: row.b_hp,
    aSnap: asSnap(row.a_snap, emptySnap()),
    bSnap: asSnap(row.b_snap, emptySnap()),
    lastHit: last && last.by && typeof last.dmg === "number" ? { by: last.by, dmg: last.dmg } : null,
    status: row.status === "done" ? "done" : "open",
  };
}

function withFightOther(others: OtherPawn[], fight: BookFight | null, selfId: string): OtherPawn[] {
  if (!fight) return others;
  const foeId = fight.aId === selfId ? fight.bId : fight.aId;
  const snap = fight.aId === foeId ? fight.aSnap : fight.bSnap;
  const hp = fight.aId === foeId ? fight.aHp : fight.bHp;
  const ghost: OtherPawn = {
    id: foeId,
    name: snap.name,
    color: snap.color,
    x: fight.x,
    y: fight.y,
    hp,
    life: hp <= 0 ? "down" : "alive",
    hand: snap.hand,
    body: snap.body,
    shield: snap.shield,
    helm: snap.helm,
  };
  if (others.some((o) => o.id === foeId)) {
    return others.map((o) => (o.id === foeId ? { ...o, hp: ghost.hp, life: ghost.life, hand: ghost.hand, body: ghost.body, shield: ghost.shield, helm: ghost.helm } : o));
  }
  return [...others, ghost];
}

async function loadOpenFight(sql: Sql, userId: string): Promise<BookFight | null> {
  const rows = await sql.query<FightRow>(
    `select id, x, y, a_id, b_id, turn_id, a_hp, b_hp, a_snap, b_snap, last_hit, status
     from fight
     where world_id = $1 and status = 'open' and (a_id = $2 or b_id = $2)
     order by updated_at desc
     limit 1`,
    [WORLD_ID, userId],
  );
  return rows[0] ? asFight(rows[0]) : null;
}

async function writePawnHp(sql: Sql, userId: string, hp: number, life: "alive" | "down") {
  await sql.query(
    `update pawn
     set body = jsonb_set(jsonb_set(coalesce(body, '{}'::jsonb), '{hp}', to_jsonb($3::int), true), '{life}', to_jsonb($4::text), true),
         updated_at = now()
     where world_id = $1 and user_id = $2`,
    [WORLD_ID, userId, hp, life],
  );
}

async function mergeFightIntoPawnBody(sql: Sql, userId: string, body: PawnBody): Promise<PawnBody> {
  const fight = await loadOpenFight(sql, userId);
  if (!fight) return body;
  const hp = fight.aId === userId ? fight.aHp : fight.bHp;
  return { ...body, hp, life: hp <= 0 ? "down" : body.life === "down" ? "down" : "alive" };
}

async function readWorld(sql: Sql): Promise<WorldRow> {
  const rows = await sql.query<WorldRow>(
    "select seed, season, year, week, day, tick_of_day, phase, weather, clock from world where id = $1",
    [WORLD_ID],
  );
  return (
    rows[0] ?? {
      seed: WORLD_SEED,
      season: "spring",
      year: 1,
      week: 1,
      day: 1,
      tick_of_day: 0,
      phase: "day",
      weather: "clear",
      clock: 0,
    }
  );
}

async function tileCount(sql: Sql): Promise<number> {
  const rows = await sql.query<{ n: number }>("select count(*)::int as n from tile where world_id = $1", [WORLD_ID]);
  return rows[0]?.n ?? 0;
}

async function birthIfEmpty(sql: Sql): Promise<boolean> {
  const n = await tileCount(sql);
  const row = await readWorld(sql);
  const stale = (row.seed ?? "") !== WORLD_SEED;
  if (n >= MAP_W * MAP_H * 0.9 && !stale) return false;
  if (birthLock) {
    await birthLock;
    return false;
  }
  birthLock = (async () => {
    if (stale || n > 0) {
      await sql.query(`delete from tile where world_id = $1`, [WORLD_ID]);
      await sql.query(`delete from pawn_memory where world_id = $1`, [WORLD_ID]);
    }
    const world = generateWorld(WORLD_SEED);
    const BATCH = 400;
    for (let i = 0; i < world.tiles.length; i += BATCH) {
      const chunk = world.tiles.slice(i, i + BATCH).map((t) => ({
        x: t.x,
        y: t.y,
        slim: slimTile(t),
      }));
      await sql.query(
        `insert into tile (world_id, x, y, slim, ver)
         select $1, (e->>'x')::int, (e->>'y')::int, e->'slim', 1
         from jsonb_array_elements($2::jsonb) e
         on conflict (world_id, x, y) do nothing`,
        [WORLD_ID, JSON.stringify(chunk)],
      );
    }
    const spawnX = (MAP_W / 2) | 0;
    const spawnY = (MAP_H / 2) | 0;
    await sql.query(`update pawn set x = $2, y = $3, updated_at = now() where world_id = $1`, [WORLD_ID, spawnX, spawnY]);
    await sql.query(
      `update world set seed = $2, width = $3, height = $4, updated_at = now() where id = $1`,
      [WORLD_ID, WORLD_SEED, MAP_W, MAP_H],
    );
  })().finally(() => {
    birthLock = null;
  });
  await birthLock;
  return true;
}

async function loadSpot(
  sql: Sql,
  px: number,
  py: number,
  userId: string,
): Promise<{ live: TilePacket[]; memory: MemoryPacket[]; others: OtherPawn[] }> {
  const liveRows = await sql.query<TileRow>(
    `select x, y, slim, ver, updated_at::text as updated_at
     from tile
     where world_id = $1
       and greatest(abs(x - $2), abs(y - $3)) <= $4`,
    [WORLD_ID, px, py, FOG_FETCH],
  );
  const live: TilePacket[] = liveRows.map((r) => ({
    x: r.x,
    y: r.y,
    slim: asSlim(r.slim),
    ver: r.ver,
    updatedAt: r.updated_at,
  }));
  const memRows = await sql.query<{ x: number; y: number; slim: SlimTile }>(
    `select x, y, slim from pawn_memory
     where world_id = $1 and user_id = $2
       and greatest(abs(x - $3), abs(y - $4)) > $5`,
    [WORLD_ID, userId, px, py, FOG_FETCH],
  );
  const memory: MemoryPacket[] = memRows.map((r) => ({
    x: r.x,
    y: r.y,
    slim: asSlim(r.slim),
  }));
  const otherRows = await sql.query<OtherDb>(
    `select user_id, name, color, x, y, body from pawn
     where world_id = $1 and user_id <> $2
       and greatest(abs(x - $3), abs(y - $4)) <= $5
       and seen_at > now() - interval '2 minutes'`,
    [WORLD_ID, userId, px, py, FOG_FETCH],
  );
  const others: OtherPawn[] = otherRows.map(pawnAsOther);
  return { live, memory, others };
}

async function imprintSpot(sql: Sql, userId: string, px: number, py: number) {
  await sql.query(
    `insert into pawn_memory (world_id, user_id, x, y, slim, seen_at)
     select t.world_id, $2, t.x, t.y, t.slim, now()
     from tile t
     where t.world_id = $1
       and greatest(abs(t.x - $3), abs(t.y - $4)) <= $5
     on conflict (world_id, user_id, x, y)
     do update set slim = excluded.slim, seen_at = excluded.seen_at`,
    [WORLD_ID, userId, px, py, FOG_FETCH],
  );
}

async function readPawn(sql: Sql, userId: string): Promise<PawnDb | null> {
  const rows = await sql.query<PawnDb>(
    `select name, color, x, y, body from pawn where world_id = $1 and user_id = $2`,
    [WORLD_ID, userId],
  );
  return rows[0] ?? null;
}

function nowIso() {
  return new Date().toISOString();
}

export const openWorldBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<BookSnapshot> => {
    const sql = await getSql();
    const born = await birthIfEmpty(sql);
    const pawn = await readPawn(sql, context.userId);
    const px = pawn?.x ?? data.x ?? 48;
    const py = pawn?.y ?? data.y ?? 48;
    const world = await readWorld(sql);
    const spot = await loadSpot(sql, px, py, context.userId);
    await imprintSpot(sql, context.userId, px, py);
    const fight = await loadOpenFight(sql, context.userId);
    return {
      ok: true,
      born,
      clock: asClock(world),
      pawn: pawn
        ? {
            name: pawn.name,
            color: pawn.color,
            x: pawn.x,
            y: pawn.y,
            body: pawn.body,
          }
        : null,
      live: spot.live,
      memory: spot.memory,
      others: withFightOther(spot.others, fight, context.userId),
      fight,
      since: nowIso(),
    };
  });

export const writeWorldDeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.string(),
        tiles: z.array(tileInSchema),
        pawn: pawnInSchema,
        clock: clockSchema.optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const conflicts: TilePacket[] = [];
    const written: { x: number; y: number; ver: number }[] = [];
    for (const t of data.tiles) {
      const upd = await sql.query<{ ver: number }>(
        `update tile
         set slim = $5::jsonb, ver = ver + 1, updated_at = now(), updated_by = $6
         where world_id = $1 and x = $2 and y = $3 and ver = $4
         returning ver`,
        [WORLD_ID, t.x, t.y, t.ver, JSON.stringify(t.slim), context.userId],
      );
      if (upd[0]) {
        written.push({ x: t.x, y: t.y, ver: upd[0].ver });
        continue;
      }
      const cur = await sql.query<TileRow>(
        `select x, y, slim, ver, updated_at::text as updated_at
         from tile where world_id = $1 and x = $2 and y = $3`,
        [WORLD_ID, t.x, t.y],
      );
      if (cur[0]) {
        conflicts.push({
          x: cur[0].x,
          y: cur[0].y,
          slim: asSlim(cur[0].slim),
          ver: cur[0].ver,
          updatedAt: cur[0].updated_at,
        });
      }
    }
    if (data.clock) {
      await sql.query(
        `update world set
           season = $2, year = $3, week = $4, day = $5, tick_of_day = $6,
           phase = $7, weather = $8, clock = $9, clock_at = now(), updated_at = now()
         where id = $1`,
        [
          WORLD_ID,
          data.clock.season,
          data.clock.year,
          data.clock.week,
          data.clock.day,
          data.clock.tickOfDay,
          data.clock.phase,
          data.clock.weather,
          data.clock.clock,
        ],
      );
    }
    const origin = data.tiles[0];
    const x = origin?.x ?? data.pawn.x;
    const y = origin?.y ?? data.pawn.y;
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        WORLD_ID,
        context.userId,
        data.kind,
        x,
        y,
        JSON.stringify({ n: data.tiles.length, written: written.length }),
      ],
    );
    const body = await mergeFightIntoPawnBody(sql, context.userId, data.pawn.body);
    await sql.query(
      `insert into pawn (world_id, user_id, name, color, x, y, body, seen_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
       on conflict (world_id, user_id) do update set
         name = excluded.name,
         color = excluded.color,
         x = excluded.x,
         y = excluded.y,
         body = excluded.body,
         seen_at = now(),
         updated_at = now()`,
      [
        WORLD_ID,
        context.userId,
        data.pawn.name,
        data.pawn.color,
        data.pawn.x,
        data.pawn.y,
        JSON.stringify(body),
      ],
    );
    await imprintSpot(sql, context.userId, data.pawn.x, data.pawn.y);
    if (conflicts.length) {
      return {
        ok: false as const,
        hint: "клетка уже другая",
        conflicts,
        written,
      };
    }
    return { ok: true as const, written };
  });

export const writeHarmDeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.string(),
        tiles: z.array(tileInSchema),
        pawn: pawnInSchema,
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!data.tiles.length) {
      const body = await mergeFightIntoPawnBody(sql, context.userId, data.pawn.body);
      await sql.query(
        `insert into pawn (world_id, user_id, name, color, x, y, body, seen_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
         on conflict (world_id, user_id) do update set
           name = excluded.name,
           color = excluded.color,
           x = excluded.x,
           y = excluded.y,
           body = excluded.body,
           seen_at = now(),
           updated_at = now()`,
        [
          WORLD_ID,
          context.userId,
          data.pawn.name,
          data.pawn.color,
          data.pawn.x,
          data.pawn.y,
          JSON.stringify(body),
        ],
      );
      return { ok: true as const, written: [] as { x: number; y: number; ver: number }[] };
    }
    const incoming = JSON.stringify(
      data.tiles.map((t) => ({ x: t.x, y: t.y, slim: t.slim, ver: t.ver })),
    );
    const rows = await sql.query<{ written: unknown; conflicts: unknown }>(
      `with incoming as (
         select (e->>'x')::int as x, (e->>'y')::int as y, e->'slim' as slim, (e->>'ver')::int as ver
         from jsonb_array_elements($2::jsonb) e
       ),
       mismatch as (
         select i.x, i.y, coalesce(t.slim, '{}'::jsonb) as slim, coalesce(t.ver, 0) as ver,
                coalesce(t.updated_at::text, now()::text) as updated_at
         from incoming i
         left join tile t on t.world_id = $1 and t.x = i.x and t.y = i.y
         where t.ver is distinct from i.ver
       ),
       upd as (
         update tile as t
         set slim = i.slim, ver = t.ver + 1, updated_at = now(), updated_by = $3
         from incoming i
         where t.world_id = $1 and t.x = i.x and t.y = i.y and t.ver = i.ver
           and not exists (select 1 from mismatch)
         returning t.x, t.y, t.ver
       )
       select
         coalesce((select jsonb_agg(jsonb_build_object('x', x, 'y', y, 'ver', ver)) from upd), '[]'::jsonb) as written,
         coalesce((select jsonb_agg(jsonb_build_object('x', x, 'y', y, 'slim', slim, 'ver', ver, 'updated_at', updated_at)) from mismatch), '[]'::jsonb) as conflicts`,
      [WORLD_ID, incoming, context.userId],
    );
    const rawWritten = rows[0]?.written;
    const rawConflicts = rows[0]?.conflicts;
    const written: { x: number; y: number; ver: number }[] = Array.isArray(rawWritten)
      ? (rawWritten as { x: number; y: number; ver: number }[])
      : [];
    const conflictRows: { x: number; y: number; slim: unknown; ver: number; updated_at: string }[] = Array.isArray(
      rawConflicts,
    )
      ? (rawConflicts as { x: number; y: number; slim: unknown; ver: number; updated_at: string }[])
      : [];
    const conflicts: TilePacket[] = conflictRows.map((c) => ({
      x: c.x,
      y: c.y,
      slim: asSlim(c.slim),
      ver: c.ver,
      updatedAt: c.updated_at,
    }));
    if (conflicts.length || written.length !== data.tiles.length) {
      return {
        ok: false as const,
        hint: "клетка уже другая",
        conflicts,
        written: [],
      };
    }
    const origin = data.tiles[0];
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        WORLD_ID,
        context.userId,
        data.kind,
        origin?.x ?? data.pawn.x,
        origin?.y ?? data.pawn.y,
        JSON.stringify({ n: data.tiles.length, harm: true }),
      ],
    );
    const body = await mergeFightIntoPawnBody(sql, context.userId, data.pawn.body);
    await sql.query(
      `insert into pawn (world_id, user_id, name, color, x, y, body, seen_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
       on conflict (world_id, user_id) do update set
         name = excluded.name,
         color = excluded.color,
         x = excluded.x,
         y = excluded.y,
         body = excluded.body,
         seen_at = now(),
         updated_at = now()`,
      [
        WORLD_ID,
        context.userId,
        data.pawn.name,
        data.pawn.color,
        data.pawn.x,
        data.pawn.y,
        JSON.stringify(body),
      ],
    );
    await imprintSpot(sql, context.userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written };
  });

export const heartbeatWorld = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        x: z.number(),
        y: z.number(),
        since: z.string(),
        pawn: pawnInSchema.optional(),
        clock: clockSchema.optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (data.pawn) {
      const body = await mergeFightIntoPawnBody(sql, context.userId, data.pawn.body);
      await sql.query(
        `insert into pawn (world_id, user_id, name, color, x, y, body, seen_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
         on conflict (world_id, user_id) do update set
           name = excluded.name,
           color = excluded.color,
           x = excluded.x,
           y = excluded.y,
           body = excluded.body,
           seen_at = now(),
           updated_at = now()`,
        [
          WORLD_ID,
          context.userId,
          data.pawn.name,
          data.pawn.color,
          data.pawn.x,
          data.pawn.y,
          JSON.stringify(body),
        ],
      );
    } else {
      await sql.query(
        `update pawn set x = $3, y = $4, seen_at = now(), updated_at = now()
         where world_id = $1 and user_id = $2`,
        [WORLD_ID, context.userId, data.x, data.y],
      );
    }
    if (data.clock) {
      await sql.query(
        `update world set
           season = $2, year = $3, week = $4, day = $5, tick_of_day = $6,
           phase = $7, weather = $8, clock = $9, clock_at = now(), updated_at = now()
         where id = $1`,
        [
          WORLD_ID,
          data.clock.season,
          data.clock.year,
          data.clock.week,
          data.clock.day,
          data.clock.tickOfDay,
          data.clock.phase,
          data.clock.weather,
          data.clock.clock,
        ],
      );
    }
    const liveRows = await sql.query<TileRow>(
      `select x, y, slim, ver, updated_at::text as updated_at
       from tile
       where world_id = $1
         and greatest(abs(x - $2), abs(y - $3)) <= $4
         and updated_at > $5::timestamptz`,
      [WORLD_ID, data.x, data.y, FOG_FETCH, data.since || "1970-01-01T00:00:00.000Z"],
    );
    const live: TilePacket[] = liveRows.map((r) => ({
      x: r.x,
      y: r.y,
      slim: asSlim(r.slim),
      ver: r.ver,
      updatedAt: r.updated_at,
    }));
    // Also fill any live cells this client has never seen (spot moved).
    const fillRows = await sql.query<TileRow>(
      `select x, y, slim, ver, updated_at::text as updated_at
       from tile
       where world_id = $1
         and greatest(abs(x - $2), abs(y - $3)) <= $4`,
      [WORLD_ID, data.x, data.y, FOG_FETCH],
    );
    const fill: TilePacket[] = fillRows.map((r) => ({
      x: r.x,
      y: r.y,
      slim: asSlim(r.slim),
      ver: r.ver,
      updatedAt: r.updated_at,
    }));
    const otherRows = await sql.query<OtherDb>(
      `select user_id, name, color, x, y, body from pawn
       where world_id = $1 and user_id <> $2
         and greatest(abs(x - $3), abs(y - $4)) <= $5
         and seen_at > now() - interval '2 minutes'`,
      [WORLD_ID, context.userId, data.x, data.y, FOG_FETCH],
    );
    const others: OtherPawn[] = otherRows.map(pawnAsOther);
    await imprintSpot(sql, context.userId, data.x, data.y);
    const world = await readWorld(sql);
    const fight = await loadOpenFight(sql, context.userId);
    return {
      ok: true as const,
      clock: asClock(world),
      live,
      fill,
      others: withFightOther(others, fight, context.userId),
      fight,
      since: nowIso(),
    };
  });

export const dropPawn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql.query(`delete from pawn_memory where world_id = $1 and user_id = $2`, [WORLD_ID, context.userId]);
    await sql.query(`delete from pawn where world_id = $1 and user_id = $2`, [WORLD_ID, context.userId]);
    return { ok: true as const };
  });

export const listWorldDeeds = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const rows = await sql.query<{ id: number; kind: string; x: number; y: number; at: string; user_id: string }>(
      `select id, kind, x, y, at::text as at, user_id from deed where world_id = $1 order by at desc limit 40`,
      [WORLD_ID],
    );
    return rows;
  });

const snapSchema = z.object({
  name: z.string(),
  color: z.string(),
  hp: z.number(),
  hand: z.string().nullable(),
  body: z.string().nullable(),
  shield: z.string().nullable(),
  helm: z.string().nullable(),
});

function snapFromPawn(p: PawnDb | null, guess: FightSnap): FightSnap {
  const body = p?.body && typeof p.body === "object" ? p.body : null;
  return {
    name: p?.name || guess.name,
    color: p?.color || guess.color,
    hp: typeof body?.hp === "number" ? body.hp : guess.hp,
    hand: body?.hand ?? guess.hand,
    body: body?.body ?? guess.body,
    shield: body?.shield ?? guess.shield,
    helm: body?.helm ?? guess.helm,
  };
}

export const openBookFight = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        foeId: z.string(),
        x: z.number(),
        y: z.number(),
        you: snapSchema,
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (data.foeId === context.userId) return { ok: false as const, hint: "сам с собой" };
    const me = await readPawn(sql, context.userId);
    const foe = await readPawn(sql, data.foeId);
    if (!foe) return { ok: false as const, hint: "его нет на поляне" };
    const mx = me?.x ?? data.x;
    const my = me?.y ?? data.y;
    if (Math.max(Math.abs(mx - foe.x), Math.abs(my - foe.y)) > 1) {
      return { ok: false as const, hint: "не на его клетке" };
    }
    const existing = await loadOpenFight(sql, context.userId);
    if (existing && (existing.aId === data.foeId || existing.bId === data.foeId)) {
      return { ok: true as const, fight: existing };
    }
    const youSnap = snapFromPawn(me, data.you as FightSnap);
    const foeSnap = snapFromPawn(foe, emptySnap());
    const id = fightPairId(context.userId, data.foeId);
    const aId = context.userId;
    const bId = data.foeId;
    await sql.query(
      `insert into fight (world_id, id, x, y, a_id, b_id, turn_id, a_hp, b_hp, a_snap, b_snap, last_hit, status, updated_at)
       values ($1, $2, $3, $4, $5, $6, $5, $7, $8, $9::jsonb, $10::jsonb, null, 'open', now())
       on conflict (world_id, id) do update set
         x = excluded.x,
         y = excluded.y,
         a_id = excluded.a_id,
         b_id = excluded.b_id,
         turn_id = excluded.a_id,
         a_hp = excluded.a_hp,
         b_hp = excluded.b_hp,
         a_snap = excluded.a_snap,
         b_snap = excluded.b_snap,
         last_hit = null,
         status = 'open',
         updated_at = now()`,
      [
        WORLD_ID,
        id,
        foe.x,
        foe.y,
        aId,
        bId,
        youSnap.hp,
        foeSnap.hp,
        JSON.stringify(youSnap),
        JSON.stringify(foeSnap),
      ],
    );
    const fight = await loadOpenFight(sql, context.userId);
    return fight ? { ok: true as const, fight } : { ok: false as const, hint: "встреча не встала" };
  });

export const strikeBookFight = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => z.object({ dmg: z.number() }).parse(d))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const fight = await loadOpenFight(sql, context.userId);
    if (!fight) return { ok: false as const, hint: "встречи нет" };
    if (fight.turnId !== context.userId) return { ok: false as const, hint: "не твой шаг", fight };
    const dmg = Math.max(1, Math.min(12, Math.round(data.dmg)));
    const iAmA = fight.aId === context.userId;
    const foeId = iAmA ? fight.bId : fight.aId;
    const foeHp = Math.max(0, (iAmA ? fight.bHp : fight.aHp) - dmg);
    const myHp = iAmA ? fight.aHp : fight.bHp;
    const done = foeHp <= 0;
    const nextTurn = done ? context.userId : foeId;
    const aHp = iAmA ? myHp : foeHp;
    const bHp = iAmA ? foeHp : myHp;
    await sql.query(
      `update fight
       set a_hp = $3, b_hp = $4, turn_id = $5, last_hit = $6::jsonb, status = $7, updated_at = now()
       where world_id = $1 and id = $2 and turn_id = $8 and status = 'open'`,
      [
        WORLD_ID,
        fight.id,
        aHp,
        bHp,
        nextTurn,
        JSON.stringify({ by: context.userId, dmg }),
        done ? "done" : "open",
        context.userId,
      ],
    );
    await writePawnHp(sql, foeId, foeHp, foeHp <= 0 ? "down" : "alive");
    const next = done
      ? {
          ...fight,
          aHp,
          bHp,
          turnId: nextTurn,
          lastHit: { by: context.userId, dmg },
          status: "done" as const,
        }
      : ((await loadOpenFight(sql, context.userId)) ?? fight);
    return { ok: true as const, fight: next };
  });

export const closeBookFight = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => z.object({ why: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ context }) => {
    const sql = await getSql();
    const fight = await loadOpenFight(sql, context.userId);
    if (!fight) return { ok: true as const, fight: null };
    await sql.query(
      `update fight set status = 'done', updated_at = now()
       where world_id = $1 and id = $2 and status = 'open'`,
      [WORLD_ID, fight.id],
    );
    return { ok: true as const, fight: { ...fight, status: "done" as const } };
  });

