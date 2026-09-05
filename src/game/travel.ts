import { isWooded } from "./grow";
import {
  BASE_SEC,
  CAPACITY,
  ITEM_WEIGHT,
  TERRAIN_COST,
} from "./constants";
import type { Inventory, ItemId, Tile, Transport, Weather } from "./types";

export function cargoWeight(inv: Inventory): number {
  let w = 0;
  for (const [k, n] of Object.entries(inv) as [keyof Inventory, number][]) {
    w += ITEM_WEIGHT[k] * n;
  }
  return w;
}

/** Надетое (тело, щит, шлем) не в сумке — весит отдельно. Рука уже в сумке. */
export function wornKg(c: { body?: ItemId | null; shield?: ItemId | null; helm?: ItemId | null }): number {
  let w = 0;
  if (c.body) w += ITEM_WEIGHT[c.body] ?? 0;
  if (c.shield) w += ITEM_WEIGHT[c.shield] ?? 0;
  if (c.helm) w += ITEM_WEIGHT[c.helm] ?? 0;
  return w;
}

export function pawnKg(c: {
  inventory: Inventory;
  body?: ItemId | null;
  shield?: ItemId | null;
  helm?: ItemId | null;
  pail?: number;
}): number {
  return cargoWeight(c.inventory) + wornKg(c) + pailKg(c.pail);
}

/** Полное ведро тяжелее пустого. Пустое ведро — вес предмета как был. */
export function pailKg(pail?: number): number {
  const n = pail ?? 0;
  if (n >= 3) return 4;
  if (n >= 2) return 3;
  if (n >= 1) return 2;
  return 0;
}

export function stepEnergy(transport: Transport): number {
  if (transport === "horse") return 0.2;
  if (transport === "cart") return 0.7;
  if (transport === "wagon") return 0.4;
  return 0.5;
}

export function loadRatio(inv: Inventory, transport: Transport, extraKg = 0): number {
  const cap = CAPACITY[transport];
  return (cargoWeight(inv) + extraKg) / cap;
}

export function enterCost(
  from: Tile,
  to: Tile,
  opts: {
    transport: Transport;
    inventory: Inventory;
    weather: Weather;
    diagonal: boolean;
    extraKg?: number;
  },
): number {
  if (to.biome === "river" && to.road !== "bridge") return Number.POSITIVE_INFINITY;
  const biome = to.biome === "forest" && !isWooded(to) ? "plains" : to.biome;
  const terrain = TERRAIN_COST[biome];
  if (!Number.isFinite(terrain)) return Number.POSITIVE_INFINITY;

  const onTo = to.road !== "none";
  const onFrom = from.road !== "none";
  let road = 1;
  if (to.road === "dirt") road = 0.4;
  if (to.road === "stone") road = 0.3;
  if (to.road === "bridge") road = 0.52;
  if (onFrom && !onTo) road *= 1.25;

  const { transport } = opts;
  let speed = 1;
  const hill = to.biome === "mountain" || to.biome === "ore";
  if (transport === "walk") {
    speed = 1;
  } else if (transport === "cart") {
    // Cargo, not a racer: same pace as walk on a path, a bit slower in the wild.
    speed = onTo ? 1 : 0.85;
    if (hill) speed *= 0.4;
  } else if (transport === "horse") {
    // Always ~2½× a walker. Roads already cut time for everyone.
    speed = 2.5;
    if (hill) speed *= 0.7;
  } else if (transport === "wagon") {
    // Horse + wagon: slower than a bare horse, faster than a cart. Built for hauls.
    speed = onTo ? 1.8 : 1.55;
    if (hill) speed *= 0.45;
  }

  const ratio = loadRatio(opts.inventory, transport, opts.extraKg ?? 0);
  const penalty =
    transport === "wagon" ? 0.22 : transport === "cart" ? 0.28 : transport === "horse" ? 0.85 : 1.15;
  const loadMult = 1 + Math.max(0, ratio - 0.25) * penalty;
  const over = ratio > 1 ? 1.55 : 1;

  let weather = 1;
  if (opts.weather === "rain") weather = onTo ? 1.08 : 1.42;
  if (opts.weather === "snow") weather = onTo ? 1.18 : 1.72;

  const diag = opts.diagonal ? Math.SQRT2 : 1;
  return (BASE_SEC * terrain * road * loadMult * over * weather * diag) / speed;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "нет пути";
  if (sec < 10) return `${sec.toFixed(1)} с`;
  if (sec < 60) return `${Math.round(sec)} с`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} мин ${s} с`;
}
