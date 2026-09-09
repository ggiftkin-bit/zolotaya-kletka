import type { AnimalKind, BuildingKind, GameState, Herd, Tile, World } from "./types";
import { tileAt } from "./worldgen";

export const ANIMAL_LABEL: Record<AnimalKind, string> = {
  hare: "заяц",
  deer: "олень",
  horse: "лошадь",
  cow: "корова",
  wolf: "волк",
};

export const TOOL_ITEMS = ["axe", "pick", "rope", "bucket", "spear", "shovel", "rod", "club", "knife", "steel_axe", "steel_pick", "steel_shovel"] as const;

export const COW_PRICE = 32;
export const HORSE_PRICE = 40;

const NEIGHBORS: Array<[number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export function nearWater(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(world, x + dx, y + dy);
      if (!t) continue;
      if (t.biome === "river" || t.biome === "ford") return true;
      if (t.building === "well" || t.building === "moat") return true;
    }
  }
  return false;
}

export function isWatered(world: World, tile: Tile): boolean {
  return (tile.cistern ?? 0) > 0 || nearWater(world, tile.x, tile.y);
}

export function waterHint(world: World, tile: Tile): string {
  if (tile.biome === "river" || tile.biome === "ford") return "вода здесь";
  if (nearWater(world, tile.x, tile.y)) return "вода рядом";
  if ((tile.cistern ?? 0) > 0) return `бочка ${tile.cistern}`;
  return "сухо · ведро, колодец или река";
}

export function needsWater(kind: BuildingKind): boolean {
  return kind === "field" || kind === "pen" || kind === "house" || kind === "shack" || kind === "stable";
}

export function makeHerd(kind: AnimalKind, count: number, wild: boolean): Herd {
  return { kind, count, wild, hunger: 0 };
}

function mix(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}

function shuffledNeighbors(x: number, y: number, salt: number): Array<[number, number]> {
  const out = NEIGHBORS.map(([dx, dy]) => [dx, dy] as [number, number]);
  let h = mix(x * 73856093 + y * 19349663 + salt * 83492791);
  for (let i = out.length - 1; i > 0; i--) {
    h = mix(h + i);
    const j = h % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function biomeOk(kind: AnimalKind, biome: Tile["biome"]): boolean {
  if (kind === "hare") return biome === "plains";
  if (kind === "deer" || kind === "wolf") return biome === "forest";
  if (kind === "horse") return biome === "plains" || biome === "forest";
  return false;
}

/** Дикое стадо: река, брод, тын, двор, тракт, шалаш, яма — нет. */
export function herdMayStand(world: World, x: number, y: number, kind: AnimalKind): boolean {
  const t = tileAt(world, x, y);
  if (!t) return false;
  if (!biomeOk(kind, t.biome)) return false;
  if (t.biome === "river" || t.biome === "ford") return false;
  if (t.road !== "none" || t.caravan) return false;
  if (t.plot) return false;
  if (t.fenceN !== "none" || t.fenceW !== "none") return false;
  if (t.building !== "none") return false;
  if (t.pit) return false;
  if (kind === "wolf" && t.commons) return false;
  if (t.herd && t.herd.count > 0) return false;
  if (t.horse) return false;
  return true;
}

/**
 * Сутки книги: дикое стадо шаг на соседа. Лошадей больше 1 на клетке нет.
 * Стол стадо не водит.
 */
export function tickWildHerds(world: World, salt: number) {
  const arrived = new Set<string>();
  const extras: Array<{ x: number; y: number; n: number }> = [];
  for (const t of world.tiles) {
    if (!t?.herd?.wild || t.herd.count <= 0) continue;
    if (t.horse) continue;
    if (t.herd.kind === "horse" && t.herd.count > 1) {
      extras.push({ x: t.x, y: t.y, n: t.herd.count - 1 });
      t.herd = { ...t.herd, count: 1 };
    }
  }
  for (const e of extras) {
    let left = e.n;
    for (const [dx, dy] of shuffledNeighbors(e.x, e.y, salt)) {
      if (left <= 0) break;
      const nx = e.x + dx;
      const ny = e.y + dy;
      if (!herdMayStand(world, nx, ny, "horse")) continue;
      const dest = tileAt(world, nx, ny);
      if (!dest) continue;
      dest.herd = makeHerd("horse", 1, true);
      arrived.add(`${nx},${ny}`);
      left -= 1;
    }
    if (left > 0) {
      const src = tileAt(world, e.x, e.y);
      if (src?.herd?.wild && src.herd.kind === "horse") src.herd = { ...src.herd, count: src.herd.count + left };
    }
  }

  const movers: Tile[] = [];
  for (const t of world.tiles) {
    if (!t?.herd?.wild || t.herd.count <= 0) continue;
    if (t.horse) continue;
    if (arrived.has(`${t.x},${t.y}`)) continue;
    movers.push(t);
  }
  for (const t of movers) {
    const herd = t.herd;
    if (!herd?.wild || herd.count <= 0) continue;
    let dest: Tile | null = null;
    for (const [dx, dy] of shuffledNeighbors(t.x, t.y, salt + 17)) {
      if (herdMayStand(world, t.x + dx, t.y + dy, herd.kind)) {
        dest = tileAt(world, t.x + dx, t.y + dy);
        break;
      }
    }
    if (!dest) continue;
    dest.herd = herd;
    t.herd = null;
  }
}

/** 5 недель мира = 30 суток. Потолок 4 в загоне. */
export const COW_BRED_DAYS = 30;
export const COW_PEN_CAP = 4;

function penHasFeed(tile: Tile): boolean {
  return (tile.chest?.herb ?? 0) > 0 || (tile.chest?.food ?? 0) > 0;
}

export function tickCowBirth(world: World) {
  for (const t of world.tiles) {
    if (!t) continue;
    const herd = t.herd;
    if (!herd || herd.wild || herd.kind !== "cow") continue;
    if (t.building !== "pen") continue;
    const ok = herd.count >= 2 && herd.count < COW_PEN_CAP && penHasFeed(t) && isWatered(world, t);
    if (!ok) {
      if (herd.bred) herd.bred = 0;
      continue;
    }
    herd.bred = (herd.bred ?? 0) + 1;
    if (herd.bred >= COW_BRED_DAYS) {
      herd.count += 1;
      herd.bred = 0;
    }
  }
}

/** 2 сезона = 36 суток. Не больше 3 своих стоящих у конюшни. */
export const HORSE_BRED_DAYS = 36;
export const HORSE_YARD_CAP = 3;

export function ownParkedHorseCount(world: World, x: number, y: number, owner: string): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(world, x + dx, y + dy);
      if (t?.horse && t.horse === owner) n += 1;
    }
  }
  return n;
}

function emptyYardNeighbor(world: World, stable: Tile): Tile | null {
  const owner = stable.owner;
  if (!owner) return null;
  for (const [dx, dy] of shuffledNeighbors(stable.x, stable.y, stable.x * 13 + stable.y * 17)) {
    const t = tileAt(world, stable.x + dx, stable.y + dy);
    if (!t) continue;
    if (!t.plot || t.owner !== owner) continue;
    if (t.horse || t.cart || t.wagon) continue;
    if (t.building !== "none" || t.pit) continue;
    return t;
  }
  return null;
}

export function tickHorseBirth(world: World) {
  for (const t of world.tiles) {
    if (!t || t.building !== "stable" || t.burned) continue;
    const owner = t.owner;
    if (!owner) continue;
    if (t.herd && t.herd.count > 0 && t.herd.kind !== "horse") continue;
    const n = ownParkedHorseCount(world, t.x, t.y, owner);
    const feed = penHasFeed(t);
    const wet = isWatered(world, t);
    if (n < 2 || n >= HORSE_YARD_CAP || !feed || !wet) {
      if (t.herd && (n < 2 || !feed || !wet)) t.herd = { ...t.herd, bred: 0 };
      if (t.herd && t.herd.kind === "horse" && t.herd.count <= 0 && !(t.herd.bred ?? 0)) t.herd = null;
      continue;
    }
    const tracker = t.herd ?? makeHerd("horse", 0, false);
    tracker.bred = (tracker.bred ?? 0) + 1;
    t.herd = tracker;
    if (tracker.bred < HORSE_BRED_DAYS) continue;
    const spot = emptyYardNeighbor(world, t);
    if (!spot) continue;
    spot.horse = owner;
    tracker.bred = 0;
    if (tracker.count <= 0) t.herd = null;
  }
}

const WOLF_CAP = 8;

/** Утро: шанс уйти с клетки. Не погоня. */
export function tickWolfMorning(world: World, salt: number) {
  for (const t of world.tiles) {
    if (!t?.herd?.wild || t.herd.kind !== "wolf") continue;
    const h = mix(t.x * 31 + t.y * 17 + salt);
    if (h % 100 < 28) t.herd = null;
  }
}

/** Редко на пустой лес вне двора. Ночью чаще. На поляну и двор — нет. */
export function tickWolfSpawn(world: World, night: boolean, salt: number) {
  let n = 0;
  const spots: Tile[] = [];
  for (const t of world.tiles) {
    if (!t) continue;
    if (t.herd?.kind === "wolf" && t.herd.count > 0) n += 1;
    if (t.biome === "forest" && !t.plot && !t.commons && herdMayStand(world, t.x, t.y, "wolf")) spots.push(t);
  }
  if (n >= WOLF_CAP || !spots.length) return;
  const p = night ? 0.32 : 0.1;
  if (mix(salt + 91) / 4294967296 > p) return;
  const pick = spots[mix(salt + 11) % spots.length]!;
  pick.herd = makeHerd("wolf", 1, true);
}

export function tickDayLife(world: World, season: GameState["season"]): string[] {
  const notes: string[] = [];
  for (const t of world.tiles) {
    if (t.cistern > 0) t.cistern -= 1;
    const wet = isWatered(world, t);
    const herd = t.herd;
    if (!herd || herd.count <= 0) {
      if (herd && t.building === "stable" && (herd.bred ?? 0) > 0) continue;
      if (herd) t.herd = null;
      continue;
    }
    if (herd.wild) continue;
    if (t.building !== "pen" && t.building !== "stable") continue;
    const chest = t.chest;
    const feed = chest.herb > 0 ? "herb" : chest.food > 0 ? "food" : null;
    if (feed) {
      chest[feed] -= 1;
      herd.hunger = 0;
    } else {
      herd.hunger += 1;
    }
    if (herd.kind === "cow" && t.building === "pen") {
      herd.age = (herd.age ?? 0) + 1;
      if (herd.age >= 36) {
        herd.count = 0;
        t.herd = null;
        notes.push("корова пала");
        continue;
      }
      if (feed && wet) {
        const old = herd.age >= 24;
        const milk = old ? (season === "winter" ? 0 : 1) : season === "winter" ? 1 : 2;
        if (milk > 0) {
          chest.food += milk;
          if (notes.length < 2) notes.push(old ? `Корова слабее. Молока +${milk}.` : `Коровы дали молоко (+${milk} еды).`);
        } else if (notes.length < 2) notes.push("Корова стара. Зимой молока нет.");
      } else if (!wet && feed) {
        if (notes.length < 2) notes.push("Загон без воды — молока нет. Колодец, река или ведро.");
      }
    }
    if (herd.hunger >= 4) {
      herd.count -= 1;
      herd.hunger = 2;
      notes.push(`${ANIMAL_LABEL[herd.kind]} ушла без корма.`);
    }
    if (herd.count <= 0) t.herd = null;
  }
  return notes;
}
