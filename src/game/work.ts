import type { BuildingKind, Busy, BusyKind, Character, Matter, Tile, World } from "./types";
import { tileAt } from "./worldgen";

export const MATTER_LABEL: Record<Matter, string> = {
  wattle: "хворост",
  wood: "дерево",
  stone: "камень",
};

export const MATTER_HP: Record<Matter, number> = {
  wattle: 8,
  wood: 20,
  stone: 40,
};

export const BUSY_LABEL: Record<BusyKind, string> = {
  hunt: "охота",
  catch: "ловлю",
  fish: "ловлю рыбу",
};

export const CLAD_STONE = 16;

export function defaultMatter(kind: BuildingKind): Matter {
  if (kind === "none") return "wood";
  if (kind === "shack" || kind === "stakes") return "wattle";
  if (kind === "well" || kind === "forge" || kind === "oven" || kind === "jail" || kind === "moat") return "stone";
  return "wood";
}

export function isRoof(tile: Tile | null | undefined): boolean {
  if (!tile) return false;
  if (tile.burned) return false;
  return tile.building === "shack" || tile.building === "house";
}

export function canBurnMatter(m: Matter): boolean {
  return m === "wattle" || m === "wood";
}

export function canFishOn(world: World, tile: Tile): boolean {
  if (tile.biome === "ford") return true;
  if (tile.biome === "river") return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = tileAt(world, tile.x + dx, tile.y + dy);
      if (n && (n.biome === "river" || n.biome === "ford")) return true;
    }
  }
  return false;
}

export function workMs(kind: BusyKind, herdKind: string | null, c: Character): number {
  let sec = 35;
  if (kind === "hunt") sec = herdKind === "deer" ? 45 : 25;
  if (kind === "catch") sec = 40;
  if (kind === "fish") sec = 35;
  if (kind === "hunt" && c.hand === "spear") sec *= 0.7;
  if (kind === "catch" && c.hand === "rope") sec *= 0.85;
  if (kind === "fish" && c.hand === "rod") sec *= 0.8;
  const skill =
    kind === "catch" ? c.skills.agro : kind === "hunt" ? c.skills.fight + c.skills.survival : c.skills.survival;
  sec *= Math.max(0.6, 1 - skill * 0.03);
  return Math.round(sec * 1000);
}

export function makeBusy(kind: BusyKind, x: number, y: number, until: number): Busy {
  return { kind, x, y, until };
}

export function burnableFence(tile: Tile, world: World): { side: "n" | "w" | "s" | "e" } | null {
  if (tile.fenceN === "wood" || tile.fenceN === "palisade") return { side: "n" };
  if (tile.fenceW === "wood" || tile.fenceW === "palisade") return { side: "w" };
  const south = tileAt(world, tile.x, tile.y + 1);
  if (south && (south.fenceN === "wood" || south.fenceN === "palisade")) return { side: "s" };
  const east = tileAt(world, tile.x + 1, tile.y);
  if (east && (east.fenceW === "wood" || east.fenceW === "palisade")) return { side: "e" };
  return null;
}

export function stoneFence(tile: Tile, world: World): boolean {
  if (tile.fenceN === "wall" || tile.fenceW === "wall") return true;
  const south = tileAt(world, tile.x, tile.y + 1);
  if (south?.fenceN === "wall") return true;
  const east = tileAt(world, tile.x + 1, tile.y);
  if (east?.fenceW === "wall") return true;
  return false;
}

export function applyFenceBurn(tile: Tile, world: World, side: "n" | "w" | "s" | "e") {
  if (side === "n") tile.fenceN = "none";
  else if (side === "w") tile.fenceW = "none";
  else if (side === "s") {
    const south = tileAt(world, tile.x, tile.y + 1);
    if (south) south.fenceN = "none";
  } else {
    const east = tileAt(world, tile.x + 1, tile.y);
    if (east) east.fenceW = "none";
  }
}
