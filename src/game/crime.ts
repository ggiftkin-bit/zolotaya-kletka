import { JAIL_MS } from "./pace";
import { plotBounds, yardStrength } from "./fence";
import { asPile } from "./pile";
import type { Character, ItemId, Tile, World } from "./types";
import { tileAt } from "./worldgen";

export function isJailed(c: Character, now = Date.now()): boolean {
  return (c.jailedUntil ?? 0) > now;
}

export function isDown(c: Character): boolean {
  return c.life === "down";
}

export function isDead(c: Character): boolean {
  return c.life === "dead";
}

export function isStill(c: Character, now = Date.now()): boolean {
  return (c.stillUntil ?? 0) > now && c.life === "alive";
}

export function isHeld(c: Character, now = Date.now()): boolean {
  if (isJailed(c, now)) return true;
  if (c.life === "dead") return true;
  if ((c.stillUntil ?? 0) > now) return true;
  return false;
}

export function stealChance(world: World, tile: Tile, thief: Character, night: boolean): number {
  const b = tile.plot ? plotBounds(world, tile.x, tile.y) : null;
  const str = b ? yardStrength(world, b.x0, b.y0, b.x1, b.y1) : 0;
  const stealth = thief.skills.stealth ?? 0;
  let p = 0.22 + str * 0.07 - stealth * 0.05;
  if (night) p -= 0.12;
  if (thief.wanted > 0) p += 0.08 * thief.wanted;
  const stakes = tileAt(world, tile.x, tile.y);
  if (stakes) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (tileAt(world, tile.x + dx, tile.y + dy)?.building === "stakes") p += 0.06;
      }
    }
  }
  return Math.min(0.82, Math.max(0.08, p));
}

export function lootFrom(tile: Tile): { item: ItemId; n: number } | null {
  if (!tile.chestLock) {
    const chest = tile.chest;
    const keys: ItemId[] = ["food", "wood", "herb", "fish", "stone", "crystal"];
    for (const k of keys) {
      if ((chest[k] ?? 0) > 0) {
        const n = Math.min(chest[k], 1 + Math.floor(Math.random() * 3));
        return { item: k, n };
      }
    }
  }
  const pile = asPile(tile.pile);
  const first = (["food", "wood", "herb", "fish", "stone", "crystal"] as ItemId[]).find((k) => (pile[k] ?? 0) > 0);
  if (first) {
    const n = Math.min(pile[first] ?? 0, 1 + Math.floor(Math.random() * 2));
    return { item: first, n };
  }
  if (tile.building === "field" && tile.amount > 0) {
    return { item: "food", n: Math.min(tile.amount, 2) };
  }
  return null;
}

export function applyCatch(c: Character, law: boolean, why = "кража", now = Date.now()): Character {
  const wanted = Math.min(5, (c.wanted ?? 0) + 1);
  if (!law) {
    return { ...c, wanted, jailWhy: "" };
  }
  const extra = wanted * 20_000;
  return {
    ...c,
    wanted,
    jailedUntil: now + JAIL_MS + extra,
    jailWhy: why,
    life: "jailed",
    resting: false,
    busy: null,
  };
}

export function ownerOf(tile: Tile | null): string {
  return tile?.owner || "";
}

/** Свой двор / своя клетка. Лавка тракта и хутор — нет. */
export function isYours(tile: Tile | null | undefined): boolean {
  if (!tile) return false;
  if (tile.caravan) return false;
  if (tile.owner === "you") return true;
  if (tile.owner) return false;
  return !!tile.owned;
}

/** Хутор или двор соседа. */
export function isForeignYard(tile: Tile | null | undefined): boolean {
  if (!tile) return false;
  return !!tile.owner && tile.owner !== "you";
}

export function hasLaw(world: World, tile: Tile): boolean {
  if (tile.law) return true;
  const b = tile.plot ? plotBounds(world, tile.x, tile.y) : null;
  if (!b) return false;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      if (tileAt(world, x, y)?.law) return true;
    }
  }
  return false;
}

export function jailSpot(world: World, fx: number, fy: number): { x: number; y: number } {
  const j = world.tiles.find((t) => t.building === "jail");
  if (j) return { x: j.x, y: j.y };
  return { x: fx, y: fy };
}
