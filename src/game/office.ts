import { caravanSell, goldTxt, sellQuote } from "./economy";
import type { GiftId, Inventory, ItemId, Season } from "./types";

export const STOCK_CAP = 100;
export const STOCK_START = 40;
export const DONATE_GOLD = 50;

export const GIFTS: Array<{ id: GiftId; label: string; gold: number }> = [
  { id: "gift_pin", label: "значок стола", gold: 200 },
  { id: "gift_mug", label: "кружка стола", gold: 500 },
  { id: "gift_nft", label: "подарок нфт", gold: 1000 },
];

export const GIFT_LABEL: Record<GiftId, string> = {
  gift_pin: "значок стола",
  gift_mug: "кружка стола",
  gift_nft: "подарок нфт",
};

/** Что лавка тракта держит кучей. Не тачка, не телега, не живость. */
export const LIVE_STOCK: ItemId[] = [
  "wood",
  "stone",
  "ore",
  "food",
  "fish",
  "herb",
  "clay",
  "crystal",
  "axe",
  "plank",
  "bread",
  "smoked",
  "coal",
  "bar",
  "tonic",
  "wheel",
  "lock",
  "brick",
  "grain",
  "flour",
  "rope",
  "spear",
  "bucket",
  "knife",
  "helm",
];

const LIVE = new Set<ItemId>(LIVE_STOCK);

export function isGiftId(v: string): v is GiftId {
  return v === "gift_pin" || v === "gift_mug" || v === "gift_nft";
}

export function isLiveStock(item: ItemId): boolean {
  return LIVE.has(item);
}

export function seedStock(): Partial<Record<ItemId, number>> {
  const o: Partial<Record<ItemId, number>> = {};
  for (const k of LIVE_STOCK) o[k] = STOCK_START;
  return o;
}

export function fillStock(raw: unknown): Partial<Record<ItemId, number>> {
  const next = seedStock();
  if (!raw || typeof raw !== "object") return next;
  const rec = raw as Record<string, unknown>;
  for (const k of LIVE_STOCK) {
    const n = rec[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) next[k] = Math.floor(n);
  }
  return next;
}

export function stockOf(stock: Partial<Record<ItemId, number>> | undefined, item: ItemId): number {
  const n = stock?.[item];
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) return Math.floor(n);
  return LIVE.has(item) ? STOCK_START : 0;
}

export function giftOrdered(gifts: Partial<Record<GiftId, "ordered">> | undefined, id: GiftId): boolean {
  return gifts?.[id] === "ordered";
}

export function planSellToStock(
  stock: Partial<Record<ItemId, number>> | undefined,
  inv: Inventory,
  item: ItemId,
  qty: number,
  season: Season,
  trader: boolean,
): { ok: true; take: number; gold: number; next: Partial<Record<ItemId, number>>; inv: Inventory } | { ok: false; hint: string } {
  if (!LIVE.has(item)) return { ok: false, hint: "Лавка это не берёт." };
  const have = stockOf(stock, item);
  if (have > STOCK_CAP) return { ok: false, hint: "склад полон" };
  const n = Math.min(qty, inv[item] ?? 0);
  if (n <= 0) return { ok: false, hint: "Нечего сдавать." };
  const quote = sellQuote(item, n, season, trader);
  if (quote.take <= 0 || quote.gold <= 0) return { ok: false, hint: "Мало для лавки." };
  const next = { ...fillStock(stock), [item]: have + quote.take };
  const bag = { ...inv, [item]: (inv[item] ?? 0) - quote.take };
  return { ok: true, take: quote.take, gold: quote.gold, next, inv: bag };
}

export function planBuyFromStock(
  stock: Partial<Record<ItemId, number>> | undefined,
  gold: number,
  item: ItemId,
  qty: number,
  season: Season,
): { ok: true; n: number; cost: number; next: Partial<Record<ItemId, number>> } | { ok: false; hint: string } {
  if (!LIVE.has(item)) return { ok: false, hint: "нет на складе" };
  const have = stockOf(stock, item);
  if (have <= 0) return { ok: false, hint: "нет на складе" };
  const n = Math.min(qty, have);
  if (n <= 0) return { ok: false, hint: "нет на складе" };
  const unit = caravanSell(item, season);
  const cost = unit * n;
  if (gold < cost) return { ok: false, hint: `Нужно ${goldTxt(cost)}.` };
  const next = { ...fillStock(stock), [item]: have - n };
  return { ok: true, n, cost, next };
}

export function planGift(
  gold: number,
  gifts: Partial<Record<GiftId, "ordered">> | undefined,
  id: GiftId,
): { ok: true; gold: number; next: Partial<Record<GiftId, "ordered">> } | { ok: false; hint: string } {
  const spec = GIFTS.find((g) => g.id === id);
  if (!spec) return { ok: false, hint: "Нет такого приза." };
  if (giftOrdered(gifts, id)) return { ok: false, hint: "заказан — выдаст админ" };
  if (gold < spec.gold) return { ok: false, hint: goldTxt(spec.gold) };
  return { ok: true, gold: spec.gold, next: { ...(gifts ?? {}), [id]: "ordered" } };
}

export function planDonate(): { ok: true; gold: number } {
  return { ok: true, gold: DONATE_GOLD };
}
