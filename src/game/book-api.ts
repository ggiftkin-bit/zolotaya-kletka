import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { MAP_H, MAP_W } from "./constants";
import { slimTile, fatTile, type SlimTile } from "./save";
import { GROW_CATCHUP_TICKS, GROW_WRITE_BATCH, TICK_MS, stepWorldClock, tickGrow } from "./grow";
import type { Season, Tile } from "./types";
import { generateWorld } from "./worldgen";
import { isItemId, settleService, serviceJobOf } from "./market";
import { defaultMatter, MATTER_HP } from "./work";
import { pileAdd } from "./pile";
import type { ItemId, ServiceJob } from "./types";
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
  clock_at?: string | Date;
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
let growLock: Promise<void> | null = null;

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

function dueOf(body: PawnBody | null | undefined): number {
  const n = Number(body?.due);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function mergeBookBody(sql: Sql, userId: string, body: PawnBody): Promise<{ body: PawnBody; credit: number }> {
  const withFight = await mergeFightIntoPawnBody(sql, userId, body);
  const row = await readPawn(sql, userId);
  const credit = dueOf(row?.body);
  return { body: { ...withFight, gold: (withFight.gold ?? 0) + credit, due: 0 }, credit };
}

async function writePawn(
  sql: Sql,
  userId: string,
  pawn: { name: string; color: string; x: number; y: number },
  body: PawnBody,
) {
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
    [WORLD_ID, userId, pawn.name, pawn.color, pawn.x, pawn.y, JSON.stringify(body)],
  );
}

async function creditDue(sql: Sql, userId: string, gold: number) {
  if (!userId || userId === "you" || gold <= 0) return;
  await sql.query(
    `update pawn
     set body = jsonb_set(
           coalesce(body, '{}'::jsonb),
           '{due}',
           to_jsonb(coalesce((body->>'due')::int, 0) + $3::int),
           true
         ),
         updated_at = now()
     where world_id = $1 and user_id = $2`,
    [WORLD_ID, userId, gold],
  );
}

async function creditItems(sql: Sql, userId: string, cargo: Partial<Record<ItemId, number>>) {
  const keys = (Object.keys(cargo) as ItemId[]).filter((k) => (cargo[k] ?? 0) > 0);
  if (!userId || userId === "you" || !keys.length) return false;
  const row = await readPawn(sql, userId);
  if (!row?.body) return false;
  const inv = { ...(row.body.inventory ?? {}) };
  for (const k of keys) inv[k] = (inv[k] ?? 0) + (cargo[k] ?? 0);
  await writePawn(sql, userId, row, { ...row.body, inventory: inv });
  return true;
}

async function clearBusy(sql: Sql, userId: string) {
  if (!userId || userId === "you") return;
  const row = await readPawn(sql, userId);
  if (!row?.body?.busy) return;
  await writePawn(sql, userId, row, { ...row.body, busy: null });
}

function slimHasService(slim: SlimTile): boolean {
  return !!(slim.sv && slim.sv.by && slim.sv.g > 0);
}

async function applyServiceSettle(
  sql: Sql,
  row: TileRow,
  job: ServiceJob,
  result: Exclude<ReturnType<typeof settleService>, { wait: true }>,
  actor: string,
): Promise<number | null> {
  const tile = fatTile(asSlim(row.slim), row.x, row.y);
  tile.service = null;
  if (!result.ok) {
    if (!result.toPosterBag) {
      for (const k of Object.keys(result.cargo) as ItemId[]) {
        const n = result.cargo[k] ?? 0;
        if (n > 0) pileAdd(tile, k, n);
      }
    } else if (result.refundTo) {
      await creditItems(sql, result.refundTo, result.cargo);
    }
    if (result.refundTo) await creditDue(sql, result.refundTo, job.gold);
  } else {
    if (result.out) {
      if (result.toPosterBag && job.by) {
        const ok = await creditItems(sql, job.by, { [result.out.item]: result.out.n });
        if (!ok) pileAdd(tile, result.out.item, result.out.n);
      } else {
        pileAdd(tile, result.out.item, result.out.n);
      }
    }
    if (result.build && tile.building === "none") {
      tile.building = result.build;
      tile.matter = defaultMatter(result.build);
      tile.hp = MATTER_HP[tile.matter];
      tile.burned = false;
    }
    if (result.payTo) await creditDue(sql, result.payTo, job.gold);
  }
  if (job.take) await clearBusy(sql, job.take);
  const slim = slimTile(tile);
  const upd = await sql.query<{ ver: number }>(
    `update tile set slim = $4::jsonb, ver = ver + 1, updated_at = now(), updated_by = $5
     where world_id = $1 and x = $2 and y = $3 and ver = $6
     returning ver`,
    [WORLD_ID, row.x, row.y, JSON.stringify(slim), actor, row.ver],
  );
  if (!upd[0]) return null;
  await sql.query(
    `insert into deed (world_id, user_id, kind, x, y, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [WORLD_ID, actor, result.ok ? "service-done" : "service-fail", row.x, row.y, JSON.stringify({ gold: job.gold, k: job.kind })],
  );
  return upd[0].ver;
}

async function settleAround(sql: Sql, px: number, py: number, actor: string) {
  const rows = await sql.query<TileRow>(
    `select x, y, slim, ver, updated_at::text as updated_at
     from tile
     where world_id = $1
       and greatest(abs(x - $2), abs(y - $3)) <= $4
       and slim ? 'sv'`,
    [WORLD_ID, px, py, FOG_FETCH],
  );
  const now = Date.now();
  for (const row of rows) {
    const tile = fatTile(asSlim(row.slim), row.x, row.y);
    const job = serviceJobOf(tile);
    if (!job) continue;
    const exec = job.take ? await readPawn(sql, job.take) : null;
    const poster = await readPawn(sql, job.by);
    const result = settleService(
      job,
      now,
      row.x,
      row.y,
      exec ? { x: exec.x, y: exec.y } : null,
      poster ? { x: poster.x, y: poster.y } : null,
    );
    if (result.wait) continue;
    await applyServiceSettle(sql, row, job, result, actor);
  }
}

function slimOrder(slim: SlimTile): { item: import("./types").ItemId; n: number; gold: number } | null {
  const raw = slim.or;
  if (!raw || !isItemId(raw.i) || raw.n <= 0 || raw.g <= 0) return null;
  return { item: raw.i, n: Math.floor(raw.n), gold: Math.floor(raw.g) };
}

async function readWorld(sql: Sql): Promise<WorldRow> {
  const rows = await sql.query<WorldRow>(
    "select seed, season, year, week, day, tick_of_day, phase, weather, clock, clock_at from world where id = $1",
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

function clockAtMs(raw: string | Date | undefined): number {
  if (!raw) return Date.now();
  if (raw instanceof Date) {
    const n = raw.getTime();
    return Number.isFinite(n) ? n : Date.now();
  }
  const n = Date.parse(String(raw));
  return Number.isFinite(n) ? n : Date.now();
}

async function writeGrownTiles(
  sql: Sql,
  grown: { x: number; y: number; slim: SlimTile; ver: number }[],
  userId: string,
) {
  for (let i = 0; i < grown.length; i += GROW_WRITE_BATCH) {
    const chunk = grown.slice(i, i + GROW_WRITE_BATCH);
    await sql.query(
      `update tile t
       set slim = e->'slim', ver = t.ver + 1, updated_at = now(), updated_by = $3
       from jsonb_array_elements($2::jsonb) e
       where t.world_id = $1
         and t.x = (e->>'x')::int
         and t.y = (e->>'y')::int
         and t.ver = (e->>'ver')::int`,
      [WORLD_ID, JSON.stringify(chunk), userId],
    );
  }
}

async function growWeeks(sql: Sql, seasons: Season[], userId: string) {
  if (!seasons.length) return 0;
  const rows = await sql.query<TileRow>(
    `select x, y, slim, ver, updated_at::text as updated_at from tile where world_id = $1`,
    [WORLD_ID],
  );
  if (!rows.length) return 0;
  const tiles: Tile[] = new Array(MAP_W * MAP_H);
  const vers: number[] = new Array(MAP_W * MAP_H).fill(1);
  const before: (string | null)[] = new Array(MAP_W * MAP_H).fill(null);
  for (const r of rows) {
    if (r.x < 0 || r.y < 0 || r.x >= MAP_W || r.y >= MAP_H) continue;
    const i = r.y * MAP_W + r.x;
    const slim = asSlim(r.slim);
    tiles[i] = fatTile(slim, r.x, r.y);
    vers[i] = r.ver;
    before[i] = JSON.stringify(slim);
  }
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i]) continue;
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    tiles[i] = fatTile({ b: "plains" }, x, y);
  }
  const world = { seed: WORLD_SEED, width: MAP_W, height: MAP_H, tiles };
  for (const season of seasons) tickGrow(world, season, true);
  const grown: { x: number; y: number; slim: SlimTile; ver: number }[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (!t || before[i] == null) continue;
    const slim = slimTile(t);
    if (JSON.stringify(slim) === before[i]) continue;
    grown.push({ x: t.x, y: t.y, slim, ver: vers[i] ?? 1 });
  }
  if (grown.length) {
    await writeGrownTiles(sql, grown, userId);
    const origin = grown[0]!;
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [WORLD_ID, userId, "выросло", origin.x, origin.y, JSON.stringify({ n: grown.length, weeks: seasons.length })],
    );
  }
  return grown.length;
}

/** Book owns the calendar. Client clock is not written here. */
async function advanceWorldClock(sql: Sql, userId: string): Promise<WorldClock> {
  if (growLock) {
    await growLock;
    return asClock(await readWorld(sql));
  }
  let result: WorldClock | null = null;
  growLock = (async () => {
    const row = await readWorld(sql);
    let clock = asClock(row);
    const atMs = clockAtMs(row.clock_at);
    const now = Date.now();
    const due = Math.max(0, Math.floor((now - atMs) / TICK_MS));
    if (due <= 0) {
      result = clock;
      return;
    }
    const ticks = Math.min(due, GROW_CATCHUP_TICKS);
    const seasons: Season[] = [];
    for (let i = 0; i < ticks; i++) {
      const stepped = stepWorldClock(clock);
      clock = stepped.clock;
      if (stepped.newWeek) seasons.push(clock.season);
    }
    if (seasons.length) {
      await growWeeks(sql, seasons, userId);
    }
    const nextAt = due > GROW_CATCHUP_TICKS ? new Date(now) : new Date(atMs + ticks * TICK_MS);
    await sql.query(
      `update world set
         season = $2, year = $3, week = $4, day = $5, tick_of_day = $6,
         phase = $7, weather = $8, clock = $9, clock_at = $10::timestamptz, updated_at = now()
       where id = $1`,
      [
        WORLD_ID,
        clock.season,
        clock.year,
        clock.week,
        clock.day,
        clock.tickOfDay,
        clock.phase,
        clock.weather,
        clock.clock,
        nextAt.toISOString(),
      ],
    );
    result = clock;
  })().finally(() => {
    growLock = null;
  });
  await growLock;
  return result ?? asClock(await readWorld(sql));
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
    const clock = await advanceWorldClock(sql, context.userId);
    let pawn = await readPawn(sql, context.userId);
    if (pawn?.body) {
      const credit = dueOf(pawn.body);
      if (credit > 0) {
        const body = { ...pawn.body, gold: (pawn.body.gold ?? 0) + credit, due: 0 };
        await writePawn(sql, context.userId, pawn, body);
        pawn = { ...pawn, body };
      }
    }
    const px = pawn?.x ?? data.x ?? 48;
    const py = pawn?.y ?? data.y ?? 48;
    await settleAround(sql, px, py, context.userId);
    const spot = await loadSpot(sql, px, py, context.userId);
    await imprintSpot(sql, context.userId, px, py);
    const fight = await loadOpenFight(sql, context.userId);
    return {
      ok: true,
      born,
      clock,
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
        `update tile t
         set slim = ($5::jsonb - 'or' - 'sv')
           || case when t.slim ? 'or' then jsonb_build_object('or', t.slim->'or') else '{}'::jsonb end
           || case when t.slim ? 'sv' then jsonb_build_object('sv', t.slim->'sv') else '{}'::jsonb end,
             ver = t.ver + 1, updated_at = now(), updated_by = $6
         where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $4
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
    const merged = await mergeBookBody(sql, context.userId, data.pawn.body);
    await writePawn(sql, context.userId, data.pawn, merged.body);
    await imprintSpot(sql, context.userId, data.pawn.x, data.pawn.y);
    if (conflicts.length) {
      return {
        ok: false as const,
        hint: "клетка уже другая",
        conflicts,
        written,
        credit: merged.credit,
      };
    }
    return { ok: true as const, written, credit: merged.credit };
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
      const merged = await mergeBookBody(sql, context.userId, data.pawn.body);
      await writePawn(sql, context.userId, data.pawn, merged.body);
      return { ok: true as const, written: [] as { x: number; y: number; ver: number }[], credit: merged.credit };
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
         set slim = (i.slim - 'or' - 'sv')
           || case when t.slim ? 'or' then jsonb_build_object('or', t.slim->'or') else '{}'::jsonb end
           || case when t.slim ? 'sv' then jsonb_build_object('sv', t.slim->'sv') else '{}'::jsonb end,
             ver = t.ver + 1, updated_at = now(), updated_by = $3
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
        credit: 0,
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
    const merged = await mergeBookBody(sql, context.userId, data.pawn.body);
    await writePawn(sql, context.userId, data.pawn, merged.body);
    await imprintSpot(sql, context.userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written, credit: merged.credit };
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
    let credit = 0;
    if (data.pawn) {
      const merged = await mergeBookBody(sql, context.userId, data.pawn.body);
      credit = merged.credit;
      await writePawn(sql, context.userId, data.pawn, merged.body);
    } else {
      await sql.query(
        `update pawn set x = $3, y = $4, seen_at = now(), updated_at = now()
         where world_id = $1 and user_id = $2`,
        [WORLD_ID, context.userId, data.x, data.y],
      );
      const row = await readPawn(sql, context.userId);
      const due = dueOf(row?.body);
      if (due > 0 && row?.body) {
        const body = { ...row.body, gold: (row.body.gold ?? 0) + due, due: 0 };
        await writePawn(sql, context.userId, { name: row.name, color: row.color, x: data.x, y: data.y }, body);
        credit = due;
      }
    }
    const clock = await advanceWorldClock(sql, context.userId);
    await settleAround(sql, data.x, data.y, context.userId);
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
    const fight = await loadOpenFight(sql, context.userId);
    return {
      ok: true as const,
      clock,
      live,
      fill,
      others: withFightOther(others, fight, context.userId),
      fight,
      since: nowIso(),
      credit,
    };
  });

export const writeStallDeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["stall-put", "stall-drop", "stall-take"]),
        tile: tileInSchema,
        pawn: pawnInSchema,
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const userId = context.userId;
    const t = data.tile;
    const curRows = await sql.query<TileRow>(
      `select x, y, slim, ver, updated_at::text as updated_at from tile where world_id = $1 and x = $2 and y = $3`,
      [WORLD_ID, t.x, t.y],
    );
    const cur = curRows[0];
    const asConflict = () =>
      cur
        ? [{ x: cur.x, y: cur.y, slim: asSlim(cur.slim), ver: cur.ver, updatedAt: cur.updated_at }]
        : [];
    if (!cur) {
      return { ok: false as const, hint: "клетка уже другая", conflicts: [] as TilePacket[], written: [], credit: 0 };
    }
    const live = asSlim(cur.slim);
    if (cur.ver !== t.ver) {
      return { ok: false as const, hint: "клетка уже другая", conflicts: asConflict(), written: [], credit: 0 };
    }
    if (live.bd !== "stall") {
      return { ok: false as const, hint: "это не прилавок", conflicts: asConflict(), written: [], credit: 0 };
    }
    const owner = live.on || "";
    const liveOrder = slimOrder(live);

    if (data.kind === "stall-take") {
      if (!liveOrder) {
        return { ok: false as const, hint: "пусто", conflicts: asConflict(), written: [], credit: 0 };
      }
      if (!owner || owner === userId) {
        return { ok: false as const, hint: "свой ордер снимай сам", conflicts: [], written: [], credit: 0 };
      }
      if (Math.max(Math.abs(data.pawn.x - t.x), Math.abs(data.pawn.y - t.y)) > 1) {
        return { ok: false as const, hint: "подойди к прилавку", conflicts: [], written: [], credit: 0 };
      }
      const buyer = await readPawn(sql, userId);
      const dbGold = (buyer?.body?.gold ?? data.pawn.body.gold ?? 0) + dueOf(buyer?.body);
      if (dbGold < liveOrder.gold) {
        return { ok: false as const, hint: "мало золота", conflicts: [], written: [], credit: 0 };
      }
      const nextSlim: SlimTile = { ...live };
      delete nextSlim.or;
      if (t.slim.pl) nextSlim.pl = t.slim.pl;
      else delete nextSlim.pl;
      const upd = await sql.query<{ ver: number }>(
        `with upd as (
           update tile t
           set slim = $5::jsonb, ver = t.ver + 1, updated_at = now(), updated_by = $4
           where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $6
             and t.slim ? 'or' and t.slim->>'bd' = 'stall'
             and t.slim->>'on' is distinct from $4
           returning t.ver
         ),
         pay as (
           update pawn p
           set body = jsonb_set(
                 coalesce(p.body, '{}'::jsonb),
                 '{due}',
                 to_jsonb(coalesce((p.body->>'due')::int, 0) + $7::int),
                 true
               ),
               updated_at = now()
           where p.world_id = $1 and p.user_id = $8
             and exists (select 1 from upd)
           returning p.user_id
         )
         select ver from upd`,
        [WORLD_ID, t.x, t.y, userId, JSON.stringify(nextSlim), t.ver, liveOrder.gold, owner],
      );
      if (!upd[0]) {
        const now = await sql.query<TileRow>(
          `select x, y, slim, ver, updated_at::text as updated_at from tile where world_id = $1 and x = $2 and y = $3`,
          [WORLD_ID, t.x, t.y],
        );
        const n = now[0];
        return {
          ok: false as const,
          hint: "клетка уже другая",
          conflicts: n ? [{ x: n.x, y: n.y, slim: asSlim(n.slim), ver: n.ver, updatedAt: n.updated_at }] : [],
          written: [],
          credit: 0,
        };
      }
      const gold = dbGold - liveOrder.gold;
      const fight = await mergeFightIntoPawnBody(sql, userId, data.pawn.body);
      const body = { ...fight, inventory: data.pawn.body.inventory, gold, due: 0 };
      await writePawn(sql, userId, data.pawn, body);
      await sql.query(
        `insert into deed (world_id, user_id, kind, x, y, payload)
         values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [WORLD_ID, userId, data.kind, t.x, t.y, JSON.stringify({ item: liveOrder.item, n: liveOrder.n, gold: liveOrder.gold, seller: owner })],
      );
      await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
      const credit = gold - (data.pawn.body.gold ?? gold);
      return { ok: true as const, written: [{ x: t.x, y: t.y, ver: upd[0].ver }], credit };
    }

    if (owner !== userId) {
      return { ok: false as const, hint: "чужой прилавок", conflicts: [], written: [], credit: 0 };
    }
    const incoming = slimOrder(t.slim);
    if (data.kind === "stall-put") {
      if (!incoming) return { ok: false as const, hint: "нет вещи", conflicts: [], written: [], credit: 0 };
      if (liveOrder) return { ok: false as const, hint: "сначала сними свой ордер", conflicts: asConflict(), written: [], credit: 0 };
    }
    if (data.kind === "stall-drop" && !liveOrder) {
      return { ok: false as const, hint: "пусто", conflicts: asConflict(), written: [], credit: 0 };
    }
    const upd = await sql.query<{ ver: number }>(
      `update tile t
       set slim = ($5::jsonb - 'sv')
         || case when t.slim ? 'sv' then jsonb_build_object('sv', t.slim->'sv') else '{}'::jsonb end,
           ver = t.ver + 1, updated_at = now(), updated_by = $6
       where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $4
         and t.slim->>'bd' = 'stall'
       returning ver`,
      [WORLD_ID, t.x, t.y, t.ver, JSON.stringify(t.slim), userId],
    );
    if (!upd[0]) {
      return { ok: false as const, hint: "клетка уже другая", conflicts: asConflict(), written: [], credit: 0 };
    }
    const merged = await mergeBookBody(sql, userId, data.pawn.body);
    await writePawn(sql, userId, data.pawn, merged.body);
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [WORLD_ID, userId, data.kind, t.x, t.y, JSON.stringify({ item: incoming?.item ?? liveOrder?.item, gold: incoming?.gold ?? liveOrder?.gold })],
    );
    await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written: [{ x: t.x, y: t.y, ver: upd[0].ver }], credit: merged.credit };
  });

export const writeServiceDeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["service-post", "service-cancel", "service-take", "service-done", "service-fail"]),
        tile: tileInSchema,
        pawn: pawnInSchema,
        early: z.enum(["arrive", "work"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const userId = context.userId;
    const t = data.tile;
    const curRows = await sql.query<TileRow>(
      `select x, y, slim, ver, updated_at::text as updated_at from tile where world_id = $1 and x = $2 and y = $3`,
      [WORLD_ID, t.x, t.y],
    );
    const cur = curRows[0];
    const asConflict = () =>
      cur
        ? [{ x: cur.x, y: cur.y, slim: asSlim(cur.slim), ver: cur.ver, updatedAt: cur.updated_at }]
        : [];
    if (!cur) {
      return { ok: false as const, hint: "клетка уже другая", conflicts: [] as TilePacket[], written: [], credit: 0 };
    }
    if (cur.ver !== t.ver) {
      return { ok: false as const, hint: "клетка уже другая", conflicts: asConflict(), written: [], credit: 0 };
    }
    const liveTile = fatTile(asSlim(cur.slim), t.x, t.y);
    const liveJob = serviceJobOf(liveTile);
    const nextTile = fatTile(asSlim(t.slim), t.x, t.y);
    const nextJob = serviceJobOf(nextTile);
    const reach = Math.max(Math.abs(data.pawn.x - t.x), Math.abs(data.pawn.y - t.y));

    if (data.kind === "service-post") {
      if (liveJob) return { ok: false as const, hint: "сначала сними услугу", conflicts: asConflict(), written: [], credit: 0 };
      if (!nextJob || nextJob.by !== userId) return { ok: false as const, hint: "нет услуги", conflicts: [], written: [], credit: 0 };
      if (nextJob.gold < 1) return { ok: false as const, hint: "цена словом", conflicts: [], written: [], credit: 0 };
    } else if (data.kind === "service-cancel") {
      if (!liveJob || liveJob.by !== userId) return { ok: false as const, hint: "чужая услуга", conflicts: [], written: [], credit: 0 };
      if (liveJob.take) return { ok: false as const, hint: "уже взяли", conflicts: [], written: [], credit: 0 };
      if (nextJob) return { ok: false as const, hint: "сначала сними", conflicts: [], written: [], credit: 0 };
    } else if (data.kind === "service-take") {
      if (!liveJob) return { ok: false as const, hint: "нет услуги", conflicts: asConflict(), written: [], credit: 0 };
      if (liveJob.by === userId) return { ok: false as const, hint: "свою услугу снимай сам", conflicts: [], written: [], credit: 0 };
      if (liveJob.take) return { ok: false as const, hint: "уже взяли", conflicts: asConflict(), written: [], credit: 0 };
      if (reach > 1) return { ok: false as const, hint: "подойди", conflicts: [], written: [], credit: 0 };
      if (!nextJob || nextJob.take !== userId) return { ok: false as const, hint: "нет услуги", conflicts: [], written: [], credit: 0 };
    } else if (data.kind === "service-done" || data.kind === "service-fail") {
      if (!liveJob) return { ok: false as const, hint: "нет услуги", conflicts: asConflict(), written: [], credit: 0 };
      const actor = liveJob.take === userId || liveJob.by === userId;
      if (!actor) return { ok: false as const, hint: "не твоё дело", conflicts: [], written: [], credit: 0 };
      if (data.kind === "service-done" && liveJob.take !== userId) {
        return { ok: false as const, hint: "не твоё дело", conflicts: [], written: [], credit: 0 };
      }
      if (data.kind === "service-done" && liveJob.kind === "watch" && reach > 0) {
        return { ok: false as const, hint: "стой на клетке", conflicts: [], written: [], credit: 0 };
      }
      if (data.kind === "service-done" && liveJob.kind === "haul") {
        const dx = liveJob.destX ?? t.x;
        const dy = liveJob.destY ?? t.y;
        if (Math.max(Math.abs(data.pawn.x - dx), Math.abs(data.pawn.y - dy)) > 0 && data.early !== "arrive") {
          return { ok: false as const, hint: "не дошёл", conflicts: [], written: [], credit: 0 };
        }
      }
      const cargo = liveJob.cargo ?? (liveJob.item && (liveJob.n ?? 0) > 0 ? { [liveJob.item]: liveJob.n ?? 1 } : {});
      const execPos = { x: data.pawn.x, y: data.pawn.y };
      const posterRow = await readPawn(sql, liveJob.by);
      const posterPos = posterRow ? { x: posterRow.x, y: posterRow.y } : null;
      const result =
        data.kind === "service-fail"
          ? { wait: false as const, ok: false, refundTo: liveJob.by, cargo, toPosterBag: false }
          : settleService(liveJob, Date.now(), t.x, t.y, execPos, posterPos, data.early);
      if (data.kind === "service-done" && result.wait) {
        return { ok: false as const, hint: "ещё рано", conflicts: [], written: [], credit: 0 };
      }
      const settled = result as Exclude<typeof result, { wait: true }>;
      if (data.kind === "service-done" && !settled.ok) {
        return { ok: false as const, hint: "не достоял", conflicts: [], written: [], credit: 0 };
      }
      const ver = await applyServiceSettle(sql, cur, liveJob, settled, userId);
      if (ver == null) {
        return { ok: false as const, hint: "клетка уже другая", conflicts: asConflict(), written: [], credit: 0 };
      }
      const merged = await mergeBookBody(sql, userId, data.pawn.body);
      await writePawn(sql, userId, data.pawn, { ...merged.body, busy: null });
      await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
      return { ok: true as const, written: [{ x: t.x, y: t.y, ver }], credit: merged.credit };
    }

    const upd = await sql.query<{ ver: number }>(
      `update tile t
       set slim = $5::jsonb, ver = t.ver + 1, updated_at = now(), updated_by = $6
       where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $4
       returning ver`,
      [WORLD_ID, t.x, t.y, t.ver, JSON.stringify(t.slim), userId],
    );
    if (!upd[0]) {
      return { ok: false as const, hint: "клетка уже другая", conflicts: asConflict(), written: [], credit: 0 };
    }

    const merged = await mergeBookBody(sql, userId, data.pawn.body);
    const body = {
      ...merged.body,
      busy: data.kind === "service-take" ? merged.body.busy : merged.body.busy,
    };
    await writePawn(sql, userId, data.pawn, body);
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [WORLD_ID, userId, data.kind, t.x, t.y, JSON.stringify({ k: liveJob?.kind ?? nextJob?.kind, gold: liveJob?.gold ?? nextJob?.gold })],
    );
    await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written: [{ x: t.x, y: t.y, ver: upd[0].ver }], credit: merged.credit };
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

