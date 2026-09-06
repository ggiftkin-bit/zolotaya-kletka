import { DAYS_PER_WEEK, SEASON_WEATHER, TICK_SEC, TICKS_PER_DAY, WEEKS_PER_SEASON } from "./constants";
import type { WorldClock } from "./book";
import { isWatered } from "./life";
import type { Season, Tile, Weather, World } from "./types";

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

export const TICK_MS = TICK_SEC * 1000;

/**
 * After the book slept: catch up at most one week of ticks.
 * One week = 6 days × 8 ticks = 48. Winter is 144 — not in one frame.
 * Leftover sleep is dropped. No week-skip handle on the table.
 */
export const GROW_CATCHUP_TICKS = 48;

export const GROW_WRITE_BATCH = 200;

const NEXT_SEASON: Record<Season, Season> = {
  spring: "summer",
  summer: "autumn",
  autumn: "winter",
  winter: "spring",
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

export function stepWorldClock(c: WorldClock): { clock: WorldClock; newDay: boolean; newWeek: boolean } {
  let season = c.season;
  let year = c.year;
  let week = c.week;
  let day = c.day;
  let tickOfDay = c.tickOfDay;
  let phase = c.phase;
  let weather: Weather = c.weather;
  let clock = c.clock + 1;
  tickOfDay += 1;
  let newDay = false;
  let newWeek = false;
  if (tickOfDay >= TICKS_PER_DAY) {
    tickOfDay = 0;
    day += 1;
    newDay = true;
  }
  phase = tickOfDay >= 4 ? "night" : "day";
  if (day > DAYS_PER_WEEK) {
    day = 1;
    week += 1;
    newWeek = true;
  }
  if (week > WEEKS_PER_SEASON) {
    week = 1;
    if (season === "winter") year += 1;
    season = NEXT_SEASON[season];
    weather = season === "winter" ? "snow" : SEASON_WEATHER[season][0]!;
  }
  if (newDay) {
    const pool = SEASON_WEATHER[season];
    weather = pool[day % pool.length]!;
  }
  return {
    clock: { season, year, week, day, tickOfDay, phase, weather, clock },
    newDay,
    newWeek,
  };
}

/** Offline pocket: live fog only. Book: `everywhere` — distant stumps also wait. */
export function tickGrow(world: World, season: Season, everywhere = false) {
  for (const t of world.tiles) {
    if (!t) continue;
    if (!everywhere && world.fog && (world.fog[t.y * world.width + t.x] ?? 0) !== 2) continue;
    growTile(world, t, season);
  }
}

export function growTile(world: World, t: Tile, season: Season) {
  if (t.building === "field") {
    growField(world, t, season);
    return;
  }
  if (!t.resource) return;
  if (
    t.resource === "herb" &&
    (t.road !== "none" || t.plot || t.commons || t.biome === "river" || t.biome === "ford")
  ) {
    return;
  }
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
