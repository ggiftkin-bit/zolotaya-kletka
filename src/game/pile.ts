import { CAPACITY, ITEMS, ITEM_LABEL, ITEM_WEIGHT } from "./constants";
import { cargoWeight } from "./travel";
import type { Inventory, ItemId, Tile, Transport } from "./types";

export type Pile = Partial<Record<ItemId, number>>;

type LegacyPile = { item: ItemId; amount: number };

export function isLegacyPile(p: unknown): p is LegacyPile {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  if (typeof o.item !== "string" || typeof o.amount !== "number") return false;
  return !ITEMS.some((k) => typeof o[k] === "number");
}

export function asPile(p: Tile["pile"] | LegacyPile | null | undefined): Pile {
  if (!p) return {};
  if (isLegacyPile(p)) {
    if (p.amount <= 0) return {};
    return { [p.item]: p.amount };
  }
  const out: Pile = {};
  for (const k of ITEMS) {
    const n = (p as Pile)[k];
    if (typeof n === "number" && n > 0) out[k] = Math.floor(n);
  }
  return out;
}

export function pileTotal(p: Pile): number {
  let n = 0;
  for (const k of ITEMS) n += p[k] ?? 0;
  return n;
}

export function pileEmpty(p: Pile): boolean {
  return pileTotal(p) <= 0;
}

export function pileSet(tile: Tile, p: Pile) {
  tile.pile = pileEmpty(p) ? null : p;
}

export function pileAdd(tile: Tile, item: ItemId, n: number) {
  if (n <= 0) return;
  const p = asPile(tile.pile);
  p[item] = (p[item] ?? 0) + n;
  pileSet(tile, p);
}

export function pileTake(tile: Tile, item: ItemId, n: number): number {
  const p = asPile(tile.pile);
  const have = p[item] ?? 0;
  const take = Math.min(n, have);
  if (take <= 0) return 0;
  const left = have - take;
  if (left <= 0) delete p[item];
  else p[item] = left;
  pileSet(tile, p);
  return take;
}

export function pileLabel(p: Pile): string {
  const bits: string[] = [];
  for (const k of ITEMS) {
    const n = p[k];
    if (n) bits.push(`${ITEM_LABEL[k]} ×${n}`);
  }
  return bits.join(" · ");
}

export function pileFirst(p: Pile): { item: ItemId; n: number } | null {
  for (const k of ITEMS) {
    const n = p[k];
    if (n && n > 0) return { item: k, n };
  }
  return null;
}

/** Сток в ношу до ёмкости, лишнее — кучей на этой клетке. */
export function giveOrPile(
  inv: Inventory,
  transport: Transport,
  tile: Tile,
  item: ItemId,
  n: number,
): { inv: Inventory; piled: number } {
  if (n <= 0) return { inv, piled: 0 };
  const next = { ...inv };
  const cap = CAPACITY[transport];
  let keep = n;
  const unit = ITEM_WEIGHT[item] ?? 1;
  const room = Math.max(0, cap - cargoWeight(next));
  const fit = unit <= 0 ? keep : Math.min(keep, Math.floor(room / unit + 1e-9));
  if (fit > 0) {
    next[item] = (next[item] ?? 0) + fit;
    keep -= fit;
  }
  if (keep > 0) pileAdd(tile, item, keep);
  return { inv: next, piled: keep };
}

export function dumpAllOn(tile: Tile, inv: Inventory, gold = 0) {
  if (gold > 0) tile.goldDrop = (tile.goldDrop ?? 0) + gold;
  for (const k of ITEMS) {
    const n = inv[k] ?? 0;
    if (n > 0) pileAdd(tile, k, n);
  }
}
