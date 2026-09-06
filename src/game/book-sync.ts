import {
  applyLive,
  applyMemory,
  darkWorld,
  demoteSpot,
  fogAt,
  FOG_LIVE,
  liveTilesOf,
  localizeOwner,
  maskLiveFog,
  packPawn,
  publishOwner,
  rememberFog,
  slimOf,
  unpackPawn,
  WORLD_SEED,
  type BookFight,
  type WorldClock,
} from "./book";
import { closeBookFight, dropPawn, heartbeatWorld, openBookFight, openWorldBook, strikeBookFight, writeWorldDeed } from "./book-api";
import { rememberLiveFoe } from "./fight";
import { loadGame } from "./save";
import type { Character, GameState, OtherPawn } from "./types";
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
let lastCell = "";
let lastHitKey = "";
let beating = false;
let beatAgain = false;

function selfIdOf(): string {
  return store?.get().selfId || "";
}

function localizePackets<T extends { slim: { on?: string } }>(packets: T[]): T[] {
  const selfId = selfIdOf();
  if (!selfId) return packets;
  return packets.map((p) => {
    const on = localizeOwner(p.slim.on, selfId);
    if (on === p.slim.on) return p;
    return { ...p, slim: { ...p.slim, on } };
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
      const wire = slim.on ? { ...slim, on: publishOwner(slim.on, selfId) } : slim;
      return { x: t.x, y: t.y, slim: wire, ver, sig, k };
    })
    .filter((v): v is NonNullable<typeof v> => !!v);
}

function sVer(state: GameState, x: number, y: number) {
  return state.world.ver?.[y * state.world.width + x] ?? 1;
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
    const pocketFog = pocket?.world?.fog;
    if (pocketFog && pocketFog.length === world.fog!.length) {
      world = { ...world, fog: rememberFog(pocketFog, world.fog!.length) };
    }
    world = applyMemory(world, localizePackets(shot.memory));
    world = applyLive(world, localizePackets(shot.live));
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
    if (shot.fight) applyIncomingFight(shot.fight, next.selfId);
    if (next.started) void beatBook(true);
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
        clock: cur.started ? clockOf(cur) : undefined,
      },
    });
    if (!res?.ok) return;
    let world = store.get().world;
    const newcomers = localizePackets(res.fill ?? []).filter((p) => fogAt(world, p.x, p.y) !== FOG_LIVE);
    if (newcomers.length) world = applyLive(world, newcomers);
    if (res.live.length) world = applyLive(world, localizePackets(res.live));
    world = maskLiveFog(world, store.get().character.x, store.get().character.y);
    store.set({
      world,
      others: res.others,
      bookAt: res.since,
      ...applyClock(res.clock),
    });
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
