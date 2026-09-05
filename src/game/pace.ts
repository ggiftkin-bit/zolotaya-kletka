import type { Character } from "./types";

export const ENERGY_MAX = 18;
/** Real ms per +1 energy in the field. */
export const ENERGY_MS = 90_000;
export const ENERGY_HOME_MS = 45_000;
export const ENERGY_SLEEP_MS = 20_000;
export const BOOST_GOLD = 6;
export const BOOST_ENERGY = 4;
export const SKIP_GOLD = 8;
export const HIRE_GOLD = 12;
export const JAIL_MS = 80_000;
export const BAIL_GOLD = 12;
export const DOWN_MS = 90_000;
export const DEAD_MS = 120_000;
/** One game day: 8 ticks × 30 s. Walk lock after death. */
export const DAY_MS = 240_000;

export const NO_STRENGTH = "Нет силы. Ляг дома или кружка 6 золота.";

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

export function regenPaused(c: Character, now = Date.now()): boolean {
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

export function applyRegen(c: Character, now: number, roof: boolean): Character {
  if (regenPaused(c, now)) {
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

export function nextEnergyIn(c: Character, now: number, roof: boolean): number {
  if (regenPaused(c, now)) return -1;
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
