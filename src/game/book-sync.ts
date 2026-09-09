import {
  applyLive,
  applyMemory,
  darkWorld,
  demoteSpot,
  fogAt,
  FOG_LIVE,
  liveTilesOf,
  maskLiveFog,
  packPawn,
  rememberFog,
  slimOf,
  travelOf,
  unpackPawn,
  wireSlim,
  WORLD_SEED,
  type BookFight,
  type WorldClock,
} from "./book";
import { closeBookFight, dropPawn, heartbeatWorld, openBookFight, openWorldBook, readStreetNotices, strikeBookFight, writeBagDeed, writeGoldDeed, writeHarmDeed, writeOfficeDeed, writeRoadDeed, writeServiceDeed, writeStallDeed, writeVillageDeed, writeWorldDeed } from "./book-api";
import { rememberLiveFoe } from "./fight";
import { makeJobs, makeTrader } from "./economy";
import { fillStock } from "./office";
import { TICKS_PER_DAY } from "./constants";
import { settleOldCounts } from "./mount";
import { loadGame, saveGame, type SlimTile } from "./save";
import type { Character, GameState, GiftId, Inventory, ItemId, OtherPawn, Travel } from "./types";
import type { GoldKind } from "./gold";
import type { BagKind } from "./bag";
import { bagOf, bagsEqual } from "./bag";
import { ENERGY_MAX } from "./pace";
import { spawnPoint } from "./worldgen";

type StoreSlice = {
  get: () => GameState & {
    persist: () => void;
    catchUp: () => void;
  };
  set: (p: Partial<GameState>) => void;
  speak?: (line: string, x: number, y: number, short?: string, tone?: "ok" | "bad" | "gold") => void;
};

let store: StoreSlice | null = null;
const lastSlim = new Map<string, string>();
let lastKind = "tile";
let flushing = false;
let flushAgain = false;
let lastCell = "";
let lastHitKey = "";
let beating = false;
let beatAgain = false;
let lastTravel: Travel | null = null;

function selfIdOf(): string {
  return store?.get().selfId || "";
}

function localizePackets<T extends { slim: SlimTile }>(packets: T[]): T[] {
  const selfId = selfIdOf();
  if (!selfId) return packets;
  return packets.map((p) => {
    const slim = wireSlim(p.slim, selfId, "localize");
    if (slim === p.slim) return p;
    return { ...p, slim };
  });
}

function publishTiles(state: GameState) {
  const selfId = selfIdOf();
  return liveTilesOf(state.world, state.character.x, state.character.y)
    .filter((t) => fogAt(state.world, t.x, t.y) === FOG_LIVE)
    .map((t) => {
      const slim = slimOf(t);
      const sig = JSON.stringify(slim);
      const k = keyOf(t.x, t.y);
      if (lastSlim.get(k) === sig) return null;
      const ver = sVer(state, t.x, t.y);
      const wire = wireSlim(slim, selfId, "publish");
      return { x: t.x, y: t.y, slim: wire, ver, sig, k };
    })
    .filter((v): v is NonNullable<typeof v> => !!v);
}

function sVer(state: GameState, x: number, y: number) {
  return state.world.ver?.[y * state.world.width + x] ?? 1;
}

function applyGold(n: number | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n) || !store) return;
  const c = store.get().character;
  const gold = Math.max(0, Math.floor(n));
  if (c.gold === gold) return;
  store.set({ character: { ...c, gold } });
}

function applyBag(inv: Inventory | undefined) {
  if (!inv || !store) return;
  const c = store.get().character;
  const next = bagOf({ inventory: inv });
  if (bagsEqual(c.inventory, next)) return;
  store.set({ character: { ...c, inventory: next } });
}

function applyVigor(res: {
  energy?: number;
  energyAt?: number;
  resting?: boolean;
  hp?: number;
  life?: Character["life"];
  deaths?: number;
}) {
  if (typeof res.energy !== "number" || !Number.isFinite(res.energy) || !store) return;
  const c = store.get().character;
  const energy = Math.max(0, Math.min(ENERGY_MAX, res.energy));
  const hp =
    typeof res.hp === "number" && Number.isFinite(res.hp) ? Math.max(0, Math.min(100, Math.floor(res.hp))) : c.hp;
  const life =
    res.life === "alive" || res.life === "down" || res.life === "jailed" || res.life === "dead" ? res.life : c.life;
  const deaths =
    typeof res.deaths === "number" && Number.isFinite(res.deaths) ? Math.max(0, Math.floor(res.deaths)) : c.deaths;
  const resting = typeof res.resting === "boolean" ? res.resting : c.resting;
  const energyAt = typeof res.energyAt === "number" && res.energyAt > 0 ? res.energyAt : c.energyAt;
  if (
    c.energy === energy &&
    c.hp === hp &&
    c.life === life &&
    c.deaths === deaths &&
    c.resting === resting &&
    c.energyAt === energyAt
  ) {
    return;
  }
  store.set({ character: { ...c, energy, hp, life, deaths, resting, energyAt } });
}

function applyFlesh(res: { satiety?: number; warmth?: number; water?: number; pail?: number }) {
  if (typeof res.satiety !== "number" || !Number.isFinite(res.satiety) || !store) return;
  const c = store.get().character;
  const satiety = Math.max(0, Math.min(100, Math.floor(res.satiety)));
  const warmth =
    typeof res.warmth === "number" && Number.isFinite(res.warmth)
      ? Math.max(0, Math.min(100, Math.floor(res.warmth)))
      : c.warmth;
  const water =
    typeof res.water === "number" && Number.isFinite(res.water)
      ? Math.max(0, Math.min(100, Math.floor(res.water)))
      : c.water;
  const pail =
    typeof res.pail === "number" && Number.isFinite(res.pail) ? Math.max(0, Math.floor(res.pail)) : c.pail;
  if (c.satiety === satiety && c.warmth === warmth && c.water === water && c.pail === pail) return;
  store.set({ character: { ...c, satiety, warmth, water, pail } });
}

function applyOwned(res: {
  credit?: number;
  gold?: number;
  inventory?: Inventory;
  energy?: number;
  energyAt?: number;
  resting?: boolean;
  hp?: number;
  life?: Character["life"];
  deaths?: number;
  satiety?: number;
  warmth?: number;
  water?: number;
  pail?: number;
}) {
  applyCredit(res.credit, res.gold);
  applyBag(res.inventory);
  applyVigor(res);
  applyFlesh(res);
}

function applyCredit(n: number | undefined, gold?: number) {
  if (typeof gold === "number") {
    applyGold(gold);
    return;
  }
  if (!n || !store) return;
  const c = store.get().character;
  store.set({ character: { ...c, gold: Math.max(0, c.gold + n) } });
}

export function bindBookStore(s: StoreSlice) {
  store = s;
}

export function noteDeed(kind: string) {
  lastKind = kind;
}

function keyOf(x: number, y: number) {
  return `${x},${y}`;
}

function rememberLive(state: GameState) {
  const c = state.character;
  for (const t of liveTilesOf(state.world, c.x, c.y)) {
    lastSlim.set(keyOf(t.x, t.y), JSON.stringify(slimOf(t)));
  }
}

function applyClock(clock: WorldClock, prev?: GameState): Partial<GameState> {
  const patch: Partial<GameState> = {
    season: clock.season,
    year: clock.year,
    week: clock.week,
    day: clock.day,
    tickOfDay: clock.tickOfDay,
    phase: clock.phase,
    weather: clock.weather,
    clock: clock.clock,
  };
  if (prev && (prev.tickOfDay !== clock.tickOfDay || prev.phase !== clock.phase)) {
    patch.tickAt = Date.now();
  }
  if (prev && prev.week !== clock.week) {
    patch.jobs = makeJobs(clock.week);
    patch.trader = makeTrader(clock.week);
  }
  if (prev) {
    const days = Math.floor(clock.clock / TICKS_PER_DAY) - Math.floor(prev.clock / TICKS_PER_DAY);
    if (days > 0) {
      const live = store?.get().character ?? prev.character;
      if (live.wanted > 0) {
        patch.character = {
          ...live,
          wanted: Math.max(0, live.wanted - days),
        };
      }
    }
  }
  return patch;
}

function pawnPayload(c: Character) {
  const live = store?.get().travel ?? null;
  if (live?.path.length) lastTravel = live;
  return {
    name: c.name,
    color: c.color,
    x: c.x,
    y: c.y,
    body: packPawn(c, live ?? lastTravel),
  };
}

export function rememberTravel(t: Travel | null | undefined) {
  if (t?.path.length) lastTravel = t;
}

export function forgetTravel() {
  lastTravel = null;
}

function travelFromPocket(pocket: ReturnType<typeof loadGame>, x: number, y: number): Travel | null {
  const t = pocket?.travel;
  if (!t || !t.path?.length) return null;
  const pc = pocket?.character;
  if (!pc || pc.x !== x || pc.y !== y) return null;
  return {
    path: t.path,
    index: t.index ?? 0,
    elapsed: t.elapsed ?? 0,
    total: t.total ?? 0,
    t0: t.t0 ?? Date.now(),
  };
}

function keepPocketBusy(character: Character, pocket: ReturnType<typeof loadGame>): Character {
  const pb = pocket?.character?.busy;
  if (!pb || !(pb.until > Date.now())) return character;
  const pc = pocket?.character;
  if (!pc || pc.x !== character.x || pc.y !== character.y) return character;
  if (character.busy && character.busy.until >= pb.until) return character;
  return { ...character, busy: pb };
}

export async function openBookFromServer(): Promise<boolean> {
  if (!store) return false;
  store.set({ bookStatus: "loading" });
  try {
    const pocket = loadGame();
    const spawn = spawnPoint();
    const shot = await openWorldBook({
      data: {
        x: pocket?.character?.x ?? spawn.x,
        y: pocket?.character?.y ?? spawn.y,
      },
    });
    if (!shot?.ok) {
      store.set({ bookOn: false, bookStatus: "offline" });
      return false;
    }
    let world = darkWorld(WORLD_SEED);
    const pocketFog = pocket?.world?.fog;
    if (pocketFog && pocketFog.length === world.fog!.length) {
      world = { ...world, fog: rememberFog(pocketFog, world.fog!.length) };
    }
    world = applyMemory(world, localizePackets(shot.memory));
    world = applyLive(world, localizePackets(shot.live));
    const at = shot.pawn ? { x: shot.pawn.x, y: shot.pawn.y } : { x: pocket?.character?.x ?? spawn.x, y: pocket?.character?.y ?? spawn.y };
    world = maskLiveFog(world, at.x, at.y);
    const prev = store.get();
    const patch: Partial<GameState> = {
      world,
      bookOn: true,
      bookStatus: "ready",
      bookAt: shot.since,
      others: shot.others,
      jobs: makeJobs(shot.clock.week),
      trader: makeTrader(shot.clock.week),
      stock: fillStock(shot.stock),
      ...applyClock(shot.clock, prev),
    };
    if (shot.pawn) {
      let character = unpackPawn(shot.pawn);
      const mig = settleOldCounts(world, character);
      character = mig.character;
      const days = Math.floor(shot.clock.clock / TICKS_PER_DAY) - Math.floor(prev.clock / TICKS_PER_DAY);
      if (days > 0 && character.wanted > 0) {
        character = { ...character, wanted: Math.max(0, character.wanted - days) };
      }
      const travel = travelOf(shot.pawn.body) ?? travelFromPocket(pocket, character.x, character.y);
      character = keepPocketBusy(character, pocket);
      patch.character = character;
      patch.started = true;
      patch.travel = travel;
      patch.preview = travel?.path ?? null;
      if (mig.cells.length) {
        store.set(patch);
        void commitHarm("wagon", mig.cells, character);
      }
    } else if (pocket?.started && pocket.character) {
      // Карман даёт только тело, не пни.
      let character = {
        ...pocket.character,
        x: pocket.character.x,
        y: pocket.character.y,
        px: pocket.character.x,
        py: pocket.character.y,
      };
      const mig = settleOldCounts(world, character);
      character = mig.character;
      const travel = pocket.travel ?? null;
      patch.character = character;
      patch.started = true;
      patch.travel = travel;
      patch.preview = travel?.path ?? null;
      if (mig.cells.length) {
        store.set(patch);
        void commitHarm("wagon", mig.cells, character);
      }
    }
    store.set(patch);
    const next = store.get();
    rememberLive(next);
    lastCell = keyOf(next.character.x, next.character.y);
    if (shot.fight) applyIncomingFight(shot.fight, next.selfId);
    if (next.started) {
      next.catchUp();
      next.persist();
      void beatBook(true);
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Unauthorized") {
      store.set({ bookOn: false, bookStatus: "offline" });
      return false;
    }
    console.warn("[книга]", err);
    store.set({ bookOn: false, bookStatus: "offline" });
    return false;
  }
}

export async function flushBook() {
  if (!store) return;
  const s = store.get();
  if (!s.bookOn || !s.started) return;
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    const tiles = publishTiles(s);
    if (tiles.length === 0) {
      // всё равно держать фишку
      return;
    }
    const kind = lastKind;
    lastKind = "tile";
    const res = await writeWorldDeed({
      data: {
        kind,
        tiles: tiles.map(({ x, y, slim, ver }) => ({ x, y, slim, ver })),
        pawn: pawnPayload(s.character),
      },
    });
    if (!res) return;
    if (res.ok) {
      const ver = (s.world.ver ?? []).slice();
      for (const w of res.written) {
        ver[w.y * s.world.width + w.x] = w.ver;
      }
      for (const t of tiles) lastSlim.set(t.k, t.sig);
      store.set({ world: { ...s.world, ver } });
      applyOwned(res);
    } else {
      const world = maskLiveFog(applyLive(store.get().world, res.conflicts), store.get().character.x, store.get().character.y);
      store.set({ world });
      rememberLive(store.get());
      store.speak?.("клетка уже другая", s.character.x, s.character.y, "другая", "bad");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] дело", err);
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      void flushBook();
    }
  }
}

/** Вред: клетка и фишка вора в книгу сразу, с ver. Конфликт — не пишет сумку. */
export async function commitHarm(kind: string, cells: Array<{ x: number; y: number }>, prior?: Character) {
  if (!store) return false;
  const s = store.get();
  if (s.started) saveGame(s);
  if (!s.bookOn || !s.started) return true;
  const selfId = selfIdOf();
  const tiles = cells.map((c) => {
    const t = s.world.tiles[c.y * s.world.width + c.x];
    const slim = t ? wireSlim(slimOf(t), selfId, "publish") : { b: "plains" as const };
    const sig = t ? JSON.stringify(slimOf(t)) : "";
    return {
      x: c.x,
      y: c.y,
      slim,
      ver: sVer(s, c.x, c.y),
      k: keyOf(c.x, c.y),
      sig,
    };
  });
  try {
    const res = await writeHarmDeed({
      data: {
        kind,
        tiles: tiles.map(({ x, y, slim, ver }) => ({ x, y, slim, ver })),
        pawn: pawnPayload(s.character),
      },
    });
    if (!res) return false;
    if (res.ok) {
      const ver = (store.get().world.ver ?? []).slice();
      for (const w of res.written) {
        ver[w.y * s.world.width + w.x] = w.ver;
      }
      for (const t of tiles) lastSlim.set(t.k, t.sig);
      store.set({ world: { ...store.get().world, ver } });
      applyOwned(res);
      return true;
    }
    let world = store.get().world;
    if (res.conflicts.length) world = applyLive(world, localizePackets(res.conflicts));
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    const patch: Partial<GameState> = { world };
    if (prior) patch.character = prior;
    store.set(patch);
    rememberLive(store.get());
    store.speak?.("клетка уже другая", s.character.x, s.character.y, "другая", "bad");
    saveGame(store.get());
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] вред", err);
    return false;
  }
}

/** Ордер прилавка: клетка витрины и фишка сразу, с ver. Покупка капает due продавцу. */
export async function commitStall(kind: "stall-put" | "stall-drop" | "stall-take", cell: { x: number; y: number }, prior?: Character) {
  if (!store) return false;
  const s = store.get();
  if (s.started) saveGame(s);
  if (!s.bookOn || !s.started) return true;
  const selfId = selfIdOf();
  const t = s.world.tiles[cell.y * s.world.width + cell.x];
  const slim = t ? wireSlim(slimOf(t), selfId, "publish") : { b: "plains" as const };
  const sig = t ? JSON.stringify(slimOf(t)) : "";
  const pack = {
    x: cell.x,
    y: cell.y,
    slim,
    ver: sVer(s, cell.x, cell.y),
    k: keyOf(cell.x, cell.y),
    sig,
  };
  lastSlim.set(pack.k, pack.sig);
  try {
    const res = await writeStallDeed({
      data: {
        kind,
        tile: { x: pack.x, y: pack.y, slim: pack.slim, ver: pack.ver },
        pawn: pawnPayload(s.character),
      },
    });
    if (!res) return false;
    if (res.ok) {
      const ver = (store.get().world.ver ?? []).slice();
      for (const w of res.written) {
        ver[w.y * s.world.width + w.x] = w.ver;
      }
      lastSlim.set(pack.k, pack.sig);
      store.set({ world: { ...store.get().world, ver } });
      applyOwned(res);
      return true;
    }
    let world = store.get().world;
    if (res.conflicts.length) world = applyLive(world, localizePackets(res.conflicts));
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    const patch: Partial<GameState> = { world };
    if (prior) patch.character = prior;
    store.set(patch);
    rememberLive(store.get());
    store.speak?.(res.hint || "клетка уже другая", s.character.x, s.character.y, "нет", "bad");
    saveGame(store.get());
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] прилавок", err);
    return false;
  }
}

export async function commitOffice(
  kind: "stock-sell" | "stock-buy" | "gift" | "donate",
  prior?: Character,
  priorStock?: GameState["stock"],
  extra?: { item?: ItemId; qty?: number; gift?: GiftId },
) {
  if (!store) return false;
  const s = store.get();
  if (s.started) saveGame(s);
  if (!s.bookOn || !s.started) return true;
  try {
    const res = await writeOfficeDeed({
      data: {
        kind,
        pawn: pawnPayload(s.character),
        item: extra?.item,
        qty: extra?.qty,
        gift: extra?.gift,
      },
    });
    if (!res) return false;
    if (res.ok) {
      store.set({ stock: fillStock(res.stock) });
      applyOwned(res);
      return true;
    }
    const patch: Partial<GameState> = {};
    if (prior) patch.character = prior;
    if (priorStock) patch.stock = priorStock;
    store.set(patch);
    store.speak?.(res.hint || "нет", s.character.x, s.character.y, res.hint || "нет", "bad");
    saveGame(store.get());
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] контора", err);
    return false;
  }
}

export async function commitRoad(
  kind: "road-post" | "road-take",
  prior?: Character,
  extra?: { ax?: number; ay?: number; bx?: number; by?: number; gold?: number; days?: number },
) {
  if (!store) return false;
  const s = store.get();
  if (s.started) saveGame(s);
  if (!s.bookOn || !s.started) return true;
  try {
    const res = await writeRoadDeed({
      data: {
        kind,
        pawn: pawnPayload(s.character),
        ax: extra?.ax,
        ay: extra?.ay,
        bx: extra?.bx,
        by: extra?.by,
        gold: extra?.gold,
        days: extra?.days,
      },
    });
    if (!res) return false;
    if (res.ok) {
      applyOwned(res);
      void pullSpot(true);
      return true;
    }
    if (prior) store.set({ character: prior });
    store.speak?.(res.hint || "нет", s.character.x, s.character.y, res.hint || "нет", "bad");
    saveGame(store.get());
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] заказ", err);
    return false;
  }
}

export async function commitGold(kind: GoldKind, prior?: Character) {
  if (!store) return false;
  const s = store.get();
  if (s.started) saveGame(s);
  if (!s.bookOn || !s.started) return true;
  try {
    const res = await writeGoldDeed({
      data: {
        kind,
        pawn: pawnPayload(s.character),
      },
    });
    if (!res) return false;
    if (res.ok) {
      applyOwned(res);
      return true;
    }
    if (prior) store.set({ character: prior });
    store.speak?.(res.hint || "мало золота", s.character.x, s.character.y, "мало золота", "bad");
    saveGame(store.get());
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] золото", err);
    if (prior) store.set({ character: prior });
    return false;
  }
}

/** Сумка: клетка и фишка сразу. Книга считает ношу, не стол. */
export async function commitBag(
  kind: BagKind,
  cell: { x: number; y: number },
  prior?: Character,
  extra?: { item?: ItemId; qty?: number; craft?: string; need?: Partial<Record<ItemId, number>>; job?: string },
) {
  if (!store) return false;
  const s = store.get();
  if (s.started) saveGame(s);
  if (!s.bookOn || !s.started) return true;
  const selfId = selfIdOf();
  const t = s.world.tiles[cell.y * s.world.width + cell.x];
  const slim = t ? wireSlim(slimOf(t), selfId, "publish") : { b: "plains" as const };
  const sig = t ? JSON.stringify(slimOf(t)) : "";
  const pack = {
    x: cell.x,
    y: cell.y,
    slim,
    ver: sVer(s, cell.x, cell.y),
    k: keyOf(cell.x, cell.y),
    sig,
  };
  const writesTile =
    kind !== "eat" &&
    kind !== "spend" &&
    kind !== "job" &&
    kind !== "grant" &&
    kind !== "yard" &&
    kind !== "sleep" &&
    kind !== "drink" &&
    kind !== "pail" &&
    kind !== "sip" &&
    kind !== "cook" &&
    kind !== "tonic";
  if (writesTile) lastSlim.set(pack.k, pack.sig);
  try {
    const res = await writeBagDeed({
      data: {
        kind,
        tile: { x: pack.x, y: pack.y, slim: pack.slim, ver: pack.ver },
        pawn: pawnPayload(s.character),
        item: extra?.item,
        qty: extra?.qty,
        craft: extra?.craft,
        need: extra?.need,
        job: extra?.job,
      },
    });
    if (!res) return false;
    if (res.ok) {
      const ver = (store.get().world.ver ?? []).slice();
      for (const w of res.written) {
        ver[w.y * s.world.width + w.x] = w.ver;
      }
      if (writesTile) {
        lastSlim.set(pack.k, pack.sig);
        store.set({ world: { ...store.get().world, ver } });
        rememberLive(store.get());
      }
      applyOwned(res);
      return true;
    }
    let world = store.get().world;
    if (res.conflicts.length) world = applyLive(world, localizePackets(res.conflicts));
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    const patch: Partial<GameState> = { world };
    if (prior) patch.character = prior;
    store.set(patch);
    rememberLive(store.get());
    store.speak?.(res.hint || "клетка уже другая", s.character.x, s.character.y, res.hint || "нет", "bad");
    saveGame(store.get());
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] сумка", err);
    if (prior) store.set({ character: prior });
    return false;
  }
}

export async function commitService(
  kind: "service-post" | "service-cancel" | "service-take" | "service-done" | "service-fail",
  cell: { x: number; y: number },
  prior?: Character,
  early?: "arrive" | "work",
  also?: Array<{ x: number; y: number }>,
) {
  if (!store) return false;
  const s = store.get();
  if (s.started) saveGame(s);
  if (!s.bookOn || !s.started) return true;
  const selfId = selfIdOf();
  const t = s.world.tiles[cell.y * s.world.width + cell.x];
  const slim = t ? wireSlim(slimOf(t), selfId, "publish") : { b: "plains" as const };
  const sig = t ? JSON.stringify(slimOf(t)) : "";
  const pack = {
    x: cell.x,
    y: cell.y,
    slim,
    ver: sVer(s, cell.x, cell.y),
    k: keyOf(cell.x, cell.y),
    sig,
  };
  lastSlim.set(pack.k, pack.sig);
  const extra = (also ?? []).map((c) => {
    const tile = s.world.tiles[c.y * s.world.width + c.x];
    const sl = tile ? wireSlim(slimOf(tile), selfId, "publish") : { b: "plains" as const };
    const sg = tile ? JSON.stringify(slimOf(tile)) : "";
    const k = keyOf(c.x, c.y);
    lastSlim.set(k, sg);
    return { x: c.x, y: c.y, slim: sl, ver: sVer(s, c.x, c.y), k, sig: sg };
  });
  try {
    const res = await writeServiceDeed({
      data: {
        kind,
        tile: { x: pack.x, y: pack.y, slim: pack.slim, ver: pack.ver },
        pawn: pawnPayload(s.character),
        early,
        sheds: extra.map(({ x, y, slim, ver }) => ({ x, y, slim, ver })),
      },
    });
    if (!res) return false;
    if (res.ok) {
      const ver = (store.get().world.ver ?? []).slice();
      for (const w of res.written) {
        ver[w.y * s.world.width + w.x] = w.ver;
      }
      lastSlim.set(pack.k, pack.sig);
      for (const e of extra) lastSlim.set(e.k, e.sig);
      store.set({ world: { ...store.get().world, ver } });
      applyOwned(res);
      return true;
    }
    let world = store.get().world;
    if (res.conflicts.length) world = applyLive(world, localizePackets(res.conflicts));
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    const patch: Partial<GameState> = { world };
    if (prior) patch.character = prior;
    store.set(patch);
    rememberLive(store.get());
    store.speak?.(res.hint || "клетка уже другая", s.character.x, s.character.y, "нет", "bad");
    saveGame(store.get());
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] услуга", err);
    return false;
  }
}

export async function commitVillage(
  kind: "village-found" | "village-join" | "village-leave",
  name: string,
  cells: Array<{ x: number; y: number }>,
  prior?: Character,
) {
  if (!store) return false;
  const s = store.get();
  if (s.started) saveGame(s);
  if (!s.bookOn || !s.started) return true;
  const selfId = selfIdOf();
  const tiles = cells.map((c) => {
    const t = s.world.tiles[c.y * s.world.width + c.x];
    const slim = t ? wireSlim(slimOf(t), selfId, "publish") : { b: "plains" as const };
    const sig = t ? JSON.stringify(slimOf(t)) : "";
    return {
      x: c.x,
      y: c.y,
      slim,
      ver: sVer(s, c.x, c.y),
      k: keyOf(c.x, c.y),
      sig,
    };
  });
  for (const t of tiles) lastSlim.set(t.k, t.sig);
  try {
    const res = await writeVillageDeed({
      data: {
        kind,
        name,
        tiles: tiles.map(({ x, y, slim, ver }) => ({ x, y, slim, ver })),
        pawn: pawnPayload(s.character),
      },
    });
    if (!res) return false;
    if (res.ok) {
      const ver = (store.get().world.ver ?? []).slice();
      for (const w of res.written) {
        ver[w.y * s.world.width + w.x] = w.ver;
      }
      for (const t of tiles) lastSlim.set(t.k, t.sig);
      store.set({ world: { ...store.get().world, ver } });
      applyOwned(res);
      return true;
    }
    let world = store.get().world;
    if (res.conflicts.length) world = applyLive(world, localizePackets(res.conflicts));
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    const patch: Partial<GameState> = { world };
    if (prior) patch.character = prior;
    store.set(patch);
    rememberLive(store.get());
    store.speak?.(res.hint || "клетка уже другая", s.character.x, s.character.y, "нет", "bad");
    saveGame(store.get());
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] имя", err);
    return false;
  }
}

export async function lookStreet(x: number, y: number) {
  if (!store) return;
  const s = store.get();
  if (!s.bookOn || !s.started) return;
  try {
    const res = await readStreetNotices({ data: { x, y } });
    if (!res?.live.length) return;
    let world = applyLive(store.get().world, localizePackets(res.live));
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    store.set({ world });
    rememberLive(store.get());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] доска", err);
  }
}

export async function pullSpot(force = false) {
  void flushBook();
  await beatBook(force);
}

export async function beatBook(_force = false) {
  if (!store) return;
  const s = store.get();
  if (!s.bookOn) return;
  const cell = keyOf(s.character.x, s.character.y);
  if (beating) {
    beatAgain = true;
    return;
  }
  beating = true;
  lastCell = cell;
  try {
    const cur = store.get();
    const demoted = demoteSpot(cur.world, cur.character.x, cur.character.y);
    if (demoted !== cur.world) store.set({ world: demoted });
    const res = await heartbeatWorld({
      data: {
        x: cur.character.x,
        y: cur.character.y,
        since: cur.bookAt || "1970-01-01T00:00:00.000Z",
        pawn: cur.started ? pawnPayload(cur.character) : undefined,
      },
    });
    if (!res?.ok) return;
    let world = store.get().world;
    const newcomers = localizePackets(res.fill ?? []).filter((p) => fogAt(world, p.x, p.y) !== FOG_LIVE);
    if (newcomers.length) world = applyLive(world, newcomers);
    if (res.live.length) world = applyLive(world, localizePackets(res.live));
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    const live = store.get();
    store.set({
      world,
      others: res.others,
      bookAt: res.since,
      stock: res.stock ? fillStock(res.stock) : store.get().stock,
      ...applyClock(res.clock, live),
    });
    applyOwned(res);
    if (typeof (res as { x?: number }).x === "number" && typeof (res as { y?: number }).y === "number") {
      const nx = (res as { x: number }).x;
      const ny = (res as { y: number }).y;
      const hint = (res as { hint?: string }).hint;
      const live = store.get();
      const c = live.character;
      const walking = !!(live.travel?.path.length);
      if (c.x !== nx || c.y !== ny) {
        if (!(walking && !hint)) {
          store.set({
            character: { ...c, x: nx, y: ny, px: nx, py: ny },
            travel: hint ? null : live.travel,
            preview: hint ? null : live.preview,
          });
        }
      }
      if (hint) store.speak?.(hint, nx, ny, hint, "bad");
      if (lastTravel?.path.length) {
        const end = lastTravel.path[lastTravel.path.length - 1];
        if (hint || (end && nx === end.x && ny === end.y)) lastTravel = null;
      }
    }
    rememberLive(store.get());
    if (res.fight) applyIncomingFight(res.fight, store.get().selfId);
    else if (store.get().meet?.live) {
      /* бой закрыли с той стороны */
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] сверка", err);
  } finally {
    beating = false;
    if (beatAgain) {
      beatAgain = false;
      const now = store?.get();
      if (now && keyOf(now.character.x, now.character.y) !== lastCell) {
        void beatBook(true);
      }
    }
  }
}

export function applyIncomingFight(fight: BookFight, selfId: string) {
  if (!store) return;
  const me = selfId || store.get().selfId || "";
  if (!me) return;
  if (fight.status === "done") {
    applyDoneFight(fight, me);
    return;
  }
  const s = store.get();
  const iAmA = fight.aId === me;
  const foeId = iAmA ? fight.bId : fight.aId;
  const foeSnap = iAmA ? fight.bSnap : fight.aSnap;
  const myHp = iAmA ? fight.aHp : fight.bHp;
  const foeHp = iAmA ? fight.bHp : fight.aHp;
  const mine = fight.turnId === me;
  const incoming = !s.meet || s.meet.foeId !== foeId;
  const hitKey = fight.lastHit ? `${fight.id}:${fight.lastHit.by}:${fight.lastHit.dmg}:${foeHp}:${myHp}` : "";
  const newHit = !!(fight.lastHit && fight.lastHit.by !== me && hitKey !== lastHitKey);
  if (hitKey) lastHitKey = hitKey;
  rememberLiveFoe(foeId, {
    hp: foeHp,
    hand: foeSnap.hand,
    body: foeSnap.body,
    shield: foeSnap.shield,
    helm: foeSnap.helm,
    life: foeHp <= 0 ? "down" : "alive",
  });
  const ghost: OtherPawn = {
    id: foeId,
    name: foeSnap.name,
    color: foeSnap.color,
    x: fight.x,
    y: fight.y,
    hp: foeHp,
    life: foeHp <= 0 ? "down" : "alive",
    hand: foeSnap.hand,
    body: foeSnap.body,
    shield: foeSnap.shield,
    helm: foeSnap.helm,
  };
  const others = s.others.some((o) => o.id === foeId)
    ? s.others.map((o) => (o.id === foeId ? { ...o, ...ghost, x: o.x, y: o.y } : o))
    : [...s.others, ghost];
  const log = newHit
    ? pushLine(s.log, `${foeSnap.name} ударил: −${fight.lastHit!.dmg}`)
    : incoming
      ? pushLine(s.log, `Напали: ${foeSnap.name}. Твой шаг — удар или мимо.`)
      : s.log;
  const hint = newHit
    ? { text: `Удар −${fight.lastHit!.dmg}. Раны ${Math.round(myHp)}.`, tone: "bad" as const }
    : incoming
      ? { text: `Напали: ${foeSnap.name}.`, tone: "bad" as const }
      : s.hint;
  const floaters = newHit
    ? [...s.floaters, { id: Date.now(), x: s.character.x, y: s.character.y, text: `удар ${fight.lastHit!.dmg}`, tone: "bad" as const }].slice(-10)
    : s.floaters;
  store.set({
    others,
    character: { ...s.character, hp: myHp, life: myHp <= 0 ? "down" : s.character.life },
    meet: {
      foeId,
      turn: mine ? "you" : "foe",
      steps: s.meet?.steps ?? 0,
      spoke: s.meet?.spoke ?? false,
      firstDone: !!(s.meet?.firstDone || fight.lastHit),
      live: true,
      incoming: incoming || !!s.meet?.incoming,
      foeHp,
      foeHand: foeSnap.hand,
      foeBody: foeSnap.body,
      foeShield: foeSnap.shield,
      foeHelm: foeSnap.helm,
    },
    inspect: null,
    travel: incoming ? null : s.travel,
    preview: incoming ? null : s.preview,
    log,
    hint: hint ?? s.hint,
    floaters,
  });
}

function applyDoneFight(fight: BookFight, selfId: string) {
  if (!store) return;
  const s = store.get();
  if (!s.meet?.live) return;
  const iAmA = fight.aId === selfId;
  const myHp = iAmA ? fight.aHp : fight.bHp;
  const foeSnap = iAmA ? fight.bSnap : fight.aSnap;
  const ILost = myHp <= 0;
  store.set({
    character: { ...s.character, hp: myHp, life: ILost ? "down" : s.character.life },
    meet: null,
    hint: { text: ILost ? "Упал." : `${foeSnap.name}: встреча кончилась.`, tone: ILost ? "bad" : "ok" },
  });
}

function pushLine(log: string[], line: string) {
  return [line, ...log].slice(0, 14);
}

export async function postOpenFight(foeId: string, x: number, y: number, you: {
  name: string;
  color: string;
  hp: number;
  hand: string | null;
  body: string | null;
  shield: string | null;
  helm: string | null;
}) {
  try {
    const res = await openBookFight({ data: { foeId, x, y, you } });
    if (res?.ok && res.fight) applyIncomingFight(res.fight, store?.get().selfId || "");
    return res;
  } catch (err) {
    console.warn("[книга] встреча", err);
    return null;
  }
}

export async function postStrikeFight(dmg: number) {
  try {
    const res = await strikeBookFight({ data: { dmg } });
    if (res && "fight" in res && res.fight) applyIncomingFight(res.fight, store?.get().selfId || "");
    return res;
  } catch (err) {
    console.warn("[книга] удар", err);
    return null;
  }
}

export async function postCloseFight() {
  try {
    await closeBookFight({ data: {} });
  } catch {
    /* offline */
  }
}

export async function resetBookPawn() {
  lastSlim.clear();
  lastKind = "tile";
  lastCell = "";
  try {
    await dropPawn();
  } catch {
    /* offline */
  }
}

export function markFreshLive(state: GameState) {
  rememberLive(state);
}
