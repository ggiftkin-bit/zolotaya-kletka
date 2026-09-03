import { createNoise2D } from "simplex-noise";
import { MAP_H, MAP_W } from "./constants";
import { makeHerd } from "./life";
import { HAMLETS, PLAYER_FIELD } from "./pact";
import { rngFromSeed } from "./rng";
import type { Biome, RoadKind, Tile, World } from "./types";

function fbm(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves = 3,
): number {
  let v = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / norm;
}

function idx(x: number, y: number) {
  return y * MAP_W + x;
}

function inBounds(x: number, y: number) {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
}

function pickBiome(elev: number, moist: number, ridge: number): Biome {
  if (elev > 0.72 && ridge > 0.35) return "ore";
  if (elev > 0.62) return "mountain";
  if (elev < 0.28 && moist > 0.55) return "swamp";
  if (moist > 0.58 && elev < 0.55) return "forest";
  if (moist > 0.42 && elev > 0.34 && elev < 0.52) return "fertile";
  return "plains";
}

function carveRiver(
  tiles: Tile[],
  rng: () => number,
  startX: number,
  startY: number,
  dirX: number,
  dirY: number,
) {
  let x = startX;
  let y = startY;
  for (let step = 0; step < MAP_W + MAP_H; step++) {
    if (!inBounds(x, y)) break;
    const t = tiles[idx(x, y)];
    if (t) {
      t.biome = "river";
      t.resource = null;
      t.amount = 0;
      t.road = "none";
    }
    if (rng() < 0.18) x += rng() < 0.5 ? -1 : 1;
    if (rng() < 0.18) y += rng() < 0.5 ? -1 : 1;
    x += dirX;
    y += dirY;
    if (rng() < 0.08) {
      if (dirX !== 0 && rng() < 0.5) y += rng() < 0.5 ? -1 : 1;
      if (dirY !== 0 && rng() < 0.5) x += rng() < 0.5 ? -1 : 1;
    }
  }
}

function placeFords(tiles: Tile[], rng: () => number) {
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const t = tiles[idx(x, y)];
      if (!t || t.biome !== "river") continue;
      const n =
        (tiles[idx(x + 1, y)]?.biome !== "river" ? 1 : 0) +
        (tiles[idx(x - 1, y)]?.biome !== "river" ? 1 : 0) +
        (tiles[idx(x, y + 1)]?.biome !== "river" ? 1 : 0) +
        (tiles[idx(x, y - 1)]?.biome !== "river" ? 1 : 0);
      if (n >= 2 && rng() < 0.08) {
        t.biome = "ford";
        t.resource = "fish";
        t.amount = 6 + Math.floor(rng() * 6);
      }
    }
  }
}

function floodWalkable(tiles: Tile[], sx: number, sy: number): boolean[] {
  const seen = new Array(tiles.length).fill(false);
  const q = [idx(sx, sy)];
  seen[idx(sx, sy)] = true;
  let head = 0;
  while (head < q.length) {
    const i = q[head++]!;
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    const neigh = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neigh) {
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (seen[ni]) continue;
      const b = tiles[ni]?.biome;
      if (b === "river") continue;
      seen[ni] = true;
      q.push(ni);
    }
  }
  return seen;
}

function widenRiver(tiles: Tile[], rng: () => number) {
  const extra: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i]?.biome !== "river") continue;
    if (rng() > 0.22) continue;
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    const n = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of n) {
      if (!inBounds(nx, ny)) continue;
      extra.push(idx(nx, ny));
    }
  }
  for (const i of extra) {
    const t = tiles[i];
    if (!t || t.biome === "river") continue;
    t.biome = "river";
    t.resource = null;
    t.amount = 0;
    t.road = "none";
  }
}

function carveLake(tiles: Tile[], cx: number, cy: number, rInner: number, rOuter: number) {
  for (let y = cy - rOuter - 1; y <= cy + rOuter + 1; y++) {
    for (let x = cx - rOuter - 1; x <= cx + rOuter + 1; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > rInner && d <= rOuter) {
        const t = tiles[idx(x, y)]!;
        t.biome = "river";
        t.resource = null;
        t.amount = 0;
        t.road = "none";
      }
    }
  }
}

function sprinkleResources(tiles: Tile[], rng: () => number) {
  for (const t of tiles) {
    if (t.biome === "river") continue;
    if (t.biome === "ford") {
      t.resource = "fish";
      t.amount = 5 + Math.floor(rng() * 5);
      continue;
    }
    if (t.biome === "forest") {
      if (rng() < 0.55) {
        t.resource = "wood";
        t.amount = 6 + Math.floor(rng() * 7);
      } else {
        t.biome = "plains";
        t.resource = "herb";
        t.amount = 3 + Math.floor(rng() * 3);
      }
    } else if (t.biome === "mountain") {
      if (rng() < 0.38) {
        t.resource = "stone";
        t.amount = 5 + Math.floor(rng() * 6);
      }
    } else if (t.biome === "ore") {
      t.resource = "ore";
      t.amount = 3 + Math.floor(rng() * 4);
    } else if (t.biome === "fertile") {
      if (rng() < 0.55) {
        t.resource = "food";
        t.amount = 4 + Math.floor(rng() * 4);
      }
    } else if (t.biome === "plains") {
      if (rng() < 0.08) {
        t.resource = "food";
        t.amount = 2 + Math.floor(rng() * 2);
      } else if (rng() < 0.22) {
        t.resource = "herb";
        t.amount = 2 + Math.floor(rng() * 3);
      }
    } else if (t.biome === "swamp") {
      if (rng() < 0.4) {
        t.resource = "herb";
        t.amount = 3 + Math.floor(rng() * 4);
      }
    }
  }
}

function placeClay(tiles: Tile[], rng: () => number) {
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const t = tiles[idx(x, y)]!;
      if (t.biome === "river" || t.resource) continue;
      const nearRiver =
        tiles[idx(x + 1, y)]?.biome === "river" ||
        tiles[idx(x - 1, y)]?.biome === "river" ||
        tiles[idx(x, y + 1)]?.biome === "river" ||
        tiles[idx(x, y - 1)]?.biome === "river";
      if (nearRiver && rng() < 0.28) {
        t.resource = "clay";
        t.amount = 4 + Math.floor(rng() * 5);
      }
    }
  }
}

function placeAnimals(tiles: Tile[], spawnX: number, spawnY: number, rng: () => number) {
  const put = (x: number, y: number, kind: "hare" | "deer" | "horse", count: number) => {
    if (!inBounds(x, y)) return;
    const t = tiles[idx(x, y)]!;
    if (t.biome === "river" || t.caravan || t.commons) return;
    t.herd = makeHerd(kind, count, true);
  };
  put(spawnX + 7, spawnY + 1, "hare", 2);
  put(spawnX - 6, spawnY + 3, "hare", 1);
  put(spawnX + 4, spawnY - 6, "deer", 1);
  put(spawnX + 16, spawnY + 1, "horse", 2);
  put(spawnX - 18, spawnY - 4, "horse", 1);

  for (const t of tiles) {
    if (t.herd || t.commons || t.caravan || t.biome === "river") continue;
    const d = Math.abs(t.x - spawnX) + Math.abs(t.y - spawnY);
    if (d < 8) continue;
    if (t.biome === "plains" && rng() < 0.035) t.herd = makeHerd("hare", 1 + Math.floor(rng() * 2), true);
    else if (t.biome === "forest" && rng() < 0.05) t.herd = makeHerd("deer", 1, true);
    else if (t.biome === "plains" && d > 18 && rng() < 0.008) {
      t.herd = makeHerd("horse", 1 + Math.floor(rng() * 2), true);
    }
  }
}

function seedIslands(tiles: Tile[], spawnX: number, spawnY: number, rng: () => number) {
  const reach = floodWalkable(tiles, spawnX, spawnY);
  for (let i = 0; i < tiles.length; i++) {
    if (reach[i]) continue;
    const t = tiles[i]!;
    if (t.biome === "river") continue;
    if (rng() < 0.18) {
      t.resource = "crystal";
      t.amount = 2 + Math.floor(rng() * 3);
    } else if (rng() < 0.22 && !t.resource) {
      t.resource = "herb";
      t.amount = 4 + Math.floor(rng() * 4);
    }
  }
}

function seedHamlets(tiles: Tile[], spawnX: number, spawnY: number) {
  for (const h of HAMLETS) stampHamlet(tiles, spawnX, spawnY, h);
}

function stampHamlet(
  tiles: Tile[],
  spawnX: number,
  spawnY: number,
  h: (typeof HAMLETS)[number],
) {
  const x0 = spawnX + h.dx;
  const y0 = spawnY + h.dy;
  const x1 = x0 + h.w - 1;
  const y1 = y0 + h.h - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inBounds(x, y)) continue;
      const t = tiles[idx(x, y)]!;
      if (t.biome === "river") t.biome = "plains";
      t.commons = false;
      t.caravan = false;
      t.resource = null;
      t.amount = 0;
      t.owned = true;
      t.plot = true;
      t.owner = h.owner;
      t.law = true;
      t.herd = null;
    }
  }
  for (let x = x0; x <= x1; x++) {
    if (inBounds(x, y0) && tiles[idx(x, y0)]) tiles[idx(x, y0)]!.fenceN = "wood";
    if (inBounds(x, y1 + 1) && tiles[idx(x, y1 + 1)]) tiles[idx(x, y1 + 1)]!.fenceN = "wood";
  }
  for (let y = y0; y <= y1; y++) {
    if (inBounds(x0, y) && tiles[idx(x0, y)]) tiles[idx(x0, y)]!.fenceW = "wood";
    if (inBounds(x1 + 1, y) && tiles[idx(x1 + 1, y)]) tiles[idx(x1 + 1, y)]!.fenceW = "wood";
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dx = spawnX - cx;
  const dy = spawnY - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      const gy = Math.round(cy);
      if (inBounds(x1 + 1, gy)) tiles[idx(x1 + 1, gy)]!.fenceW = "gate";
    } else if (inBounds(x0, Math.round(cy))) tiles[idx(x0, Math.round(cy))]!.fenceW = "gate";
  } else if (dy >= 0) {
    const gx = Math.round(cx);
    if (inBounds(gx, y1 + 1)) tiles[idx(gx, y1 + 1)]!.fenceN = "gate";
  } else if (inBounds(Math.round(cx), y0)) tiles[idx(Math.round(cx), y0)]!.fenceN = "gate";

  const home = tiles[idx(Math.min(x1, x0 + 1), y0)];
  if (home) {
    home.building = "shack";
    home.matter = "wattle";
    home.hp = 8;
    home.burned = false;
    home.chest = { ...home.chest, wood: 8, food: 6 };
    home.chestLock = true;
  }
  if (h.shop) {
    const stall = tiles[idx(x0, Math.min(y1, y0 + 1))];
    if (stall) {
      stall.building = "shop";
      stall.matter = "wood";
      stall.hp = 14;
      stall.chest = { ...stall.chest, food: 6, herb: 3, rope: 1, bread: 2, smoked: 2 };
    }
    const field = tiles[idx(x1, y1)];
    if (field && field.building === "none") {
      field.building = "field";
      field.amount = 6;
      field.resource = "food";
    }
  }
}

export function ensureHamlets(world: World) {
  const spawn = spawnPoint();
  relocateHamlets(world);
  for (const h of HAMLETS) {
    if (world.tiles.some((t) => t.plot && t.owner === h.owner)) continue;
    stampHamlet(world.tiles, spawn.x, spawn.y, h);
  }
  paintHamletStreets(world.tiles, spawn.x, spawn.y);
}

function hamletAtExpected(tiles: Tile[], spawnX: number, spawnY: number, h: (typeof HAMLETS)[number]) {
  const t = tiles[idx(spawnX + h.dx, spawnY + h.dy)];
  return !!t && t.plot && t.owner === h.owner;
}

function wipeOwnerYard(tiles: Tile[], owner: string) {
  const plots = tiles.filter((t) => t.plot && t.owner === owner);
  if (!plots.length) return;
  const x0 = Math.min(...plots.map((p) => p.x));
  const y0 = Math.min(...plots.map((p) => p.y));
  const x1 = Math.max(...plots.map((p) => p.x));
  const y1 = Math.max(...plots.map((p) => p.y));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inBounds(x, y)) continue;
      const t = tiles[idx(x, y)]!;
      if (t.owner !== owner) continue;
      t.plot = false;
      t.owned = false;
      t.owner = "";
      t.law = false;
      t.building = "none";
      t.village = "";
      t.herd = null;
      t.fenceN = "none";
      t.fenceW = "none";
    }
  }
  for (let x = x0; x <= x1; x++) {
    if (inBounds(x, y1 + 1)) {
      const t = tiles[idx(x, y1 + 1)]!;
      if (t.fenceN !== "none" && !t.plot) t.fenceN = "none";
    }
  }
  for (let y = y0; y <= y1; y++) {
    if (inBounds(x1 + 1, y)) {
      const t = tiles[idx(x1 + 1, y)]!;
      if (t.fenceW !== "none" && !t.plot) t.fenceW = "none";
    }
  }
}

export function relocateHamlets(world: World) {
  const spawn = spawnPoint();
  for (const h of HAMLETS) {
    if (hamletAtExpected(world.tiles, spawn.x, spawn.y, h)) continue;
    if (world.tiles.some((t) => t.plot && t.owner === h.owner)) wipeOwnerYard(world.tiles, h.owner);
    stampHamlet(world.tiles, spawn.x, spawn.y, h);
  }
}

function clearPlayerField(tiles: Tile[], spawnX: number, spawnY: number) {
  const x0 = spawnX + PLAYER_FIELD.dx;
  const y0 = spawnY + PLAYER_FIELD.dy;
  for (let y = y0; y < y0 + PLAYER_FIELD.h; y++) {
    for (let x = x0; x < x0 + PLAYER_FIELD.w; x++) {
      if (!inBounds(x, y)) continue;
      const t = tiles[idx(x, y)]!;
      if (t.plot && t.owner && t.owner !== "you") continue;
      t.biome = "plains";
      t.commons = false;
      t.caravan = false;
      t.resource = null;
      t.amount = 0;
      t.herd = null;
      t.road = "none";
    }
  }
}

function paintHamletStreets(tiles: Tile[], spawnX: number, spawnY: number) {
  const boxes = HAMLETS.map((h) => ({
    x0: spawnX + h.dx,
    y0: spawnY + h.dy,
    x1: spawnX + h.dx + h.w - 1,
    y1: spawnY + h.dy + h.h - 1,
  }));
  const minX = Math.min(...boxes.map((b) => b.x0)) - 1;
  const minY = Math.min(...boxes.map((b) => b.y0)) - 1;
  const maxX = Math.max(...boxes.map((b) => b.x1)) + 1;
  const maxY = Math.max(...boxes.map((b) => b.y1)) + 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!inBounds(x, y)) continue;
      const t = tiles[idx(x, y)]!;
      if (t.plot || t.caravan || t.biome === "river") continue;
      let touch = 0;
      for (const b of boxes) {
        const inside =
          x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1 && !(x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
        if (inside) touch += 1;
      }
      if (touch >= 1) {
        t.commons = true;
        t.biome = "plains";
        t.resource = null;
        t.amount = 0;
        t.herd = null;
      }
    }
  }
}

export function migrateStations(world: World) {
  for (const t of world.tiles) {
    if (t.building === "workshop") t.building = "bench";
    if (t.building === "mine") t.building = "adit";
    if (t.goldDrop == null) t.goldDrop = 0;
    if (t.wagon == null) t.wagon = "";
    if (t.chestLock == null) t.chestLock = false;
    if (t.gateLock == null) t.gateLock = false;
    if (t.pit == null) t.pit = false;
    if (t.bank == null) t.bank = false;
  }
  stampClayBanks(world);
  stampMeadowHerb(world.tiles);
}

export function stampMeadowHerb(tiles: Tile[]) {
  for (const t of tiles) {
    if (t.commons) {
      if (t.resource === "herb" && t.building === "none" && !t.caravan && !t.plot) {
        t.resource = null;
        t.amount = 0;
        t.scarred = false;
        t.regen = 0;
      }
      continue;
    }
    if (t.biome !== "plains") continue;
    if (t.caravan || t.building !== "none" || t.pit || t.bank || t.plot) continue;
    if (t.resource === "herb" && t.amount <= 0 && !t.scarred) {
      t.amount = 2;
      t.regen = 0;
    }
  }
}

export function stampClayBanks(world: World) {
  if (world.tiles.some((t) => t.bank)) return;
  const rng = rngFromSeed(world.seed || "kletka-seed-01", 17);
  placeBanks(world.tiles, rng);
}

function placeBanks(tiles: Tile[], rng: () => number) {
  const riverish = (x: number, y: number) => {
    const t = tiles[idx(x, y)];
    return t && (t.biome === "river" || t.biome === "ford");
  };
  const eligible = (t: Tile) => {
    if (!t) return false;
    if (t.pit || t.bank || t.commons || t.plot || t.caravan) return false;
    if (t.building !== "none" || t.road !== "none") return false;
    if (t.biome === "river" || t.biome === "ford" || t.biome === "swamp" || t.biome === "mountain" || t.biome === "ore") return false;
    if (t.biome !== "plains" && t.biome !== "fertile") return false;
    const near =
      riverish(t.x + 1, t.y) || riverish(t.x - 1, t.y) || riverish(t.x, t.y + 1) || riverish(t.x, t.y - 1);
    return near;
  };
  for (let y = 1; y < MAP_H - 1; y++) {
    let run = 0;
    for (let x = 1; x < MAP_W - 1; x++) {
      const t = tiles[idx(x, y)]!;
      if (eligible(t) && rng() < 0.42) {
        run += 1;
        if (run >= 2 && run <= 5) {
          t.bank = true;
          if (t.resource === "clay") {
            t.resource = null;
            t.amount = 0;
          }
        }
        if (run >= 5) {
          run = 0;
          x += 1 + Math.floor(rng() * 4);
        }
      } else {
        run = 0;
      }
    }
  }
}

export function spawnPoint(): { x: number; y: number } {
  return { x: (MAP_W / 2) | 0, y: (MAP_H / 2) | 0 };
}

const worldCache = new Map<string, World>();

function cloneWorld(world: World): World {
  return {
    seed: world.seed,
    width: world.width,
    height: world.height,
    tiles: world.tiles.map((t) => ({
      ...t,
      pile: t.pile ? { ...t.pile } : null,
      goldDrop: t.goldDrop ?? 0,
      chest: { ...(t.chest ?? {}) },
      scarred: !!t.scarred,
      takings: t.takings ?? 0,
      herd: t.herd ? { ...t.herd } : null,
      cistern: t.cistern ?? 0,
      plot: !!t.plot,
      fenceN: t.fenceN ?? "none",
      fenceW: t.fenceW ?? "none",
      owner: t.owner ?? "",
      law: !!t.law,
      mark: t.mark ? { ...t.mark } : null,
      matter: t.matter ?? "wood",
      hp: t.hp ?? 20,
      burned: !!t.burned,
      village: t.village ?? "",
      wagon: t.wagon ?? "",
      chestLock: !!t.chestLock,
      gateLock: !!t.gateLock,
      pit: !!t.pit,
      bank: !!t.bank,
      regen: t.regen ?? 0,
    })),
  };
}

const CACHE_VER = "v15-";

export function warmupWorld(seed: string) {
  if (worldCache.has(CACHE_VER + seed)) return;
  worldCache.set(CACHE_VER + seed, buildWorld(seed));
}

export function generateWorld(seed: string): World {
  const key = CACHE_VER + seed;
  const hit = worldCache.get(key);
  if (hit) return cloneWorld(hit);
  const built = buildWorld(seed);
  worldCache.set(key, built);
  return cloneWorld(built);
}

function buildWorld(seed: string): World {
  const elevRng = rngFromSeed(seed, 1);
  const moistRng = rngFromSeed(seed, 2);
  const riverRng = rngFromSeed(seed, 3);
  const extraRng = rngFromSeed(seed, 4);
  const elevN = createNoise2D(elevRng);
  const moistN = createNoise2D(moistRng);
  const ridgeN = createNoise2D(rngFromSeed(seed, 5));

  const tiles: Tile[] = new Array(MAP_W * MAP_H);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const e = (fbm(elevN, x / 42, y / 42) + 1) / 2;
      const m = (fbm(moistN, x / 36 + 20, y / 36) + 1) / 2;
      const r = (fbm(ridgeN, x / 18, y / 18, 3) + 1) / 2;
      const biome = pickBiome(e, m, r);
      tiles[idx(x, y)] = {
        x,
        y,
        biome,
        road: "none",
        resource: null,
        amount: 0,
        commons: false,
        owned: false,
        building: "none",
        caravan: false,
        pile: null,
        goldDrop: 0,
        chest: {
          wood: 0,
          stone: 0,
          ore: 0,
          food: 0,
          fish: 0,
          axe: 0,
          herb: 0,
          clay: 0,
          crystal: 0,
          rope: 0,
          bucket: 0,
          spear: 0,
          shovel: 0,
          rod: 0,
          bread: 0,
          plank: 0,
          bar: 0,
          tonic: 0,
          smoked: 0,
          coal: 0,
          wheel: 0,
          lock: 0,
        },
        scarred: false,
        takings: 0,
        regen: 0,
        herd: null,
        cistern: 0,
        plot: false,
        fenceN: "none",
        fenceW: "none",
        owner: "",
        law: false,
        mark: null,
        matter: "wood",
        hp: 20,
        burned: false,
        village: "",
        wagon: "",
        chestLock: false,
        gateLock: false,
        pit: false,
        bank: false,
      };
    }
  }

  carveRiver(tiles, riverRng, 2, 8 + Math.floor(riverRng() * 20), 1, 0);
  carveRiver(tiles, riverRng, 10, 2, 0, 1);
  carveRiver(tiles, riverRng, MAP_W - 4, 20 + Math.floor(riverRng() * 30), -1, 0);
  carveRiver(tiles, riverRng, 30 + Math.floor(riverRng() * 20), MAP_H - 3, 0, -1);
  carveRiver(tiles, riverRng, 4, MAP_H - 12, 1, -1);
  widenRiver(tiles, extraRng);
  carveLake(tiles, 22 + Math.floor(extraRng() * 12), 28 + Math.floor(extraRng() * 10), 2, 5);
  carveLake(tiles, 70 + Math.floor(extraRng() * 8), 64 + Math.floor(extraRng() * 8), 1.5, 4);
  placeFords(tiles, extraRng);
  sprinkleResources(tiles, extraRng);
  placeClay(tiles, extraRng);
  placeBanks(tiles, extraRng);

  const spawn = spawnPoint();
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = spawn.x + dx;
      const y = spawn.y + dy;
      if (!inBounds(x, y)) continue;
      const t = tiles[idx(x, y)]!;
      t.biome = "plains";
      t.commons = true;
      t.road = "none";
      t.resource = Math.abs(dx) + Math.abs(dy) <= 1 ? "food" : null;
      t.amount = t.resource ? 3 : 0;
    }
  }

  const grove = [
    [4, -1],
    [5, 0],
    [5, 1],
    [4, 2],
    [-4, 0],
    [-5, -1],
    [0, 5],
    [1, 5],
    [0, -5],
  ];
  for (const [dx, dy] of grove) {
    const x = spawn.x + dx;
    const y = spawn.y + dy;
    if (!inBounds(x, y)) continue;
    const t = tiles[idx(x, y)]!;
    if (t.biome === "river") continue;
    t.biome = "forest";
    t.commons = false;
    t.resource = "wood";
    t.amount = 8 + Math.floor(extraRng() * 4);
    t.scarred = false;
  }

  seedHamlets(tiles, spawn.x, spawn.y);
  clearPlayerField(tiles, spawn.x, spawn.y);
  paintHamletStreets(tiles, spawn.x, spawn.y);

  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    for (let i = 3; i <= 14; i++) {
      const x = spawn.x + dx * i;
      const y = spawn.y + dy * i;
      if (!inBounds(x, y)) break;
      const t = tiles[idx(x, y)]!;
      if (t.biome === "river") {
        t.biome = "ford";
        t.resource = "fish";
        t.amount = 8;
        t.road = "bridge";
        break;
      }
      if (t.biome !== "ford") t.road = "dirt";
    }
  }

  const caravanSpots: Array<[number, number]> = [
    [spawn.x + 12, spawn.y],
    [spawn.x - 10, spawn.y + 6],
  ];
  for (const [cx, cy] of caravanSpots) {
    if (!inBounds(cx, cy)) continue;
    const t = tiles[idx(cx, cy)]!;
    if (t.biome === "river") {
      t.biome = "ford";
      t.resource = "fish";
      t.amount = 6;
    }
    t.caravan = true;
    t.commons = true;
    t.road = t.road === "none" ? "dirt" : t.road;
  }

  placeAnimals(tiles, spawn.x, spawn.y, extraRng);

  const reachable = floodWalkable(tiles, spawn.x, spawn.y);
  seedIslands(tiles, spawn.x, spawn.y, extraRng);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    if (!reachable[i] && t.biome === "river") {
      if (extraRng() < 0.04) {
        t.biome = "ford";
        t.resource = "fish";
        t.amount = 5;
      }
    }
  }

  stampMeadowHerb(tiles);

  return { seed, width: MAP_W, height: MAP_H, tiles };
}

export function tileAt(world: World, x: number, y: number): Tile | null {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  return world.tiles[y * world.width + x] ?? null;
}

export function isWalkable(tile: Tile | null, world?: World): boolean {
  if (!tile) return false;
  if (world?.fog) {
    const f = world.fog[tile.y * world.width + tile.x] ?? 0;
    if (f === 0) return false;
  }
  if (tile.building === "moat") return tile.road === "bridge";
  if (tile.biome === "river") return tile.road === "bridge";
  return true;
}

export function setRoad(world: World, x: number, y: number, road: RoadKind) {
  const t = tileAt(world, x, y);
  if (t) t.road = road;
}
