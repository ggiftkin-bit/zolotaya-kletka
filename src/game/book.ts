import { ENERGY_MAX, splitBodyWater } from "./pace";
import { emptySkills } from "./economy";
import { MAP_H, MAP_W, zeroInv } from "./constants";
import { fatTile, slimTile, type SlimTile } from "./save";
import type { Busy, Character, FenceKind, Inventory, OtherPawn, Season, Skills, Tile, Transport, Weather, World } from "./types";

export type { OtherPawn };

export const WORLD_ID = "kletka";
export const WORLD_SEED = "kletka-land-02";
export const FOG_R = 2;
/** С горы или башни пятно дальше. */
export const FOG_R_HIGH = 5;
/** Сколько клеток книга отдаёт фишке (не больше высокого пятна). */
export const FOG_FETCH = 5;
export const FOG_DARK = 0;
export const FOG_MEM = 1;
export const FOG_LIVE = 2;

export type FightSnap = {
  name: string;
  color: string;
  hp: number;
  hand: Character["hand"];
  body: Character["body"];
  shield: Character["shield"];
  helm: Character["helm"];
};

export type BookFight = {
  id: string;
  x: number;
  y: number;
  aId: string;
  bId: string;
  turnId: string;
  aHp: number;
  bHp: number;
  aSnap: FightSnap;
  bSnap: FightSnap;
  lastHit: { by: string; dmg: number } | null;
  status: "open" | "done";
};

export function fightPairId(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** В книге двор — user_id. На столе свой двор всегда «you». */
export function localizeOwner(owner: string | undefined, selfId: string): string {
  if (!owner) return "";
  if (selfId && owner === selfId) return "you";
  if (owner === "you") return "";
  return owner;
}

export function publishOwner(owner: string | undefined, selfId: string): string {
  if (!owner) return "";
  if (owner === "you") return selfId || "you";
  return owner;
}

export type TilePacket = {
  x: number;
  y: number;
  slim: SlimTile;
  ver: number;
  updatedAt?: string;
};

export type MemoryPacket = {
  x: number;
  y: number;
  slim: SlimTile;
};

export type WorldClock = {
  season: Season;
  year: number;
  week: number;
  day: number;
  tickOfDay: number;
  phase: "day" | "night";
  weather: Weather;
  clock: number;
};

export type PawnBody = {
  gold: number;
  inventory: Inventory;
  transport: Transport;
  energy: number;
  satiety: number;
  warmth: number;
  hp: number;
  profession: Character["profession"];
  skills: Skills;
  seasonSkillGain: number;
  profWeek: number;
  hand: Character["hand"];
  body: Character["body"];
  shield: Character["shield"];
  helm: Character["helm"];
  horses: number;
  carts: number;
  wagon: boolean;
  water: number;
  pail: number;
  sipTick?: number;
  energyAt: number;
  wanted: number;
  jailedUntil: number;
  jailWhy: string;
  life: Character["life"];
  downAt: number;
  deadUntil: number;
  deaths: number;
  stillUntil: number;
  resting: boolean;
  busy: Busy | null;
  wear: Character["wear"];
  bagWear?: Character["bagWear"];
  pacts: Record<string, "friend" | "feud">;
  village: string;
};

export type PawnRow = {
  name: string;
  color: string;
  x: number;
  y: number;
  body: PawnBody | null;
};

export type BookSnapshot = {
  ok: true;
  born: boolean;
  clock: WorldClock;
  pawn: PawnRow | null;
  live: TilePacket[];
  memory: MemoryPacket[];
  others: OtherPawn[];
  fight: BookFight | null;
  since: string;
};

export function chebyshev(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function tileIndex(x: number, y: number, width = MAP_W) {
  return y * width + x;
}

export function fogAt(world: World, x: number, y: number): number {
  if (!world.fog) return FOG_LIVE;
  return world.fog[tileIndex(x, y, world.width)] ?? FOG_DARK;
}

function tileOf(world: World, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return undefined;
  return world.tiles[tileIndex(x, y, world.width)];
}

function isRiverish(t: Tile | undefined) {
  return !!t && (t.biome === "river" || t.biome === "ford");
}

/** 2 клетки кругом. Дальше — только стоя на горе / жиле или в своей башне. */
export function sightRadius(world: World, px: number, py: number): number {
  const here = tileOf(world, px, py);
  if (!here) return FOG_R;
  if (here.biome === "mountain" || here.biome === "ore") return FOG_R_HIGH;
  if (here.building === "tower" && (!here.owner || here.owner === "you")) return FOG_R_HIGH;
  return FOG_R;
}

function coverLine(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [[x0, y0]];
  const nx = Math.abs(x1 - x0);
  const ny = Math.abs(y1 - y0);
  const sx = Math.sign(x1 - x0) || 0;
  const sy = Math.sign(y1 - y0) || 0;
  let px = x0;
  let py = y0;
  for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
    const xerr = (ix + 0.5) * ny;
    const yerr = (iy + 0.5) * nx;
    if (xerr === yerr) {
      px += sx;
      py += sy;
      ix += 1;
      iy += 1;
    } else if (xerr < yerr) {
      px += sx;
      ix += 1;
    } else {
      py += sy;
      iy += 1;
    }
    pts.push([px, py]);
    if (pts.length > 16) break;
  }
  return pts;
}

/** Не видно, что за рекой. Вдоль реки — видно. */
export function canSee(world: World, px: number, py: number, x: number, y: number): boolean {
  if (px === x && py === y) return true;
  if (chebyshev(x, y, px, py) > sightRadius(world, px, py)) return false;
  const line = coverLine(px, py, x, y);
  for (let i = 1; i < line.length - 1; i++) {
    const [lx, ly] = line[i]!;
    if (!isRiverish(tileOf(world, lx, ly))) continue;
    if (!isRiverish(tileOf(world, x, y))) return false;
  }
  return true;
}

export function maskLiveFog(world: World, px: number, py: number): World {
  if (!world.fog) return world;
  const fog = world.fog.slice();
  const w = world.width;
  const r = sightRadius(world, px, py);
  const x0 = Math.max(0, px - r);
  const y0 = Math.max(0, py - r);
  const x1 = Math.min(w - 1, px + r);
  const y1 = Math.min(world.height - 1, py + r);
  for (let i = 0; i < fog.length; i++) {
    if (fog[i] !== FOG_LIVE) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (!canSee(world, px, py, x, y)) fog[i] = FOG_MEM;
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!canSee(world, px, py, x, y)) continue;
      fog[tileIndex(x, y, w)] = FOG_LIVE;
    }
  }
  return { ...world, fog };
}

export function allLiveFog(n = MAP_W * MAP_H): number[] {
  return new Array(n).fill(FOG_LIVE);
}

export function allDarkFog(n = MAP_W * MAP_H): number[] {
  return new Array(n).fill(FOG_DARK);
}

/** Живое пятно прошлого входа → память. Нет массива — тьма. */
export function rememberFog(fog: number[] | undefined, n: number): number[] {
  if (!fog || fog.length !== n) return allDarkFog(n);
  const out = fog.slice();
  for (let i = 0; i < out.length; i++) {
    const f = out[i] ?? FOG_DARK;
    out[i] = f === FOG_LIVE ? FOG_MEM : f;
  }
  return out;
}

export function allOnesVer(n = MAP_W * MAP_H): number[] {
  return new Array(n).fill(1);
}

function emptyInv(): Inventory {
  return zeroInv();
}

export function darkWorld(seed = WORLD_SEED): World {
  const tiles: Tile[] = new Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      tiles[tileIndex(x, y)] = fatTile({ b: "plains" }, x, y);
    }
  }
  return {
    seed,
    width: MAP_W,
    height: MAP_H,
    tiles,
    fog: allDarkFog(),
    ver: allOnesVer(),
  };
}

export function packPawn(c: Character): PawnBody {
  return {
    gold: c.gold,
    inventory: c.inventory,
    transport: c.transport,
    energy: c.energy,
    satiety: c.satiety,
    warmth: c.warmth,
    hp: c.hp,
    profession: c.profession,
    skills: c.skills,
    seasonSkillGain: c.seasonSkillGain,
    profWeek: c.profWeek,
    hand: c.hand,
    body: c.body ?? null,
    shield: c.shield ?? null,
    helm: c.helm ?? null,
    horses: c.horses,
    carts: c.carts,
    wagon: c.wagon,
    water: c.water,
    pail: c.pail,
    sipTick: c.sipTick ?? 0,
    energyAt: c.energyAt,
    wanted: c.wanted,
    jailedUntil: c.jailedUntil,
    jailWhy: c.jailWhy,
    life: c.life,
    downAt: c.downAt,
    deadUntil: c.deadUntil,
    deaths: c.deaths,
    stillUntil: c.stillUntil,
    resting: c.resting,
    busy: c.busy,
    wear: c.wear ?? {},
    bagWear: c.bagWear ?? {},
    pacts: c.pacts,
    village: c.village,
  };
}

export function unpackPawn(row: PawnRow): Character {
  const packed = (row.body && typeof row.body === "object" ? row.body : {}) as Partial<Character>;
  const inv = { ...emptyInv(), ...(packed.inventory ?? {}) };
  return {
    name: row.name || "Испытатель",
    color: row.color || "#6b3a2a",
    x: row.x,
    y: row.y,
    px: row.x,
    py: row.y,
    gold: typeof packed.gold === "number" ? packed.gold : 20,
    inventory: inv,
    transport: packed.transport ?? "walk",
    energy: typeof packed.energy === "number" ? Math.min(ENERGY_MAX, packed.energy) : ENERGY_MAX,
    satiety: packed.satiety ?? 90,
    warmth: packed.warmth ?? 90,
    hp: packed.hp ?? 100,
    profession: packed.profession ?? "wanderer",
    skills: { ...emptySkills(), ...(packed.skills ?? {}) },
    seasonSkillGain: packed.seasonSkillGain ?? 0,
    profWeek: packed.profWeek ?? 0,
    hand: packed.hand ?? "axe",
    body: packed.body ?? null,
    shield: packed.shield ?? null,
    helm: packed.helm ?? null,
    horses: packed.horses ?? 0,
    carts: packed.carts ?? 0,
    wagon: !!packed.wagon,
    ...splitBodyWater(packed),
    sipTick: packed.sipTick ?? 0,
    energyAt: packed.energyAt ?? Date.now(),
    wanted: packed.wanted ?? 0,
    jailedUntil: packed.jailedUntil ?? 0,
    jailWhy: packed.jailWhy ?? "",
    life: packed.life ?? "alive",
    downAt: packed.downAt ?? 0,
    deadUntil: packed.deadUntil ?? 0,
    deaths: packed.deaths ?? 0,
    stillUntil: packed.stillUntil ?? 0,
    resting: !!packed.resting,
    busy: packed.busy ?? null,
    wear: packed.wear ?? {},
    bagWear: packed.bagWear ?? {},
    pacts: packed.pacts ?? {},
    village: packed.village ?? "",
  };
}

const FENCE_RANK: Record<FenceKind, number> = { none: 0, wood: 1, gate: 1, palisade: 2, wall: 3 };

/** Книга без fn/fw не затирает живой тын кармана деревом по умолчанию. Снятый двор (plot→false) — входящее ребро. */
function mergeBookTile(prev: Tile | undefined, slim: SlimTile, x: number, y: number): Tile {
  const next = fatTile(slim, x, y);
  if (!prev) return next;
  if (prev.plot && !next.plot) return next;
  const keep = (side: "n" | "w"): FenceKind => {
    const incoming = side === "n" ? next.fenceN : next.fenceW;
    const old = side === "n" ? prev.fenceN : prev.fenceW;
    const has = side === "n" ? slim.fn != null : slim.fw != null;
    if (!has) return old !== "none" ? old : incoming;
    if (incoming === "gate") return incoming;
    if (FENCE_RANK[old] > FENCE_RANK[incoming]) return old;
    return incoming;
  };
  next.fenceN = keep("n");
  next.fenceW = keep("w");
  return next;
}

export function applyLive(world: World, packets: TilePacket[]): World {
  const tiles = world.tiles.slice();
  const fog = (world.fog ?? allDarkFog(tiles.length)).slice();
  const ver = (world.ver ?? allOnesVer(tiles.length)).slice();
  for (const p of packets) {
    if (p.x < 0 || p.y < 0 || p.x >= world.width || p.y >= world.height) continue;
    const i = tileIndex(p.x, p.y, world.width);
    tiles[i] = mergeBookTile(tiles[i], p.slim, p.x, p.y);
    ver[i] = p.ver;
  }
  return { ...world, tiles, fog, ver };
}

export function applyMemory(world: World, packets: MemoryPacket[]): World {
  const tiles = world.tiles.slice();
  const fog = (world.fog ?? allDarkFog(tiles.length)).slice();
  const ver = (world.ver ?? allOnesVer(tiles.length)).slice();
  for (const p of packets) {
    if (p.x < 0 || p.y < 0 || p.x >= world.width || p.y >= world.height) continue;
    const i = tileIndex(p.x, p.y, world.width);
    if (fog[i] === FOG_LIVE) continue;
    tiles[i] = mergeBookTile(tiles[i], p.slim, p.x, p.y);
    fog[i] = FOG_MEM;
  }
  return { ...world, tiles, fog, ver };
}

export function demoteSpot(world: World, px: number, py: number): World {
  return maskLiveFog(world, px, py);
}

export function liveTilesOf(world: World, px: number, py: number): Tile[] {
  const out: Tile[] = [];
  const r = sightRadius(world, px, py);
  const x0 = Math.max(0, px - r);
  const y0 = Math.max(0, py - r);
  const x1 = Math.min(world.width - 1, px + r);
  const y1 = Math.min(world.height - 1, py + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!canSee(world, px, py, x, y)) continue;
      const t = world.tiles[tileIndex(x, y, world.width)];
      if (t) out.push(t);
    }
  }
  return out;
}

export function slimOf(t: Tile): SlimTile {
  return slimTile(t);
}
