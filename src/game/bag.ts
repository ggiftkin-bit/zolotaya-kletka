import { CAPACITY, FIELD_CROP, GATHER_YIELD, ITEMS, ITEM_LABEL, ITEM_WEIGHT, PROFESSION_BIOME, zeroInv } from "./constants";
import { canDoCraft, CRAFTS, EAT_ORDER, EAT_SAT, type CraftKind } from "./craft";
import { BUILD_COST } from "./economy";
import { TONIC_HP } from "./pace";
import { cargoWeight } from "./travel";
import { defaultMatter, isAxeHand, isPickHand } from "./work";
import type { BuildingKind, Inventory, ItemId, Matter, Profession, Tile, Transport } from "./types";

/** Первая запись фишки. Не мешок с клиента. */
export function startInv(): Inventory {
  const inv = zeroInv();
  inv.food = 6;
  inv.axe = 1;
  return inv;
}

export function bagOf(body: { inventory?: Partial<Inventory> | null } | null | undefined): Inventory {
  const inv = zeroInv();
  const raw = body?.inventory;
  if (!raw) return inv;
  for (const k of ITEMS) {
    const n = raw[k];
    if (typeof n === "number" && Number.isFinite(n) && n > 0) inv[k] = Math.floor(n);
  }
  return inv;
}

export function cloneBag(inv: Inventory): Inventory {
  return { ...zeroInv(), ...inv };
}

export function bagsEqual(a: Inventory, b: Inventory): boolean {
  for (const k of ITEMS) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  }
  return true;
}

export function takeBag(
  inv: Inventory,
  need: Partial<Record<ItemId, number>>,
): { ok: true; inv: Inventory } | { ok: false; hint: string } {
  const next = cloneBag(inv);
  for (const [k, n0] of Object.entries(need) as [ItemId, number][]) {
    const n = Math.max(0, Math.floor(n0 ?? 0));
    if (n <= 0) continue;
    if ((next[k] ?? 0) < n) return { ok: false, hint: `Мало: ${ITEM_LABEL[k]}.` };
    next[k] = (next[k] ?? 0) - n;
  }
  return { ok: true, inv: next };
}

export function addBag(inv: Inventory, item: ItemId, n: number): Inventory {
  if (n <= 0) return inv;
  const next = cloneBag(inv);
  next[item] = (next[item] ?? 0) + Math.floor(n);
  return next;
}

/** Сколько влезает в ношу. Лишнее — на клетку. Transport из книги. */
export function giveOrSpill(
  inv: Inventory,
  transport: Transport,
  item: ItemId,
  n: number,
): { inv: Inventory; spill: number } {
  if (n <= 0) return { inv, spill: 0 };
  const next = cloneBag(inv);
  const cap = CAPACITY[transport] ?? CAPACITY.walk;
  const w = ITEM_WEIGHT[item] ?? 1;
  const room = Math.max(0, cap - cargoWeight(next));
  const fit = w <= 0 ? n : Math.min(n, Math.floor(room / w + 1e-9));
  if (fit > 0) next[item] = (next[item] ?? 0) + fit;
  return { inv: next, spill: Math.max(0, n - fit) };
}

export const BAG_KINDS = [
  "gather",
  "dig",
  "hunt",
  "fish",
  "pickup",
  "drop",
  "chest-put",
  "chest-take",
  "craft",
  "eat",
  "spend",
  "steal",
  "job",
  "grant",
  "yard",
  "sleep",
  "drink",
  "pail",
  "sip",
  "pour",
  "cook",
  "tonic",
  "scrap",
] as const;

export type BagKind = (typeof BAG_KINDS)[number];

export function isBagKind(v: string): v is BagKind {
  return (BAG_KINDS as readonly string[]).includes(v);
}

export const CELL_GONE = "уже нет";

export function planGather(
  tile: { resource: ItemId | null; amount: number; biome: Tile["biome"] },
  pawn: { profession: Profession; hand: ItemId | null },
  night: boolean,
): { ok: true; item: ItemId; got: number } | { ok: false; hint: string } {
  const res = tile.resource;
  if (!res || tile.amount <= 0) return { ok: false, hint: CELL_GONE };

  let got = Math.min(GATHER_YIELD[res] || 1, tile.amount);
  const match = PROFESSION_BIOME[pawn.profession]?.includes(tile.biome);
  if (match) got = Math.min(tile.amount, got + 1);
  if (isAxeHand(pawn.hand) && res === "wood") got = Math.min(tile.amount, got + 1);
  if (pawn.hand === "steel_axe" && res === "wood") got = Math.min(tile.amount, got + 1);
  if (isPickHand(pawn.hand) && (res === "stone" || res === "ore" || res === "crystal")) got = Math.min(tile.amount, got + 1);
  if (pawn.hand === "steel_pick" && (res === "stone" || res === "ore")) got = Math.min(tile.amount, got + 1);
  if (res === "wood" && !isAxeHand(pawn.hand)) got = Math.max(1, Math.floor(got * 0.4));
  if ((res === "stone" || res === "ore") && !isPickHand(pawn.hand)) got = Math.max(1, Math.floor(got * 0.4));
  if (night) got = Math.max(1, Math.floor(got * 0.5));
  return { ok: true, item: res, got };
}

/** Успех охоты. Еда как была. Шкуру снимает только охотник. */
export function huntTake(hand: ItemId | null, profession: Profession): { food: number; hide: number } {
  return { food: hand === "spear" ? 2 : 1, hide: profession === "hunter" ? 1 : 0 };
}

export function planEat(inv: Inventory, item: ItemId): { ok: true; inv: Inventory } | { ok: false; hint: string } {
  if (!EAT_ORDER.includes(item)) return { ok: false, hint: "Еды нет." };
  return takeBag(inv, { [item]: 1 });
}

export function eatSatiety(item: ItemId, profession: string): number {
  const base = EAT_SAT[item] ?? 14;
  return base + (profession === "baker" && item === "bread" ? 8 : 0);
}

export function isDrinkTile(tile: { biome: string; building: string }): boolean {
  return tile.biome === "river" || tile.biome === "ford" || tile.building === "well";
}

export const SIP_WATER = 25;
export const PAIL_FULL = 3;
export const CISTERN_POUR = 5;
export const CISTERN_CAP = 12;
export const COOK_SAT = 28;
export const COOK_HERB_SAT = 40;

export function planCook(inv: Inventory): { ok: true; inv: Inventory; gain: number } | { ok: false; hint: string } {
  const meal: ItemId | null = (inv.food ?? 0) > 0 ? "food" : (inv.fish ?? 0) > 0 ? "fish" : null;
  if (!meal || (inv.wood ?? 0) <= 0) return { ok: false, hint: "Нужны еда или рыба и полено." };
  const herb = (inv.herb ?? 0) > 0;
  const need: Partial<Record<ItemId, number>> = { [meal]: 1, wood: 1 };
  if (herb) need.herb = 1;
  const paid = takeBag(inv, need);
  if (!paid.ok) return paid;
  return { ok: true, inv: paid.inv, gain: herb ? COOK_HERB_SAT : COOK_SAT };
}

export function craftDefOf(id: string) {
  return CRAFTS.find((c) => c.id === id) ?? null;
}

export function isCraftKind(id: string): id is CraftKind {
  return CRAFTS.some((c) => c.id === id);
}

export function canCraftHere(id: string, profession: Profession, tile: Tile | null) {
  const def = craftDefOf(id);
  if (!def) return false;
  return canDoCraft(def, profession, tile);
}

export function planTonic(
  inv: Inventory,
  hp: number,
): { ok: true; inv: Inventory; hp: number } | { ok: false; hint: string } {
  if (hp >= 100) return { ok: false, hint: "Цел. Настой береги." };
  const paid = takeBag(inv, { tonic: 1 });
  if (!paid.ok) return { ok: false, hint: "Настоя нет. Варит целитель." };
  return { ok: true, inv: paid.inv, hp: Math.min(100, hp + TONIC_HP) };
}

/** Сгоревший остов: шалаш/костёр 1 уголь, прочее дерево 2. Камень — 0. */
export function scrapCoalOf(building: BuildingKind, matter: Matter): number {
  if (building === "none") return 0;
  if (matter === "stone") return 0;
  if (building === "shack" || building === "camp") return 1;
  return 2;
}

export function halfBuildRefund(kind: Exclude<BuildingKind, "none">): Partial<Record<ItemId, number>> {
  const cost = BUILD_COST[kind];
  const out: Partial<Record<ItemId, number>> = {};
  const wood = Math.floor((cost.wood ?? 0) / 2);
  const stone = Math.floor((cost.stone ?? 0) / 2);
  const plank = Math.floor((cost.plank ?? 0) / 2);
  if (wood > 0) out.wood = wood;
  if (stone > 0) out.stone = stone;
  if (plank > 0) out.plank = plank;
  return out;
}

export type ScrapPlan =
  | { ok: true; mode: "burn"; coal: number }
  | { ok: true; mode: "live"; refund: Partial<Record<ItemId, number>> }
  | { ok: false; hint: string };

export function planScrap(tile: Tile, selfId: string): ScrapPlan {
  if (tile.building === "none") return { ok: false, hint: CELL_GONE };
  if (tile.burned) {
    const matter = tile.matter || defaultMatter(tile.building);
    return { ok: true, mode: "burn", coal: scrapCoalOf(tile.building, matter) };
  }
  if (tile.building !== "shack" && tile.building !== "house") {
    return { ok: false, hint: "Это не шалаш." };
  }
  const mine = !tile.owner || tile.owner === "you" || tile.owner === selfId;
  if (!mine) return { ok: false, hint: "чужое" };
  return { ok: true, mode: "live", refund: halfBuildRefund(tile.building) };
}

/** Испытание «выдать дерево». Книга кладёт столько, не стол. */
export const GRANT_WOOD = 20;

export { FIELD_CROP };
