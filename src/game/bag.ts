import { CAPACITY, FIELD_CROP, GATHER_YIELD, ITEMS, ITEM_LABEL, ITEM_WEIGHT, PROFESSION_BIOME, zeroInv } from "./constants";
import { canDoCraft, CRAFTS, EAT_ORDER, type CraftKind } from "./craft";
import { cargoWeight } from "./travel";
import type { Inventory, ItemId, Profession, Tile, Transport } from "./types";

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
] as const;

export type BagKind = (typeof BAG_KINDS)[number];

export function isBagKind(v: string): v is BagKind {
  return (BAG_KINDS as readonly string[]).includes(v);
}

export function planGather(
  tile: { resource: ItemId | null; amount: number; biome: Tile["biome"] },
  pawn: { profession: Profession; hand: ItemId | null },
  night: boolean,
): { ok: true; item: ItemId; got: number } | { ok: false; hint: string } {
  const res = tile.resource;
  if (!res || tile.amount <= 0) return { ok: false, hint: "Уже пусто." };
  let got = Math.min(GATHER_YIELD[res] || 1, tile.amount);
  const match = PROFESSION_BIOME[pawn.profession]?.includes(tile.biome);
  if (match) got = Math.min(tile.amount, got + 1);
  if (pawn.hand === "axe" && res === "wood") got = Math.min(tile.amount, got + 1);
  if (pawn.hand === "pick" && (res === "stone" || res === "ore" || res === "crystal")) got = Math.min(tile.amount, got + 1);
  if (res === "wood" && pawn.hand !== "axe") got = Math.max(1, Math.floor(got * 0.4));
  if ((res === "stone" || res === "ore") && pawn.hand !== "pick") got = Math.max(1, Math.floor(got * 0.4));
  if (night) got = Math.max(1, Math.floor(got * 0.5));
  return { ok: true, item: res, got };
}

export function planEat(inv: Inventory, item: ItemId): { ok: true; inv: Inventory } | { ok: false; hint: string } {
  if (!EAT_ORDER.includes(item)) return { ok: false, hint: "Еды нет." };
  return takeBag(inv, { [item]: 1 });
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

export { FIELD_CROP };
