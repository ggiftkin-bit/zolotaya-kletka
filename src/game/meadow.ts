import { DAYS_PER_WEEK, MAP_H, MAP_W, TICKS_PER_DAY } from "./constants";
import { pileAdd } from "./pile";
import type { SlimTile } from "./save";
import type { RoadJob, Tile, World } from "./types";

export const PEACE_HINT = "здесь мир";
export const BOARD_CAP = 2;
export const BOARD_CAP_HINT = "хватит столбов";
export const MARKET_RENT = 8;
export const MARKET_RENT_TICKS = TICKS_PER_DAY * DAYS_PER_WEEK;
export const STALL_HERE_HINT = "Прилавок — у калитки или на клетке рынка.";
export const STALL_ONE_HINT = "С одной почты один рыночный прилавок.";
export const STALL_RENT_HINT = "Аренда рынка — 8 золота за неделю.";
export const HALL_HINT = "Зал не ставят и не жгут.";
export const ROAD_GOLD_CAP = 80;
export const ROAD_TAKEN_HINT = "уже взяли";
export const ROAD_STAFF_HINT = "Заказ — у зала, метка книги.";
export const ROAD_EMPTY_HINT = "Пусто — не висит.";
export const ROAD_LINE_HINT = "Река или чужой двор — линия не встаёт.";
export const ROAD_GOLD_WORDS = [8, 16, 20, 40, 80] as const;
export const ROAD_DAYS = [1, 3, 6] as const;

export function isMeadow(tile: Tile | null | undefined): boolean {
  return !!tile && !!tile.commons && !tile.caravan && !tile.plot;
}

/** Поляна и лавка тракта. Двор за тыном — как был. */
export function isPeace(tile: Tile | null | undefined): boolean {
  if (!tile || tile.plot) return false;
  return !!(tile.commons || tile.caravan);
}

export function isPeaceSlim(slim: SlimTile | null | undefined): boolean {
  if (!slim || slim.pt) return false;
  return !!(slim.co || slim.cv);
}

export function hallPos(): { x: number; y: number } {
  return { x: (MAP_W / 2) | 0, y: (MAP_H / 2) | 0 };
}

export function marketSpots(at: { x: number; y: number } = hallPos()): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      out.push({ x: at.x + dx, y: at.y + dy });
    }
  }
  return out;
}

function tileAt(world: World, x: number, y: number): Tile | null {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  return world.tiles[y * world.width + x] ?? null;
}

export function stampHallMarket(world: World) {
  let hall = world.tiles.find((t) => t.building === "hall");
  if (!hall) {
    const spawn = hallPos();
    const at = tileAt(world, spawn.x, spawn.y);
    const free =
      at && at.building === "none" && at.commons && !at.caravan && !at.plot
        ? at
        : world.tiles.find((t) => t.commons && !t.caravan && !t.plot && t.building === "none" && !t.pit);
    if (free) {
      free.building = "hall";
      free.matter = "stone";
      free.hp = 40;
      free.burned = false;
      free.resource = null;
      free.amount = 0;
      hall = free;
    }
  }
  if (!hall) return;
  for (const p of marketSpots(hall)) {
    const t = tileAt(world, p.x, p.y);
    if (!t || t.building === "hall" || t.caravan || t.plot || t.biome === "river") continue;
    t.market = true;
    if (t.commons && t.resource === "herb") {
      t.resource = null;
      t.amount = 0;
    }
  }
}

export function keepCivicSlim(live: SlimTile, incoming: SlimTile): SlimTile {
  const next = { ...incoming };
  if (live.bd === "hall") {
    next.bd = "hall";
    delete next.br;
    if (live.rj && !next.rj) next.rj = live.rj;
  }
  if (live.mr) next.mr = 1;
  if (typeof live.ru === "number" && next.bd === "stall" && next.ru == null) next.ru = live.ru;
  return next;
}

export function civicWriteHint(live: SlimTile, incoming: SlimTile): string | null {
  if (incoming.bd === "hall" && live.bd !== "hall") return HALL_HINT;
  if (live.bd === "hall" && incoming.br) return HALL_HINT;
  if (incoming.br && !live.br && isPeaceSlim(live)) return PEACE_HINT;
  return null;
}

export function canPlaceMarketStall(tile: Tile): boolean {
  return !!tile.market && tile.building === "none" && !tile.burned && !tile.caravan;
}

export function liveBoardCount(world: World, who: string): number {
  let n = 0;
  for (const t of world.tiles) {
    if (t.building === "board" && !t.burned && (t.owner === who || t.owner === "you")) n += 1;
  }
  return n;
}

export function liveMarketStall(world: World, who: string): Tile | null {
  for (const t of world.tiles) {
    if (t.market && t.building === "stall" && (t.owner === who || t.owner === "you")) return t;
  }
  return null;
}

export function expireMarketTile(tile: Tile, clock: number): boolean {
  if (!tile.market || tile.building !== "stall") return false;
  const until = tile.rentUntil ?? 0;
  if (until > clock) return false;
  if (tile.order && tile.order.n > 0) pileAdd(tile, tile.order.item, tile.order.n);
  tile.order = null;
  tile.building = "none";
  tile.owner = "";
  tile.rentUntil = 0;
  tile.burned = false;
  return true;
}

function inBounds(world: World, x: number, y: number) {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

function lineRun(ax: number, ay: number, bx: number, by: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  let x = ax;
  let y = ay;
  out.push({ x, y });
  while (x !== bx || y !== by) {
    if (x !== bx) x += dx;
    else y += dy;
    out.push({ x, y });
    if (out.length > 96) break;
  }
  return out;
}

function elbow(ax: number, ay: number, bx: number, by: number, viaX: boolean): Array<{ x: number; y: number }> {
  if (ax === bx || ay === by) return lineRun(ax, ay, bx, by);
  const mx = viaX ? bx : ax;
  const my = viaX ? ay : by;
  const a = lineRun(ax, ay, mx, my);
  const b = lineRun(mx, my, bx, by);
  return a.concat(b.slice(1));
}

function lineBlocked(world: World, cells: Array<{ x: number; y: number }>): boolean {
  for (const c of cells) {
    if (!inBounds(world, c.x, c.y)) return true;
    const t = tileAt(world, c.x, c.y);
    if (!t) return true;
    if (t.biome === "river" && t.road !== "bridge") return true;
    if (t.plot && t.owner && t.owner !== "you") return true;
  }
  return false;
}

export function collectElbows(ax: number, ay: number, bx: number, by: number): Array<{ x: number; y: number }> {
  const seen = new Set<string>();
  const out: Array<{ x: number; y: number }> = [];
  for (const c of elbow(ax, ay, bx, by, true).concat(elbow(ax, ay, bx, by, false))) {
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export function planRoadLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { ok: true; cells: Array<{ x: number; y: number }> } | { ok: false; hint: string } {
  if (ax === bx && ay === by) return { ok: false, hint: ROAD_LINE_HINT };
  const a = elbow(ax, ay, bx, by, true);
  const b = elbow(ax, ay, bx, by, false);
  if (!lineBlocked(world, a)) return { ok: true, cells: a };
  if (a !== b && !lineBlocked(world, b)) return { ok: true, cells: b };
  return { ok: false, hint: ROAD_LINE_HINT };
}

export function roadLineDone(world: World, cells: Array<{ x: number; y: number }>): boolean {
  if (!cells.length) return false;
  for (const c of cells) {
    const t = tileAt(world, c.x, c.y);
    if (!t || t.road === "none") return false;
  }
  return true;
}

export function roadJobOf(tile: Tile | null | undefined): RoadJob | null {
  return tile?.roadJob ?? null;
}

export function settleRoadJob(
  world: World,
  hall: Tile,
  clock: number,
): { pay?: { who: string; gold: number }; changed: boolean } {
  const job = hall.roadJob;
  if (!job) return { changed: false };
  const line = planRoadLine(world, job.ax, job.ay, job.bx, job.by);
  if (!line.ok) return { changed: false };
  if (job.take && roadLineDone(world, line.cells)) {
    const pay = { who: job.take, gold: job.gold };
    hall.roadJob = null;
    return { pay, changed: true };
  }
  if (job.take && job.until > 0 && clock >= job.until) {
    hall.roadJob = { ...job, take: undefined, until: 0 };
    return { changed: true };
  }
  return { changed: false };
}
