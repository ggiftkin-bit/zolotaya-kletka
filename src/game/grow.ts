import { isWatered } from "./life";
import type { Season, Tile, World } from "./types";

/** Weeks of emptiness before the first sprout. Trees wait the longest. */
export const REGROW_WAIT: Record<string, number> = {
  wood: 4,
  food: 2,
  herb: 2,
  fish: 1,
  stone: 7,
  ore: 9,
  clay: 5,
  crystal: 12,
};

const REGROW_CAP: Record<string, number> = {
  wood: 8,
  food: 6,
  herb: 4,
  fish: 6,
  stone: 6,
  ore: 4,
  clay: 4,
  crystal: 2,
};

export function isWooded(tile: Tile) {
  return tile.biome === "forest" && tile.amount >= 4;
}

export function looksEmpty(tile: Tile) {
  if (tile.building === "field") return tile.amount <= 0;
  if (tile.amount > 0) return false;
  return tile.scarred || tile.commons || tile.biome === "forest" || tile.biome === "fertile" || tile.biome === "mountain" || tile.biome === "ore";
}

export function markDepleted(tile: Tile) {
  tile.amount = 0;
  tile.scarred = true;
  const key = tile.resource ?? "food";
  tile.regen = REGROW_WAIT[key] ?? 3;
}

export function tickGrow(world: World, season: Season) {
  for (const t of world.tiles) {
    if (world.fog && (world.fog[t.y * world.width + t.x] ?? 0) !== 2) continue;
    growTile(world, t, season);
  }
}

function growTile(world: World, t: Tile, season: Season) {
  if (t.building === "field") {
    growField(world, t, season);
    return;
  }
  if (!t.resource) return;
  const cap = REGROW_CAP[t.resource] ?? 4;
  const winterStop = season === "winter" && (t.resource === "wood" || t.resource === "food" || t.resource === "herb");
  if (winterStop) return;

  if (t.amount <= 0 && t.scarred) {
    t.regen = (t.regen ?? REGROW_WAIT[t.resource] ?? 3) - 1;
    if (t.regen > 0) return;
    t.amount = 1;
    t.regen =
      t.resource === "wood"
        ? season === "spring"
          ? 2
          : 3
        : t.resource === "herb"
          ? 2
          : (REGROW_WAIT[t.resource] ?? 3);
    return;
  }

  if (t.amount > 0 && t.amount < cap) {
    if (t.resource === "wood") {
      t.regen = (t.regen ?? 2) - 1;
      if (t.regen > 0) return;
      t.amount += 1;
      t.regen = season === "spring" ? 1 : 2;
      if (t.amount >= 5) t.scarred = false;
      return;
    }
    if (t.resource === "herb") {
      t.regen = (t.regen ?? 2) - 1;
      if (t.regen > 0) return;
      t.amount += 1;
      t.regen = 2;
      if (t.amount >= 3) t.scarred = false;
      return;
    }
    if (!t.scarred && t.amount < 3) t.amount += 1;
  }
}

function growField(world: World, t: Tile, season: Season) {
  if (season === "winter") return;
  t.resource = "food";
  if (t.amount <= 0) {
    t.regen = (t.regen ?? 2) - 1;
    if (t.regen > 0) return;
    const wet = isWatered(world, t);
    t.amount = wet ? 3 : 2;
    t.scarred = false;
    t.regen = 0;
    return;
  }
  const grow = season === "summer" ? 3 : 2;
  const wet = isWatered(world, t);
  const add = wet ? grow : Math.max(1, Math.floor(grow * 0.4));
  t.amount = Math.min(12, t.amount + add);
  t.scarred = false;
}
