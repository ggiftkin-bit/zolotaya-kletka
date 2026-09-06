import { JAIL_MS } from "./pace";
import { plotBounds, setYardGateLock, yardStrength } from "./fence";
import { asPile, pileTake } from "./pile";
import type { Character, Dummy, ItemId, Tile, World } from "./types";
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

/** Ночь, колья, скрытность. Манекен не нужен — закон смотрит клетки двора. */
export function rollCaught(world: World, tile: Tile, thief: Character, night: boolean, extra = 0): boolean {
  const p = stealChance(world, tile, thief, night);
  return Math.random() < Math.min(0.88, Math.max(0, p + extra));
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

/** Один тык — пачка, не весь сундук. Вещь из клетки в сумку вора. */
export function takeLoot(tile: Tile, loot: { item: ItemId; n: number }) {
  if (!tile.chestLock && (tile.chest[loot.item] ?? 0) > 0) {
    tile.chest[loot.item] = Math.max(0, (tile.chest[loot.item] ?? 0) - loot.n);
    return;
  }
  if ((asPile(tile.pile)[loot.item] ?? 0) > 0) {
    pileTake(tile, loot.item, loot.n);
    return;
  }
  if (tile.building === "field") {
    tile.amount = Math.max(0, tile.amount - loot.n);
  }
}

export function markCrime(tile: Tile, who: string) {
  tile.mark = { who, at: Date.now() };
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

/** Хозяин-манекен на этом дворе. Для ямы не нужен: живой хозяин может закрыть стол. */
export function dummyOnYard(dummies: Dummy[] | undefined, world: World, tile: Tile): boolean {
  const list = dummies ?? [];
  const b = tile.plot ? plotBounds(world, tile.x, tile.y) : null;
  return list.some((d) => {
    if (d.life !== "alive") return false;
    if (b) return d.x >= b.x0 && d.x <= b.x1 && d.y >= b.y0 && d.y <= b.y1;
    return d.x === tile.x && d.y === tile.y;
  });
}

export function jailSpot(world: World, fx: number, fy: number): { x: number; y: number } {
  const here = tileAt(world, fx, fy);
  const b = here?.plot ? plotBounds(world, fx, fy) : null;
  if (b) {
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const t = tileAt(world, x, y);
        if (t?.building === "jail") return { x: t.x, y: t.y };
      }
    }
    if (here && !here.caravan) return { x: fx, y: fy };
  }
  const j = world.tiles.find((t) => t.building === "jail" && !t.caravan);
  if (j) return { x: j.x, y: j.y };
  return { x: fx, y: fy };
}

export type CatchHit = {
  c: Character;
  jailed: boolean;
  law: boolean;
  spot: { x: number; y: number } | null;
};

/** Яма только при законе двора. Без закона — розыск. Хозяин оффлайн годится. */
export function punish(c: Character, world: World, tile: Tile, why: string, now = Date.now()): CatchHit {
  const law = hasLaw(world, tile);
  let next = applyCatch(c, law, why, now);
  if (!isJailed(next)) return { c: next, jailed: false, law, spot: null };
  const spot = jailSpot(world, tile.x, tile.y);
  next = { ...next, x: spot.x, y: spot.y, px: spot.x, py: spot.y, busy: null };
  return { c: next, jailed: true, law, spot };
}

export function plotCells(world: World, tile: Tile): { x: number; y: number }[] {
  const b = tile.plot ? plotBounds(world, tile.x, tile.y) : null;
  if (!b) return [{ x: tile.x, y: tile.y }];
  const out: { x: number; y: number }[] = [];
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) out.push({ x, y });
  }
  return out;
}

export function harmCells(...tiles: Array<{ x: number; y: number } | null | undefined>): { x: number; y: number }[] {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  for (const t of tiles) {
    if (!t) continue;
    const k = `${t.x},${t.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x: t.x, y: t.y });
  }
  return out;
}

export function fenceBurnCells(tile: Tile, side: "n" | "w" | "s" | "e"): { x: number; y: number }[] {
  if (side === "s") return harmCells(tile, { x: tile.x, y: tile.y + 1 });
  if (side === "e") return harmCells(tile, { x: tile.x + 1, y: tile.y });
  return harmCells(tile);
}

export function unlockKind(world: World, tile: Tile, kind: "chest" | "gate"): { x: number; y: number }[] {
  if (kind === "chest") {
    tile.chestLock = false;
    return harmCells(tile);
  }
  setYardGateLock(world, tile.x, tile.y, false);
  return plotCells(world, tile);
}
