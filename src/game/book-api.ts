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
  type BookSnapshot,
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
  if (n >= MAP_W * MAP_H * 0.9) return false;
  if (birthLock) {
    await birthLock;
    return false;
  }
  birthLock = (async () => {
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
    `select user_id, name, color, x, y from pawn
     where world_id = $1 and user_id <> $2
       and greatest(abs(x - $3), abs(y - $4)) <= $5
       and seen_at > now() - interval '2 minutes'`,
    [WORLD_ID, userId, px, py, FOG_FETCH],
  );
  const others: OtherPawn[] = otherRows.map((r) => ({
    id: r.user_id,
    name: r.name,
    color: r.color,
    x: r.x,
    y: r.y,
  }));
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
      others: spot.others,
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
        JSON.stringify(data.pawn.body),
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
          JSON.stringify(data.pawn.body),
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
      `select user_id, name, color, x, y from pawn
       where world_id = $1 and user_id <> $2
         and greatest(abs(x - $3), abs(y - $4)) <= $5
         and seen_at > now() - interval '2 minutes'`,
      [WORLD_ID, context.userId, data.x, data.y, FOG_FETCH],
    );
    const others: OtherPawn[] = otherRows.map((r) => ({
      id: r.user_id,
      name: r.name,
      color: r.color,
      x: r.x,
      y: r.y,
    }));
    await imprintSpot(sql, context.userId, data.x, data.y);
    const world = await readWorld(sql);
    return {
      ok: true as const,
      clock: asClock(world),
      live,
      fill,
      others,
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
