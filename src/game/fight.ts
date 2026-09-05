import { ENERGY_MAX } from "./pace";
import { HAMLETS } from "./pact";
import { MEEPLE_COLORS } from "./constants";
import type { Character, Dummy, ItemId, OtherPawn, Profession, Skills, World } from "./types";

export type Fighter = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  hp: number;
  energy: number;
  satiety: number;
  warmth: number;
  water: number;
  hand: ItemId | null;
  body: ItemId | null;
  shield: ItemId | null;
  helm: ItemId | null;
  profession: Profession;
  skills: Skills;
  life: "alive" | "down";
  dummy: boolean;
  downAt: number;
  inventory: Partial<Record<ItemId, number>>;
};

export type StrikeCtx = {
  night: boolean;
  first: boolean;
  winter: boolean;
  roof: boolean;
  ownYard: boolean;
  foreignYard: boolean;
  atYard: boolean;
  foeStealth: number;
};

const DUMMY_JOB: Record<
  string,
  {
    name: string;
    profession: Profession;
    hand: ItemId | null;
    body: ItemId | null;
    shield: ItemId | null;
    helm: ItemId | null;
    fight: number;
    stealth: number;
    speech: number;
  }
> = {
  сосед: { name: "Сосед", profession: "hireling", hand: "spear", body: null, shield: "board_shield", helm: null, fight: 3, stealth: 1, speech: 1 },
  Игнат: { name: "Игнат", profession: "lumberjack", hand: "axe", body: null, shield: null, helm: null, fight: 1, stealth: 0, speech: 0 },
  Маша: { name: "Маша", profession: "farmer", hand: null, body: "wadded", shield: null, helm: null, fight: 0, stealth: 0, speech: 2 },
  Степан: { name: "Степан", profession: "miner", hand: "pick", body: null, shield: null, helm: null, fight: 1, stealth: 0, speech: 0 },
};

export function chebyshev(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function youFighter(c: Character): Fighter {
  return {
    id: "you",
    name: c.name,
    color: c.color,
    x: c.x,
    y: c.y,
    hp: c.hp,
    energy: c.energy,
    satiety: c.satiety,
    warmth: c.warmth,
    water: c.water,
    hand: c.hand,
    body: c.body ?? null,
    shield: c.shield ?? null,
    helm: c.helm ?? null,
    profession: c.profession,
    skills: c.skills,
    life: c.life === "down" ? "down" : "alive",
    dummy: false,
    downAt: c.downAt ?? 0,
    inventory: {},
  };
}

function zSkills(fight = 0, stealth = 0, speech = 0): Skills {
  return {
    survival: 1,
    craft: 0,
    build: 0,
    trade: 0,
    agro: 0,
    mine: 0,
    fight,
    stealth,
    speech,
    lead: 0,
    law: 0,
    med: 0,
  };
}

export function dummyHome(world: World, owner: string): { x: number; y: number } | null {
  const house = world.tiles.find(
    (t) => t.owner === owner && (t.building === "house" || t.building === "shack") && !t.burned,
  );
  if (house) return { x: house.x, y: house.y };
  const any = world.tiles.find((t) => t.plot && t.owner === owner);
  return any ? { x: any.x, y: any.y } : null;
}

export function makeHamletDummies(world: World, prev?: Fighter[]): Dummy[] {
  const out: Dummy[] = [];
  HAMLETS.forEach((h, i) => {
    const home = dummyHome(world, h.owner);
    if (!home) return;
    const old = prev?.find((d) => d.id === h.owner);
    const spec = DUMMY_JOB[h.owner] ?? {
      name: h.owner,
      profession: "wanderer" as const,
      hand: null,
      body: null,
      shield: null,
      helm: null,
      fight: 0,
      stealth: 0,
      speech: 0,
    };
    out.push({
      id: h.owner,
      name: spec.name,
      color: MEEPLE_COLORS[i % MEEPLE_COLORS.length]!,
      x: old?.life === "down" ? old.x : home.x,
      y: old?.life === "down" ? old.y : home.y,
      hp: old?.hp ?? 100,
      energy: 18,
      satiety: 80,
      warmth: 80,
      water: 80,
      hand: spec.hand,
      body: spec.body,
      shield: spec.shield,
      helm: spec.helm,
      profession: spec.profession,
      skills: zSkills(spec.fight, spec.stealth, spec.speech),
      life: old?.life === "down" && (old.hp ?? 0) <= 0 ? "down" : "alive",
      dummy: true as const,
      downAt: old?.downAt ?? 0,
      inventory: old?.inventory ?? { food: 3, wood: 2 },
    });
  });
  return out;
}

export function dummyAt(dummies: Dummy[], x: number, y: number): Dummy | null {
  return dummies.find((d) => d.x === x && d.y === y) ?? null;
}

/** Живого на клетке рисуем тем же листом, что манекена. Здоровье книги не трогаем. */
export function liveAsDummy(o: OtherPawn): Dummy {
  return {
    id: o.id,
    name: o.name || "чужой",
    color: o.color || MEEPLE_COLORS[0]!,
    x: o.x,
    y: o.y,
    hp: 100,
    energy: ENERGY_MAX,
    satiety: 80,
    warmth: 80,
    water: 80,
    hand: null,
    body: null,
    shield: null,
    helm: null,
    profession: "wanderer",
    skills: zSkills(0, 0, 0),
    life: "alive",
    dummy: false,
    downAt: 0,
    inventory: {},
  };
}

export function occupantAt(dummies: Dummy[], others: OtherPawn[], x: number, y: number): Dummy | null {
  const o = others.find((p) => p.x === x && p.y === y);
  if (o) return liveAsDummy(o);
  return dummyAt(dummies, x, y);
}

export function foeById(dummies: Dummy[], others: OtherPawn[], id: string): Dummy | null {
  const d = dummies.find((x) => x.id === id);
  if (d) return d;
  const o = others.find((p) => p.id === id);
  return o ? liveAsDummy(o) : null;
}

export function gearSlot(id: ItemId): "body" | "shield" | "helm" | null {
  if (id === "wadded") return "body";
  if (id === "board_shield" || id === "bar_shield") return "shield";
  if (id === "helm") return "helm";
  return null;
}

export function handMult(hand: ItemId | null, first: boolean, atYard: boolean, night = false): number {
  if (hand === "spear") return 1.25 * (first ? 1.1 : 1);
  if (hand === "club") return 1.1;
  if (hand === "knife") return 1.15 * (night ? 1.05 : 1);
  if (hand === "axe") return 1.05 * (atYard ? 1.1 : 1);
  if (hand === "pick") return 0.9;
  if (hand === "shovel") return 0.75;
  if (hand === "rope" || hand === "rod" || hand === "bucket") return 0.65;
  return 0.55;
}

export function armorMult(def: { shield?: ItemId | null; body?: ItemId | null; helm?: ItemId | null } | null | undefined): number {
  if (!def) return 1;
  let m = 1;
  if (def.shield === "board_shield") m *= 0.8;
  if (def.shield === "bar_shield") m *= 0.65;
  if (def.body === "wadded") m *= 0.88;
  if (def.helm === "helm") m *= 0.85;
  return Math.max(0.45, m);
}

export function profHit(p: Profession): number {
  if (p === "hireling") return 1.15;
  if (p === "miner" || p === "lumberjack") return 1.05;
  if (p === "healer") return 0.9;
  if (p === "trader") return 0.95;
  return 1;
}

export function bodyMult(f: Fighter, winter: boolean, roof: boolean): number {
  let m = 1;
  if (f.satiety < 25) m *= 0.7;
  if (f.warmth < 25) {
    m *= 0.75;
    if (winter && !roof) m *= 0.9;
  }
  if (f.water < 25) m *= 0.85;
  if (f.hp < 15) m *= 0.6;
  else if (f.hp < 40) m *= 0.8;
  if (f.satiety > 60 && f.warmth > 60 && f.water > 60) m *= 1.05;
  return m;
}

export function strikeDmg(atk: Fighter, ctx: StrikeCtx, def?: Fighter | Dummy | null): { dmg: number; sneak: boolean } {
  const en = Math.max(0, atk.energy);
  let base = 4 * (en / ENERGY_MAX);
  if (en < 1) base *= 0.4;
  let m = 1;
  m *= handMult(atk.hand, ctx.first, ctx.atYard, ctx.night);
  m *= profHit(atk.profession);
  m *= bodyMult(atk, ctx.winter, ctx.roof);
  const sneak = ctx.night && ctx.first && (atk.skills.stealth ?? 0) > ctx.foeStealth;
  if (sneak) m *= 1.15;
  if (ctx.ownYard) m *= 1.1;
  else if (ctx.foreignYard) m *= 0.9;
  m *= 1 + (atk.skills.fight ?? 0) * 0.02;
  const raw = base * m * armorMult(def);
  const dmg = Math.max(1, Math.min(12, Math.round(raw)));
  return { dmg, sneak };
}

export function talkChance(you: Fighter, trader: boolean): number {
  let p = 0.22 + (you.skills.speech ?? 0) * 0.08;
  if (trader) p += 0.08;
  return Math.min(0.82, Math.max(0.12, p));
}

export function leaveChance(night: boolean, stealth: number): number {
  if (!night) return 1;
  return Math.min(0.92, Math.max(0.28, 0.4 + stealth * 0.05));
}
