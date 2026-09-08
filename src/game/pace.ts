import type { Character } from "./types";

export const ENERGY_MAX = 18;
/** Real ms per +1 energy in the field. */
export const ENERGY_MS = 90_000;
export const ENERGY_HOME_MS = 45_000;
export const ENERGY_SLEEP_MS = 20_000;
export const BOOST_GOLD = 8;
export const BOOST_ENERGY = 4;
export const SKIP_GOLD = 12;
export const HIRE_GOLD = 16;
export const JAIL_MS = 80_000;
export const BAIL_GOLD = 20;
export const DOWN_MS = 90_000;
export const DEAD_MS = 120_000;
/** One game day: 8 ticks × 30 s. Walk lock after death. */
export const DAY_MS = 240_000;

export const NO_STRENGTH = "Нет силы. Ляг дома или кружка 8 золота.";

export const START_HP = 100;

export type Vigor = {
  energy: number;
  energyAt: number;
  resting: boolean;
  hp: number;
  life: "alive" | "down" | "jailed" | "dead";
  deaths: number;
  downAt: number;
  deadUntil: number;
};

export function vigorOf(
  body: {
    energy?: number;
    energyAt?: number;
    resting?: boolean;
    hp?: number;
    life?: string;
    deaths?: number;
    downAt?: number;
    deadUntil?: number;
  } | null | undefined,
  now = Date.now(),
): Vigor {
  const life =
    body?.life === "down" || body?.life === "jailed" || body?.life === "dead" ? body.life : "alive";
  const energy = typeof body?.energy === "number" && Number.isFinite(body.energy) ? body.energy : ENERGY_MAX;
  const hp = typeof body?.hp === "number" && Number.isFinite(body.hp) ? body.hp : START_HP;
  return {
    energy: Math.max(0, Math.min(ENERGY_MAX, energy)),
    energyAt: typeof body?.energyAt === "number" && body.energyAt > 0 ? body.energyAt : now,
    resting: !!body?.resting,
    hp: Math.max(0, Math.min(100, Math.floor(hp))),
    life,
    deaths: Math.max(0, Math.floor(Number(body?.deaths) || 0)),
    downAt: typeof body?.downAt === "number" ? body.downAt : 0,
    deadUntil: typeof body?.deadUntil === "number" ? body.deadUntil : 0,
  };
}

export function busyEnergy(kind: string): number {
  if (kind === "lock") return 3;
  if (kind === "catch") return 1;
  if (kind === "watch" || kind === "haul" || kind === "bring") return 0;
  if (
    kind === "hunt" ||
    kind === "fish" ||
    kind === "chop" ||
    kind === "mine" ||
    kind === "forage" ||
    kind === "craft" ||
    kind === "dig" ||
    kind === "build" ||
    kind === "road" ||
    kind === "fill" ||
    kind === "burn" ||
    kind === "drive"
  ) {
    return 2;
  }
  return 0;
}

/** Реген по часам. Книга крутит, не стол. */
export function regenVigor(
  v: Vigor,
  now: number,
  opts: { roof: boolean; walking: boolean; hungry: boolean; busyUntil?: number; hired?: boolean },
): Vigor {
  const paused = opts.walking || (!!opts.busyUntil && opts.busyUntil > now && !opts.hired);
  if (paused) {
    if (v.energyAt === now) return v;
    return { ...v, energyAt: now };
  }
  if (v.energy >= ENERGY_MAX) {
    if (v.resting) return { ...v, resting: false, energyAt: now };
    return v;
  }
  const last = v.energyAt || now;
  const ms = energyPeriod({ roof: opts.roof, sleeping: v.resting, hungry: opts.hungry });
  const gained = Math.floor((now - last) / ms);
  if (gained <= 0) return v;
  const energy = Math.min(ENERGY_MAX, v.energy + gained);
  return {
    ...v,
    energy,
    energyAt: last + gained * ms,
    resting: energy >= ENERGY_MAX ? false : v.resting,
  };
}

/** First death 0, then 10, 20, 30… */
export function deathFee(deaths: number): number {
  return Math.max(0, deaths) * 10;
}

export function energyPeriod(opts: { roof: boolean; sleeping: boolean; hungry: boolean }): number {
  let ms = ENERGY_MS;
  if (opts.roof) ms = ENERGY_HOME_MS;
  if (opts.sleeping) ms = ENERGY_SLEEP_MS;
  if (opts.hungry) ms = Math.floor(ms * 1.45);
  return ms;
}

export function regenPaused(c: Character, now = Date.now(), walking = false): boolean {
  if (walking) return true;
  return !!c.busy && c.busy.until > now && !c.busy.hired;
}

export function formatWait(ms: number): string {
  if (ms <= 0) return "сейчас";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} мин ${r} с` : `${m} мин`;
}

export function applyRegen(c: Character, now: number, roof: boolean, walking = false): Character {
  if (regenPaused(c, now, walking)) {
    if (c.energyAt === now) return c;
    return { ...c, energyAt: now };
  }
  if (c.energy >= ENERGY_MAX) {
    if (c.resting) return { ...c, resting: false, energyAt: now };
    return c;
  }
  const last = c.energyAt || now;
  const ms = energyPeriod({ roof, sleeping: !!c.resting, hungry: c.satiety < 25 });
  const gained = Math.floor((now - last) / ms);
  if (gained <= 0) return c;
  const energy = Math.min(ENERGY_MAX, c.energy + gained);
  return {
    ...c,
    energy,
    energyAt: last + gained * ms,
    resting: energy >= ENERGY_MAX ? false : c.resting,
  };
}

export function nextEnergyIn(c: Character, now: number, roof: boolean, walking = false): number {
  if (regenPaused(c, now, walking)) return -1;
  if (c.energy >= ENERGY_MAX) return 0;
  const last = c.energyAt || now;
  const ms = energyPeriod({ roof, sleeping: !!c.resting, hungry: c.satiety < 25 });
  const passed = (now - last) % ms;
  return ms - passed;
}

/** Старые сейвы держали в `water` ведро 0–3. Теперь вода тела 0–100, ведро — `pail`. */
export function splitBodyWater(raw: { water?: number; pail?: number }): { water: number; pail: number } {
  if (typeof raw.pail === "number") {
    return {
      water: Math.min(100, Math.max(0, raw.water ?? 90)),
      pail: Math.max(0, raw.pail),
    };
  }
  const w = raw.water;
  if (typeof w !== "number") return { water: 90, pail: 0 };
  if (w <= 12) return { water: 90, pail: w };
  return { water: Math.min(100, w), pail: 0 };
}
