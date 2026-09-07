import { CAPACITY, ITEMS, ITEM_LABEL, ITEM_WEIGHT } from "./constants";
import { cargoWeight } from "./travel";
import type { Inventory, ItemId, Tile, Transport, World } from "./types";

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
  extraKg = 0,
): { inv: Inventory; piled: number } {
  if (n <= 0) return { inv, piled: 0 };
  const next = { ...inv };
  const cap = CAPACITY[transport];
  let keep = n;
  const unit = ITEM_WEIGHT[item] ?? 1;
  const room = Math.max(0, cap - cargoWeight(next) - extraKg);
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

/** Склад кормит станок. Не сундук и не витрина. */
export const SHED_REACH = 2;

export type ShedTake = { x: number; y: number; pile: Pile };

export type NeedPull = {
  inv: Inventory;
  pile: Pile;
  sheds: ShedTake[];
  cargo: Partial<Record<ItemId, number>>;
};

function cellReach(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function canShedFeed(station: Tile, shed: Tile): boolean {
  if (shed.building !== "shed" || shed.burned) return false;
  if (cellReach(station.x, station.y, shed.x, shed.y) > SHED_REACH) return false;
  if (station.owner && shed.owner && station.owner === shed.owner) return true;
  if (station.village && shed.village && station.village === shed.village) return true;
  return false;
}

export function shedsNear(world: World, station: Tile): Tile[] {
  const out: Tile[] = [];
  for (const t of world.tiles) {
    if (canShedFeed(station, t)) out.push(t);
  }
  out.sort((a, b) => {
    const da = cellReach(station.x, station.y, a.x, a.y);
    const db = cellReach(station.x, station.y, b.x, b.y);
    return da - db || a.y - b.y || a.x - b.x;
  });
  return out;
}

export function applyNeedPull(world: World, station: Tile, pulled: NeedPull) {
  pileSet(station, pulled.pile);
  for (const sh of pulled.sheds) {
    const t = world.tiles[sh.y * world.width + sh.x];
    if (t) pileSet(t, sh.pile);
  }
}

/** Куча станка → склад в двух клетках → сумка. Ровно need. */
export function pullNeed(
  world: World,
  inv: Inventory,
  station: Tile,
  need: Partial<Record<ItemId, number>>,
): { ok: true } & NeedPull | { ok: false; hint: string } {
  const inv2 = { ...inv };
  const pile = asPile(station.pile);
  const near = shedsNear(world, station);
  const sheds: ShedTake[] = near.map((t) => ({ x: t.x, y: t.y, pile: asPile(t.pile) }));
  const cargo: Partial<Record<ItemId, number>> = {};
  for (const [k, n0] of Object.entries(need) as [ItemId, number][]) {
    const n = n0 ?? 0;
    if (n <= 0) continue;
    let left = n;
    const fromPile = Math.min(pile[k] ?? 0, left);
    if (fromPile > 0) {
      pile[k] = (pile[k] ?? 0) - fromPile;
      if ((pile[k] ?? 0) <= 0) delete pile[k];
      left -= fromPile;
    }
    if (left > 0) {
      for (const sh of sheds) {
        const take = Math.min(sh.pile[k] ?? 0, left);
        if (take <= 0) continue;
        sh.pile[k] = (sh.pile[k] ?? 0) - take;
        if ((sh.pile[k] ?? 0) <= 0) delete sh.pile[k];
        left -= take;
        if (left <= 0) break;
      }
    }
    if (left > 0) {
      const bag = Math.min(inv2[k] ?? 0, left);
      inv2[k] = (inv2[k] ?? 0) - bag;
      left -= bag;
    }
    if (left > 0) {
      return { ok: false, hint: near.length ? "мало на складе" : `Мало: ${ITEM_LABEL[k]}.` };
    }
    cargo[k] = n;
  }
  const changed = sheds.filter((sh, i) => {
    const was = asPile(near[i]!.pile);
    return JSON.stringify(sh.pile) !== JSON.stringify(was);
  });
  return { ok: true, inv: inv2, pile, sheds: changed, cargo };
}
