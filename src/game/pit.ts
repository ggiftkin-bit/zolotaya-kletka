import { CELL_GONE } from "./bag";
import { isForeignYard } from "./crime";
import type { Inventory, ItemId, Tile, World } from "./types";
import { tileAt } from "./worldgen";

export { giveOrPile } from "./pile";

export type FillPay = { clay: number; wood: number; stone: number };

export function fillPay(inv: Inventory): FillPay | null {
  if ((inv.clay ?? 0) >= 2) return { clay: 2, wood: 0, stone: 0 };
  if ((inv.clay ?? 0) >= 1 && (inv.wood ?? 0) >= 1) return { clay: 1, wood: 1, stone: 0 };
  if ((inv.clay ?? 0) >= 1 && (inv.stone ?? 0) >= 1) return { clay: 1, wood: 0, stone: 1 };
  return null;
}

export function fillNeedLine(inv: Inventory): string {
  if (fillPay(inv)) return "";
  return "Засыпать: 2 глины, либо 1 глина и дерево, либо 1 глина и камень.";
}

/** Равнина / лес / поле — песок. Болото и берег — глина. Не пачка на 20. */
export function digYield(tile: Tile): { item: ItemId; got: number } | null {
  if (tile.bank) return { item: "clay", got: 2 };
  if (tile.biome === "swamp") return { item: "clay", got: 1 };
  if (tile.biome === "plains" || tile.biome === "forest" || tile.biome === "fertile") {
    return { item: "sand", got: 1 };
  }
  return null;
}

function digRefuse(tile: Tile, hand: ItemId | null): string | null {
  if (hand !== "shovel") return "нужна лопата";
  if (tile.pit) return CELL_GONE;
  if (tile.commons) return "поляну не копают";
  if (tile.road !== "none") return "тракт не копают";
  if (tile.biome === "river" || tile.biome === "ford" || tile.building === "moat") return "воду не копают";
  if (tile.biome === "mountain" || tile.biome === "ore") return "горы — киркой";
  if (tile.caravan) return "не здесь";
  if (tile.building !== "none") return "под домом нельзя";
  if (!digYield(tile)) return "здесь лопатой не копают";
  return null;
}

export function planDig(
  tile: Tile,
  hand: ItemId | null,
): { ok: true; item: ItemId; got: number } | { ok: false; hint: string } {
  const why = digRefuse(tile, hand);
  if (why) return { ok: false, hint: why };
  const y = digYield(tile);
  if (!y) return { ok: false, hint: "здесь лопатой не копают" };
  return { ok: true, ...y };
}

export function digLine(tile: Tile): string {
  const y = digYield(tile);
  if (!y) return "яма";
  return y.got === 1 ? `1 ${y.item === "sand" ? "песок" : "глина"} · яма` : `${y.got} глины · яма`;
}

export function canDigReason(world: World, tile: Tile, hand: ItemId | null): string | null {
  const why = digRefuse(tile, hand);
  if (why) return why;
  if (isForeignYard(tile)) return "чужой двор";
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const n = tileAt(world, tile.x + dx, tile.y + dy);
    if (n && isForeignYard(n)) return "чужой двор";
  }
  return null;
}

export function refundPaid(inv: Inventory, pay: FillPay): Inventory {
  const next = { ...inv };
  next.clay = (next.clay ?? 0) + pay.clay;
  next.wood = (next.wood ?? 0) + pay.wood;
  next.stone = (next.stone ?? 0) + pay.stone;
  return next;
}

export function takePaid(inv: Inventory, pay: FillPay): Inventory {
  const next = { ...inv };
  next.clay = Math.max(0, (next.clay ?? 0) - pay.clay);
  next.wood = Math.max(0, (next.wood ?? 0) - pay.wood);
  next.stone = Math.max(0, (next.stone ?? 0) - pay.stone);
  return next;
}
