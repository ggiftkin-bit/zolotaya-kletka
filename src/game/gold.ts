import { CART_GOLD, LOCK_GOLD, WAGON_GOLD, goldTxt } from "./economy";
import { COW_PRICE, HORSE_PRICE } from "./life";
import { BAIL_GOLD, BOOST_GOLD, SKIP_GOLD, deathFee } from "./pace";

/** Старт фишки. Первая запись в книгу — это, не цифра с клиента. */
export const START_GOLD = 20;
export const WORK_GOLD = 8;

export const GOLD_KINDS = [
  "boost",
  "skip",
  "hire",
  "bail",
  "death",
  "cart",
  "horse",
  "wagon",
  "lock",
  "cow",
  "work",
  "sell-cart",
  "sell-horse",
  "sell-wagon",
] as const;

export type GoldKind = (typeof GOLD_KINDS)[number];

export function isGoldKind(v: string): v is GoldKind {
  return (GOLD_KINDS as readonly string[]).includes(v);
}

function priceOf(kind: GoldKind, deaths: number): number {
  if (kind === "boost") return BOOST_GOLD;
  if (kind === "skip") return SKIP_GOLD;
  if (kind === "hire") return 0;
  if (kind === "bail") return BAIL_GOLD;
  if (kind === "death") return deathFee(deaths);
  if (kind === "cart") return CART_GOLD;
  if (kind === "horse") return HORSE_PRICE;
  if (kind === "wagon") return WAGON_GOLD;
  if (kind === "lock") return LOCK_GOLD;
  if (kind === "cow") return COW_PRICE;
  if (kind === "work") return -WORK_GOLD;
  if (kind === "sell-cart") return -Math.floor(CART_GOLD / 2);
  if (kind === "sell-horse") return -Math.floor(HORSE_PRICE / 2);
  if (kind === "sell-wagon") return -Math.floor(WAGON_GOLD / 2);
  return 0;
}

/** Книга считает. Клиент говорит род, не новую цифру. */
export function planGoldDeed(
  kind: GoldKind,
  purse: number,
  deaths = 0,
): { ok: true; gold: number; delta: number; price: number } | { ok: false; hint: string } {
  const have = Math.max(0, Math.floor(purse));
  const price = priceOf(kind, deaths);
  const delta = kind === "death" ? -Math.min(have, Math.max(0, price)) : -price;
  const next = have + delta;
  if (next < 0) return { ok: false, hint: `Нужно ${goldTxt(price)}.` };
  return { ok: true, gold: next, delta, price: Math.abs(price) };
}
