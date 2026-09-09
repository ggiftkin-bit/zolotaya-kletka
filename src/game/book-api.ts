import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { MAP_H, MAP_W, zeroInv } from "./constants";
import { slimTile, fatTile, type SlimTile } from "./save";
import { GROW_CATCHUP_TICKS, GROW_WRITE_BATCH, TICK_MS, markDepleted, PIT_HEAL_WEEKS, REGROW_WAIT, stepWorldClock, tickGrow } from "./grow";
import type { Inventory, ItemId, Season, ServiceJob, Tile, Transport, World } from "./types";
import { generateWorld } from "./worldgen";
import { isItemId, settleService, serviceJobOf, stampTake } from "./market";
import { fillStock, isGiftId, planBuyFromStock, planDonate, planGift, planSellDay, planSellToStock, stockOf, worldDayOf, STOCK_CAP, STOCK_START } from "./office";
import { isGoldKind, planGoldDeed, START_GOLD } from "./gold";
import { bagOf, canCraftHere, CISTERN_CAP, CISTERN_POUR, CELL_GONE, craftDefOf, eatSatiety, giveOrSpill, GRANT_WOOD, huntTake, isBagKind, isDrinkTile, PAIL_FULL, planCook, planEat, planGather, planScrap, planTonic, SIP_WATER, startInv, takeBag } from "./bag";
import { BOOST_ENERGY, busyEnergy, DEAD_MS, ENERGY_MAX, fleshOf, regenVigor, RISE_SAT, RISE_WATER, RISE_WARMTH, tickFlesh, vigorOf, WORK_HUNGER } from "./pace";
import { stepEnergy } from "./travel";
import { isHamletOwner, isLivingOwner } from "./pact";
import { tickCowBirth, tickHorseBirth, tickWildHerds, tickWolfMorning, tickWolfSpawn } from "./life";
import { defaultMatter, MATTER_HP, isRoof } from "./work";
import { asPile, dumpAllOn, pileAdd, pileEmpty, pileSet, pullNeed, SHED_REACH, applyNeedPull } from "./pile";
import { planDig } from "./pit";
import { STRIKE_CAP } from "./fight";
import { makeJobs } from "./economy";
import { MAX_PLOT, plotBounds, yardWoodCost } from "./fence";
import {
  FOG_FETCH,
  WORLD_ID,
  WORLD_SEED,
  darkWorld,
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

/** Ордер, услуга, имя — книга держит, пока дело не пишет их само. */
function keepSlimKeys(src: string, keys: Array<"or" | "sv" | "vg">): string {
  const minus = keys.map((k) => `- '${k}'`).join(" ");
  const restore = keys
    .map((k) => `|| case when t.slim ? '${k}' then jsonb_build_object('${k}', t.slim->'${k}') else '{}'::jsonb end`)
    .join(" ");
  return `(${src} ${minus}) ${restore}`;
}

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

function purseOf(body: PawnBody | null | undefined): number {
  const g = typeof body?.gold === "number" && Number.isFinite(body.gold) ? body.gold : 0;
  return Math.max(0, Math.floor(g) + dueOf(body));
}

function purseGold(book: PawnBody | null | undefined): number {
  return book ? purseOf(book) : START_GOLD;
}

/** Upsert фишки не берёт с клиента gold / due / gifts / inventory / energy / hp / life / deaths / satiety / warmth / water. */
function keepBookPurse(incoming: PawnBody, book: PawnBody | null | undefined): PawnBody {
  const vig = vigorOf(book);
  const flesh = fleshOf(book);
  return {
    ...incoming,
    gold: purseGold(book),
    due: 0,
    gifts: { ...(book?.gifts ?? {}) },
    inventory: book ? bagOf(book) : startInv(),
    energy: vig.energy,
    energyAt: vig.energyAt,
    resting: vig.resting,
    hp: vig.hp,
    life: vig.life,
    deaths: vig.deaths,
    downAt: vig.downAt,
    deadUntil: vig.deadUntil,
    sells: book?.sells,
    sellDay: book?.sellDay,
    satiety: flesh.satiety,
    warmth: flesh.warmth,
    water: flesh.water,
    pail: flesh.pail,
    sipTick: flesh.sipTick,
    bodyTick: flesh.bodyTick,
  };
}

function vigorOut(body: PawnBody) {
  const v = vigorOf(body);
  return {
    energy: v.energy,
    energyAt: v.energyAt,
    resting: v.resting,
    hp: v.hp,
    life: v.life,
    deaths: v.deaths,
  };
}

function fleshOut(body: PawnBody) {
  const f = fleshOf(body);
  return {
    satiety: f.satiety,
    warmth: f.warmth,
    water: f.water,
    pail: f.pail,
  };
}

function roofOfSlim(slim: SlimTile, profession: string | undefined): boolean {
  const tile = fatTile(slim, 0, 0);
  if (isRoof(tile) || tile.building === "tower") return true;
  return profession === "hireling";
}

function tickVigor(
  incoming: PawnBody,
  book: PawnBody | null | undefined,
  kept: PawnBody,
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  slim: SlimTile | null,
  walking: boolean,
): PawnBody {
  const now = Date.now();
  let vig = vigorOf(kept, now);
  const steps = from ? Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) : 0;
  if (steps > 0) {
    const drain = steps * stepEnergy(transportOf(kept));
    vig = { ...vig, energy: Math.max(0, vig.energy - drain) };
  }
  const inBusy = incoming.busy;
  const wasBusy = book?.busy;
  if (inBusy && inBusy.until > (wasBusy?.until ?? 0)) {
    vig = { ...vig, energy: Math.max(0, vig.energy - busyEnergy(inBusy.kind)) };
  }
  const roof = slim ? roofOfSlim(slim, kept.profession) : false;
  vig = regenVigor(vig, now, {
    roof,
    walking: walking || steps > 0,
    hungry: (kept.satiety ?? 90) < 25,
    busyUntil: inBusy?.until,
    hired: !!inBusy?.hired,
  });
  if (vig.life === "down" && roof && now - (vig.downAt || now) >= 3_000) {
    vig = { ...vig, life: "alive", hp: Math.max(20, vig.hp), downAt: 0, resting: true, energyAt: now };
  }
  if (vig.life === "dead" && vig.deadUntil > 0 && now >= vig.deadUntil) {
    vig = {
      ...vig,
      life: "alive",
      hp: 40,
      energy: Math.max(vig.energy, 8),
      downAt: 0,
      deadUntil: 0,
      resting: false,
    };
  }
  return {
    ...kept,
    energy: vig.energy,
    energyAt: vig.energyAt,
    resting: vig.resting,
    hp: vig.hp,
    life: vig.life,
    deaths: vig.deaths,
    downAt: vig.downAt,
    deadUntil: vig.deadUntil,
  };
}

function goldTakenFromSlim(live: SlimTile, incoming: SlimTile): number {
  let n = 0;
  if ((live.gd ?? 0) > 0 && incoming.gd == null) n += live.gd ?? 0;
  if ((live.tk ?? 0) > 0 && incoming.tk == null) n += live.tk ?? 0;
  return n;
}

function goodsOfSlim(slim: SlimTile): Inventory {
  const inv = bagOf(null);
  const pile = asPile(slim.pl);
  const chest = asPile(slim.ch);
  for (const k of Object.keys(pile) as ItemId[]) {
    const n = pile[k] ?? 0;
    if (n > 0) inv[k] = (inv[k] ?? 0) + n;
  }
  for (const k of Object.keys(chest) as ItemId[]) {
    const n = chest[k] ?? 0;
    if (n > 0) inv[k] = (inv[k] ?? 0) + n;
  }
  return inv;
}

function goodsMinus(a: Inventory, b: Inventory): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const k of Object.keys(a) as ItemId[]) {
    const n = (a[k] ?? 0) - (b[k] ?? 0);
    if (n > 0) out[k] = n;
  }
  return out;
}

function transportOf(body: PawnBody | null | undefined): Transport {
  const t = body?.transport;
  if (t === "cart" || t === "horse" || t === "wagon" || t === "walk") return t;
  return "walk";
}

function foldGoodsIntoBag(
  bag: Inventory,
  transport: Transport,
  live: SlimTile,
  incoming: SlimTile,
  stealField = false,
): { ok: true; inv: Inventory } | { ok: false; hint: string } {
  const from = goodsMinus(goodsOfSlim(live), goodsOfSlim(incoming));
  const to = goodsMinus(goodsOfSlim(incoming), goodsOfSlim(live));
  if (stealField && live.bd === "field") {
    const d = (live.n ?? 0) - (incoming.n ?? 0);
    if (d > 0) {
      const it = (live.rs as ItemId | undefined) ?? "grain";
      from[it] = (from[it] ?? 0) + Math.min(d, 2);
    }
  }
  let next = bag;
  for (const [k, n] of Object.entries(from) as [ItemId, number][]) {
    if (n > 0) {
      const g = giveOrSpill(next, transport, k, n);
      next = g.inv;
    }
  }
  const paid = takeBag(next, to);
  if (!paid.ok) return { ok: false, hint: paid.hint };
  return { ok: true, inv: paid.inv };
}

function cargoOfJob(job: ServiceJob | null | undefined): Partial<Record<ItemId, number>> {
  if (!job || job.kind === "bring" || job.kind === "watch") return {};
  if (job.cargo) {
    const out: Partial<Record<ItemId, number>> = {};
    for (const [k, n] of Object.entries(job.cargo) as [ItemId, number][]) {
      if (n > 0) out[k] = Math.floor(n);
    }
    if (Object.keys(out).length) return out;
  }
  if (job.item && isItemId(job.item) && (job.n ?? 0) > 0) return { [job.item]: Math.floor(job.n ?? 1) };
  return {};
}

function asMiniWorld(tiles: Tile[]): World {
  const w = darkWorld(WORLD_SEED);
  for (const t of tiles) {
    if (t.x >= 0 && t.x < w.width && t.y >= 0 && t.y < w.height) {
      w.tiles[t.y * w.width + t.x] = t;
    }
  }
  return w;
}

async function campNear(sql: Sql, x: number, y: number): Promise<boolean> {
  const rows = await sql.query<{ slim: SlimTile }>(
    `select slim from tile where world_id = $1 and greatest(abs(x - $2), abs(y - $3)) <= 1`,
    [WORLD_ID, x, y],
  );
  return rows.some((r) => {
    const t = fatTile(asSlim(r.slim), 0, 0);
    return t.building === "camp" && !t.burned;
  });
}

async function mergeBookBody(
  sql: Sql,
  userId: string,
  pawn: { x: number; y: number; body: PawnBody },
): Promise<{ body: PawnBody; credit: number; gold: number; inventory: Inventory }> {
  const row = await readPawn(sql, userId);
  const credit = dueOf(row?.body);
  let kept = keepBookPurse(pawn.body, row?.body);
  kept = await mergeFightIntoPawnBody(sql, userId, kept);
  const here = await sql.query<{ slim: SlimTile }>(
    `select slim from tile where world_id = $1 and x = $2 and y = $3`,
    [WORLD_ID, pawn.x, pawn.y],
  );
  const slim = here[0] ? asSlim(here[0].slim) : null;
  const walking = !!(pawn.body.travel && Array.isArray((pawn.body.travel as { path?: unknown }).path) && ((pawn.body.travel as { path?: unknown[] }).path?.length ?? 0) > 0);
  const wasDead = row?.body?.life === "dead";
  kept = tickVigor(
    pawn.body,
    row?.body,
    kept,
    row ? { x: row.x, y: row.y } : null,
    { x: pawn.x, y: pawn.y },
    slim,
    walking,
  );
  const clock = await advanceWorldClock(sql, userId);
  if (wasDead && kept.life === "alive") {
    kept = { ...kept, satiety: RISE_SAT, warmth: RISE_WARMTH, water: RISE_WATER, bodyTick: clock.clock };
  }
  const fire = await campNear(sql, pawn.x, pawn.y);
  const shelter = slim ? roofOfSlim(slim, undefined) : false;
  const f = tickFlesh(fleshOf(kept), clock.clock, {
    roof: shelter,
    fire,
    phase: clock.phase,
    season: clock.season,
    weather: clock.weather,
    alive: kept.life === "alive",
  });
  kept = {
    ...kept,
    satiety: f.satiety,
    warmth: f.warmth,
    water: f.water,
    pail: f.pail,
    sipTick: f.sipTick,
    bodyTick: f.bodyTick,
    hp: f.hp,
  };
  if (kept.life === "alive") {
    if (shelter) {
      kept = { ...kept, hp: Math.max(1, kept.hp) };
    } else if (kept.hp <= 0) {
      const live = slim ? fatTile(slim, pawn.x, pawn.y) : null;
      if (live) {
        dumpAllOn(live, bagOf(kept));
        for (const id of [kept.body, kept.shield, kept.helm]) {
          if (id) pileAdd(live, id, 1);
        }
        await sql.query(
          `update tile t
           set slim = ${keepSlimKeys("$4::jsonb", ["or", "sv", "vg"])},
               ver = t.ver + 1, updated_at = now(), updated_by = $5
           where t.world_id = $1 and t.x = $2 and t.y = $3`,
          [WORLD_ID, pawn.x, pawn.y, JSON.stringify(slimTile(live)), userId],
        );
      }
      kept = {
        ...kept,
        hp: 0,
        life: "down",
        downAt: Date.now(),
        inventory: zeroInv(),
        body: null,
        shield: null,
        helm: null,
        hand: null,
        busy: null,
        resting: false,
      };
    }
  }
  return { body: kept, credit, gold: kept.gold, inventory: kept.inventory };
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

async function debitItems(sql: Sql, userId: string, cargo: Partial<Record<ItemId, number>>) {
  const keys = (Object.keys(cargo) as ItemId[]).filter((k) => (cargo[k] ?? 0) > 0);
  if (!userId || userId === "you" || !keys.length) return false;
  const row = await readPawn(sql, userId);
  if (!row?.body) return false;
  const inv = { ...(row.body.inventory ?? {}) };
  for (const k of keys) {
    if ((inv[k] ?? 0) < (cargo[k] ?? 0)) return false;
  }
  for (const k of keys) inv[k] = (inv[k] ?? 0) - (cargo[k] ?? 0);
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
      const dx = job.kind === "bring" ? (job.destX ?? tile.x) : tile.x;
      const dy = job.kind === "bring" ? (job.destY ?? tile.y) : tile.y;
      const putOnHang = () => pileAdd(tile, result.out!.item, result.out!.n);
      if (result.toPosterBag && job.by) {
        const ok = await creditItems(sql, job.by, { [result.out.item]: result.out.n });
        if (!ok) putOnHang();
      } else if (job.kind === "bring" && (dx !== tile.x || dy !== tile.y)) {
        const destRows = await sql.query<TileRow>(
          `select x, y, slim, ver, updated_at::text as updated_at from tile where world_id = $1 and x = $2 and y = $3`,
          [WORLD_ID, dx, dy],
        );
        const destRow = destRows[0];
        if (destRow) {
          const dest = fatTile(asSlim(destRow.slim), dx, dy);
          pileAdd(dest, result.out.item, result.out.n);
          await sql.query(
            `update tile t
             set slim = ${keepSlimKeys("$4::jsonb", ["or", "sv", "vg"])},
                 ver = t.ver + 1, updated_at = now(), updated_by = $5
             where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $6`,
            [WORLD_ID, dx, dy, JSON.stringify(slimTile(dest)), actor, destRow.ver],
          );
        } else putOnHang();
      } else {
        putOnHang();
      }
    }
    if (result.ok && job.kind === "bring" && result.out) {
      await debitItems(sql, actor, { [result.out.item]: result.out.n });
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

async function ensureStock(sql: Sql): Promise<Partial<Record<ItemId, number>>> {
  const rows = await sql.query<{ stock: unknown }>(`select stock from world where id = $1`, [WORLD_ID]);
  const raw = rows[0]?.stock;
  const filled = fillStock(raw);
  const empty = !raw || typeof raw !== "object" || Object.keys(raw as object).length === 0;
  if (empty) {
    await sql.query(`update world set stock = $2::jsonb, updated_at = now() where id = $1`, [
      WORLD_ID,
      JSON.stringify(filled),
    ]);
  }
  return filled;
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

async function growWeeks(sql: Sql, seasons: Season[], userId: string, daySalts: number[] = [], nightSalts: number[] = []) {
  if (!seasons.length && !daySalts.length && !nightSalts.length) return 0;
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
  for (const salt of daySalts) {
    tickWolfMorning(world, salt);
    tickWildHerds(world, salt);
    tickCowBirth(world);
    tickHorseBirth(world);
    tickWolfSpawn(world, false, salt);
  }
  for (const salt of nightSalts) tickWolfSpawn(world, true, salt);
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
    const daySalts: number[] = [];
    const nightSalts: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const stepped = stepWorldClock(clock);
      clock = stepped.clock;
      if (stepped.newDay) daySalts.push(clock.clock);
      if (clock.tickOfDay === 4) nightSalts.push(clock.clock);
      if (stepped.newWeek) seasons.push(clock.season);
    }
    if (seasons.length || daySalts.length || nightSalts.length) {
      await growWeeks(sql, seasons, userId, daySalts, nightSalts);
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
    const stock = await ensureStock(sql);
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
      stock,
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
    let picked = 0;
    for (const t of data.tiles) {
      const live = await sql.query<TileRow>(
        `select x, y, slim, ver, updated_at::text as updated_at
         from tile where world_id = $1 and x = $2 and y = $3`,
        [WORLD_ID, t.x, t.y],
      );
      const liveOn = ((live[0] ? asSlim(live[0].slim).on : "") || "").trim();
      if (liveOn && liveOn !== context.userId && liveOn !== "you") {
        if (live[0]) {
          conflicts.push({
            x: live[0].x,
            y: live[0].y,
            slim: asSlim(live[0].slim),
            ver: live[0].ver,
            updatedAt: live[0].updated_at,
          });
        }
        continue;
      }
      const upd = await sql.query<{ ver: number }>(
        `update tile t
         set slim = ${keepSlimKeys("$5::jsonb", ["or", "sv", "vg"])},
             ver = t.ver + 1, updated_at = now(), updated_by = $6
         where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $4
         returning ver`,
        [WORLD_ID, t.x, t.y, t.ver, JSON.stringify(t.slim), context.userId],
      );
      if (upd[0]) {
        written.push({ x: t.x, y: t.y, ver: upd[0].ver });
        if (live[0]) picked += goldTakenFromSlim(asSlim(live[0].slim), t.slim);
        continue;
      }
      if (live[0]) {
        conflicts.push({
          x: live[0].x,
          y: live[0].y,
          slim: asSlim(live[0].slim),
          ver: live[0].ver,
          updatedAt: live[0].updated_at,
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
    const merged = await mergeBookBody(sql, context.userId, data.pawn);
    const body = { ...merged.body, gold: merged.gold + picked };
    await writePawn(sql, context.userId, data.pawn, body);
    await imprintSpot(sql, context.userId, data.pawn.x, data.pawn.y);
    if (conflicts.length) {
      return {
        ok: false as const,
        hint: "клетка уже другая",
        conflicts,
        written,
        credit: merged.credit,
        gold: body.gold,
        inventory: body.inventory,
      };
    }
    return { ok: true as const, written, credit: merged.credit, gold: body.gold, inventory: body.inventory };
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
    if (data.kind === "burn") {
      const pre = await mergeBookBody(sql, context.userId, data.pawn);
      const tinder = takeBag(pre.inventory, { herb: 1 });
      if (!tinder.ok) {
        return {
          ok: false as const,
          hint: "нечем зажечь",
          conflicts: [] as TilePacket[],
          written: [] as { x: number; y: number; ver: number }[],
          credit: 0,
          gold: pre.gold,
          inventory: pre.inventory,
        };
      }
    }
    if (!data.tiles.length) {
      const merged = await mergeBookBody(sql, context.userId, data.pawn);
      await writePawn(sql, context.userId, data.pawn, merged.body);
      return { ok: true as const, written: [] as { x: number; y: number; ver: number }[], credit: merged.credit, gold: merged.gold, inventory: merged.inventory };
    }
    let picked = 0;
    const liveBy: SlimTile[] = [];
    for (const t of data.tiles) {
      const live = await sql.query<{ slim: SlimTile }>(
        `select slim from tile where world_id = $1 and x = $2 and y = $3`,
        [WORLD_ID, t.x, t.y],
      );
      const slim = live[0] ? asSlim(live[0].slim) : { b: "plains" as const };
      liveBy.push(slim);
      if (live[0]) picked += goldTakenFromSlim(slim, t.slim);
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
         set slim = ${keepSlimKeys("i.slim", ["or", "sv", "vg"])},
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
    const merged = await mergeBookBody(sql, context.userId, data.pawn);
    let bag = merged.inventory;
    const ride = transportOf(merged.body);
    if (data.kind === "pile" || data.kind === "steal") {
      for (let i = 0; i < data.tiles.length; i++) {
        const t = data.tiles[i]!;
        const folded = foldGoodsIntoBag(bag, ride, liveBy[i] ?? { b: "plains" }, t.slim, data.kind === "steal");
        if (!folded.ok) {
          return { ok: false as const, hint: folded.hint, conflicts: [], written: [], credit: 0, gold: merged.gold, inventory: merged.inventory };
        }
        bag = folded.inv;
      }
    } else if (data.kind === "lock") {
      const live = liveBy[0] ?? { b: "plains" as const };
      const inc = data.tiles[0]?.slim ?? { b: "plains" as const };
      const liveLocked = !!(live.cl || live.gl);
      const incLocked = !!(inc.cl || inc.gl);
      if (incLocked && !liveLocked) {
        const paid = takeBag(bag, { lock: 1 });
        if (!paid.ok) {
          return { ok: false as const, hint: paid.hint, conflicts: [], written: [], credit: 0, gold: merged.gold, inventory: merged.inventory };
        }
        bag = paid.inv;
      } else if (liveLocked && !incLocked) {
        bag = giveOrSpill(bag, ride, "lock", 1).inv;
      }
    } else if (data.kind === "burn") {
      const paid = takeBag(bag, { herb: 1 });
      if (!paid.ok) {
        return { ok: false as const, hint: "нечем зажечь", conflicts: [], written: [], credit: 0, gold: merged.gold, inventory: merged.inventory };
      }
      bag = paid.inv;
    }
    let hand = merged.body.hand;
    if (hand === "herb" && (bag.herb ?? 0) <= 0) hand = null;
    const body = { ...merged.body, gold: merged.gold + picked, inventory: bag, hand };
    await writePawn(sql, context.userId, data.pawn, body);
    await imprintSpot(sql, context.userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written, credit: merged.credit, gold: body.gold, inventory: body.inventory };
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
    let gold = START_GOLD;
    let inventory = startInv();
    let vigor = vigorOf(null);
    let flesh = fleshOf(null);
    if (data.pawn) {
      const merged = await mergeBookBody(sql, context.userId, data.pawn);
      credit = merged.credit;
      gold = merged.gold;
      inventory = merged.inventory;
      vigor = vigorOf(merged.body);
      flesh = fleshOf(merged.body);
      await writePawn(sql, context.userId, data.pawn, merged.body);
    } else {
      await sql.query(
        `update pawn set x = $3, y = $4, seen_at = now(), updated_at = now()
         where world_id = $1 and user_id = $2`,
        [WORLD_ID, context.userId, data.x, data.y],
      );
      const row = await readPawn(sql, context.userId);
      const due = dueOf(row?.body);
      gold = purseOf(row?.body);
      inventory = bagOf(row?.body);
      vigor = vigorOf(row?.body);
      flesh = fleshOf(row?.body);
      if (due > 0 && row?.body) {
        const body = { ...row.body, gold, due: 0 };
        await writePawn(sql, context.userId, { name: row.name, color: row.color, x: data.x, y: data.y }, body);
        credit = due;
        inventory = bagOf(body);
        vigor = vigorOf(body);
        flesh = fleshOf(body);
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
    const stock = await ensureStock(sql);
    return {
      ok: true as const,
      clock,
      live,
      fill,
      others: withFightOther(others, fight, context.userId),
      fight,
      since: nowIso(),
      credit,
      gold,
      inventory,
      stock,
      energy: vigor.energy,
      energyAt: vigor.energyAt,
      resting: vigor.resting,
      hp: vigor.hp,
      life: vigor.life,
      deaths: vigor.deaths,
      satiety: flesh.satiety,
      warmth: flesh.warmth,
      water: flesh.water,
      pail: flesh.pail,
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
      const dbGold = purseGold(buyer?.body);
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
      const kept = keepBookPurse(fight, buyer?.body);
      const given = giveOrSpill(kept.inventory, transportOf(kept), liveOrder.item, liveOrder.n);
      const body = { ...kept, inventory: given.inv, gold, due: 0 };
      await writePawn(sql, userId, data.pawn, body);
      await sql.query(
        `insert into deed (world_id, user_id, kind, x, y, payload)
         values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [WORLD_ID, userId, data.kind, t.x, t.y, JSON.stringify({ item: liveOrder.item, n: liveOrder.n, gold: liveOrder.gold, seller: owner })],
      );
      await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
      return { ok: true as const, written: [{ x: t.x, y: t.y, ver: upd[0].ver }], credit: 0, gold, inventory: body.inventory };
    }

    if (owner !== userId) {
      return { ok: false as const, hint: "чужой прилавок", conflicts: [], written: [], credit: 0 };
    }
    const incoming = slimOrder(t.slim);
    if (data.kind === "stall-put") {
      if (!incoming) return { ok: false as const, hint: "нет вещи", conflicts: [], written: [], credit: 0 };
      if (liveOrder) return { ok: false as const, hint: "сначала сними свой ордер", conflicts: asConflict(), written: [], credit: 0 };
      const poster = await readPawn(sql, userId);
      const paid = takeBag(bagOf(poster?.body), { [incoming.item]: incoming.n });
      if (!paid.ok) return { ok: false as const, hint: paid.hint, conflicts: [], written: [], credit: 0 };
    }
    if (data.kind === "stall-drop" && !liveOrder) {
      return { ok: false as const, hint: "пусто", conflicts: asConflict(), written: [], credit: 0 };
    }
    const upd = await sql.query<{ ver: number }>(
      `update tile t
       set slim = ${keepSlimKeys("$5::jsonb", ["sv", "vg"])},
           ver = t.ver + 1, updated_at = now(), updated_by = $6
       where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $4
         and t.slim->>'bd' = 'stall'
       returning ver`,
      [WORLD_ID, t.x, t.y, t.ver, JSON.stringify(t.slim), userId],
    );
    if (!upd[0]) {
      return { ok: false as const, hint: "клетка уже другая", conflicts: asConflict(), written: [], credit: 0 };
    }
    const merged = await mergeBookBody(sql, userId, data.pawn);
    let inv = merged.inventory;
    if (data.kind === "stall-put" && incoming) {
      const paid = takeBag(inv, { [incoming.item]: incoming.n });
      if (!paid.ok) return { ok: false as const, hint: paid.hint, conflicts: [], written: [], credit: 0, gold: merged.gold, inventory: inv };
      inv = paid.inv;
    } else if (data.kind === "stall-drop" && liveOrder) {
      inv = giveOrSpill(inv, transportOf(merged.body), liveOrder.item, liveOrder.n).inv;
    }
    const body = { ...merged.body, inventory: inv };
    await writePawn(sql, userId, data.pawn, body);
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [WORLD_ID, userId, data.kind, t.x, t.y, JSON.stringify({ item: incoming?.item ?? liveOrder?.item, gold: incoming?.gold ?? liveOrder?.gold })],
    );
    await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written: [{ x: t.x, y: t.y, ver: upd[0].ver }], credit: merged.credit, gold: merged.gold, inventory: inv };
  });

export const writeOfficeDeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["stock-sell", "stock-buy", "gift", "donate"]),
        pawn: pawnInSchema,
        item: z.string().optional(),
        qty: z.number().optional(),
        gift: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const userId = context.userId;
    const clock = asClock(await readWorld(sql));
    const season = clock.season;
    const stock = await ensureStock(sql);
    const row = await readPawn(sql, userId);
    const dbBody = row?.body;
    const dbGold = purseGold(dbBody);
    const trader = (dbBody?.profession ?? data.pawn.body.profession) === "trader";
    const gifts = { ...(dbBody?.gifts ?? {}) };

    const fail = (hint: string) => ({ ok: false as const, hint, stock, credit: 0, gold: dbGold, inventory: bagOf(dbBody) });

    if (data.kind === "donate") {
      const plan = planDonate();
      const fight = await mergeFightIntoPawnBody(sql, userId, data.pawn.body);
      const kept = keepBookPurse(fight, dbBody);
      const gold = dbGold + plan.gold;
      const body = { ...kept, gold, due: 0, gifts };
      await writePawn(sql, userId, data.pawn, body);
      await sql.query(
        `insert into deed (world_id, user_id, kind, x, y, payload)
         values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [WORLD_ID, userId, "office-donate", data.pawn.x, data.pawn.y, JSON.stringify({ gold: plan.gold })],
      );
      return { ok: true as const, stock, credit: 0, gold, inventory: body.inventory };
    }

    if (data.kind === "gift") {
      const id = data.gift ?? "";
      if (!isGiftId(id)) return fail("Нет такого приза.");
      const plan = planGift(dbGold, gifts, id);
      if (!plan.ok) return fail(plan.hint);
      const fight = await mergeFightIntoPawnBody(sql, userId, data.pawn.body);
      const kept = keepBookPurse(fight, dbBody);
      const gold = dbGold - plan.gold;
      const body = { ...kept, gold, due: 0, gifts: plan.next };
      await writePawn(sql, userId, data.pawn, body);
      await sql.query(
        `insert into deed (world_id, user_id, kind, x, y, payload)
         values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [WORLD_ID, userId, "office-gift", data.pawn.x, data.pawn.y, JSON.stringify({ id, gold: plan.gold })],
      );
      return { ok: true as const, stock, credit: 0, gold, inventory: body.inventory };
    }

    const item = data.item ?? "";
    if (!isItemId(item)) return fail("Лавка это не берёт.");
    const qty = Math.max(1, Math.floor(data.qty ?? 1));

    if (data.kind === "stock-sell") {
      const bag = bagOf(dbBody);
      const plan = planSellToStock(stock, bag, item, qty, season, trader);
      if (!plan.ok) return fail(plan.hint);
      const cap = planSellDay(dbBody, worldDayOf(clock.clock));
      if (!cap.ok) return fail(cap.hint);
      const have = stockOf(stock, item);
      const nextCount = have + plan.take;
      const upd = await sql.query<{ stock: unknown }>(
        `update world
         set stock = jsonb_set(coalesce(stock, '{}'::jsonb), ARRAY[$2::text], to_jsonb($4::int), true),
             updated_at = now()
         where id = $1
           and coalesce((stock->>$2)::int, $5) = $3
           and coalesce((stock->>$2)::int, $5) <= $6
         returning stock`,
        [WORLD_ID, item, have, nextCount, STOCK_START, STOCK_CAP],
      );
      if (!upd[0]) {
        const now = await ensureStock(sql);
        const again = stockOf(now, item);
        return fail(again > STOCK_CAP ? "склад полон" : "склад уже другой");
      }
      const fight = await mergeFightIntoPawnBody(sql, userId, data.pawn.body);
      const kept = keepBookPurse(fight, dbBody);
      const gold = dbGold + plan.gold;
      const body = { ...kept, inventory: plan.inv, gold, due: 0, gifts, sells: cap.sells, sellDay: cap.sellDay };
      await writePawn(sql, userId, data.pawn, body);
      await sql.query(
        `insert into deed (world_id, user_id, kind, x, y, payload)
         values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [WORLD_ID, userId, "stock-sell", data.pawn.x, data.pawn.y, JSON.stringify({ item, n: plan.take, gold: plan.gold })],
      );
      return { ok: true as const, stock: fillStock(upd[0].stock), credit: 0, gold, inventory: body.inventory };
    }

    const plan = planBuyFromStock(stock, dbGold, item, qty, season);
    if (!plan.ok) return fail(plan.hint);
    const haveBuy = stockOf(stock, item);
    const nextBuy = haveBuy - plan.n;
    const updBuy = await sql.query<{ stock: unknown }>(
      `update world
       set stock = jsonb_set(coalesce(stock, '{}'::jsonb), ARRAY[$2::text], to_jsonb($4::int), true),
           updated_at = now()
       where id = $1
         and coalesce((stock->>$2)::int, $5) = $3
         and coalesce((stock->>$2)::int, $5) >= $6
       returning stock`,
      [WORLD_ID, item, haveBuy, nextBuy, STOCK_START, plan.n],
    );
    if (!updBuy[0]) {
      const now = await ensureStock(sql);
      return fail(stockOf(now, item) <= 0 ? "нет на складе" : "склад уже другой");
    }
    const fightBuy = await mergeFightIntoPawnBody(sql, userId, data.pawn.body);
    const keptBuy = keepBookPurse(fightBuy, dbBody);
    const goldBuy = dbGold - plan.cost;
    const givenBuy = giveOrSpill(keptBuy.inventory, transportOf(keptBuy), item, plan.n);
    const bodyBuy = { ...keptBuy, inventory: givenBuy.inv, gold: goldBuy, due: 0, gifts };
    await writePawn(sql, userId, data.pawn, bodyBuy);
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [WORLD_ID, userId, "stock-buy", data.pawn.x, data.pawn.y, JSON.stringify({ item, n: plan.n, gold: plan.cost })],
    );
    return { ok: true as const, stock: fillStock(updBuy[0].stock), credit: 0, gold: goldBuy, inventory: bodyBuy.inventory };
  });

export const writeGoldDeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.string(),
        pawn: pawnInSchema,
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const userId = context.userId;
    if (!isGoldKind(data.kind)) return { ok: false as const, hint: "нет такого дела", gold: 0, inventory: startInv() };
    const row = await readPawn(sql, userId);
    const merged = await mergeBookBody(sql, userId, data.pawn);
    const plan = planGoldDeed(data.kind, merged.gold, row?.body?.deaths ?? 0);
    if (!plan.ok) return { ok: false as const, hint: plan.hint, gold: merged.gold, inventory: merged.inventory };
    const fight = await mergeFightIntoPawnBody(sql, userId, merged.body);
    let inv = merged.body.inventory;
    if (data.kind === "lock") {
      inv = giveOrSpill(inv, transportOf(merged.body), "lock", 1).inv;
    }
    const now = Date.now();
    let vig = vigorOf(fight, now);
    let satiety = typeof fight.satiety === "number" ? fight.satiety : 90;
    if (data.kind === "boost") {
      vig = { ...vig, energy: Math.min(ENERGY_MAX, vig.energy + BOOST_ENERGY), energyAt: now };
    } else if (data.kind === "work") {
      vig = { ...vig, energy: Math.max(0, vig.energy - 4), energyAt: now };
      satiety = Math.max(0, satiety - WORK_HUNGER);
    } else if (data.kind === "death" && vig.life !== "dead") {
      vig = {
        ...vig,
        life: "dead",
        hp: 0,
        deaths: vig.deaths + 1,
        deadUntil: now + DEAD_MS,
        downAt: 0,
        resting: false,
      };
    }
    const body = {
      ...fight,
      gold: plan.gold,
      due: 0,
      gifts: merged.body.gifts,
      inventory: inv,
      energy: vig.energy,
      energyAt: vig.energyAt,
      resting: vig.resting,
      hp: vig.hp,
      life: vig.life,
      deaths: vig.deaths,
      downAt: vig.downAt,
      deadUntil: vig.deadUntil,
      satiety,
    };
    await writePawn(sql, userId, data.pawn, body);
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [WORLD_ID, userId, `gold-${data.kind}`, data.pawn.x, data.pawn.y, JSON.stringify({ gold: plan.gold, delta: plan.delta })],
    );
    return { ok: true as const, gold: plan.gold, credit: 0, inventory: inv, ...vigorOut(body), ...fleshOut(body) };
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
        sheds: z.array(tileInSchema).optional(),
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
      const poster = await readPawn(sql, userId);
      if (purseOf(poster?.body) < nextJob.gold) {
        return { ok: false as const, hint: "мало золота", conflicts: [], written: [], credit: 0 };
      }
      const haul = cargoOfJob(nextJob);
      const paidCargo = takeBag(bagOf(poster?.body), haul);
      if (!paidCargo.ok) return { ok: false as const, hint: paidCargo.hint, conflicts: [], written: [], credit: 0 };
      const posted: ServiceJob = { ...nextJob, until: 0 };
      delete posted.take;
      nextTile.service = posted;
      t.slim = slimTile(nextTile);
    } else if (data.kind === "service-cancel") {
      if (!liveJob || liveJob.by !== userId) return { ok: false as const, hint: "чужая услуга", conflicts: [], written: [], credit: 0 };
      if (liveJob.take) return { ok: false as const, hint: "уже взяли", conflicts: [], written: [], credit: 0 };
      if (nextJob) return { ok: false as const, hint: "сначала сними", conflicts: [], written: [], credit: 0 };
    } else if (data.kind === "service-take") {
      if (!liveJob) return { ok: false as const, hint: "нет услуги", conflicts: asConflict(), written: [], credit: 0 };
      if (liveJob.by === userId) return { ok: false as const, hint: "свою услугу снимай сам", conflicts: [], written: [], credit: 0 };
      if (liveJob.take) return { ok: false as const, hint: "уже взяли", conflicts: asConflict(), written: [], credit: 0 };
      if (reach > 1) {
        const vg = liveTile.village;
        let atBoard = false;
        if (vg) {
          const near = await sql.query<{ slim: unknown }>(
            `select slim from tile where world_id = $1 and x between $2 and $3 and y between $4 and $5`,
            [WORLD_ID, data.pawn.x - 1, data.pawn.x + 1, data.pawn.y - 1, data.pawn.y + 1],
          );
          atBoard = near.some((r) => {
            const sl = asSlim(r.slim);
            return sl.bd === "board" && sl.vg === vg;
          });
        }
        if (!atBoard) return { ok: false as const, hint: "подойди", conflicts: [], written: [], credit: 0 };
      }
      if (liveJob.kind === "bring") {
        const need = liveJob.n ?? 1;
        const it = liveJob.item;
        const have = it ? (bagOf((await readPawn(sql, userId))?.body)[it] ?? 0) : 0;
        if (!it || have < need) return { ok: false as const, hint: "нет в сумке", conflicts: [], written: [], credit: 0 };
      }
      if (!nextJob || nextJob.take !== userId) return { ok: false as const, hint: "нет услуги", conflicts: [], written: [], credit: 0 };
      nextTile.service = stampTake(liveJob, userId, Date.now());
      t.slim = slimTile(nextTile);
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
      if (data.kind === "service-done" && (liveJob.kind === "haul" || liveJob.kind === "bring")) {
        const dx = liveJob.destX ?? t.x;
        const dy = liveJob.destY ?? t.y;
        if (Math.max(Math.abs(data.pawn.x - dx), Math.abs(data.pawn.y - dy)) > 0 && data.early !== "arrive") {
          return { ok: false as const, hint: "не дошёл", conflicts: [], written: [], credit: 0 };
        }
      }
      if (data.kind === "service-done" && liveJob.kind === "bring") {
        const need = liveJob.n ?? 1;
        const it = liveJob.item;
        const have = it ? (bagOf((await readPawn(sql, userId))?.body)[it] ?? 0) : 0;
        if (!it || have < need) return { ok: false as const, hint: "нет в сумке", conflicts: [], written: [], credit: 0 };
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
      const merged = await mergeBookBody(sql, userId, data.pawn);
      let inv = merged.inventory;
      if (data.kind === "service-done" && liveJob.kind === "bring" && liveJob.item && isItemId(liveJob.item)) {
        const paid = takeBag(inv, { [liveJob.item]: liveJob.n ?? 1 });
        if (!paid.ok) return { ok: false as const, hint: paid.hint, conflicts: [], written: [], credit: 0, gold: merged.gold, inventory: inv };
        inv = paid.inv;
      }
      await writePawn(sql, userId, data.pawn, { ...merged.body, busy: null, inventory: inv });
      await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
      return { ok: true as const, written: [{ x: t.x, y: t.y, ver }], credit: merged.credit, gold: merged.gold, inventory: inv };
    }

    const upd = await sql.query<{ ver: number }>(
      `update tile t
       set slim = ${keepSlimKeys("$5::jsonb", ["or", "vg"])},
           ver = t.ver + 1, updated_at = now(), updated_by = $6
       where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $4
       returning ver`,
      [WORLD_ID, t.x, t.y, t.ver, JSON.stringify(t.slim), userId],
    );
    if (!upd[0]) {
      return { ok: false as const, hint: "клетка уже другая", conflicts: asConflict(), written: [], credit: 0 };
    }
    const written: { x: number; y: number; ver: number }[] = [{ x: t.x, y: t.y, ver: upd[0].ver }];
    if (data.kind === "service-post" && data.sheds?.length) {
      const stationOn = (asSlim(cur.slim).on || userId) as string;
      const stationVg = (asSlim(cur.slim).vg || nextTile.village || "") as string;
      for (const sh of data.sheds) {
        if (Math.max(Math.abs(sh.x - t.x), Math.abs(sh.y - t.y)) > 2) continue;
        const shedRows = await sql.query<TileRow>(
          `select x, y, slim, ver, updated_at::text as updated_at from tile where world_id = $1 and x = $2 and y = $3`,
          [WORLD_ID, sh.x, sh.y],
        );
        const row = shedRows[0];
        if (!row || row.ver !== sh.ver) continue;
        const live = asSlim(row.slim);
        if (live.bd !== "shed") continue;
        const on = live.on || "";
        const sameOwner = on === userId || on === stationOn;
        const sameName = !!(stationVg && live.vg && live.vg === stationVg);
        if (!sameOwner && !sameName) continue;
        const shedUpd = await sql.query<{ ver: number }>(
          `update tile t
           set slim = ${keepSlimKeys("$5::jsonb", ["or", "sv", "vg"])},
               ver = t.ver + 1, updated_at = now(), updated_by = $6
           where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $4
             and t.slim->>'bd' = 'shed'
           returning ver`,
          [WORLD_ID, sh.x, sh.y, sh.ver, JSON.stringify(sh.slim), userId],
        );
        if (shedUpd[0]) written.push({ x: sh.x, y: sh.y, ver: shedUpd[0].ver });
      }
    }

    const merged = await mergeBookBody(sql, userId, data.pawn);
    let gold = merged.gold;
    let inv = merged.inventory;
    const ride = transportOf(merged.body);
    if (data.kind === "service-post") {
      const pay = nextJob?.gold ?? 0;
      if (gold < pay) {
        return { ok: false as const, hint: "мало золота", conflicts: [], written: [], credit: 0, gold, inventory: inv };
      }
      gold -= pay;
      const paid = takeBag(inv, cargoOfJob(nextJob));
      if (!paid.ok) return { ok: false as const, hint: paid.hint, conflicts: [], written: [], credit: 0, gold, inventory: inv };
      inv = paid.inv;
    } else if (data.kind === "service-cancel") {
      gold += liveJob?.gold ?? 0;
      const back = cargoOfJob(liveJob);
      for (const [k, n] of Object.entries(back) as [ItemId, number][]) {
        if (n > 0) inv = giveOrSpill(inv, ride, k, n).inv;
      }
    }
    const body = {
      ...merged.body,
      gold,
      inventory: inv,
      busy: merged.body.busy,
    };
    await writePawn(sql, userId, data.pawn, body);
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [WORLD_ID, userId, data.kind, t.x, t.y, JSON.stringify({ k: liveJob?.kind ?? nextJob?.kind, gold: liveJob?.gold ?? nextJob?.gold })],
    );
    await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written, credit: merged.credit, gold, inventory: inv };
  });

export const writeBagDeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.string(),
        tile: tileInSchema,
        pawn: pawnInSchema,
        item: z.string().optional(),
        qty: z.number().optional(),
        craft: z.string().optional(),
        need: z.record(z.string(), z.number()).optional(),
        job: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const userId = context.userId;
    if (!isBagKind(data.kind)) {
      return { ok: false as const, hint: "нет такого дела", conflicts: [] as TilePacket[], written: [], credit: 0, gold: 0, inventory: startInv() };
    }
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
    const emptyFail = (hint: string, gold = 0, inventory = startInv()) => ({
      ok: false as const,
      hint,
      conflicts: [] as TilePacket[],
      written: [] as { x: number; y: number; ver: number }[],
      credit: 0,
      gold,
      inventory,
    });
    const bagSoft =
      data.kind === "eat" ||
      data.kind === "spend" ||
      data.kind === "job" ||
      data.kind === "grant" ||
      data.kind === "yard" ||
      data.kind === "sleep" ||
      data.kind === "drink" ||
      data.kind === "pail" ||
      data.kind === "sip" ||
      data.kind === "cook" ||
      data.kind === "tonic";
    const takesCell =
      data.kind === "gather" ||
      data.kind === "dig" ||
      data.kind === "hunt" ||
      data.kind === "fish" ||
      data.kind === "pickup" ||
      data.kind === "chest-take" ||
      data.kind === "craft" ||
      data.kind === "scrap";
    if (!cur) return emptyFail(takesCell ? CELL_GONE : "клетка уже другая");
    if (cur.ver !== t.ver && !bagSoft) {
      return {
        ok: false as const,
        hint: takesCell ? CELL_GONE : "клетка уже другая",
        conflicts: asConflict(),
        written: [],
        credit: 0,
        gold: 0,
        inventory: startInv(),
      };
    }
    const reach = Math.max(Math.abs(data.pawn.x - t.x), Math.abs(data.pawn.y - t.y));
    if (!bagSoft && reach > 1) {
      return emptyFail("подойди");
    }
    const liveSlim = asSlim(cur.slim);
    const live = fatTile(liveSlim, t.x, t.y);
    const merged = await mergeBookBody(sql, userId, data.pawn);
    const ride = transportOf(merged.body);
    const bag0 = merged.inventory;
    const gold0 = merged.gold;
    let inv = bag0;
    let gold = gold0;
    let resting = !!merged.body.resting;
    let energyAt = merged.body.energyAt;
    const flesh0 = fleshOf(merged.body);
    let satiety = flesh0.satiety;
    let warmth = flesh0.warmth;
    let water = flesh0.water;
    let pail = flesh0.pail;
    let sipTick = flesh0.sipTick;
    let hp = vigorOf(merged.body).hp;
    const written: { x: number; y: number; ver: number }[] = [];
    const clock = asClock(await readWorld(sql));
    const night = clock.phase === "night";

    const bump = async (tile: Tile, ver: number, minN = 0) => {
      const slim = slimTile(tile);
      const extra = minN > 0 ? "and coalesce((t.slim->>'n')::int, 0) >= $7" : "";
      const params: unknown[] = [WORLD_ID, tile.x, tile.y, ver, JSON.stringify(slim), userId];
      if (minN > 0) params.push(minN);
      const upd = await sql.query<{ ver: number }>(
        `update tile t
         set slim = ${keepSlimKeys("$5::jsonb", ["or", "sv", "vg"])},
             ver = t.ver + 1, updated_at = now(), updated_by = $6
         where t.world_id = $1 and t.x = $2 and t.y = $3 and t.ver = $4
           ${extra}
         returning ver`,
        params,
      );
      return upd[0]?.ver ?? null;
    };

    const failCell = async (hint: string) => {
      const rows = await sql.query<TileRow>(
        `select x, y, slim, ver, updated_at::text as updated_at from tile where world_id = $1 and x = $2 and y = $3`,
        [WORLD_ID, t.x, t.y],
      );
      const now = rows[0];
      const conflicts = now
        ? [{ x: now.x, y: now.y, slim: asSlim(now.slim), ver: now.ver, updatedAt: now.updated_at }]
        : [];
      return {
        ok: false as const,
        hint,
        conflicts,
        written: [] as { x: number; y: number; ver: number }[],
        credit: 0,
        gold: gold0,
        inventory: bag0,
      };
    };
    const lost = () => failCell(CELL_GONE);

    const spill = (item: ItemId, n: number) => {
      const g = giveOrSpill(inv, ride, item, n);
      inv = g.inv;
      if (g.spill > 0) pileAdd(live, item, g.spill);
      return g.spill;
    };

    if (data.kind === "eat") {
      const item = data.item ?? "";
      if (!isItemId(item)) return emptyFail("Еды нет.", gold, inv);
      const plan = planEat(inv, item);
      if (!plan.ok) return emptyFail(plan.hint, gold, inv);
      inv = plan.inv;
      satiety = Math.min(100, satiety + eatSatiety(item, merged.body.profession));
    } else if (data.kind === "spend") {
      const rawNeed = data.need ?? {};
      const need: Partial<Record<ItemId, number>> = {};
      for (const [k, n0] of Object.entries(rawNeed)) {
        if (!isItemId(k)) continue;
        const n = Math.max(0, Math.floor(n0 ?? 0));
        if (n > 0) need[k] = n;
      }
      if (!Object.keys(need).length) {
        const item = data.item ?? "";
        const qty = Math.max(0, Math.floor(data.qty ?? 1));
        if (!isItemId(item) || qty < 1) return emptyFail("нечего списать", gold, inv);
        need[item] = qty;
      }
      const paid = takeBag(inv, need);
      if (!paid.ok) return emptyFail(paid.hint, gold, inv);
      inv = paid.inv;
    } else if (data.kind === "gather") {
      const plan = planGather(live, { profession: merged.body.profession, hand: merged.body.hand }, night);
      if (!plan.ok) return lost();
      live.amount -= plan.got;
      if (live.amount <= 0) markDepleted(live);
      else if (plan.item === "herb") live.regen = Math.max(live.regen ?? 0, REGROW_WAIT.herb ?? 2);
      spill(plan.item, plan.got);
      const ver = await bump(live, t.ver, plan.got);
      if (ver == null) return lost();
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "dig") {
      const plan = planDig(live, merged.body.hand);
      if (!plan.ok) return live.pit || plan.hint === CELL_GONE ? lost() : emptyFail(plan.hint, gold, inv);
      const wasBank = !!live.bank;
      live.pit = true;
      live.bank = false;
      live.regen = PIT_HEAL_WEEKS;
      spill(plan.item, plan.got);
      if (!wasBank && Math.random() < 0.08) spill("ore", 1);
      const ver = await bump(live, t.ver);
      if (ver == null) return lost();
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "hunt") {
      if (!live.herd || !live.herd.wild || (live.herd.kind !== "hare" && live.herd.kind !== "deer")) {
        return lost();
      }
      const spear = merged.body.hand === "spear";
      const chance = spear ? 0.85 : merged.body.hand === "axe" ? 0.55 : 0.35;
      if (Math.random() > chance) {
        live.herd.count -= Math.random() < 0.4 ? 1 : 0;
        if (live.herd.count <= 0) live.herd = null;
      } else {
        const take = huntTake(merged.body.hand, merged.body.profession);
        live.herd.count -= 1;
        if (live.herd.count <= 0) live.herd = null;
        spill("food", take.food);
        if (take.hide > 0) spill("hide", take.hide);
      }
      const ver = await bump(live, t.ver);
      if (ver == null) return lost();
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "fish") {
      const hasRod = merged.body.hand === "rod";
      const net = live.building === "net";
      if (!hasRod && !net) return emptyFail("Нужна удочка в руке.", gold, inv);
      const stock = live.resource === "fish" ? live.amount : Math.max(0, 6 - (live.takings ?? 0));
      if (stock <= 0) return lost();
      const fisher = merged.body.profession === "fisher";
      let got = 1;
      if (hasRod) got += 1;
      if ((merged.body.skills?.survival ?? 0) >= 3 || fisher) got += 1;
      if (merged.body.hand === "spear") got = Math.max(1, got - 1);
      got = Math.min(3, stock, got);
      live.takings = (live.takings ?? 0) + 1;
      if (live.resource === "fish") live.amount = Math.max(0, live.amount - got);
      spill("fish", got);
      const ver = await bump(live, t.ver, live.resource === "fish" ? got : 0);
      if (ver == null) return lost();
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "pickup") {
      const pile = asPile(live.pile);
      if (pileEmpty(pile) && (live.goldDrop ?? 0) <= 0) return lost();
      pileSet(live, {});
      for (const [k, n] of Object.entries(pile) as [ItemId, number][]) {
        if (n > 0) spill(k, n);
      }
      gold += live.goldDrop ?? 0;
      live.goldDrop = 0;
      const ver = await bump(live, t.ver);
      if (ver == null) return lost();
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "drop") {
      const item = data.item ?? "";
      const qty = Math.max(0, Math.floor(data.qty ?? 1));
      if (!isItemId(item) || qty < 1) return emptyFail("Нечего выкладывать.", gold, inv);
      const n = Math.min(qty, inv[item] ?? 0);
      if (n < 1) return emptyFail("Нечего выкладывать.", gold, inv);
      const paid = takeBag(inv, { [item]: n });
      if (!paid.ok) return emptyFail(paid.hint, gold, inv);
      inv = paid.inv;
      pileAdd(live, item, n);
      const ver = await bump(live, t.ver);
      if (ver == null) return failCell("клетка уже другая");
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "chest-put" || data.kind === "chest-take") {
      const mine = !live.owner || live.owner === userId || live.owner === "you";
      const house = live.building === "shack" || live.building === "house" || live.building === "shed";
      if (!house && !live.owned) return emptyFail("нет сундука", gold, inv);
      if (!mine) return emptyFail("чужой двор", gold, inv);
      if (live.chestLock && live.owner && live.owner !== userId && live.owner !== "you") {
        return emptyFail("замок", gold, inv);
      }
      const item = data.item ?? "";
      const qty = Math.max(0, Math.floor(data.qty ?? 1));
      if (!isItemId(item) || qty < 1) return emptyFail("пусто", gold, inv);
      if (data.kind === "chest-put") {
        const n = Math.min(qty, inv[item] ?? 0);
        if (n < 1) return emptyFail("Нечего класть.", gold, inv);
        const paid = takeBag(inv, { [item]: n });
        if (!paid.ok) return emptyFail(paid.hint, gold, inv);
        inv = paid.inv;
        live.chest = { ...live.chest, [item]: (live.chest[item] ?? 0) + n };
      } else {
        const n = Math.min(qty, live.chest[item] ?? 0);
        if (n < 1) return lost();
        live.chest = { ...live.chest, [item]: Math.max(0, (live.chest[item] ?? 0) - n) };
        spill(item, n);
      }
      const ver = await bump(live, t.ver);
      if (ver == null) return lost();
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "craft") {
      const id = data.craft ?? "";
      const def = craftDefOf(id);
      if (!def) return emptyFail("Ремесло сорвалось.", gold, inv);
      if (!canCraftHere(def.id, merged.body.profession, live)) {
        return emptyFail("не здесь", gold, inv);
      }
      const nearRows = await sql.query<TileRow>(
        `select x, y, slim, ver, updated_at::text as updated_at
         from tile where world_id = $1
           and greatest(abs(x - $2), abs(y - $3)) <= $4`,
        [WORLD_ID, t.x, t.y, SHED_REACH],
      );
      const fats = nearRows.map((r) => fatTile(asSlim(r.slim), r.x, r.y));
      const world = asMiniWorld(fats);
      const station = world.tiles[t.y * world.width + t.x] ?? live;
      const pulled = pullNeed(world, inv, station, def.need);
      if (!pulled.ok) return emptyFail(pulled.hint, gold, inv);
      applyNeedPull(world, station, pulled);
      inv = pulled.inv;
      const g = giveOrSpill(inv, ride, def.out, def.n);
      inv = g.inv;
      if (g.spill > 0) pileAdd(station, def.out, g.spill);
      const stationVer = await bump(station, t.ver);
      if (stationVer == null) return lost();
      written.push({ x: t.x, y: t.y, ver: stationVer });
      for (const sh of pulled.sheds) {
        const row = nearRows.find((r) => r.x === sh.x && r.y === sh.y);
        if (!row) return lost();
        const shed = world.tiles[sh.y * world.width + sh.x];
        if (!shed) return lost();
        pileSet(shed, sh.pile);
        const ver = await bump(shed, row.ver);
        if (ver == null) return lost();
        written.push({ x: sh.x, y: sh.y, ver });
      }
    } else if (data.kind === "job") {
      if (!live.caravan) return emptyFail("Заказ закрывают в лавке на тракте.", gold, inv);
      if (reach > 1) return emptyFail("подойди", gold, inv);
      const id = (data.job ?? "").trim();
      const job = makeJobs(clock.week).find((j) => j.id === id);
      if (!job) return emptyFail("заказа нет", gold, inv);
      const paid = takeBag(inv, { [job.item]: job.need });
      if (!paid.ok) return emptyFail(paid.hint, gold, inv);
      inv = paid.inv;
      gold += job.pay;
    } else if (data.kind === "grant") {
      spill("wood", GRANT_WOOD);
    } else if (data.kind === "yard") {
      if (!live.plot) return emptyFail("Здесь нет двора.", gold, inv);
      if (live.owner && live.owner !== userId) return emptyFail("чужой двор", gold, inv);
      const nearRows = await sql.query<TileRow>(
        `select x, y, slim, ver, updated_at::text as updated_at
         from tile where world_id = $1
           and greatest(abs(x - $2), abs(y - $3)) <= $4`,
        [WORLD_ID, t.x, t.y, MAX_PLOT],
      );
      const fats = nearRows.map((r) => fatTile(asSlim(r.slim), r.x, r.y));
      const world = asMiniWorld(fats);
      const b = plotBounds(world, t.x, t.y);
      if (!b) return emptyFail("Здесь нет двора.", gold, inv);
      const refund = Math.floor(yardWoodCost(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) / 2);
      if (refund > 0) spill("wood", refund);
    } else if (data.kind === "sleep") {
      const next = !resting;
      if (next && !roofOfSlim(liveSlim, merged.body.profession)) {
        return emptyFail("нужен шалаш", gold, inv);
      }
      resting = next;
      energyAt = Date.now();
    } else if (data.kind === "drink") {
      if (reach > 1) return emptyFail("подойди", gold, inv);
      if (!isDrinkTile(live)) return emptyFail("нет воды", gold, inv);
      if (water >= 100) return emptyFail("Уже полный.", gold, inv);
      water = 100;
      sipTick = clock.clock;
    } else if (data.kind === "pail") {
      if (reach > 1) return emptyFail("подойди", gold, inv);
      if ((inv.bucket ?? 0) <= 0) return emptyFail("Нужно ведро в ноше.", gold, inv);
      if (!isDrinkTile(live)) return emptyFail("нет воды", gold, inv);
      pail = PAIL_FULL;
    } else if (data.kind === "sip") {
      if (pail <= 0) return emptyFail("Ведро пустое. Набери у реки.", gold, inv);
      if (water >= 100) return emptyFail("Уже полный.", gold, inv);
      pail -= 1;
      water = Math.min(100, water + SIP_WATER);
    } else if (data.kind === "pour") {
      if (pail <= 0) return emptyFail("Ведро пустое. Набери у реки.", gold, inv);
      pail -= 1;
      live.cistern = Math.min(CISTERN_CAP, (live.cistern ?? 0) + CISTERN_POUR);
      const ver = await bump(live, t.ver);
      if (ver == null) return { ok: false as const, hint: "клетка уже другая", conflicts: asConflict(), written: [], credit: 0, gold, inventory: inv };
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "cook") {
      if (reach > 1) return emptyFail("подойди", gold, inv);
      const house = live.building === "shack" || live.building === "house" || live.building === "camp";
      if (!house || live.burned) return emptyFail("нет огня", gold, inv);
      const plan = planCook(inv);
      if (!plan.ok) return emptyFail(plan.hint, gold, inv);
      inv = plan.inv;
      satiety = Math.min(100, satiety + plan.gain);
    } else if (data.kind === "tonic") {
      const plan = planTonic(inv, hp);
      if (!plan.ok) return emptyFail(plan.hint, gold, inv);
      inv = plan.inv;
      hp = plan.hp;
    } else if (data.kind === "scrap") {
      const plan = planScrap(live, userId);
      if (!plan.ok) return plan.hint === CELL_GONE ? lost() : emptyFail(plan.hint, gold, inv);
      dumpAllOn(live, live.chest ?? zeroInv());
      live.chest = zeroInv();
      if (plan.mode === "burn") {
        if (plan.coal > 0) spill("coal", plan.coal);
      } else {
        for (const [k, n] of Object.entries(plan.refund) as [ItemId, number][]) {
          if (n > 0) spill(k, n);
        }
      }
      live.building = "none";
      live.burned = false;
      live.hp = 0;
      const ver = await bump(live, t.ver);
      if (ver == null) return lost();
      written.push({ x: t.x, y: t.y, ver });
    } else if (data.kind === "steal") {
      return emptyFail("кража — делом вреда", gold, inv);
    } else {
      return emptyFail("нет такого дела", gold, inv);
    }

    const body = {
      ...merged.body,
      gold,
      due: 0,
      inventory: inv,
      resting,
      energyAt,
      satiety,
      warmth,
      water,
      pail,
      sipTick,
      hp,
    };
    await writePawn(sql, userId, data.pawn, body);
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [WORLD_ID, userId, `bag-${data.kind}`, t.x, t.y, JSON.stringify({ item: data.item, qty: data.qty, craft: data.craft, job: data.job, n: written.length })],
    );
    await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written, credit: merged.credit, gold, inventory: inv, ...vigorOut(body), ...fleshOut(body) };
  });

export const writeVillageDeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["village-found", "village-join", "village-leave"]),
        name: z.string(),
        tiles: z.array(tileInSchema),
        pawn: pawnInSchema,
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const userId = context.userId;
    const name = data.name.trim().replace(/\s+/g, " ").slice(0, 24);
    if (data.kind !== "village-leave" && !name) {
      return { ok: false as const, hint: "имя словом", conflicts: [] as TilePacket[], written: [], credit: 0 };
    }
    if (data.tiles.length > 200) {
      return { ok: false as const, hint: "слишком широко", conflicts: [] as TilePacket[], written: [], credit: 0 };
    }
    if (!data.tiles.length) {
      const merged = await mergeBookBody(sql, userId, data.pawn);
      await writePawn(sql, userId, data.pawn, merged.body);
      return { ok: true as const, written: [] as { x: number; y: number; ver: number }[], credit: merged.credit, gold: merged.gold, inventory: merged.inventory };
    }
    const keys = JSON.stringify(data.tiles.map((t) => ({ x: t.x, y: t.y })));
    const curRows = await sql.query<TileRow>(
      `select x, y, slim, ver, updated_at::text as updated_at
       from tile
       where world_id = $1
         and (x, y) in (select * from jsonb_to_recordset($2::jsonb) as p(x int, y int))`,
      [WORLD_ID, keys],
    );
    const byKey = new Map(curRows.map((r) => [`${r.x},${r.y}`, r]));
    for (const t of data.tiles) {
      const cur = byKey.get(`${t.x},${t.y}`);
      if (!cur) {
        return { ok: false as const, hint: "клетка уже другая", conflicts: [] as TilePacket[], written: [], credit: 0 };
      }
      const live = asSlim(cur.slim);
      const on = live.on || "";
      if (live.pt) {
        if (on === userId) continue;
        if (data.kind !== "village-leave" && isHamletOwner(on)) continue;
        return { ok: false as const, hint: "чужой двор", conflicts: [] as TilePacket[], written: [], credit: 0 };
      }
    }
    if (data.kind === "village-found") {
      const hamletPath = data.tiles.some((t) => t.slim.pt && isHamletOwner(t.slim.on || ""));
      if (!hamletPath) {
        const neighbor = await sql.query<{ on: string }>(
          `select other.slim->>'on' as on
           from tile mine
           join tile other
             on other.world_id = mine.world_id
            and other.slim ? 'pt'
            and other.slim->>'on' is not null
            and other.slim->>'on' is distinct from $2
            and greatest(abs(mine.x - other.x), abs(mine.y - other.y)) <= 2
           where mine.world_id = $1
             and mine.slim ? 'pt'
             and mine.slim->>'on' = $2`,
          [WORLD_ID, userId],
        );
        if (!neighbor.some((r) => r.on && isLivingOwner(r.on))) {
          return {
            ok: false as const,
            hint: "нужен второй двор рядом или 4 друга хуторов",
            conflicts: [] as TilePacket[],
            written: [],
            credit: 0,
          };
        }
      }
    }
    if (data.kind === "village-join") {
      const near = await sql.query<{ ok: number }>(
        `select 1 as ok
         from tile mine
         join tile named
           on named.world_id = mine.world_id
          and named.slim->>'vg' = $3
          and greatest(abs(mine.x - named.x), abs(mine.y - named.y)) <= 2
         where mine.world_id = $1
           and mine.slim ? 'pt'
           and mine.slim->>'on' = $2
         limit 1`,
        [WORLD_ID, userId, name],
      );
      if (!near[0]) {
        return { ok: false as const, hint: "двор не касается этого имени", conflicts: [] as TilePacket[], written: [], credit: 0 };
      }
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
      [WORLD_ID, incoming, userId],
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
    if (data.kind === "village-leave" && name) {
      const left = await sql.query<{ on: string | null; pt: string | null }>(
        `select slim->>'on' as on, slim->>'pt' as pt from tile where world_id = $1 and slim->>'vg' = $2`,
        [WORLD_ID, name],
      );
      const otherLive = left.some((r) => r.pt && r.on && isLivingOwner(r.on) && r.on !== userId);
      const hamlets = left.some((r) => r.pt && r.on && isHamletOwner(r.on));
      if (!otherLive && !hamlets) {
        await sql.query(
          `update tile
           set slim = slim - 'vg', ver = ver + 1, updated_at = now(), updated_by = $3
           where world_id = $1 and slim->>'vg' = $2`,
          [WORLD_ID, name, userId],
        );
      }
    }
    const origin = data.tiles[0];
    await sql.query(
      `insert into deed (world_id, user_id, kind, x, y, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        WORLD_ID,
        userId,
        data.kind,
        origin?.x ?? data.pawn.x,
        origin?.y ?? data.pawn.y,
        JSON.stringify({ name, n: data.tiles.length }),
      ],
    );
    const merged = await mergeBookBody(sql, userId, data.pawn);
    await writePawn(sql, userId, data.pawn, merged.body);
    await imprintSpot(sql, userId, data.pawn.x, data.pawn.y);
    return { ok: true as const, written, credit: merged.credit, gold: merged.gold, inventory: merged.inventory };
  });

export const readStreetNotices = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => z.object({ x: z.number(), y: z.number() }).parse(d))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const boardRows = await sql.query<TileRow>(
      `select x, y, slim, ver, updated_at::text as updated_at from tile where world_id = $1 and x = $2 and y = $3`,
      [WORLD_ID, data.x, data.y],
    );
    const board = boardRows[0];
    if (!board) return { name: "", live: [] as TilePacket[] };
    const slim = asSlim(board.slim);
    if (slim.bd !== "board") return { name: "", live: [] as TilePacket[] };
    if (slim.br) return { name: (slim.vg || "").trim(), live: [] as TilePacket[] };
    const name = (slim.vg || "").trim();
    const owner = (slim.on || "").trim();
    if (!name && !owner) return { name: "", live: [] as TilePacket[] };
    const rows = await sql.query<TileRow>(
      `select x, y, slim, ver, updated_at::text as updated_at
       from tile
       where world_id = $1
         and (slim ? 'or' or slim ? 'sv')
         and (
           ($2 <> '' and slim->>'vg' = $2)
           or ($3 <> '' and (slim->>'on' = $3 or slim->'sv'->>'by' = $3))
         )
         and not (x = $4 and y = $5)
       limit 40`,
      [WORLD_ID, name, owner, data.x, data.y],
    );
    const live: TilePacket[] = rows.map((r) => ({
      x: r.x,
      y: r.y,
      slim: asSlim(r.slim),
      ver: r.ver,
      updatedAt: r.updated_at,
    }));
    return { name, live };
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
    const dmg = Math.max(1, Math.min(STRIKE_CAP, Math.round(data.dmg)));
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

