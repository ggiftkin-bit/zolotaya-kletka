import { ITEM_LABEL, ITEMS } from "./constants";
import { goldTxt } from "./economy";
import { giveOrPile } from "./pile";
import { chebyshev } from "./book";
import type { Character, Inventory, ItemId, Tile, Transport } from "./types";

/** One lot on a stall. Item sits on the tile (escrow), not in the air. */
export type StallOrder = {
  item: ItemId;
  n: number;
  gold: number;
};

export const STALL_PRICES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20] as const;

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
