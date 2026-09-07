import { MAP_H, MAP_W, zeroInv } from "./constants";
import { asPile, pileEmpty } from "./pile";
import type { BuildingKind, FenceKind, Inventory, ItemId, Matter, RoadKind, Tile, GameState, ServiceJob, ServiceKind } from "./types";
import { defaultMatter, MATTER_HP } from "./work";

const KEY = "zolotaya-kletka-v8";
const OLD_KEYS = [
  "zolotaya-kletka-v10",
  "zolotaya-kletka-v9",
  "zolotaya-kletka-v7",
  "zolotaya-kletka-v6",
  "zolotaya-kletka-v5",
];

export type SlimTile = {
  b: Tile["biome"];
  rd?: RoadKind;
  rs?: ItemId;
  n?: number;
  co?: 1;
  ow?: 1;
  bd?: BuildingKind;
  cv?: 1;
  pl?: Partial<Record<ItemId, number>> | { item: ItemId; amount: number };
  gd?: number;
  ch?: Partial<Inventory>;
  sc?: 1;
  tk?: number;
  rg?: number;
  hd?: Tile["herd"];
  ci?: number;
  pt?: 1;
  fn?: FenceKind;
  fw?: FenceKind;
  on?: string;
  lw?: 1;
  mk?: Tile["mark"];
  mt?: Matter;
  hp?: number;
  br?: 1;
  vg?: string;
  wg?: string;
  cl?: 1;
  gl?: 1;
  pi?: 1;
  bk?: 1;
  or?: { i: ItemId; n: number; g: number };
  sv?: {
    k: ServiceKind;
    g: number;
    u: number;
    by: string;
    tk?: string;
    i?: ItemId;
    n?: number;
    dx?: number;
    dy?: number;
    bd?: BuildingKind;
    ck?: string;
    cg?: Partial<Record<ItemId, number>>;
    d?: number;
  };
};

function emptyChest(): Inventory {
  return zeroInv();
}

function fatOrder(raw: SlimTile["or"] | undefined): Tile["order"] {
  if (!raw || typeof raw !== "object") return null;
  const item = raw.i;
  const n = raw.n;
  const gold = raw.g;
  if (!item || typeof n !== "number" || n <= 0 || typeof gold !== "number" || gold <= 0) return null;
  return { item, n, gold };
}

function slimCargo(c?: Partial<Record<ItemId, number>>): Partial<Record<ItemId, number>> | undefined {
  if (!c) return undefined;
  const o: Partial<Record<ItemId, number>> = {};
  let n = 0;
  (Object.keys(c) as ItemId[]).forEach((k) => {
    const v = c[k];
    if (v && v > 0) {
      o[k] = Math.floor(v);
      n += 1;
    }
  });
  return n ? o : undefined;
}

function fatService(raw: SlimTile["sv"] | undefined): ServiceJob | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.k;
  if (kind !== "watch" && kind !== "haul" && kind !== "build" && kind !== "craft" && kind !== "bring") return null;
  if (!raw.by || typeof raw.g !== "number" || raw.g <= 0 || typeof raw.u !== "number") return null;
  const job: ServiceJob = { kind, gold: Math.floor(raw.g), until: raw.u, by: raw.by };
  if (raw.tk) job.take = raw.tk;
  if (raw.i) job.item = raw.i;
  if (typeof raw.n === "number" && raw.n > 0) job.n = Math.floor(raw.n);
  if (typeof raw.dx === "number") job.destX = raw.dx;
  if (typeof raw.dy === "number") job.destY = raw.dy;
  if (raw.bd) job.build = raw.bd;
  if (raw.ck) job.craft = raw.ck;
  const cg = slimCargo(raw.cg);
  if (cg) job.cargo = cg;
  if (typeof raw.d === "number" && raw.d > 0) job.doSec = Math.floor(raw.d);
  return job;
}

function slimService(job: ServiceJob | null | undefined): SlimTile["sv"] | undefined {
  if (!job || job.gold <= 0) return undefined;
  const o: NonNullable<SlimTile["sv"]> = { k: job.kind, g: job.gold, u: job.until, by: job.by };
  if (job.take) o.tk = job.take;
  if (job.item) o.i = job.item;
  if (job.n && job.n > 0) o.n = job.n;
  if (typeof job.destX === "number") o.dx = job.destX;
  if (typeof job.destY === "number") o.dy = job.destY;
  if (job.build) o.bd = job.build;
  if (job.craft) o.ck = job.craft;
  const cg = slimCargo(job.cargo);
  if (cg) o.cg = cg;
  if (job.doSec && job.doSec > 0) o.d = job.doSec;
  return o;
}

function slimChest(c?: Inventory | null): Partial<Inventory> | undefined {
  if (!c) return undefined;
  const o: Partial<Inventory> = {};
  let n = 0;
  (Object.keys(c) as ItemId[]).forEach((k) => {
    const v = c[k];
    if (v) {
      o[k] = v;
      n += 1;
    }
  });
  return n ? o : undefined;
}

export function slimTile(t: Tile): SlimTile {
  const o: SlimTile = { b: t.biome };
  if (t.road !== "none") o.rd = t.road;
  if (t.resource) {
    o.rs = t.resource;
    o.n = t.amount;
  }
  if (t.commons) o.co = 1;
  if (t.owned) o.ow = 1;
  if (t.building !== "none") o.bd = t.building;
  if (t.caravan) o.cv = 1;
  const pile = asPile(t.pile);
  if (!pileEmpty(pile)) o.pl = pile;
  if (t.goldDrop) o.gd = t.goldDrop;
  const ch = slimChest(t.chest);
  if (ch) o.ch = ch;
  if (t.scarred) o.sc = 1;
  if (t.takings) o.tk = t.takings;
  if (t.regen) o.rg = t.regen;
  if (t.herd) o.hd = t.herd;
  if (t.cistern) o.ci = t.cistern;
  if (t.plot) o.pt = 1;
  if (t.fenceN !== "none") o.fn = t.fenceN;
  if (t.fenceW !== "none") o.fw = t.fenceW;
  if (t.owner) o.on = t.owner;
  if (t.law) o.lw = 1;
  if (t.mark) o.mk = t.mark;
  const matter = t.matter ?? defaultMatter(t.building);
  if (matter !== "wood") o.mt = matter;
  const hp = t.hp ?? MATTER_HP[matter];
  if (hp !== MATTER_HP[matter]) o.hp = hp;
  if (t.burned) o.br = 1;
  if (t.village) o.vg = t.village;
  if (t.wagon) o.wg = t.wagon;
  if (t.chestLock) o.cl = 1;
  if (t.gateLock) o.gl = 1;
  if (t.pit) o.pi = 1;
  if (t.bank) o.bk = 1;
  if (t.order && t.order.n > 0 && t.order.gold > 0) o.or = { i: t.order.item, n: t.order.n, g: t.order.gold };
  const sv = slimService(t.service);
  if (sv) o.sv = sv;
  return o;
}

export function fatTile(raw: Partial<Tile> & { b?: Tile["biome"] }, x: number, y: number): Tile {
  const building = (raw.building ?? (raw as SlimTile).bd ?? "none") as BuildingKind;
  const matter = (raw.matter ?? (raw as SlimTile).mt ?? defaultMatter(building)) as Matter;
  const slim = raw as SlimTile;
  const biome = raw.biome ?? slim.b ?? "plains";
  return {
    x,
    y,
    biome,
    road: (raw.road ?? slim.rd ?? "none") as RoadKind,
    resource: (raw.resource ?? slim.rs ?? null) as Tile["resource"],
    amount: raw.amount ?? slim.n ?? 0,
    commons: !!(raw.commons ?? slim.co),
    owned: !!(raw.owned ?? slim.ow),
    building,
    caravan: !!(raw.caravan ?? slim.cv),
    pile: (() => {
      const p = asPile(raw.pile ?? slim.pl ?? null);
      return pileEmpty(p) ? null : p;
    })(),
    goldDrop: raw.goldDrop ?? slim.gd ?? 0,
    chest: { ...emptyChest(), ...(raw.chest ?? slim.ch ?? {}) },
    scarred: !!(raw.scarred ?? slim.sc),
    takings: raw.takings ?? slim.tk ?? 0,
    regen: raw.regen ?? slim.rg ?? 0,
    herd: raw.herd ?? slim.hd ?? null,
    cistern: raw.cistern ?? slim.ci ?? 0,
    plot: !!(raw.plot ?? slim.pt),
    fenceN: (raw.fenceN ?? slim.fn ?? "none") as FenceKind,
    fenceW: (raw.fenceW ?? slim.fw ?? "none") as FenceKind,
    owner: raw.owner ?? slim.on ?? "",
    law: !!(raw.law ?? slim.lw),
    mark: raw.mark ?? slim.mk ?? null,
    matter,
    hp: raw.hp ?? slim.hp ?? MATTER_HP[matter],
    burned: !!(raw.burned ?? slim.br),
    village: raw.village ?? slim.vg ?? "",
    wagon: raw.wagon ?? slim.wg ?? "",
    chestLock: !!(raw.chestLock ?? slim.cl),
    gateLock: !!(raw.gateLock ?? slim.gl),
    pit: !!(raw.pit ?? slim.pi),
    bank: !!(raw.bank ?? slim.bk),
    order: fatOrder(slim.or),
    service: fatService(slim.sv),
  };
}

function inflateTiles(raw: unknown, width: number, height: number): Tile[] | null {
  if (!Array.isArray(raw) || raw.length < 16) return null;
  const w = width || MAP_W;
  const h = height || MAP_H;
  const tiles: Tile[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const cell = raw[i] as Partial<Tile> & SlimTile;
    if (!cell) {
      tiles[i] = fatTile({ b: "plains" }, x, y);
      continue;
    }
    const xx = typeof cell.x === "number" ? cell.x : x;
    const yy = typeof cell.y === "number" ? cell.y : y;
    tiles[i] = fatTile(cell, xx, yy);
  }
  if (tiles.length < w * h * 0.5 && tiles.length < 1000) return null;
  return tiles;
}

function readRaw(): unknown | null {
  if (typeof localStorage === "undefined") return null;
  const keys = [KEY, ...OLD_KEYS];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }
  return null;
}

export function loadGame(): GameState | null {
  try {
    const parsed = readRaw() as (Partial<GameState> & { pack?: number; world?: { seed?: string; width?: number; height?: number; tiles?: unknown; fog?: number[]; ver?: number[] } }) | null;
    if (!parsed?.world) return null;
    const width = parsed.world.width ?? MAP_W;
    const height = parsed.world.height ?? MAP_H;
    const tiles = inflateTiles(parsed.world.tiles, width, height);
    if (!parsed.character) return null;
    if (!tiles) {
      return {
        ...(parsed as GameState),
        world: {
          seed: parsed.world.seed ?? "kletka-land-02",
          width,
          height,
          tiles: [],
          fog: parsed.world.fog,
          ver: parsed.world.ver,
        },
        started: !!parsed.started,
      };
    }
    return {
      ...(parsed as GameState),
      world: {
        seed: parsed.world.seed ?? "kletka-land-02",
        width,
        height,
        tiles,
        fog: parsed.world.fog,
        ver: parsed.world.ver,
      },
      started: !!parsed.started,
    };
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): boolean {
  if (typeof localStorage === "undefined") return false;
  if (!state.started) return true;
  const blob = {
    pack: 1,
    started: true,
    world: {
      seed: state.world.seed,
      width: state.world.width,
      height: state.world.height,
      tiles: state.bookOn ? [] : state.world.tiles.map(slimTile),
      fog: state.world.fog,
      ver: state.world.ver,
    },
    character: state.character,
    weather: state.weather,
    season: state.season,
    year: state.year,
    week: state.week,
    day: state.day,
    clock: state.clock,
    tickOfDay: state.tickOfDay,
    phase: state.phase,
    timeScale: state.timeScale,
    tool: state.tool,
    buildKind: state.buildKind,
    selected: state.selected,
    jobs: state.jobs,
    trader: state.trader,
    plotMark: state.plotMark,
    travel: state.travel,
    clockAt: state.clockAt ?? Date.now(),
    log: (state.log ?? []).slice(0, 16),
    meet: state.meet ?? null,
    dummies: state.dummies ?? [],
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
    return true;
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...blob, log: ["сейв ужат"] }));
      return true;
    } catch {
      return false;
    }
  }
}

export function clearGame() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
  for (const k of OLD_KEYS) localStorage.removeItem(k);
}
