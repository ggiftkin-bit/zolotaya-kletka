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
  slimOf,
  unpackPawn,
  WORLD_SEED,
  type WorldClock,
} from "./book";
import { dropPawn, heartbeatWorld, openWorldBook, writeWorldDeed } from "./book-api";
import { loadGame } from "./save";
import type { Character, GameState } from "./types";
import { spawnPoint } from "./worldgen";

type StoreSlice = {
  get: () => GameState & {
    persist: () => void;
  };
  set: (p: Partial<GameState>) => void;
  speak?: (line: string, x: number, y: number, short?: string, tone?: "ok" | "bad" | "gold") => void;
};

let store: StoreSlice | null = null;
const lastSlim = new Map<string, string>();
let lastKind = "tile";
let flushing = false;
let flushAgain = false;
let pulling = false;
let lastCell = "";

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

function clockOf(s: GameState): WorldClock {
  return {
    season: s.season,
    year: s.year,
    week: s.week,
    day: s.day,
    tickOfDay: s.tickOfDay,
    phase: s.phase,
    weather: s.weather,
    clock: s.clock,
  };
}

function applyClock(clock: WorldClock): Partial<GameState> {
  return {
    season: clock.season,
    year: clock.year,
    week: clock.week,
    day: clock.day,
    tickOfDay: clock.tickOfDay,
    phase: clock.phase,
    weather: clock.weather,
    clock: clock.clock,
  };
}

function pawnPayload(c: Character) {
  return {
    name: c.name,
    color: c.color,
    x: c.x,
    y: c.y,
    body: packPawn(c),
  };
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
    world = applyMemory(world, shot.memory);
    world = applyLive(world, shot.live);
    const at = shot.pawn ? { x: shot.pawn.x, y: shot.pawn.y } : { x: pocket?.character?.x ?? spawn.x, y: pocket?.character?.y ?? spawn.y };
    world = maskLiveFog(world, at.x, at.y);
    const patch: Partial<GameState> = {
      world,
      bookOn: true,
      bookStatus: "ready",
      bookAt: shot.since,
      others: shot.others,
      ...applyClock(shot.clock),
    };
    if (shot.pawn) {
      const character = unpackPawn(shot.pawn);
      patch.character = character;
      patch.started = true;
    } else if (pocket?.started && pocket.character) {
      // Карман даёт только тело, не пни.
      const character = {
        ...pocket.character,
        x: pocket.character.x,
        y: pocket.character.y,
        px: pocket.character.x,
        py: pocket.character.y,
      };
      patch.character = character;
      patch.started = true;
    }
    store.set(patch);
    const next = store.get();
    rememberLive(next);
    lastCell = keyOf(next.character.x, next.character.y);
    if (next.started) void pullSpot(true);
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
    const tiles = liveTilesOf(s.world, s.character.x, s.character.y)
      .filter((t) => fogAt(s.world, t.x, t.y) === FOG_LIVE)
      .map((t) => {
        const slim = slimOf(t);
        const sig = JSON.stringify(slim);
        const k = keyOf(t.x, t.y);
        if (lastSlim.get(k) === sig) return null;
        const ver = s.world.ver?.[t.y * s.world.width + t.x] ?? 1;
        return { x: t.x, y: t.y, slim, ver, sig, k };
      })
      .filter((v): v is NonNullable<typeof v> => !!v);
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
        clock: clockOf(s),
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

export async function pullSpot(force = false) {
  if (!store) return;
  const s = store.get();
  if (!s.bookOn) return;
  const cell = keyOf(s.character.x, s.character.y);
  if (!force && cell === lastCell && pulling) return;
  if (pulling) return;
  pulling = true;
  lastCell = cell;
  try {
    await flushBook();
    const cur = store.get();
    const demoted = demoteSpot(cur.world, cur.character.x, cur.character.y);
    if (demoted !== cur.world) store.set({ world: demoted });
    const res = await heartbeatWorld({
      data: {
        x: cur.character.x,
        y: cur.character.y,
        since: cur.bookAt || "1970-01-01T00:00:00.000Z",
        pawn: cur.started ? pawnPayload(cur.character) : undefined,
        clock: cur.started ? clockOf(cur) : undefined,
      },
    });
    if (!res?.ok) return;
    let world = store.get().world;
    const newcomers = (res.fill ?? []).filter((p) => fogAt(world, p.x, p.y) !== FOG_LIVE);
    if (newcomers.length) world = applyLive(world, newcomers);
    if (res.live.length) world = applyLive(world, res.live);
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    store.set({
      world,
      others: res.others,
      bookAt: res.since,
      ...applyClock(res.clock),
    });
    rememberLive(store.get());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg !== "Unauthorized") console.warn("[книга] сверка", err);
  } finally {
    pulling = false;
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
