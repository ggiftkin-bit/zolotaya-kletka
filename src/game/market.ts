import { ITEM_LABEL, ITEMS } from "./constants";
import { BUILD_COST, BUILDING_LABEL, goldTxt } from "./economy";
import { CRAFTS, atBench, type CraftKind } from "./craft";
import { asPile, giveOrPile, pileSet, pullNeed, type Pile } from "./pile";
import { FOG_LIVE, chebyshev } from "./book";
import type { BuildingKind, Character, Inventory, ItemId, ServiceJob, ServiceKind, Tile, Transport, World } from "./types";

/** One lot on a stall. Item sits on the tile (escrow), not in the air. */
export type StallOrder = {
  item: ItemId;
  n: number;
  gold: number;
};

export const STALL_PRICES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20] as const;

export const SERVICE_GOLD = [2, 4, 8, 12] as const;
/** Постой: стоять 15 / 30 / 60 мин стены. Не срок вывески. */
export const SERVICE_DO = [15 * 60, 30 * 60, 60 * 60] as const;
/** Отвези: Busy пока не дошёл. Стена не срывает. */
const HAUL_BUSY_MS = 24 * 60 * 60 * 1000;

export const SERVICE_LABEL: Record<ServiceKind, string> = {
  watch: "постой",
  haul: "отвези",
  build: "построй",
  craft: "сделай",
};

export function isItemId(v: string): v is ItemId {
  return (ITEMS as string[]).includes(v);
}

export function stallOrderOf(tile: Tile | null | undefined): StallOrder | null {
  if (!tile?.order) return null;
  if (!isItemId(tile.order.item) || tile.order.n <= 0 || tile.order.gold <= 0) return null;
  return tile.order;
}

export function stallLine(order: StallOrder): string {
  const n = order.n > 1 ? ` ×${order.n}` : "";
  return `${ITEM_LABEL[order.item]}${n} · ${goldTxt(order.gold)}`;
}

export function canReachStall(px: number, py: number, tile: Tile): boolean {
  return chebyshev(px, py, tile.x, tile.y) <= 1;
}

export function planPut(
  tile: Tile,
  inv: Inventory,
  item: ItemId,
  gold: number,
): { ok: true; order: StallOrder; inv: Inventory } | { ok: false; hint: string } {
  if (tile.building !== "stall") return { ok: false, hint: "Это не прилавок." };
  if (tile.burned) return { ok: false, hint: "Сгорел." };
  if (stallOrderOf(tile)) return { ok: false, hint: "Сначала сними свой ордер." };
  if (!isItemId(item)) return { ok: false, hint: "Этого на прилавок не кладут." };
  const n = 1;
  if ((inv[item] ?? 0) < n) return { ok: false, hint: "Нет в сумке." };
  const pay = Math.floor(gold);
  if (pay < 1) return { ok: false, hint: "Цена словом: хотя бы 1 золото." };
  return {
    ok: true,
    order: { item, n, gold: pay },
    inv: { ...inv, [item]: inv[item] - n },
  };
}

export function planDrop(
  tile: Tile,
  inv: Inventory,
  transport: Transport,
  extraKg = 0,
): { ok: true; inv: Inventory; piled: number; order: StallOrder } | { ok: false; hint: string } {
  if (tile.building !== "stall") return { ok: false, hint: "Это не прилавок." };
  const order = stallOrderOf(tile);
  if (!order) return { ok: false, hint: "Пусто." };
  const given = giveOrPile({ ...inv }, transport, tile, order.item, order.n, extraKg);
  return { ok: true, inv: given.inv, piled: given.piled, order };
}

export function planTake(
  tile: Tile,
  gold: number,
  inv: Inventory,
  transport: Transport,
  extraKg = 0,
): { ok: true; inv: Inventory; gold: number; pay: number; piled: number; order: StallOrder } | { ok: false; hint: string } {
  if (tile.building !== "stall") return { ok: false, hint: "Это не прилавок." };
  if (tile.burned) return { ok: false, hint: "Сгорел." };
  const order = stallOrderOf(tile);
  if (!order) return { ok: false, hint: "Пусто." };
  if (gold < order.gold) return { ok: false, hint: `Нужно ${goldTxt(order.gold)}, есть ${goldTxt(gold)}.` };
  const given = giveOrPile({ ...inv }, transport, tile, order.item, order.n, extraKg);
  return {
    ok: true,
    inv: given.inv,
    gold: gold - order.gold,
    pay: order.gold,
    piled: given.piled,
    order,
  };
}

export function bagGoods(c: Character): ItemId[] {
  return ITEMS.filter((k) => (c.inventory[k] ?? 0) > 0);
}

export function isGateTile(tile: Tile): boolean {
  return tile.fenceN === "gate" || tile.fenceW === "gate";
}

export function isCraftStation(tile: Tile): boolean {
  const b = tile.building;
  return b === "bench" || b === "workshop" || b === "forge" || b === "oven" || b === "smoke" || b === "herbs" || b === "coalpit";
}

export function serviceJobOf(tile: Tile | null | undefined): ServiceJob | null {
  const j = tile?.service;
  if (!j) return null;
  if (j.kind !== "watch" && j.kind !== "haul" && j.kind !== "build" && j.kind !== "craft") return null;
  if (j.gold <= 0 || !j.by) return null;
  return j;
}

export function isMineService(job: ServiceJob): boolean {
  return job.by === "you";
}

export function serviceLine(job: ServiceJob, now = Date.now()): string {
  const who = job.take ? (job.take === "you" ? " · твоё дело" : " · взяли") : "";
  let when = "";
  if (!job.take) {
    if (job.kind === "watch" && job.doSec) when = ` · ${Math.round(job.doSec / 60)} мин`;
  } else if (job.until > now) {
    const sec = Math.ceil((job.until - now) / 1000);
    when = ` · ${sec >= 60 ? `${Math.ceil(sec / 60)} мин` : `${sec} с`}`;
  }
  if (job.kind === "haul" && job.item) {
    return `${SERVICE_LABEL.haul} ${ITEM_LABEL[job.item]}${job.n && job.n > 1 ? ` ×${job.n}` : ""} · ${goldTxt(job.gold)}${when}${who}`;
  }
  if (job.kind === "craft") {
    const def = CRAFTS.find((d) => d.id === job.craft);
    return `${SERVICE_LABEL.craft} ${def?.label ?? "ремесло"} · ${goldTxt(job.gold)}${when}${who}`;
  }
  if (job.kind === "build" && job.build) {
    return `${SERVICE_LABEL.build} ${BUILDING_LABEL[job.build]} · ${goldTxt(job.gold)}${when}${who}`;
  }
  return `${SERVICE_LABEL[job.kind]} · ${goldTxt(job.gold)}${when}${who}`;
}

export function canPostService(tile: Tile, mine: boolean): boolean {
  if (!mine || tile.burned) return false;
  if (isGateTile(tile) || tile.building === "stall") return true;
  if (isCraftStation(tile)) return true;
  if (tile.plot && tile.building === "none") return true;
  return false;
}

export function canSeeService(tile: Tile, mine: boolean): boolean {
  return !!serviceJobOf(tile) || canPostService(tile, mine);
}

function payGold(purse: number, gold: number): { ok: true; gold: number; pay: number } | { ok: false; hint: string } {
  const pay = Math.floor(gold);
  if (pay < 1) return { ok: false, hint: "Цена словом: хотя бы 1 золото." };
  if (purse < pay) return { ok: false, hint: `Нужно ${goldTxt(pay)}, есть ${goldTxt(purse)}.` };
  return { ok: true, gold: purse - pay, pay };
}

export function planPostWatch(
  tile: Tile,
  mine: boolean,
  purse: number,
  gold: number,
  waitSec: number,
  now: number,
): { ok: true; job: ServiceJob; gold: number } | { ok: false; hint: string } {
  if (!mine) return { ok: false, hint: "Свою услугу клади у своей калитки." };
  if (!isGateTile(tile) && tile.building !== "stall") return { ok: false, hint: "Постой — у калитки или прилавка." };
  if (serviceJobOf(tile)) return { ok: false, hint: "Сначала сними услугу." };
  if (!SERVICE_DO.includes(waitSec as (typeof SERVICE_DO)[number])) return { ok: false, hint: "Срок: 15, 30 или 60 мин." };
  const pay = payGold(purse, gold);
  if (!pay.ok) return pay;
  return {
    ok: true,
    gold: pay.gold,
    job: { kind: "watch", gold: pay.pay, until: 0, doSec: waitSec, by: "you", destX: tile.x, destY: tile.y },
  };
}

export function planPostHaul(
  tile: Tile,
  mine: boolean,
  inv: Inventory,
  purse: number,
  item: ItemId,
  gold: number,
  now: number,
): { ok: true; job: ServiceJob; gold: number; inv: Inventory } | { ok: false; hint: string } {
  if (!mine) return { ok: false, hint: "Свою услугу клади у себя." };
  if (!isGateTile(tile) && tile.building !== "stall") return { ok: false, hint: "Отвези — у калитки или прилавка." };
  if (serviceJobOf(tile)) return { ok: false, hint: "Сначала сними услугу." };
  if (!isItemId(item)) return { ok: false, hint: "Этого не везут." };
  if ((inv[item] ?? 0) < 1) return { ok: false, hint: "Нет в сумке." };
  const pay = payGold(purse, gold);
  if (!pay.ok) return pay;
  return {
    ok: true,
    gold: pay.gold,
    inv: { ...inv, [item]: inv[item] - 1 },
    job: {
      kind: "haul",
      gold: pay.pay,
      until: 0,
      by: "you",
      item,
      n: 1,
      destX: tile.x,
      destY: tile.y,
      cargo: { [item]: 1 },
    },
  };
}

export function planPostCraft(
  tile: Tile,
  mine: boolean,
  inv: Inventory,
  purse: number,
  craft: CraftKind,
  gold: number,
  now: number,
  world: World,
): { ok: true; job: ServiceJob; gold: number; inv: Inventory; pile: Pile; sheds: { x: number; y: number; pile: Pile }[] } | { ok: false; hint: string } {
  if (!mine) return { ok: false, hint: "Чужой станок без заказа не запускать." };
  const def = CRAFTS.find((d) => d.id === craft);
  if (!def) return { ok: false, hint: "Нет такого рецепта." };
  if (!atBench(tile, def.bench)) return { ok: false, hint: "Этот рецепт — не на этом станке." };
  if (serviceJobOf(tile)) return { ok: false, hint: "Сначала сними услугу." };
  const pay = payGold(purse, gold);
  if (!pay.ok) return pay;
  const pulled = pullNeed(world, inv, tile, def.need);
  if (!pulled.ok) return pulled;
  return {
    ok: true,
    gold: pay.gold,
    inv: pulled.inv,
    pile: pulled.pile,
    sheds: pulled.sheds,
    job: {
      kind: "craft",
      gold: pay.pay,
      until: 0,
      by: "you",
      craft: def.id,
      item: def.out,
      n: def.n,
      destX: tile.x,
      destY: tile.y,
      cargo: pulled.cargo,
    },
  };
}

export function planPostBuild(
  tile: Tile,
  mine: boolean,
  inv: Inventory,
  purse: number,
  kind: BuildingKind,
  gold: number,
  now: number,
  world: World,
): { ok: true; job: ServiceJob; gold: number; inv: Inventory; pile: Pile; sheds: { x: number; y: number; pile: Pile }[] } | { ok: false; hint: string } {
  if (!mine) return { ok: false, hint: "Строят на клетке заказчика." };
  if (!tile.plot || tile.building !== "none") return { ok: false, hint: "Построй — на пустой клетке двора." };
  if (kind === "none" || kind === "shop" || kind === "board" || kind === "workshop" || kind === "mine") {
    return { ok: false, hint: "Этот станок не заказывают." };
  }
  const cost = BUILD_COST[kind as Exclude<BuildingKind, "none">];
  if (!cost) return { ok: false, hint: "Не ставят." };
  if (serviceJobOf(tile)) return { ok: false, hint: "Сначала сними услугу." };
  const pay = payGold(purse, gold);
  if (!pay.ok) return pay;
  const need: Partial<Record<ItemId, number>> = {};
  if (cost.wood) need.wood = cost.wood;
  if (cost.stone) need.stone = cost.stone;
  const pulled = pullNeed(world, inv, tile, need);
  if (!pulled.ok) return pulled;
  return {
    ok: true,
    gold: pay.gold,
    inv: pulled.inv,
    pile: pulled.pile,
    sheds: pulled.sheds,
    job: {
      kind: "build",
      gold: pay.pay,
      until: 0,
      by: "you",
      build: kind,
      destX: tile.x,
      destY: tile.y,
      cargo: pulled.cargo,
    },
  };
}

export function planTakeService(
  tile: Tile,
  mine: boolean,
  px: number,
  py: number,
  busy: Character["busy"],
  now: number,
): { ok: true; job: ServiceJob } | { ok: false; hint: string } {
  const job = serviceJobOf(tile);
  if (!job) return { ok: false, hint: "Нет услуги." };
  if (mine || job.by === "you") return { ok: false, hint: "Свою услугу снимай, не бери." };
  if (job.take) return { ok: false, hint: "Уже взяли." };
  if (chebyshev(px, py, tile.x, tile.y) > 1) return { ok: false, hint: "Подойди." };
  if (busy && busy.until > Date.now()) return { ok: false, hint: "Сначала доделай своё дело." };
  return { ok: true, job: stampTake(job, "you", now) };
}

/** Срок на until только в момент «Взять». Вывеска без часа. */
export function stampTake(job: ServiceJob, who: string, now: number): ServiceJob {
  const next: ServiceJob = { ...job, take: who };
  if (job.kind === "watch") {
    const sec = SERVICE_DO.includes(job.doSec as (typeof SERVICE_DO)[number]) ? job.doSec! : SERVICE_DO[1];
    next.until = now + sec * 1000;
  }
  return next;
}

/** Busy на столе. Постой — until с «Взять». Отвези — пока не дошёл. */
export function serviceBusyUntil(job: ServiceJob, now: number): number {
  if (job.kind === "watch") return Math.max(job.until, now + 1000);
  if (job.kind === "haul") return now + HAUL_BUSY_MS;
  return job.until > now ? job.until : now;
}

export function planCancelService(
  tile: Tile,
  mine: boolean,
): { ok: true; job: ServiceJob } | { ok: false; hint: string } {
  const job = serviceJobOf(tile);
  if (!job) return { ok: false, hint: "Нет услуги." };
  if (!mine && job.by !== "you") return { ok: false, hint: "Чужую услугу не снимают." };
  if (job.take) return { ok: false, hint: "Уже взяли — ждут дело или срыв." };
  return { ok: true, job };
}

export type ServiceSettle =
  | { wait: true }
  | {
      wait: false;
      ok: boolean;
      payTo?: string;
      refundTo?: string;
      cargo: Partial<Record<ItemId, number>>;
      toPosterBag: boolean;
      out?: { item: ItemId; n: number };
      build?: BuildingKind;
    };

function jobCargo(job: ServiceJob): Partial<Record<ItemId, number>> {
  if (job.cargo) return { ...job.cargo };
  if (job.item && (job.n ?? 0) > 0) return { [job.item]: job.n ?? 1 };
  return {};
}

function atCell(p: { x: number; y: number } | null, x: number, y: number, reach = 0) {
  if (!p) return false;
  return chebyshev(p.x, p.y, x, y) <= reach;
}

/** Книга: вывеска не горит. Срок — только взятое дело. */
export function settleService(
  job: ServiceJob,
  now: number,
  tileX: number,
  tileY: number,
  exec: { x: number; y: number } | null,
  poster: { x: number; y: number } | null,
  early?: "arrive" | "work",
): ServiceSettle {
  const cargo = jobCargo(job);
  const destX = job.destX ?? tileX;
  const destY = job.destY ?? tileY;
  const posterHere = atCell(poster, destX, destY, 0);

  if (!job.take) {
    return { wait: true };
  }

  if (early === "arrive" && job.kind === "haul" && atCell(exec, destX, destY, 0)) {
    return {
      wait: false,
      ok: true,
      payTo: job.take,
      cargo,
      toPosterBag: posterHere,
      out: job.item ? { item: job.item, n: job.n ?? 1 } : undefined,
    };
  }
  if (early === "work" && (job.kind === "craft" || job.kind === "build") && atCell(exec, tileX, tileY, 1)) {
    if (job.kind === "craft") {
      const def = CRAFTS.find((d) => d.id === job.craft);
      return {
        wait: false,
        ok: true,
        payTo: job.take,
        cargo: {},
        toPosterBag: posterHere,
        out: def ? { item: def.out, n: def.n } : undefined,
      };
    }
    return { wait: false, ok: true, payTo: job.take, cargo: {}, toPosterBag: false, build: job.build };
  }

  if (job.kind === "watch") {
    if (!job.until || now < job.until) return { wait: true };
    if (atCell(exec, tileX, tileY, 0)) {
      return { wait: false, ok: true, payTo: job.take, cargo: {}, toPosterBag: false };
    }
    return { wait: false, ok: false, refundTo: job.by, cargo: {}, toPosterBag: false };
  }

  return { wait: true };
}

export function applyCargoPile(tile: Tile, cargo: Partial<Record<ItemId, number>>) {
  const pile = asPile(tile.pile);
  for (const k of ITEMS) {
    const n = cargo[k];
    if (n && n > 0) pile[k] = (pile[k] ?? 0) + n;
  }
  pileSet(tile, pile);
}

export function craftsAtTile(tile: Tile) {
  return CRAFTS.filter((d) => atBench(tile, d.bench));
}

/** Объявление улицы. Вещь на прилавке, не на доске. */
export type StreetNotice = {
  kind: "order" | "service";
  x: number;
  y: number;
  line: string;
};

export function canReadBoard(tile: Tile, px: number, py: number, fog: number): boolean {
  if (tile.building !== "board") return false;
  if (fog !== FOG_LIVE) return false;
  return chebyshev(px, py, tile.x, tile.y) <= 1;
}

export function streetNotices(world: World, name: string, now = Date.now()): StreetNotice[] {
  if (!name) return [];
  const rows: StreetNotice[] = [];
  for (const t of world.tiles) {
    if (t.village !== name) continue;
    const order = stallOrderOf(t);
    if (order) rows.push({ kind: "order", x: t.x, y: t.y, line: stallLine(order) });
    const job = serviceJobOf(t);
    if (job) rows.push({ kind: "service", x: t.x, y: t.y, line: serviceLine(job, now) });
  }
  return rows;
}

