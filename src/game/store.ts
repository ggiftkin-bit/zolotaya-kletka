import { create } from "zustand";
import {
  BUILD_OK,
  CAPACITY,
  DAYS_PER_WEEK,
  GATHER_YIELD,
  ITEMS,
  ITEM_LABEL,
  MAP_H,
  MAP_W,
  PROFESSION_BIOME,
  ROAD_COST,
  SEASON_WEATHER,
  TICK_SEC,
  TICKS_PER_DAY,
  WEEKS_PER_SEASON,
  zeroInv,
} from "./constants";
import {
  BUILD_COST,
  BUILDING_LABEL,
  CART_GOLD,
  CART_WOOD,
  WAGON_GOLD,
  LOCK_GOLD,
  PROF_SKILL,
  PROFESSION_LABEL,
  caravanSell,
  emptySkills,
  goldTxt,
  makeJobs,
  makeTrader,
  seasonPrice,
  sellQuote,
} from "./economy";
import { requestLook } from "./cam";
import { findPath, pathTotal } from "./path";
import { canDigReason, fillNeedLine, fillPay, giveOrPile, takePaid } from "./pit";
import { asPile, dumpAllOn, pileAdd, pileEmpty, pileTake } from "./pile";
import { canCrossDiag, MAX_PLOT, clearYard, normRect, plotBounds, putGate, setYardGateLock, stampYard, upgradeYard, yardWoodCost } from "./fence";
import { applyRegen, BAIL_GOLD, BOOST_ENERGY, BOOST_GOLD, DAY_MS, DEAD_MS, DOWN_MS, ENERGY_MAX, HIRE_GOLD, NO_STRENGTH, SKIP_GOLD, deathFee, energyPeriod, formatWait, splitBodyWater } from "./pace";
import { applyCatch, dummyOnYard, hasLaw, isForeignYard, isHeld, isJailed, isStill, isYours, jailSpot, lootFrom, ownerOf, stealChance } from "./crime";
import { ANIMAL_LABEL, COW_PRICE, HORSE_PRICE, TOOL_ITEMS, isWatered, makeHerd, nearWater, tickDayLife } from "./life";
import { clearGame, loadGame, saveGame } from "./save";
import { stampVillage, clearVillage, friendNames, hamletTitle, hasOwnYard, canFoundVillage, isOutsideYard, setVillageLaw } from "./pact";
import { cargoWeight, loadRatio, pailKg, stepEnergy, wornKg } from "./travel";
import { atBench, CRAFTS, EAT_ORDER, EAT_SAT, PROF_BLURB, type CraftKind } from "./craft";
import { markDepleted, tickGrow, REGROW_WAIT } from "./grow";
import { lootOn, canOpenPlace } from "./places";
import { cancelNotice, ensureNotify, maybePingHidden, scheduleNotice } from "./notify";
import {
  BUSY_LABEL,
  CLAD_STONE,
  MATTER_HP,
  MATTER_LABEL,
  TOOL_BREAK,
  applyFenceBurn,
  buildMs,
  burnableFence,
  canBurnMatter,
  canFishOn,
  craftMs,
  defaultMatter,
  isRoof,
  isWearId,
  makeBusy,
  nearCamp,
  remainingWear,
  stoneFence,
  TOOL_LIFE,
  useTool,
  workMs,
  type WearId,
} from "./work";
import type {
  AnimalKind,
  BuildingKind,
  Character,
  Dummy,
  Floater,
  Meet,
  GameState,
  Inventory,
  ItemId,
  Profession,
  Season,
  Skill,
  ToolMode,
  Transport,
  Trader,
  Weather,
} from "./types";
import { chebyshev, dummyHome, foeById, gearSlot, leaveChance, makeHamletDummies, occupantAt, strikeDmg, talkChance, youFighter } from "./fight";
import { viewPos } from "./view-pos";
import { generateWorld, isWalkable, spawnPoint, tileAt, warmupWorld, ensureHamlets, migrateStations } from "./worldgen";
import { FOG_DARK, allDarkFog, fogAt, maskLiveFog, rememberFog } from "./book";
import { bindBookStore, flushBook, noteDeed, openBookFromServer, pullSpot, resetBookPawn } from "./book-sync";

let worldAcc = 0;

function emptyChest(): Inventory {
  return zeroInv();
}

function emptyInv(): Inventory {
  return { ...emptyChest(), food: 6, axe: 1 };
}

function normInv(inv?: Partial<Inventory> | null): Inventory {
  return { ...emptyChest(), ...(inv ?? {}) };
}

function chestOf(t: { chest?: Inventory }): Inventory {
  return { ...emptyChest(), ...t.chest };
}

function hasChest(t: { owned: boolean; building: string; owner?: string }) {
  if (t.owner && t.owner !== "you") return false;
  return t.building === "shack" || t.building === "house" || t.building === "shed" || t.owned;
}

function heldLine(c: Character, now = Date.now()): string | null {
  if (c.life === "dead") return "Погиб. Двор стоит — выйдешь дома.";
  if (isJailed(c, now)) return c.jailWhy ? `Сидишь. ${c.jailWhy}. Залог ${goldTxt(BAIL_GOLD)}.` : `Сидишь. Залог ${goldTxt(BAIL_GOLD)}.`;
  if ((c.stillUntil ?? 0) > now) return `Отлёживаешься. Сутки без хода · ещё ${formatWait(c.stillUntil - now)}.`;
  return null;
}

function actHeld(c: Character, now = Date.now()): string | null {
  if (c.life === "down") return "Упал. Ползи к шалашу — под крышей поднимешься.";
  return heldLine(c, now);
}

function dumpCargo(world: GameState["world"], x: number, y: number, inv: Inventory, gold = 0, extra: Array<ItemId | null> = []) {
  let origin = tileAt(world, x, y);
  if (!origin || origin.biome === "river" || origin.building === "moat") {
    origin = null;
    for (let r = 0; r <= 3 && !origin; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const t = tileAt(world, x + dx, y + dy);
          if (!t) continue;
          if (t.biome === "river" || t.building === "moat") continue;
          origin = t;
          break;
        }
      }
    }
  }
  if (!origin) return;
  dumpAllOn(origin, inv, gold);
  for (const id of extra) {
    if (id) pileAdd(origin, id, 1);
  }
}

function emptyTheInv(inv: Inventory): Inventory {
  const next = { ...inv };
  for (const k of ITEMS) next[k] = 0;
  return next;
}

function makeCharacter(name: string, color: string): Character {
  const p = spawnPoint();
  return {
    name,
    color,
    x: p.x,
    y: p.y,
    px: p.x,
    py: p.y,
    gold: 20,
    inventory: emptyInv(),
    transport: "walk",
    energy: ENERGY_MAX,
    satiety: 90,
    warmth: 90,
    hp: 100,
    profession: "wanderer",
    skills: emptySkills(),
    seasonSkillGain: 0,
    profWeek: 0,
    hand: "axe",
    body: null,
    shield: null,
    helm: null,
    horses: 0,
    carts: 0,
    wagon: false,
    water: 100,
    pail: 0,
    sipTick: 0,
    energyAt: Date.now(),
    wanted: 0,
    jailedUntil: 0,
    jailWhy: "",
    life: "alive",
    downAt: 0,
    deadUntil: 0,
    deaths: 0,
    stillUntil: 0,
    resting: false,
    busy: null,
    wear: {},
    bagWear: {},
    pacts: {},
    village: "",
  };
}

function pushLog(logs: string[], line: string) {
  return [line, ...logs].slice(0, 48);
}

let floaterSeq = 1;

function addFloater(x: number, y: number, text: string, tone: Floater["tone"] = "ok") {
  const s = useGame.getState();
  const prev = s.floaters ?? [];
  useGame.setState({
    floaters: [...prev, { id: ++floaterSeq, x, y, text, tone }].slice(-10),
  });
}

function speak(
  line: string,
  x: number,
  y: number,
  short?: string,
  tone: Floater["tone"] = "ok",
  extra?: { theme?: string; keep?: "jail" | "down" },
) {
  const s = useGame.getState();
  const prev = s.floaters ?? [];
  useGame.setState({
    log: pushLog(s.log, line),
    hint: { text: line, tone, theme: extra?.theme, keep: extra?.keep },
    floaters: [...prev, { id: ++floaterSeq, x, y, text: short ?? line, tone }].slice(-10),
  });
}

function dropHint(opts?: { theme?: string; force?: boolean }) {
  const s = useGame.getState();
  const h = s.hint;
  if (!h) return;
  if (!opts?.force) {
    if (h.keep === "jail" && isJailed(s.character)) return;
    if (h.keep === "down" && s.character.life === "down") return;
  }
  if (opts?.theme && h.theme && h.theme !== opts.theme) return;
  useGame.setState({ hint: null });
}

function needStrength(c: Character, n: number, x: number, y: number): boolean {
  if (c.energy >= n) return true;
  speak(NO_STRENGTH, x, y, "нет силы", "bad");
  return false;
}

function walkTo(x: number, y: number) {
  const s = useGame.getState();
  const tile = tileAt(s.world, x, y);
  const c = s.character;
  if (!tile) return;
  dropHint();
  const hold = heldLine(c);
  if (hold) {
    speak(hold, c.x, c.y, c.life === "dead" ? "погиб" : c.life === "down" ? "упал" : isStill(c) ? "сутки" : "в яме", "bad", {
      keep: isJailed(c) ? "jail" : c.life === "down" ? "down" : undefined,
    });
    return;
  }
  if (s.meet) {
    speak("Встреча. Сначала шаг листа.", c.x, c.y, "встреча", "ok");
    return;
  }
  if (fogAt(s.world, x, y) === FOG_DARK) {
    useGame.setState({ selected: { x, y }, inspect: null, preview: null });
    speak("Дальше тумана. Иди ближе — пятно едет за фишкой.", x, y, "туман", "bad");
    return;
  }
  if (!isWalkable(tile, s.world)) {
    useGame.setState({ selected: { x, y }, inspect: null, preview: null });
    speak(
      tile.building === "moat" ? "Ров. Обходи или строй мост." : "Реку вплавь нельзя. Обходи или строй мост.",
      x,
      y,
      tile.building === "moat" ? "ров" : "река",
      "bad",
    );
    return;
  }
  if (c.energy < stepEnergy(c.transport) && c.life !== "down") {
    speak("Нет силы. Ляг или кружка.", c.x, c.y, "нет силы", "bad");
    return;
  }
  if (isBusy(c) && !c.busy?.hired) {
    speak(`Занят: ${BUSY_LABEL[c.busy!.kind]}. Жди, брось или найми руки.`, c.x, c.y, BUSY_LABEL[c.busy!.kind], "bad");
    return;
  }
  const path = findPath(s.world, c.x, c.y, x, y, ctxOf(s));
  if (!path) {
    useGame.setState({ selected: { x, y }, inspect: null, preview: null });
    speak("Нет пути. Забор — только калитка. Засов — взлом. Река — мост или в обход.", x, y, "нет пути", "bad");
    return;
  }
  const total = pathTotal(path);
  const t0 = Date.now();
  useGame.setState({
    selected: { x, y },
    inspect: null,
    preview: path,
    travel: { path, index: 0, elapsed: 0, total, t0 },
    character: { ...c, resting: false },
  });
  addFloater(x, y, c.life === "down" ? `ползу ${total.toFixed(0)}с` : `ход ${total.toFixed(0)}с`, "ok");
  const wallMs = (total / Math.max(0.25, s.timeScale)) * 1000;
  void ensureNotify().then((ok) => {
    if (ok) scheduleNotice("walk", "Пришёл", `Ход ${Math.ceil(total)} с — на месте.`, t0 + wallMs);
  });
  useGame.getState().persist();
}

function ownedCount(world: GameState["world"]) {
  return world.tiles.reduce((n, t) => n + (t.owned ? 1 : 0), 0);
}

function hasRoofAt(s: GameState, x: number, y: number) {
  const t = tileAt(s.world, x, y);
  return isRoof(t) || t?.building === "tower";
}

function isBusy(c: Character, now = Date.now()): boolean {
  return !!c.busy && c.busy.until > now;
}

function meetBlock(): boolean {
  const s = useGame.getState();
  if (!s.meet) return false;
  speak("Встреча. Сначала шаг листа.", s.character.x, s.character.y, "встреча", "ok");
  return true;
}

let meetIgnore = "";

function maybeMeetHere(x: number, y: number) {
  const s = useGame.getState();
  if (s.meet) return;
  const d = occupantAt(s.dummies ?? [], s.others ?? [], x, y);
  if (!d || d.life !== "alive") return;
  if (meetIgnore === `${x},${y},${d.id}`) return;
  if (meetWhy(s, d)) return;
  startMeet(d.id);
}

function busyBlock(): boolean {
  const s = useGame.getState();
  if (!isBusy(s.character)) return false;
  const b = s.character.busy!;
  speak(
    `Занят: ${BUSY_LABEL[b.kind]}. Жди, брось или найми руки.`,
    s.character.x,
    s.character.y,
    BUSY_LABEL[b.kind],
    "bad",
  );
  return true;
}

function startBusy(c: Character, busy: NonNullable<Character["busy"]>, line: string, x: number, y: number, short: string) {
  const s = useGame.getState();
  useGame.setState({
    character: { ...c, busy, resting: false },
    inspect: null,
    log: pushLog(s.log, line),
    floaters: [...s.floaters, { id: ++floaterSeq, x, y, text: short, tone: "ok" as const }].slice(-10),
  });
  scheduleNotice("busy", "Дело готово", BUSY_LABEL[busy.kind], busy.until);
  useGame.getState().persist();
}

function takeWear(c: Character, id: WearId | null): { c: Character; broke: boolean } {
  if (!id) return { c, broke: false };
  const r = useTool(c, id);
  if (r.missing) return { c, broke: false };
  if (r.broke) {
    const s = useGame.getState();
    useGame.setState({
      log: pushLog(s.log, TOOL_BREAK[id]),
      hint: { text: TOOL_BREAK[id], tone: "bad" },
      floaters: [...s.floaters, { id: ++floaterSeq, x: c.x, y: c.y, text: TOOL_BREAK[id], tone: "bad" as const }].slice(-10),
    });
  }
  return { c: r.c, broke: r.broke };
}

function stashHand(c: Character): Character {
  const id = c.hand;
  if (!isWearId(id)) return { ...c, hand: null };
  const left = remainingWear({ ...c, hand: id }, id);
  const wear = { ...(c.wear ?? {}) };
  const bagWear = { ...(c.bagWear ?? {}) };
  if (left > 0 && left < TOOL_LIFE[id]) bagWear[id] = left;
  else delete bagWear[id];
  delete wear[id];
  return { ...c, hand: null, wear, bagWear };
}

function gripHand(c: Character, id: ItemId | null): Character {
  let next = c.hand && c.hand !== id ? stashHand(c) : { ...c };
  if (!id) {
    if (next.hand) next = stashHand(next);
    return next;
  }
  if (next.hand === id) return next;
  const bagWear = { ...(next.bagWear ?? {}) };
  const wear = { ...(next.wear ?? {}) };
  if (isWearId(id)) {
    wear[id] = bagWear[id] ?? TOOL_LIFE[id];
    delete bagWear[id];
  }
  return { ...next, hand: id, wear, bagWear };
}

function bumpSkill(c: Character, skill: Skill, amount: number): Character {
  if (c.seasonSkillGain >= 3) return c;
  const next = Math.min(20, c.skills[skill] + amount);
  const gain = next - c.skills[skill];
  if (gain <= 0) return c;
  return {
    ...c,
    skills: { ...c.skills, [skill]: next },
    seasonSkillGain: c.seasonSkillGain + gain,
  };
}

type Actions = {
  boot: () => void;
  warmup: () => void;
  openBook: () => Promise<boolean>;
  startNew: (name: string, color: string, seed?: string) => void;
  reset: () => void;
  setTool: (tool: ToolMode) => void;
  setBuildKind: (k: BuildingKind) => void;
  setHover: (x: number | null, y: number | null) => void;
  clickTile: (x: number, y: number) => void;
  inspectTile: (x: number, y: number) => void;
  goTo: (x: number, y: number) => void;
  focusMe: () => void;
  stopWalk: () => void;
  closeInspect: () => void;
  setTransport: (t: Transport) => void;
  setWeather: (w: Weather) => void;
  setSeason: (s: Season) => void;
  setTimeScale: (n: number) => void;
  setProfession: (p: Profession) => void;
  eat: (item: ItemId) => void;
  sellToCaravan: (item: ItemId, qty: number) => void;
  takeJob: (id: string) => void;
  grant: (kind: "wood" | "stone" | "cart" | "horse" | "gold" | "wagon" | "lock") => void;
  stepSim: (dt: number) => void;
  catchUp: () => void;
  persist: () => void;
  askNotify: () => void;
  doGather: () => void;
  doClaim: (x: number, y: number) => void;
  doUnclaim: (x: number, y: number) => void;
  doBuild: (x: number, y: number) => void;
  doRoad: (x: number, y: number, kind: "dirt" | "stone" | "bridge") => void;
  dropFloater: (id: number) => void;
  dropItem: (item: ItemId, qty: number) => void;
  pickupPile: () => void;
  storeItem: (item: ItemId, qty: number) => void;
  takeChest: (item: ItemId, qty: number) => void;
  buyFromTrader: (item: ItemId, qty: number) => void;
  restHere: () => void;
  sleepHere: () => void;
  cookHere: () => void;
  craftAxe: () => void;
  workDay: () => void;
  collectShop: () => void;
  equipHand: (item: ItemId | null) => void;
  equipWear: (item: ItemId | null, slot?: "body" | "shield" | "helm") => void;
  huntHere: () => void;
  catchHorse: () => void;
  fillBucket: () => void;
  sipPail: () => void;
  drinkWater: () => void;
  pourWater: () => void;
  buyLivestock: (kind: "cow" | "horse") => void;
  sellLivestock: (kind: "cow" | "horse") => void;
  buyCart: () => void;
  sellCart: () => void;
  craftCart: () => void;
  buyWagon: () => void;
  sellWagon: () => void;
  craftWagon: () => void;
  hitchWagon: () => void;
  unhitchWagon: () => void;
  stealWagon: () => void;
  craftGear: (item: "rope" | "bucket" | "spear" | "rod") => void;
  feedHere: () => void;
  upgradeFence: (to: "palisade" | "wall") => void;
  makeGate: () => void;
  hangLock: (kind: "chest" | "gate") => void;
  takeLock: (kind: "chest" | "gate") => void;
  pickLock: (kind: "chest" | "gate") => void;
  buyLock: () => void;
  dropYard: () => void;
  cancelPlot: () => void;
  stealHere: () => void;
  boostEnergy: () => void;
  skipTravel: () => void;
  toggleLaw: () => void;
  bailOut: () => void;
  fishHere: () => void;
  cancelBusy: () => void;
  skipBusy: () => void;
  hireBusy: () => void;
  burnHere: () => void;
  excavateHere: () => void;
  fillPit: () => void;
  cladStone: () => void;
  scrapBurned: () => void;
  offerFriend: () => void;
  formVillage: (name?: string) => void;
  dissolveVillage: () => void;
  doCraft: (kind: CraftKind) => void;
  prospectHere: () => void;
  sowField: () => void;
  drinkTonic: () => void;
  buyFromShop: (item: ItemId, qty: number) => void;
  sellToShop: (item: ItemId, qty: number) => void;
  startMeet: (foeId: string) => void;
  meetHit: () => void;
  meetLeave: () => void;
  meetDrop: () => void;
  meetYield: () => void;
  meetTalk: () => void;
};

function ctxOf(s: GameState) {
  const down = s.character.life === "down";
  return {
    transport: down ? "walk" as const : s.character.transport,
    inventory: s.character.inventory,
    weather: s.weather,
    extraKg: wornKg(s.character) + pailKg(s.character.pail),
  };
}

const NEXT_SEASON: Record<Season, Season> = {
  spring: "summer",
  summer: "autumn",
  autumn: "winter",
  winter: "spring",
};

export const useGame = create<GameState & Actions>((set, get) => ({
  world: { seed: "", width: MAP_W, height: MAP_H, tiles: [] },
  character: makeCharacter("Испытатель", "#6b3a2a"),
  weather: "clear",
  season: "spring",
  year: 1,
  week: 1,
  day: 1,
  clock: 0,
  tickOfDay: 0,
  phase: "day",
  timeScale: 1,
  tool: "move",
  buildKind: "shack",
  selected: null,
  inspect: null,
  hover: null,
  preview: null,
  travel: null,
  clockAt: Date.now(),
  tickAt: Date.now(),
  jobs: [],
  trader: makeTrader(1),
  plotMark: null,
  log: [],
  started: false,
  floaters: [],
  hint: null,
  bookOn: false,
  bookAt: "",
  bookStatus: "idle",
  others: [],
  meet: null,
  dummies: [],

  boot: () => {
    const saved = loadGame();
    if (saved?.started && saved.character && saved.world?.tiles?.length > 1000) {
      viewPos.x = saved.character.x;
      viewPos.y = saved.character.y;
      worldAcc = 0;
      const character = {
        ...saved.character,
        inventory: normInv(saved.character.inventory),
        hand: saved.character.hand ?? "axe",
        horses: saved.character.horses ?? 0,
        carts: saved.character.carts ?? (saved.character.transport === "cart" ? 1 : 0),
        wagon: !!saved.character.wagon || saved.character.transport === "wagon",
        ...splitBodyWater(saved.character),
        sipTick: saved.character.sipTick ?? 0,
        energyAt: saved.character.energyAt ?? Date.now(),
        wanted: saved.character.wanted ?? 0,
        jailedUntil: saved.character.jailedUntil ?? 0,
        jailWhy: saved.character.jailWhy ?? "",
        life: saved.character.life ?? "alive",
        downAt: saved.character.downAt ?? 0,
        deadUntil: saved.character.deadUntil ?? 0,
        deaths: saved.character.deaths ?? 0,
        stillUntil: saved.character.stillUntil ?? 0,
        resting: !!saved.character.resting,
        energy: Math.min(ENERGY_MAX, saved.character.energy ?? ENERGY_MAX),
        busy: saved.character.busy ?? null,
        wear: saved.character.wear ?? {},
        bagWear: saved.character.bagWear ?? {},
        pacts: saved.character.pacts ?? {},
        village: saved.character.village ?? "",
        profession: saved.character.profession ?? "wanderer",
        body: saved.character.body ?? null,
        shield: saved.character.shield ?? null,
        helm: saved.character.helm ?? null,
      };
      const tiles = saved.world.tiles.map((t) => ({
        ...t,
        matter: t.matter ?? defaultMatter(t.building === "workshop" ? "bench" : t.building),
        hp: t.hp ?? MATTER_HP[t.matter ?? defaultMatter(t.building)],
        burned: !!t.burned,
        village: t.village ?? "",
        regen: t.regen ?? 0,
        goldDrop: t.goldDrop ?? 0,
        building: t.building === "workshop" ? "bench" : t.building === "mine" ? "adit" : t.building,
        chest: { ...emptyChest(), ...t.chest },
        pit: !!t.pit,
        bank: !!t.bank,
        pile: (() => {
          const p = asPile(t.pile);
          return pileEmpty(p) ? null : p;
        })(),
      }));
      const world = maskLiveFog(
        {
          ...saved.world,
          tiles,
          fog: rememberFog(saved.world.fog, tiles.length),
          ver: saved.world.ver && saved.world.ver.length === tiles.length ? saved.world.ver : tiles.map(() => 1),
        },
        character.x,
        character.y,
      );
      migrateStations(world);
      ensureHamlets(world);
      set({
        ...saved,
        character,
        world,
        jobs: saved.jobs ?? [],
        trader: saved.trader ?? makeTrader(saved.week ?? 1),
        hover: null,
        preview: saved.travel?.path ?? null,
        floaters: [],
        inspect: null,
        hint: null,
        plotMark: saved.plotMark ?? null,
        travel: saved.travel
          ? { ...saved.travel, t0: saved.travel.t0 ?? Date.now(), elapsed: saved.travel.elapsed ?? 0 }
          : null,
        clockAt: saved.clockAt ?? Date.now(),
        tickAt: Date.now(),
        started: true,
        bookOn: false,
        bookStatus: "offline",
        others: [],
        meet: saved.meet ?? null,
        dummies: makeHamletDummies(world, saved.dummies),
      });
      queueMicrotask(() => useGame.getState().catchUp());
    }
  },

  warmup: () => {
    try {
      warmupWorld("kletka-land-02");
    } catch {
      /* ok */
    }
  },

  openBook: () => openBookFromServer(),

  startNew: (name, color, seed) => {
    const prev = get();
    if (prev.bookOn && prev.world.tiles.length > 1000) {
      const character = makeCharacter(name.trim() || "Испытатель", color);
      viewPos.x = character.x;
      viewPos.y = character.y;
      worldAcc = 0;
      const world = maskLiveFog(
        { ...prev.world, fog: allDarkFog(prev.world.tiles.length), ver: prev.world.ver ?? prev.world.tiles.map(() => 1) },
        character.x,
        character.y,
      );
      set({
        world,
        character,
        tool: "move",
        buildKind: "shack",
        selected: { x: character.x, y: character.y },
        inspect: null,
        hover: null,
        preview: null,
        travel: null,
        clockAt: Date.now(),
        tickAt: Date.now(),
        jobs: prev.jobs.length ? prev.jobs : makeJobs(prev.week || 1),
        plotMark: null,
        started: true,
        floaters: [],
        hint: null,
        log: [
          `Весна I, неделя 1. ${character.name} выходит на поляну.`,
          "Клетка пишется в книгу мира. Пятно едет за фишкой. Даль — тьма, не жила.",
          "Сила капает сама. Дома быстрее. Кружка за золото — сразу. Тап — наклейки, Пойти — ход.",
        ],
        meet: null,
        dummies: makeHamletDummies(world),
      });
      window.setTimeout(() => {
        noteDeed("pawn");
        useGame.getState().persist();
        void pullSpot(true);
      }, 250);
      return;
    }
    const world = generateWorld(seed || "kletka-land-02");
    const character = makeCharacter(name.trim() || "Испытатель", color);
    viewPos.x = character.x;
    viewPos.y = character.y;
    worldAcc = 0;
    set({
      world,
      character,
      weather: "clear",
      season: "spring",
      year: 1,
      week: 1,
      day: 1,
      clock: 0,
      tickOfDay: 0,
      phase: "day",
      timeScale: 1,
      tool: "move",
      buildKind: "shack",
      selected: { x: character.x, y: character.y },
      inspect: null,
      hover: null,
      preview: null,
      travel: null,
      clockAt: Date.now(),
      tickAt: Date.now(),
      jobs: makeJobs(1),
      trader: makeTrader(1),
      plotMark: null,
      started: true,
      floaters: [],
      hint: null,
      log: [
        `Весна I, неделя 1. ${character.name} выходит на поляну.`,
        "Сила капает сама. Дома быстрее. Кружка за золото — сразу. Тап — наклейки, Пойти — ход.",
        "Четыре хутора кустом к югу от поляны. Поле 4×4 под двор — рядом. У калитки — Дружить. Свой двор вплотную + 4 друга — Сход.",
        "Охота и рыба — ждут. Шалаш из хвороста горит, камень нет. Двор соседа к юго-западу.",
        "Забор: нижний ряд «Двор», два угла — участок. Внутри поле и дом без столбов. Ночью без тына воруют. Калитка без замка — дыра.",
      ],
      meet: null,
      dummies: makeHamletDummies(world),
    });
    window.setTimeout(() => useGame.getState().persist(), 250);
  },

  reset: () => {
    clearGame();
    void resetBookPawn();
    worldAcc = 0;
    set({ started: false, travel: null, preview: null, log: [], jobs: [], floaters: [], inspect: null, plotMark: null, hint: null, others: [], meet: null, dummies: [] });
  },

  setTool: (tool) => set({ tool, preview: null, inspect: null, plotMark: tool === "claim" ? get().plotMark : null }),
  setBuildKind: (k) => set({ buildKind: k, preview: null }),

  setHover: (x, y) => {
    if (x === null || y === null) {
      set({ hover: null });
      return;
    }
    set({ hover: { x, y } });
  },

  clickTile: (x, y) => {
    const s = get();
    if (!s.started) return;
    if (s.meet) {
      speak("Встреча. Сначала шаг листа.", s.character.x, s.character.y, "встреча", "ok");
      return;
    }
    if (isJailed(s.character) || s.character.life === "dead") {
      const hold = heldLine(s.character) ?? "Не ходит.";
      const short = s.character.life === "dead" ? "погиб" : "в яме";
      speak(hold, s.character.x, s.character.y, short, "bad", {
        keep: s.character.life === "dead" ? undefined : "jail",
      });
      return;
    }
    const tile = tileAt(s.world, x, y);
    if (!tile) return;
    if (!s.inspect || s.inspect.x !== x || s.inspect.y !== y) dropHint();
    set({ selected: { x, y }, inspect: { x, y }, tool: "move" });
  },

  inspectTile: (x, y) => {
    const tile = tileAt(get().world, x, y);
    if (!tile) return;
    const cur = get().inspect;
    if (!cur || cur.x !== x || cur.y !== y) dropHint();
    set({ selected: { x, y }, inspect: { x, y } });
  },

  goTo: (x, y) => walkTo(x, y),
  focusMe: () => {
    const c = get().character;
    requestLook(c.x, c.y);
    speak("Тут.", c.x, c.y, "тут", "ok");
  },
  stopWalk: () => {
    const s = get();
    if (!s.travel) return;
    cancelNotice("walk");
    set({ travel: null, preview: null });
    speak("Стою.", s.character.x, s.character.y, "стой", "ok");
  },

  closeInspect: () => {
    dropHint();
    set({ inspect: null });
  },

  setTransport: (t) => {
    const s = get();
    if (s.character.life === "down") {
      speak("Упал. Ползи к шалашу.", s.character.x, s.character.y, "ползу", "bad", { keep: "down" });
      return;
    }
    if ((s.character.wagon || s.character.transport === "wagon") && t !== "wagon") {
      if (t === "horse") {
        unhitchWagon();
        return;
      }
      speak("Телегу в карман не спрячешь. Отцепи — стоит на клетке.", s.character.x, s.character.y, "отцепи", "bad");
      return;
    }
    if (t === "wagon") {
      hitchWagon();
      return;
    }
    if (t === "horse" && s.character.horses < 1) {
      speak(
        "Лошадь не с неба. Поймай табун верёвкой, купи в лавке или держи в конюшне.",
        s.character.x,
        s.character.y,
        "нет лошади",
        "bad",
      );
      return;
    }
    if (t === "cart" && (s.character.carts ?? 0) < 1) {
      speak(
        `Тачку продаёт лавка на тракте за ${goldTxt(CART_GOLD)} — или сколоти дома из ${CART_WOOD} дерева. Груз больше, шаг как пешком.`,
        s.character.x,
        s.character.y,
        "нет тачки",
        "bad",
      );
      return;
    }
    set({
      character: { ...s.character, transport: t, wagon: false },
      preview: null,
      travel: null,
      log: pushLog(
        s.log,
        t === "horse"
          ? "Сел на лошадь. В 2½ раза быстрее пешего, ноша почти как пешком."
          : t === "cart"
            ? `Тачка. Ноша ${CAPACITY.cart} кг, шаг как пешком.`
            : "Пешком.",
      ),
      hint: {
        text:
          t === "horse"
            ? "Лошадь. В 2½ раза быстрее."
            : t === "cart"
              ? `Тачка. Ноша ${CAPACITY.cart} кг, шаг как пешком.`
              : "Пешком.",
        tone: "ok",
      },
    });
  },

  setWeather: (w) =>
    set((s) => ({
      weather: w,
      travel: null,
      preview: null,
      log: pushLog(s.log, `Погода: ${w}.`),
    })),

  setSeason: (season) => {
    const w = SEASON_WEATHER[season][0]!;
    set((s) => ({
      season,
      weather: season === "winter" ? "snow" : w,
      log: pushLog(s.log, `Сезон: ${season}.`),
    }));
  },

  setTimeScale: (n) => set({ timeScale: n }),

  setProfession: (p) => {
    const s = get();
    if (s.character.profession !== "wanderer") {
      speak(
        `Уже ${PROFESSION_LABEL[s.character.profession]}. Пока так.`,
        s.character.x,
        s.character.y,
        "уже",
        "ok",
      );
      return;
    }
    if (p === "wanderer") return;
    set({
      character: { ...s.character, profession: p, profWeek: s.week },
      log: pushLog(s.log, `Стал: ${PROFESSION_LABEL[p]}. Обратно сам не сменишь. ${PROF_BLURB[p]}`),
    });
  },

  eat: (item) => {
    const s = get();
    const inv = { ...s.character.inventory };
    if (!EAT_ORDER.includes(item) || (inv[item] ?? 0) <= 0) {
      speak("Еды нет.", s.character.x, s.character.y, "еды нет", "bad");
      return;
    }
    if (s.character.satiety >= 92) {
      speak("Сыт. Сила капает сама, еда её не копирует.", s.character.x, s.character.y, "сыт", "ok");
      return;
    }
    inv[item] -= 1;
    const bonus = s.character.profession === "baker" && item === "bread" ? 8 : 0;
    const satiety = Math.min(100, s.character.satiety + (EAT_SAT[item] ?? 14) + bonus);
    set({
      character: { ...s.character, inventory: inv, satiety },
      log: pushLog(s.log, `Съел ${ITEM_LABEL[item]}. Сытость ${Math.round(satiety)}. Сила сама капает — еда её не копирует.`),
      floaters: [
        ...s.floaters,
        { id: ++floaterSeq, x: s.character.x, y: s.character.y, text: "+сытость", tone: "ok" as const },
      ].slice(-10),
    });
  },

  sellToCaravan: (item, qty) => {
    const s = get();
    const here = tileAt(s.world, s.character.x, s.character.y);
    if (!here?.caravan) {
      set({ log: pushLog(s.log, "Лавка на тракте — дойди до повозки.") });
      return;
    }
    const inv = { ...s.character.inventory };
    const n = Math.min(qty, inv[item]);
    if (n <= 0) {
      set({ log: pushLog(s.log, "Нечего сдавать.") });
      return;
    }
    const quota = s.trader.demand[item] ?? 0;
    if (quota <= 0) {
      speak(
        `Лавка больше не берёт ${ITEM_LABEL[item]} на этой неделе. Приходи после смены недели.`,
        here.x,
        here.y,
        "сыты",
        "bad",
      );
      return;
    }
    const take = Math.min(n, quota);
    const quote = sellQuote(item, take, s.season, s.character.profession === "trader");
    if (quote.take <= 0 || quote.gold <= 0) {
      speak("Мало для лавки.", here.x, here.y, "мало для лавки", "bad");
      return;
    }
    inv[item] -= quote.take;
    const gold = s.character.gold + quote.gold;
    let c = { ...s.character, inventory: inv, gold };
    c = bumpSkill(c, "trade", 0.15);
    const demand = { ...s.trader.demand, [item]: quota - quote.take };
    const last = `Купил ${quote.take} ${ITEM_LABEL[item]} за ${goldTxt(quote.gold)}. Ещё берёт ${demand[item]}.`;
    set({
      character: c,
      trader: { ...s.trader, demand, last },
      log: pushLog(s.log, `Лавка: ${last}`),
      floaters: [
        ...s.floaters,
        { id: ++floaterSeq, x: here.x, y: here.y, text: `+${goldTxt(quote.gold)}`, tone: "gold" as const },
      ].slice(-10),
    });
  },

  takeJob: (id) => {
    const s = get();
    const here = tileAt(s.world, s.character.x, s.character.y);
    if (!here?.caravan && here?.building !== "board") {
      set({ log: pushLog(s.log, "Заказ закрывают в лавке на тракте или у доски биржи.") });
      return;
    }
    const job = s.jobs.find((j) => j.id === id);
    if (!job || job.status !== "open") return;
    const have = s.character.inventory[job.item];
    if (have < job.need) {
      set({ log: pushLog(s.log, `Нужно ${job.need} ${job.item}, есть ${have}.`) });
      return;
    }
    const inv = { ...s.character.inventory };
    inv[job.item] -= job.need;
    let c = {
      ...s.character,
      inventory: inv,
      gold: s.character.gold + job.pay,
    };
    c = bumpSkill(c, PROF_SKILL[c.profession], 0.2);
    set({
      character: c,
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, status: "done" as const } : j)),
      log: pushLog(s.log, `Закрыл заказ «${job.title}»: +${goldTxt(job.pay)}.`),
    });
  },

  grant: (kind) => {
    const s = get();
    const inv = { ...s.character.inventory };
    let gold = s.character.gold;
    let transport = s.character.transport;
    let horses = s.character.horses ?? 0;
    let carts = s.character.carts ?? 0;
    let line = "";
    if (kind === "wood") {
      inv.wood += 20;
      line = "+20 дерева (испытание).";
    } else if (kind === "stone") {
      inv.stone += 16;
      line = "+16 камня (испытание).";
    } else if (kind === "gold") {
      gold += 80;
      line = `+${goldTxt(80)} (испытание).`;
    } else if (kind === "cart") {
      carts = Math.max(1, carts);
      transport = "cart";
      line = "Тачка выдана.";
    } else if (kind === "lock") {
      inv.lock = (inv.lock ?? 0) + 2;
      gold = Math.max(gold, 40);
      line = "Два замка (испытание).";
    } else if (kind === "wagon") {
      horses = Math.max(1, horses);
      gold = Math.max(gold, 40);
      transport = "wagon";
      line = "Телега за лошадью (испытание).";
    } else {
      transport = "horse";
      horses += 1;
      gold = Math.max(gold, 40);
      line = "Лошадь выдана (испытание).";
    }
    set({
      character: {
        ...s.character,
        inventory: inv,
        gold,
        transport,
        horses,
        carts,
        wagon: kind === "wagon" ? true : kind === "horse" || kind === "cart" ? false : s.character.wagon,
      },
      log: pushLog(s.log, line),
    });
  },

  stepSim: (dt) => {
    catchUpSim(dt);
  },
  catchUp: () => catchUpSim(0.016),
  askNotify: () => {
    void ensureNotify();
  },

  persist: () => {
    if (!get().started) return;
    const ok = saveGame(get());
    if (!ok) {
      const s = get();
      if (!s.log[0]?.startsWith("сейв не встал")) {
        set({ log: pushLog(s.log, "сейв не встал. Место в браузере кончилось.") });
      }
    }
    void flushBook();
  },
  doGather: () => gatherHere(),
  doClaim: (x, y) => plotTap(x, y),
  doUnclaim: (x, y) => {
    const s = useGame.getState();
    const t = tileAt(s.world, x, y);
    if (t?.plot) dropYardHere();
    else unclaimTile(x, y);
  },
  doBuild: (x, y) => buildOn(x, y, get().buildKind),
  doRoad: (x, y, kind) => buildRoad(x, y, kind),
  dropFloater: (id) =>
    set((s) => ({ floaters: s.floaters.filter((f) => f.id !== id) })),
  dropItem: (item, qty) => dropItem(item, qty),
  pickupPile: () => pickupPile(),
  storeItem: (item, qty) => storeItem(item, qty),
  takeChest: (item, qty) => takeChest(item, qty),
  buyFromTrader: (item, qty) => buyFromTrader(item, qty),
  restHere: () => restHere(),
  sleepHere: () => sleepHere(),
  cookHere: () => cookHere(),
  craftAxe: () => craftAxe(),
  workDay: () => workDay(),
  collectShop: () => collectShop(),
  equipHand: (item) => equipHand(item),
  equipWear: (item, slot) => equipWear(item, slot),
  huntHere: () => huntHere(),
  catchHorse: () => catchHorse(),
  fillBucket: () => fillBucket(),
  sipPail: () => sipPail(),
  drinkWater: () => drinkWater(),
  pourWater: () => pourWater(),
  buyLivestock: (kind) => buyLivestock(kind),
  sellLivestock: (kind) => sellLivestock(kind),
  buyCart: () => buyCart(),
  sellCart: () => sellCart(),
  craftCart: () => craftCart(),
  buyWagon: () => buyWagon(),
  sellWagon: () => sellWagon(),
  craftWagon: () => craftWagon(),
  hitchWagon: () => hitchWagon(),
  unhitchWagon: () => unhitchWagon(),
  stealWagon: () => stealWagon(),
  craftGear: (item) => craftGear(item),
  feedHere: () => feedHere(),
  upgradeFence: (to) => upgradeFenceHere(to),
  makeGate: () => makeGateHere(),
  hangLock: (kind) => hangLock(kind),
  takeLock: (kind) => takeLock(kind),
  pickLock: (kind) => pickLock(kind),
  buyLock: () => buyLock(),
  dropYard: () => dropYardHere(),
  cancelPlot: () => useGame.setState({ plotMark: null }),
  stealHere: () => stealHere(),
  boostEnergy: () => boostEnergy(),
  skipTravel: () => skipTravel(),
  toggleLaw: () => toggleLaw(),
  bailOut: () => bailOut(),
  fishHere: () => fishHere(),
  cancelBusy: () => cancelBusy(),
  skipBusy: () => skipBusy(),
  hireBusy: () => hireBusy(),
  burnHere: () => burnHere(),
  excavateHere: () => excavateHere(),
  fillPit: () => fillPitHere(),
  cladStone: () => cladStone(),
  scrapBurned: () => scrapBurned(),
  offerFriend: () => offerFriend(),
  formVillage: (name) => formVillage(name),
  dissolveVillage: () => dissolveVillage(),
  doCraft: (kind) => doCraft(kind),
  prospectHere: () => prospectHere(),
  sowField: () => sowField(),
  drinkTonic: () => drinkTonic(),
  buyFromShop: (item, qty) => buyFromShop(item, qty),
  sellToShop: (item, qty) => sellToShop(item, qty),
  startMeet: (foeId) => startMeet(foeId),
  meetHit: () => meetHit(),
  meetLeave: () => meetLeave(),
  meetDrop: () => meetDrop(),
  meetYield: () => meetYield(),
  meetTalk: () => meetTalk(),
}));

bindBookStore({
  get: () => useGame.getState(),
  set: (p) => useGame.setState(p),
  speak,
});

function catchUpSim(dt: number) {
  const s = useGame.getState();
  if (!s.started) return;
  const now = Date.now();
  let dummies = s.dummies ?? [];
  let dummyTouched = false;
  dummies = dummies.map((d) => {
    if (d.life !== "down") return d;
    if (now - (d.downAt || 0) < DOWN_MS) return d;
    dummyTouched = true;
    const home = dummyHome(s.world, d.id);
    const hasLoot = Object.values(d.inventory ?? {}).some((n) => (n ?? 0) > 0);
    return {
      ...d,
      life: "alive" as const,
      hp: 40,
      energy: 18,
      downAt: 0,
      x: home?.x ?? d.x,
      y: home?.y ?? d.y,
      inventory: hasLoot ? d.inventory : { food: 3, wood: 2 },
    };
  });
  if (dummyTouched) useGame.setState({ dummies });
  const roof =
    hasRoofAt(s, s.character.x, s.character.y) ||
    (s.character.profession === "hireling" && s.character.resting);
  let live = applyRegen(s.character, now, roof, !!s.travel);
  if (live.life === "jailed" && (live.jailedUntil ?? 0) > 0 && now >= live.jailedUntil) {
    live = { ...live, jailedUntil: 0, jailWhy: "", life: "alive" };
    dropHint({ force: true });
    useGame.setState({ log: pushLog(s.log, "Вышел. Розыск не сброшен."), hint: null });
    maybePingHidden("Вышел", "Срок в яме кончился.", "jail");
  }
  if (isJailed(live, now) && s.travel) {
    cancelNotice("walk");
    useGame.setState({ travel: null, preview: null });
  }
  if (live.life === "down") {
    const underRoof = hasRoofAt({ ...s, character: live }, live.x, live.y);
    if (underRoof) {
      if (now - (live.downAt || now) >= 3_000) {
        live = { ...live, life: "alive", hp: Math.max(20, live.hp), downAt: 0, resting: true, energyAt: now };
        dropHint({ force: true });
        useGame.setState({
          log: pushLog(useGame.getState().log, "Поднялся под крышей. Лежишь — сила капает быстрее."),
          hint: { text: "Поднялся под крышей. Лежишь. Сила капает быстрее.", tone: "ok" },
        });
      }
    } else if (now - (live.downAt || now) >= DOWN_MS) {
      const n = live.deaths ?? 0;
      const fee = Math.min(live.gold, deathFee(n));
      live = {
        ...live,
        life: "dead",
        deadUntil: now + DEAD_MS,
        hp: 0,
        gold: live.gold - fee,
        deaths: n + 1,
      };
      const feeLine = fee <= 0 ? "Этот раз даром." : `Сняли ${goldTxt(fee)}.`;
      const next = deathFee(n + 1);
      useGame.setState({
        log: pushLog(
          useGame.getState().log,
          `Погиб. ${feeLine} Двор стоит. Выйдешь дома через 2 мин, потом сутки без хода. Следующий раз — ${goldTxt(next)}.`,
        ),
      });
      maybePingHidden("Погиб", "Двор стоит. Выйдешь дома через 2 мин.", "dead");
    }
  }
  if (live.life === "dead" && now >= (live.deadUntil || 0)) {
    const home =
      s.world.tiles.find((t) => t.plot && t.owner === "you" && (t.building === "house" || t.building === "shack") && !t.burned) ||
      s.world.tiles.find((t) => t.plot && t.owner === "you") ||
      null;
    const p = home ? { x: home.x, y: home.y } : spawnPoint();
    live = {
      ...live,
      life: "alive",
      hp: 40,
      satiety: 50,
      warmth: 70,
      water: 50,
      energy: Math.max(live.energy, 8),
      downAt: 0,
      deadUntil: 0,
      stillUntil: now + DAY_MS,
      x: p.x,
      y: p.y,
      px: p.x,
      py: p.y,
      busy: null,
      resting: false,
    };
    viewPos.x = p.x;
    viewPos.y = p.y;
    useGame.setState({
      travel: null,
      preview: null,
      selected: { x: p.x, y: p.y },
      log: pushLog(useGame.getState().log, "Вышел дома. Сундук цел. Сутки без хода."),
    });
    maybePingHidden("Дома", "Вышел на своём дворе.", "dead");
  }
  if ((live.jailedUntil ?? 0) > 0 && now >= live.jailedUntil && isJailed(live, now) === false && live.life !== "dead" && live.life !== "down") {
    live = { ...live, jailedUntil: 0, jailWhy: "", life: live.life === "jailed" ? "alive" : live.life };
  }
  if (live !== s.character) {
    if (s.character.resting && live.energy >= ENERGY_MAX && s.character.energy < ENERGY_MAX) {
      cancelNotice("energy");
      maybePingHidden("Сила полная", "Отдохнул — можно вставать.", "energy");
      useGame.setState({ hint: { text: "Сила полная. Можно вставать.", tone: "ok" } });
    }
    useGame.setState({ character: live });
  }
  if (live.busy && now >= live.busy.until) resolveBusy();

  const clockAt = s.clockAt || now;
  const gapSec = Math.max(0, ((now - clockAt) / 1000) * s.timeScale);
  const extra = Math.min(6, Math.floor(gapSec / TICK_SEC));
  if (extra > 0) {
    worldAcc = 0;
    for (let i = 0; i < extra; i++) worldTick();
  } else {
    worldAcc += Math.min(dt, 0.25) * s.timeScale;
    if (worldAcc >= TICK_SEC) {
      worldAcc -= TICK_SEC;
      worldTick();
    }
  }
  useGame.setState({ clockAt: now });
  advanceTravel(now);
  const here = useGame.getState();
  if (meetIgnore) {
    const [ix, iy] = meetIgnore.split(",");
    if (`${here.character.x}` !== ix || `${here.character.y}` !== iy) meetIgnore = "";
  }
  if (!here.meet) maybeMeetHere(here.character.x, here.character.y);
}

function advanceTravel(now: number) {
  const s = useGame.getState();
  if (isHeld(s.character, now)) {
    if (s.travel) {
      cancelNotice("walk");
      useGame.setState({ travel: null, preview: null });
    }
    viewPos.x = s.character.x;
    viewPos.y = s.character.y;
    return;
  }
  const travel = s.travel;
  if (!travel || travel.path.length === 0) {
    viewPos.x = s.character.x;
    viewPos.y = s.character.y;
    return;
  }
  const t0 = travel.t0 || now;
  let elapsed = travel.elapsed + Math.max(0, ((now - t0) / 1000) * s.timeScale);
  let index = travel.index;
  let x = s.character.x;
  let y = s.character.y;
  let energy = s.character.energy;
  let stepped = false;
  const drain = s.character.life === "down" ? 0 : stepEnergy(s.character.transport);
  while (index < travel.path.length) {
    const cur = travel.path[index]!;
    if (elapsed < cur.cost) break;
    if (drain > 0 && energy < drain) {
      elapsed = 0;
      cancelNotice("walk");
      const c = useGame.getState().character;
      speak("Нет силы. Ляг или кружка.", x, y, "нет силы", "bad");
      useGame.setState({
        character: { ...c, x, y, px: x, py: y, energy },
        travel: null,
        preview: null,
        selected: { x, y },
      });
      return;
    }
    elapsed -= cur.cost;
    x = cur.x;
    y = cur.y;
    index += 1;
    energy = Math.max(0, energy - drain);
    stepped = true;
  }
  if (index >= travel.path.length) {
    viewPos.x = x;
    viewPos.y = y;
    const c = useGame.getState().character;
    cancelNotice("walk");
    maybePingHidden("Пришёл", "Ход кончился — ты на месте.", "walk");
    useGame.setState({
      character: { ...c, x, y, px: x, py: y, energy },
      travel: null,
      preview: null,
      selected: { x, y },
      inspect: null,
      floaters: [
        ...useGame.getState().floaters,
        { id: ++floaterSeq, x, y, text: "пришёл", tone: "ok" as const },
      ].slice(-10),
    });
    void pullSpot();
    queueMicrotask(() => maybeMeetHere(x, y));
    return;
  }
  const occ = occupantAt(s.dummies ?? [], s.others ?? [], x, y);
  if (stepped && occ && occ.life === "alive") {
    viewPos.x = x;
    viewPos.y = y;
    const c = useGame.getState().character;
    cancelNotice("walk");
    useGame.setState({
      character: { ...c, x, y, px: x, py: y, energy },
      travel: null,
      preview: null,
      selected: { x, y },
      inspect: null,
    });
    void pullSpot();
    queueMicrotask(() => maybeMeetHere(x, y));
    return;
  }
  const cur = travel.path[index]!;
  const t = cur.cost > 0 ? elapsed / cur.cost : 1;
  viewPos.x = x + (cur.x - x) * t;
  viewPos.y = y + (cur.y - y) * t;
  if (stepped) {
    const curS = useGame.getState();
    useGame.setState({
      character: { ...curS.character, x, y, px: x, py: y, energy },
      travel: { ...travel, index, elapsed, t0: now },
    });
    void pullSpot();
  } else {
    travel.elapsed = elapsed;
    travel.t0 = now;
  }
}

function worldTick() {
  const s = useGame.getState();
  if (!s.started) return;
  let { tickOfDay, day, week, year, season, weather, phase, clock, jobs } = s;
  clock += 1;
  tickOfDay += 1;
  let log = s.log;
  let c = { ...s.character };
  const roof = hasRoofAt(s, c.x, c.y);

  c.satiety = Math.max(0, c.satiety - (roof ? 1 : 2));
  c.water = Math.max(0, c.water - (roof ? 1 : 2));
  const fire = nearCamp(s.world, c.x, c.y);
  if (c.life === "alive") {
    if (roof) c.warmth = Math.min(100, c.warmth + 4);
    else if (fire) c.warmth = Math.min(100, c.warmth + (phase === "night" ? 3 : 1));
    else if (phase === "night") c.warmth = Math.max(0, c.warmth - (s.season === "winter" ? 3 : 2));
    else if (s.weather === "rain" || s.weather === "snow") c.warmth = Math.max(0, c.warmth - 1);
    if (c.satiety === 0) c.hp = Math.max(0, c.hp - 3);
    if (c.warmth === 0) c.hp = Math.max(0, c.hp - 2);
    if (c.water === 0) c.hp = Math.max(0, c.hp - 2);
    if (roof && c.satiety > 40) c.hp = Math.min(100, c.hp + 3);
    else if (c.satiety > 40 && c.warmth > 40 && c.water > 40) c.hp = Math.min(100, c.hp + 1);
  }
  if (c.horses < 1 && (c.transport === "horse" || c.transport === "wagon")) {
    if (c.wagon || c.transport === "wagon") parkWagonNear(s.world, c.x, c.y, "you");
    c.transport = "walk";
    c.wagon = false;
  }
  if ((c.carts ?? 0) < 1 && c.transport === "cart") c.transport = "walk";
  if (c.hand && c.inventory[c.hand] <= 0) c.hand = null;

  if (c.hp <= 0 && c.life === "alive") {
    dumpCargo(s.world, c.x, c.y, c.inventory, 0, [c.body, c.shield, c.helm]);
    c.inventory = emptyTheInv(c.inventory);
    c.body = null;
    c.shield = null;
    c.helm = null;
    c.hand = null;
    if (c.wagon || c.transport === "wagon") {
      parkWagonNear(s.world, c.x, c.y, "you");
    }
    c.wagon = false;
    c.transport = "walk";
    c.life = "down";
    c.downAt = Date.now();
    c.hp = 0;
    c.busy = null;
    c.resting = false;
    cancelNotice("walk");
    log = pushLog(log, "Упал. Ноша на клетке. Ползи к шалашу — там поднимешься. Без крыши через 90 с — погиб.");
    useGame.setState({
      travel: null,
      preview: null,
      hint: { text: "Упал. Ползи к шалашу.", tone: "bad", keep: "down" },
    });
  }

  let newDay = false;
  let newWeek = false;
  if (tickOfDay >= TICKS_PER_DAY) {
    tickOfDay = 0;
    day += 1;
    newDay = true;
  }
  phase = tickOfDay >= 4 ? "night" : "day";
  if (newDay && c.wanted > 0) c.wanted = Math.max(0, c.wanted - 1);
  if (newDay) {
    for (const t of s.world.tiles) {
      if (t.biome === "ford" && t.building === "none") t.takings = 0;
    }
  }
  if (day > DAYS_PER_WEEK) {
    day = 1;
    week += 1;
    newWeek = true;
  }
  if (week > WEEKS_PER_SEASON) {
    week = 1;
    const next = NEXT_SEASON[season];
    if (season === "winter") year += 1;
    season = next;
    weather = season === "winter" ? "snow" : SEASON_WEATHER[season][0]!;
    c.seasonSkillGain = 0;
    log = pushLog(log, `Глава: ${season} ${year}. Колоды и цены сменились.`);
  }

  if (newDay) {
    const pool = SEASON_WEATHER[season];
    weather = pool[day % pool.length]!;
    log = pushLog(log, `${phase === "night" ? "Ночь" : "День"} ${day}, неделя ${week}.`);
    for (const t of s.world.tiles) {
      if (t.building === "shop" && t.owned) {
        const chest = chestOf(t);
        const ware = ITEMS.find((k) => chest[k] > 0);
        if (ware) {
          chest[ware] -= 1;
          t.chest = chest;
          t.takings += seasonPrice(ware, season);
        }
      }
    }
    for (const note of tickDayLife(s.world, season)) log = pushLog(log, note);
  }

  if (newWeek) {
    jobs = makeJobs(week);
    const trader = makeTrader(week);
    tickGrow(s.world, season);
    log = pushLog(log, `Неделя ${week}. Лавка обновила спрос. Заказы на бирже.`);
    noteDeed("grow");
    useGame.setState({
      character: c,
      clock,
      tickOfDay,
      day,
      week,
      year,
      season,
      weather,
      phase,
      jobs,
      trader,
      log,
      world: { ...s.world, tiles: s.world.tiles },
      tickAt: Date.now(),
    });
    useGame.getState().persist();
    return;
  }

  useGame.setState({
    character: c,
    clock,
    tickOfDay,
    day,
    week,
    year,
    season,
    weather,
    phase,
    jobs,
    log,
    world: { ...s.world, tiles: s.world.tiles },
    tickAt: Date.now(),
  });
}

function gatherHere() {
  const s = useGame.getState();
  const here = { x: s.character.x, y: s.character.y };
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, here.x, here.y, "нельзя", "bad");
    return;
  }
  if (meetBlock()) return;
  if (s.travel) {
    speak("Сначала дойди.", here.x, here.y, "сначала дойди", "bad");
    return;
  }
  if (busyBlock()) return;
  const tile = tileAt(s.world, s.character.x, s.character.y);
  if (!tile) return;
  if (tile.herd && tile.herd.wild && (tile.herd.kind === "hare" || tile.herd.kind === "deer")) {
    huntHere();
    return;
  }
  if (tile.herd && tile.herd.wild && tile.herd.kind === "horse") {
    catchHorse();
    return;
  }
  if (tile.resource === "fish") {
    fishHere();
    return;
  }
  if (isForeignYard(tile) && (tile.building === "field" || tile.building === "pen" || tile.building === "stable")) {
    speak("чужой двор", tile.x, tile.y, "чужой двор", "bad");
    return;
  }
  if (tile.commons) {
    speak("Поляну не косят. Трава — на равнине.", here.x, here.y, "поляна", "ok");
    return;
  }
  if (!tile.resource || tile.amount <= 0) {
    if (tile.resource === "herb" || (tile.commons && !tile.resource)) {
      const wait = tile.regen > 0 ? tile.regen : REGROW_WAIT.herb ?? 2;
      speak(`Трава сорвана. Отрастёт через ${wait} нед.`, here.x, here.y, "сорвана", "ok");
      return;
    }
    speak(tile.scarred ? "Уже срублено — одни пни. Ищи соседний лес." : "Здесь нечего взять. Лес для дров — там, где стоят деревья.", here.x, here.y, "пусто", "bad");
    return;
  }
  const item = tile.resource;
  const kind: "chop" | "mine" | "forage" = item === "wood" ? "chop" : item === "stone" || item === "ore" || item === "crystal" ? "mine" : "forage";
  const cost = kind === "forage" ? 1 : 2;
  if (!needStrength(s.character, cost, here.x, here.y)) return;
  let c = { ...s.character, energy: Math.max(0, s.character.energy - cost) };
  let tool: WearId | null = null;
  if (kind === "chop" && c.hand === "axe") tool = "axe";
  if (kind === "mine" && c.hand === "pick") tool = "pick";
  const worn = takeWear(c, tool);
  c = worn.c;
  const ms = workMs(kind, null, c);
  startBusy(
    c,
    makeBusy(kind, here.x, here.y, Date.now() + ms, { item }),
    kind === "chop"
      ? `Рублю · ${Math.ceil(ms / 1000)} с. Топор быстрее.`
      : kind === "mine"
        ? `Долблю · ${Math.ceil(ms / 1000)} с. Кирка быстрее.`
        : item === "herb"
          ? `Нарву траву · ${Math.ceil(ms / 1000)} с.`
          : `Сбираю · ${Math.ceil(ms / 1000)} с.`,
    here.x,
    here.y,
    BUSY_LABEL[kind],
  );
}

function plotTap(x: number, y: number) {
  const s = useGame.getState();
  const c = s.character;
  if (s.travel) {
    speak("В пути нельзя.", c.x, c.y, "в пути", "bad");
    return;
  }
  const tile = tileAt(s.world, x, y);
  if (!tile) return;
  if (tile.commons) {
    speak("Поляну не огораживают.", x, y, "общая", "bad");
    return;
  }
  if (tile.biome === "river") {
    speak("Реку не огораживают.", x, y, "река", "bad");
    return;
  }
  if (s.plotMark && s.plotMark.x === x && s.plotMark.y === y) {
    useGame.setState({ plotMark: null, log: pushLog(s.log, "Снял угол.") });
    return;
  }
  if (!s.plotMark) {
    useGame.setState({
      plotMark: { x, y },
      inspect: null,
      log: pushLog(s.log, `Угол двора ${x},${y}. Ткни второй угол — забор по краю.`),
      floaters: [...s.floaters, { id: ++floaterSeq, x, y, text: "угол 1", tone: "ok" as const }].slice(-10),
    });
    return;
  }
  finishYard(s.plotMark.x, s.plotMark.y, x, y);
}

function finishYard(ax: number, ay: number, bx: number, by: number) {
  const s = useGame.getState();
  const { x0, y0, x1, y1, w, h } = normRect(ax, ay, bx, by);
  if (w > MAX_PLOT || h > MAX_PLOT) {
    speak(`Двор до ${MAX_PLOT}×${MAX_PLOT}. Сейчас ${w}×${h}.`, bx, by, "велик", "bad");
    return;
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = tileAt(s.world, x, y);
      if (!t || t.commons || t.biome === "river" || t.caravan) {
        speak("Внутри река, поляна или лавка — так двор не ставят.", bx, by, "не сюда", "bad");
        return;
      }
    }
  }
  const wood = yardWoodCost(w, h);
  if (s.character.inventory.wood < wood) {
    speak(`На тын нужно ${wood} дерева. Периметр двора.`, bx, by, `нужно ${wood}д`, "bad");
    return;
  }
  if (s.character.energy < 2) {
    speak("Нет сил ставить забор. Отдых сверху.", bx, by, "нет сил", "bad");
    return;
  }
  stampYard(s.world, x0, y0, x1, y1, s.character.x, s.character.y);
  const inv = { ...s.character.inventory, wood: s.character.inventory.wood - wood };
  let c = bumpSkill(
    { ...s.character, inventory: inv, energy: Math.max(0, s.character.energy - 2) },
    "build",
    0.2,
  );
  useGame.setState({
    character: c,
    plotMark: null,
    inspect: null,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Двор ${w}×${h}. Тын по краю, калитка к тебе. Внутри можно поле и дом без столбов.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: x0, y: y0, text: `−${wood} ${ITEM_LABEL.wood}`, tone: "ok" as const }].slice(-10),
  });
  noteDeed("fence");
  useGame.getState().persist();
}

function claimTile(x: number, y: number) {
  plotTap(x, y);
}

function unclaimTile(x: number, y: number) {
  const s = useGame.getState();
  const c = s.character;
  if (s.travel) {
    speak("В пути нельзя.", c.x, c.y, "в пути", "bad");
    return;
  }
  if (Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) > 1) {
    speak("Столб снимают рядом.", x, y, "подойди", "bad");
    return;
  }
  const tile = tileAt(s.world, x, y);
  if (!tile?.owned) {
    speak("Здесь нет столба.", x, y, "нет столба", "bad");
    return;
  }
  if (tile.building !== "none") {
    speak("Сначала убери постройку.", x, y, "есть дом", "bad");
    return;
  }
  tile.owned = false;
  useGame.setState({
    character: { ...c, gold: c.gold + 5 },
    inspect: null,
    log: pushLog(s.log, `Снял столб с ${x},${y}. Вернул ${goldTxt(5)}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x, y, text: `столб снят +${goldTxt(5)}`, tone: "gold" as const }].slice(-10),
    world: { ...s.world, tiles: s.world.tiles },
  });
}

function dropYardHere() {
  const s = useGame.getState();
  const t = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!t?.plot) {
    speak("Здесь нет двора.", s.character.x, s.character.y, "нет двора", "bad");
    return;
  }
  const b = plotBounds(s.world, t.x, t.y);
  if (!b) return;
  const refund = Math.floor(yardWoodCost(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) / 2);
  clearYard(s.world, b.x0, b.y0, b.x1, b.y1);
  const inv = { ...s.character.inventory, wood: s.character.inventory.wood + refund };
  useGame.setState({
    character: { ...s.character, inventory: inv },
    inspect: null,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Снял забор. Вернул ${refund} дерева. Постройки остались.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: t.x, y: t.y, text: "двор снят", tone: "ok" as const }].slice(-10),
  });
}

function upgradeFenceHere(to: "palisade" | "wall") {
  const s = useGame.getState();
  const t = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!t?.plot) {
    speak("Укрепляют двор — встань внутри забора.", s.character.x, s.character.y, "не двор", "bad");
    return;
  }
  const b = plotBounds(s.world, t.x, t.y);
  if (!b) return;
  const per = yardWoodCost(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  const inv = { ...s.character.inventory };
  if (to === "palisade") {
    if (inv.wood < per) return speak(`Частокол: ${per} дерева.`, t.x, t.y, "мало дерева", "bad");
    inv.wood -= per;
  } else {
    if (inv.stone < per) return speak(`Стена: ${per} камня.`, t.x, t.y, "мало камня", "bad");
    inv.stone -= per;
  }
  upgradeYard(s.world, b.x0, b.y0, b.x1, b.y1, to);
  let c = bumpSkill({ ...s.character, inventory: inv, energy: Math.max(0, s.character.energy - 2) }, "build", 0.15);
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, to === "palisade" ? "Частокол по периметру. Набеги слабее." : "Каменная стена. Ночь почти тихая."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: t.x, y: t.y, text: to === "palisade" ? "частокол" : "стена", tone: "ok" as const }].slice(
      -10,
    ),
  });
}

function makeGateHere() {
  const s = useGame.getState();
  const t = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!t?.plot) {
    speak("Калитку ставят на край двора.", s.character.x, s.character.y, "не двор", "bad");
    return;
  }
  if (!putGate(s.world, t.x, t.y)) {
    speak("Встань на крайнюю клетку двора.", t.x, t.y, "не край", "bad");
    return;
  }
  useGame.setState({
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, "Калитка на этом крае. Без замка — дыра: ходят все, и воры тоже."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: t.x, y: t.y, text: "калитка", tone: "ok" as const }].slice(-10),
  });
}

function hangLock(kind: "chest" | "gate") {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile) return;
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Подойди.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  const mine = tile.owner === "you" || tile.owned || (!tile.owner && tile.plot);
  if (!mine) {
    speak("Замок вешают на своё.", tile.x, tile.y, "не твоё", "bad");
    return;
  }
  if ((s.character.inventory.lock ?? 0) < 1) {
    speak(`Нужен замок. Кузнец из слитка или лавка за ${goldTxt(LOCK_GOLD)}.`, tile.x, tile.y, "нет замка", "bad");
    return;
  }
  if (kind === "chest") {
    if (tile.building !== "shack" && tile.building !== "house" && tile.building !== "shed") {
      speak("Замок на сундук — в шалаше, доме или складе.", tile.x, tile.y, "не сундук", "bad");
      return;
    }
    if (tile.chestLock) {
      speak("Сундук уже на замке. Для тебя открыт. Чужой — только взлом.", tile.x, tile.y, "уже", "ok");
      return;
    }
    tile.chestLock = true;
  } else {
    if (!tile.plot) {
      speak("Засов — на калитки двора.", tile.x, tile.y, "не двор", "bad");
      return;
    }
    if (tile.gateLock) {
      speak("Калитки уже на засове. Свой проходит, чужой — нет.", tile.x, tile.y, "уже", "ok");
      return;
    }
    setYardGateLock(s.world, tile.x, tile.y, true);
  }
  const inv = { ...s.character.inventory, lock: s.character.inventory.lock - 1 };
  useGame.setState({
    character: { ...s.character, inventory: inv },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(
      s.log,
      kind === "chest"
        ? "Повесил замок на сундук. Свой открывается сам. Чужой — взлом."
        : "Засов на калитках. Свой проходит. Чужой не войдёт — только взлом.",
    ),
    hint: {
      text: kind === "chest" ? "Сундук на замке." : "Калитки на засове.",
      tone: "ok",
    },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "замок", tone: "ok" as const }].slice(-10),
  });
  noteDeed("lock");
  useGame.getState().persist();
}

function takeLock(kind: "chest" | "gate") {
  const s = useGame.getState();
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile) return;
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Подойди.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  const mine = tile.owner === "you" || tile.owned || (!tile.owner && tile.plot);
  if (!mine) {
    speak("Чужой замок не снимают — его взламывают.", tile.x, tile.y, "не твоё", "bad");
    return;
  }
  if (kind === "chest") {
    if (!tile.chestLock) {
      speak("На сундуке нет замка.", tile.x, tile.y, "нет", "bad");
      return;
    }
    tile.chestLock = false;
  } else {
    if (!tile.plot || !tile.gateLock) {
      speak("На калитке нет засова.", tile.x, tile.y, "нет", "bad");
      return;
    }
    setYardGateLock(s.world, tile.x, tile.y, false);
  }
  const inv = { ...s.character.inventory, lock: (s.character.inventory.lock ?? 0) + 1 };
  useGame.setState({
    character: { ...s.character, inventory: inv },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, kind === "chest" ? "Снял замок с сундука. Снова в сумке." : "Снял засов. Калитка снова дыра."),
    hint: { text: "Замок в сумке.", tone: "ok" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "снял", tone: "ok" as const }].slice(-10),
  });
}

function pickLock(kind: "chest" | "gate") {
  const s = useGame.getState();
  if (s.travel) {
    speak("В пути не взламывают.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile) return;
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Подойди к замку.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  const who = ownerOf(tile);
  if (!who || who === "you") {
    speak("Своё не взламывают. Сними замок.", tile.x, tile.y, "своё", "ok");
    return;
  }
  if (kind === "chest" && !tile.chestLock) {
    speak("Сундук не заперт.", tile.x, tile.y, "нет замка", "ok");
    return;
  }
  if (kind === "gate" && !tile.gateLock) {
    speak("Калитка без засова.", tile.x, tile.y, "нет засова", "ok");
    return;
  }
  if (s.character.energy < 3) {
    speak("Нет сил на взлом.", tile.x, tile.y, "нет силы", "bad");
    return;
  }
  const law = hasLaw(s.world, tile);
  const ownerHere = dummyOnYard(s.dummies, s.world, tile);
  const canCatch = law || ownerHere;
  const p = canCatch ? stealChance(s.world, tile, s.character, s.phase === "night") : 0;
  const caught = canCatch && Math.random() < Math.min(0.88, p + 0.16);
  tile.mark = { who: s.character.name, at: Date.now() };
  let c = {
    ...s.character,
    energy: Math.max(0, s.character.energy - 3),
  };
  c = bumpSkill(c, "stealth", caught ? 0.05 : 0.25);
  const betrayal = s.character.pacts[who] === "friend" || (!!s.character.village && tile.village === s.character.village);
  if (betrayal) c = { ...c, pacts: { ...c.pacts, [who]: "feud" }, wanted: (c.wanted ?? 0) + 2 };
  if (caught) {
    c = applyCatch(c, true, `взлом у ${who}`);
    if (c.wagon || c.transport === "wagon") {
      parkWagonNear(s.world, s.character.x, s.character.y, "you");
      c = { ...c, wagon: false, transport: c.horses > 0 ? "horse" : "walk" };
    }
    if (isJailed(c)) {
      cancelNotice("walk");
      const spot = jailSpot(s.world, tile.x, tile.y);
      c = { ...c, x: spot.x, y: spot.y, px: spot.x, py: spot.y, busy: null };
      viewPos.x = spot.x;
      viewPos.y = spot.y;
    }
    useGame.setState({
      character: c,
      inspect: null,
      travel: null,
      preview: null,
      hint: isJailed(c)
        ? { text: `Сидишь. ${c.jailWhy}. Залог ${goldTxt(BAIL_GOLD)}.`, tone: "bad" as const, keep: "jail" as const }
        : { text: "Видели взлом. Ямы нет, розыск. Замок цел.", tone: "bad" as const },
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(
        s.log,
        isJailed(c)
          ? `Поймали за взлом. ${law ? "Закон" : "Хозяин"} — яма. Замок цел.`
          : `Видели взлом. Ямы нет, розыск. Замок цел.`,
      ),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: law ? "яма" : "видели", tone: "bad" as const }].slice(-10),
    });
    return;
  }
  if (kind === "chest") tile.chestLock = false;
  else setYardGateLock(s.world, tile.x, tile.y, false);
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(
      s.log,
      kind === "chest"
        ? `Взломал сундук у ${who}. Замок сорван.`
        : `Взломал калитку у ${who}. Засов сорван. Можно войти.`,
    ),
    hint: { text: kind === "chest" ? "Сундук открыт." : "Калитка открыта. Можно войти.", tone: "ok" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "взлом", tone: "ok" as const }].slice(-10),
  });
}

function buyLock() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile?.caravan) {
    speak("Замок продаёт лавка на тракте. Или кузнец из слитка.", s.character.x, s.character.y, "нет лавки", "bad");
    return;
  }
  if (s.character.gold < LOCK_GOLD) {
    speak(`Замок ${goldTxt(LOCK_GOLD)}. Кузнец льёт из слитка.`, tile.x, tile.y, "мало золота", "bad");
    return;
  }
  const inv = { ...s.character.inventory, lock: (s.character.inventory.lock ?? 0) + 1 };
  useGame.setState({
    character: { ...s.character, inventory: inv, gold: s.character.gold - LOCK_GOLD },
    log: pushLog(s.log, `Купил замок за ${goldTxt(LOCK_GOLD)}. Повесь на калитку или сундук.`),
    hint: { text: "Замок в сумке. Повесь дома.", tone: "gold" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `−${goldTxt(LOCK_GOLD)}`, tone: "gold" as const }].slice(-10),
  });
}

function pickupPile() {
  const s = useGame.getState();
  const tile = tileAt(s.world, s.character.x, s.character.y);
  if (!tile) return;
  const gold = tile.goldDrop ?? 0;
  const pile = asPile(tile.pile);
  if (pileEmpty(pile) && gold <= 0) return;
  let inv = { ...s.character.inventory };
  const bits: string[] = [];
  for (const k of ITEMS) {
    const n = pile[k] ?? 0;
    if (n <= 0) continue;
    inv[k] = (inv[k] ?? 0) + n;
    bits.push(`${n} ${ITEM_LABEL[k]}`);
  }
  tile.pile = null;
  tile.goldDrop = 0;
  if (gold) bits.push(goldTxt(gold));
  useGame.setState({
    character: { ...s.character, inventory: inv, gold: s.character.gold + gold },
    log: pushLog(s.log, `Подобрал ${bits.join(" · ")}.`),
    floaters: [
      ...s.floaters,
      { id: ++floaterSeq, x: tile.x, y: tile.y, text: bits[0] ?? "поднял", tone: gold ? ("gold" as const) : ("ok" as const) },
    ].slice(-10),
    world: { ...s.world, tiles: s.world.tiles },
  });
  noteDeed("pile");
  useGame.getState().persist();
}

function dropItem(item: ItemId, qty: number) {
  const s = useGame.getState();
  const have = s.character.inventory[item];
  const n = Math.min(qty, have);
  if (n <= 0) {
    speak("Нечего выкладывать.", s.character.x, s.character.y, "пусто", "bad");
    return;
  }
  const tile = tileAt(s.world, s.character.x, s.character.y);
  if (!tile) return;
  let c = { ...s.character };
  const extras = have - (c.hand === item ? 1 : 0);
  if (n > extras && isWearId(item) && c.hand === item) {
    c = stashHand(c);
  }
  const inv = { ...c.inventory, [item]: have - n };
  if ((inv[item] ?? 0) <= 0 && c.hand === item) c = { ...c, hand: null };
  if (isWearId(item) && (inv[item] ?? 0) <= (c.hand === item ? 1 : 0)) {
    const bagWear = { ...(c.bagWear ?? {}) };
    delete bagWear[item];
    c = { ...c, bagWear };
  }
  pileAdd(tile, item, n);
  useGame.setState({
    character: { ...c, inventory: inv },
    log: pushLog(s.log, `Выложил ${n} ${ITEM_LABEL[item]} на клетку.`),
    floaters: [
      ...s.floaters,
      { id: ++floaterSeq, x: tile.x, y: tile.y, text: `выложил ${n}`, tone: "ok" as const },
    ].slice(-10),
    world: { ...s.world, tiles: s.world.tiles },
  });
  noteDeed("pile");
  useGame.getState().persist();
}

function storeItem(item: ItemId, qty: number) {
  const s = useGame.getState();
  const tile = tileAt(s.world, s.character.x, s.character.y);
  if (!tile || !hasChest(tile)) {
    speak("Сундук — в своём шалаше, доме или складе.", s.character.x, s.character.y, "нет сундука", "bad");
    return;
  }
  const have = s.character.inventory[item];
  const n = Math.min(qty, have);
  if (n <= 0) {
    speak("Нечего класть.", tile.x, tile.y, "пусто", "bad");
    return;
  }
  let c = s.character;
  const extras = have - (c.hand === item ? 1 : 0);
  if (n > extras && isWearId(item) && c.hand === item) c = stashHand(c);
  const inv = { ...c.inventory, [item]: have - n };
  if ((inv[item] ?? 0) <= 0 && c.hand === item) c = { ...c, hand: null };
  const chest = chestOf(tile);
  chest[item] += n;
  tile.chest = chest;
  useGame.setState({
    character: { ...c, inventory: inv },
    log: pushLog(s.log, `В сундук: ${n} ${ITEM_LABEL[item]}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "в сундук", tone: "ok" as const }].slice(-10),
    world: { ...s.world, tiles: s.world.tiles },
  });
}

function takeChest(item: ItemId, qty: number) {
  const s = useGame.getState();
  const tile = tileAt(s.world, s.character.x, s.character.y);
  if (!tile || !hasChest(tile)) {
    speak("Сундука здесь нет.", s.character.x, s.character.y, "нет сундука", "bad");
    return;
  }
  const chest = chestOf(tile);
  const n = Math.min(qty, chest[item]);
  if (n <= 0) {
    speak("В сундуке пусто.", tile.x, tile.y, "пусто", "bad");
    return;
  }
  chest[item] -= n;
  tile.chest = chest;
  const inv = { ...s.character.inventory, [item]: s.character.inventory[item] + n };
  useGame.setState({
    character: { ...s.character, inventory: inv },
    log: pushLog(s.log, `Из сундука: ${n} ${ITEM_LABEL[item]}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "из сундука", tone: "ok" as const }].slice(-10),
    world: { ...s.world, tiles: s.world.tiles },
  });
}

function buildOn(x: number, y: number, kind: BuildingKind) {
  const s = useGame.getState();
  if (kind === "none") return;
  if (kind === "workshop") kind = "bench";
  if (kind === "mine") kind = "adit";
  if (kind === "shop" || kind === "board") {
    speak("Лавка и биржа — на тракте, не зданием.", x, y, "не здесь", "bad");
    return;
  }
  const c = s.character;
  if (actHeld(c)) {
    speak(actHeld(c)!, c.x, c.y, "нельзя", "bad");
    return;
  }
  if (s.travel) {
    speak("В пути нельзя строить.", x, y, "в пути", "bad");
    return;
  }
  if (meetBlock()) return;
  if (busyBlock()) return;
  if (Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) > 1) {
    speak("Строят на соседней клетке.", x, y, "подойди", "bad");
    return;
  }
  const tile = tileAt(s.world, x, y);
  if (!tile) return;
  if (isForeignYard(tile)) {
    speak("чужой двор", x, y, "чужой двор", "bad");
    return;
  }
  if (tile.commons) {
    speak("На общей поляне капитальную стройку нельзя. Отойди за край.", x, y, "общая", "bad");
    return;
  }
  if (kind === "stakes" || kind === "moat") {
    if (!isOutsideYard(s.world, x, y)) {
      speak("Колья и ров — только снаружи тына.", x, y, "не снаружи", "bad");
      return;
    }
  } else if (!tile.owned && !tile.plot && kind !== "shack" && kind !== "field" && kind !== "pen" && kind !== "well" && kind !== "net" && kind !== "camp") {
    speak("Шалаш, поле, загон и колодец — без столба. Двор даёт зону под дом и станки.", x, y, "нужен двор", "bad");
    return;
  }
  if (kind === "net" && !nearWater(s.world, x, y) && tile.biome !== "ford") {
    speak("Сеть — на берегу реки или брода.", x, y, "не берег", "bad");
    return;
  }
  if ((kind === "tower" || kind === "jail" || kind === "shed" || kind === "bench" || kind === "forge" || kind === "oven") && !tile.plot && !tile.owned) {
    speak(`${BUILDING_LABEL[kind]} — только во дворе.`, x, y, "не двор", "bad");
    return;
  }
  if (tile.building !== "none") {
    if (!(kind === "house" && tile.building === "shack" && (tile.owner === "you" || tile.owned || tile.plot))) {
      speak("Клетка занята.", x, y, "занято", "bad");
      return;
    }
  }
  const ok = BUILD_OK[kind];
  if (!ok.includes(tile.biome)) {
    speak(`${BUILDING_LABEL[kind]} сюда не встаёт.`, x, y, "не сюда", "bad");
    return;
  }
  const cost = BUILD_COST[kind];
  const inv = { ...c.inventory };
  if (inv.wood < cost.wood || inv.stone < cost.stone || c.gold < cost.gold) {
    const need: string[] = [];
    if (cost.wood) need.push(`${cost.wood} ${ITEM_LABEL.wood}`);
    if (cost.stone) need.push(`${cost.stone} ${ITEM_LABEL.stone}`);
    if (cost.gold) need.push(goldTxt(cost.gold));
    speak(`Нужно ${need.join(", ")}.`, x, y, "мало материалов", "bad");
    return;
  }
  inv.wood -= cost.wood;
  inv.stone -= cost.stone;
  if (c.energy < 2) {
    speak(NO_STRENGTH, x, y, "нет силы", "bad");
    return;
  }
  const next = { ...c, inventory: inv, gold: c.gold - cost.gold, energy: Math.max(0, c.energy - 2) };
  const ms = buildMs(kind, next);
  startBusy(
    next,
    makeBusy("build", x, y, Date.now() + ms, { build: kind }),
    `Ставлю ${BUILDING_LABEL[kind]} · ${Math.ceil(ms / 1000)} с.`,
    x,
    y,
    "ставлю",
  );
}

function buildRoad(x: number, y: number, kind: "dirt" | "stone" | "bridge") {
  const s = useGame.getState();
  const c = s.character;
  if (s.travel) {
    speak("В пути нельзя строить.", x, y, "в пути", "bad");
    return;
  }
  if (meetBlock()) return;
  if (busyBlock()) return;
  const dist = Math.max(Math.abs(c.x - x), Math.abs(c.y - y));
  if (dist > 1) {
    speak("Дорогу кладут на соседней клетке.", x, y, "подойди", "bad");
    return;
  }
  const tile = tileAt(s.world, x, y);
  if (!tile) return;
  if (kind === "bridge") {
    if (tile.biome !== "river" && tile.biome !== "ford") {
      speak("Мост — только через реку.", x, y, "не река", "bad");
      return;
    }
  } else if (tile.biome === "river") {
    speak("Через реку нужен мост.", x, y, "нужен мост", "bad");
    return;
  }
  const cost = ROAD_COST[kind];
  const inv = { ...c.inventory };
  if (inv.wood < cost.wood || inv.stone < cost.stone) {
    speak(`Мало материалов: ${cost.wood} дерева, ${cost.stone} камня.`, x, y, "мало материалов", "bad");
    return;
  }
  inv.wood -= cost.wood;
  inv.stone -= cost.stone;
  if (c.energy < 2) {
    speak(NO_STRENGTH, x, y, "нет силы", "bad");
    return;
  }
  const next = { ...c, inventory: inv, energy: Math.max(0, c.energy - 2) };
  const ms = workMs("road", null, next);
  startBusy(
    next,
    makeBusy("road", x, y, Date.now() + ms, { road: kind }),
    `Кладу ${kind === "dirt" ? "грунт" : kind === "stone" ? "камень" : "мост"} · ${Math.ceil(ms / 1000)} с.`,
    x,
    y,
    "кладу путь",
  );
}

function hereTile() {
  const s = useGame.getState();
  return tileAt(s.world, s.character.x, s.character.y);
}

function buyFromTrader(item: ItemId, qty: number) {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile?.caravan) {
    speak("Лавка на тракте — дойди до повозки.", s.character.x, s.character.y, "нет лавки", "bad");
    return;
  }
  const have = s.trader.wares[item] ?? 0;
  const n = Math.min(qty, have);
  if (n <= 0) {
    speak(`В лавке кончилось: ${ITEM_LABEL[item]}. На неделе подвезут.`, tile.x, tile.y, "нет товара", "bad");
    return;
  }
  const unit = caravanSell(item, s.season);
  const cost = unit * n;
  if (s.character.gold < cost) {
    speak(`Нужно ${goldTxt(cost)}, есть ${goldTxt(s.character.gold)}.`, tile.x, tile.y, "мало золота", "bad");
    return;
  }
  const given = giveOrPile({ ...s.character.inventory }, s.character.transport, tile, item, n);
  const wares = { ...s.trader.wares, [item]: have - n };
  let c = { ...s.character, inventory: given.inv, gold: s.character.gold - cost };
  c = bumpSkill(c, "trade", 0.1);
  const last = `Продал тебе ${n} ${ITEM_LABEL[item]} за ${goldTxt(unit)} шт. Осталось ${wares[item]}.`;
  useGame.setState({
    character: c,
    trader: { ...s.trader, wares, last },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, given.piled ? `Лавка: ${last} Лишнее на клетке.` : `Лавка: ${last}`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `−${goldTxt(cost)}`, tone: "gold" as const }].slice(-10),
  });
}

function restHere() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile) return;
  if (isJailed(s.character)) {
    speak("В яме сила капает сама. Или залог.", tile.x, tile.y, "в яме", "bad");
    return;
  }
  if (s.character.life === "down") {
    speak("Упал. Сначала дойди до шалаша — там поднимешься.", tile.x, tile.y, "упал", "bad");
    return;
  }
  if (s.character.life === "dead") {
    speak("Погиб. Двор стоит — выйдешь дома.", tile.x, tile.y, "погиб", "bad");
    return;
  }
  const roof = hasRoofAt(s, tile.x, tile.y) || s.character.profession === "hireling";
  if (!roof) {
    speak("Зайди в шалаш или дом и нажми Спать. В поле сила капает медленно. Кружка за золото — сразу.", tile.x, tile.y, "нужен шалаш", "bad");
    return;
  }
  if (s.character.energy >= ENERGY_MAX && !s.character.resting) {
    speak("Сила полная. Ты в шалаше — тепло капает само. Лежать незачем.", tile.x, tile.y, "сила полная", "ok");
    return;
  }
  const resting = !s.character.resting;
  if (resting) cancelNotice("walk");
  else cancelNotice("energy");
  const line = resting
    ? "Лежишь. Сила капает быстрее, пока лежишь. Можно убрать телефон."
    : "Встал.";
  useGame.setState({
    character: { ...s.character, resting, energyAt: Date.now() },
    travel: resting ? null : s.travel,
    log: pushLog(s.log, line),
    hint: { text: line, tone: "ok" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: resting ? "лежишь" : "встал", tone: "ok" as const }].slice(-10),
  });
  if (resting) {
    const period = energyPeriod({ roof, sleeping: true, hungry: s.character.satiety < 25 });
    const need = Math.max(1, ENERGY_MAX - s.character.energy);
    scheduleNotice("energy", "Сила полная", "Отдохнул — можно вставать.", Date.now() + need * period);
    useGame.getState().persist();
  }
}

function sleepHere() {
  restHere();
}

function boostEnergy() {
  const s = useGame.getState();
  if (isJailed(s.character)) {
    speak("Из ямы кружку не подают. Залог.", s.character.x, s.character.y, "в яме", "bad");
    return;
  }
  if (s.character.energy >= ENERGY_MAX) {
    speak("Сила полная.", s.character.x, s.character.y, "полная", "ok");
    return;
  }
  if (s.character.gold < BOOST_GOLD) {
    speak(`Кружка ${goldTxt(BOOST_GOLD)} — сила сразу. Сдай добро в лавку.`, s.character.x, s.character.y, "мало золота", "bad");
    return;
  }
  const energy = Math.min(ENERGY_MAX, s.character.energy + BOOST_ENERGY);
  useGame.setState({
    character: { ...s.character, gold: s.character.gold - BOOST_GOLD, energy, energyAt: Date.now() },
    log: pushLog(s.log, `Кружка −${goldTxt(BOOST_GOLD)}. Сила ${energy}/${ENERGY_MAX}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: s.character.x, y: s.character.y, text: `+${BOOST_ENERGY} сила`, tone: "gold" as const }].slice(-10),
  });
}

function skipTravel() {
  const s = useGame.getState();
  if (isHeld(s.character)) {
    speak(heldLine(s.character) ?? "Не ходит.", s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  const travel = s.travel;
  if (!travel || travel.path.length === 0) return;
  if (s.character.gold < SKIP_GOLD) {
    speak(`Ускорить ход — ${goldTxt(SKIP_GOLD)}.`, s.character.x, s.character.y, "мало золота", "bad");
    return;
  }
  cancelNotice("walk");
  const last = travel.path[travel.path.length - 1]!;
  viewPos.x = last.x;
  viewPos.y = last.y;
  useGame.setState({
    character: {
      ...s.character,
      x: last.x,
      y: last.y,
      px: last.x,
      py: last.y,
      gold: s.character.gold - SKIP_GOLD,
    },
    travel: null,
    preview: null,
    selected: { x: last.x, y: last.y },
    log: pushLog(s.log, `Подорожная −${goldTxt(SKIP_GOLD)}. Пришёл сразу.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: last.x, y: last.y, text: "сразу", tone: "gold" as const }].slice(-10),
  });
  queueMicrotask(() => maybeMeetHere(last.x, last.y));
}

function bailOut() {
  const s = useGame.getState();
  if (!isJailed(s.character)) {
    speak("Ты не в яме.", s.character.x, s.character.y, "на воле", "ok");
    return;
  }
  if (s.character.gold < BAIL_GOLD) {
    speak("Сдайте в лавку, потом залог.", s.character.x, s.character.y, "мало золота", "bad", { keep: "jail" });
    return;
  }
  dropHint({ force: true });
  useGame.setState({
    character: { ...s.character, gold: s.character.gold - BAIL_GOLD, jailedUntil: 0, jailWhy: "", life: s.character.life === "jailed" ? "alive" : s.character.life },
    hint: null,
    log: pushLog(s.log, `Залог −${goldTxt(BAIL_GOLD)}. Вышел. Розыск остался.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: s.character.x, y: s.character.y, text: "залог", tone: "gold" as const }].slice(-10),
  });
}

function toggleLaw() {
  const s = useGame.getState();
  const t = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!t?.plot) {
    speak("Законы — на дворе.", s.character.x, s.character.y, "не двор", "bad");
    return;
  }
  const village = s.character.village && t.village === s.character.village ? s.character.village : "";
  if (village) {
    const next = !hasLaw(s.world, t);
    setVillageLaw(s.world, village, next);
    useGame.setState({
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, next ? `Закон деревни «${village}»: вора сажают.` : `В «${village}» законов нет.`),
    });
    return;
  }
  if (t.owner && t.owner !== "you") {
    speak("Законы — на своём дворе.", s.character.x, s.character.y, "не твой", "bad");
    return;
  }
  const b = plotBounds(s.world, t.x, t.y);
  if (!b) return;
  const next = !hasLaw(s.world, t);
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const q = tileAt(s.world, x, y);
      if (q) q.law = next;
    }
  }
  useGame.setState({
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(
      s.log,
      next
        ? "На дворе законы: вора, если увидят, сажают."
        : "Законов нет. Вора не посадят — но двор может мстить сам.",
    ),
  });
}

function stealHere() {
  const s = useGame.getState();
  if (s.travel) {
    speak("В пути не крадут.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (busyBlock()) return;
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile) return;
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Крадут рядом.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  const who = ownerOf(tile);
  if (!who || who === "you") {
    speak("Своё не крадут. Чужой двор — к юго-западу от поляны.", tile.x, tile.y, "нечего", "bad");
    return;
  }
  const betrayal =
    s.character.pacts[who] === "friend" || (!!s.character.village && tile.village === s.character.village);
  if (s.character.energy < 2) {
    speak("Нет сил на кражу.", tile.x, tile.y, "нет силы", "bad");
    return;
  }
  const loot = lootFrom(tile);
  if (!loot) {
    if (tile.chestLock) {
      speak("Сундук на замке. Сначала взломай — или унеси с кучи у клетки.", tile.x, tile.y, "замок", "bad", { theme: "empty" });
      return;
    }
    speak("Пусто. Уже вынесли.", tile.x, tile.y, "пусто", "bad", { theme: "empty" });
    return;
  }
  const law = hasLaw(s.world, tile);
  const ownerHere = dummyOnYard(s.dummies, s.world, tile);
  const canCatch = law || ownerHere;
  const p = canCatch ? stealChance(s.world, tile, s.character, s.phase === "night") : 0;
  const caught = canCatch && Math.random() < p;
  const inv = { ...s.character.inventory };
  inv[loot.item] += loot.n;
  if (!tile.chestLock && tile.chest[loot.item] > 0) tile.chest[loot.item] -= loot.n;
  else if (asPile(tile.pile)[loot.item]) {
    pileTake(tile, loot.item, loot.n);
  } else if (tile.building === "field") tile.amount = Math.max(0, tile.amount - loot.n);
  tile.mark = { who: s.character.name, at: Date.now() };
  let c: Character = {
    ...s.character,
    inventory: inv,
    energy: Math.max(0, s.character.energy - 2),
  };
  c = bumpSkill(c, "stealth", caught ? 0.05 : 0.2);
  if (betrayal) {
    c = { ...c, pacts: { ...c.pacts, [who]: "feud" }, wanted: (c.wanted ?? 0) + 2 };
  }
  if (caught) {
    c = applyCatch(c, true, `кража у ${who}`);
    if (c.wagon || c.transport === "wagon") {
      parkWagonNear(s.world, s.character.x, s.character.y, "you");
      c = { ...c, wagon: false, transport: c.horses > 0 ? "horse" : "walk" };
    }
    if (isJailed(c)) {
      cancelNotice("walk");
      const spot = jailSpot(s.world, tile.x, tile.y);
      c = { ...c, x: spot.x, y: spot.y, px: spot.x, py: spot.y, busy: null };
      viewPos.x = spot.x;
      viewPos.y = spot.y;
    }
    const why = law ? "Закон двора — яма." : "Хозяин на дворе — яма.";
    useGame.setState({
      character: c,
      inspect: null,
      travel: null,
      preview: null,
      hint: { text: `Сидишь. ${c.jailWhy}. Залог ${goldTxt(BAIL_GOLD)}.`, tone: "bad", keep: "jail" },
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, `Поймали за кражу. ${why} ${c.jailWhy}. Успел унести ${loot.n} ${ITEM_LABEL[loot.item]}.`),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "яма", tone: "bad" as const }].slice(-10),
    });
    return;
  }
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Утащил ${loot.n} ${ITEM_LABEL[loot.item]} со двора ${who}. Тихо.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${loot.n} ${ITEM_LABEL[loot.item]}`, tone: "ok" as const }].slice(-10),
  });
}

function cookHere() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || (tile.building !== "shack" && tile.building !== "house" && tile.building !== "camp")) {
    speak("Готовить — у костра, в шалаше или доме.", s.character.x, s.character.y, "нет огня", "bad");
    return;
  }
  if (tile.burned) {
    speak("Очаг сгорел.", tile.x, tile.y, "сгорел", "bad");
    return;
  }
  const inv = { ...s.character.inventory };
  const meal: ItemId = inv.food > 0 ? "food" : inv.fish > 0 ? "fish" : "food";
  if (inv[meal] <= 0 || inv.wood <= 0) {
    speak("Нужны еда или рыба и полено.", tile.x, tile.y, "нет припасов", "bad");
    return;
  }
  inv[meal] -= 1;
  inv.wood -= 1;
  const herb = inv.herb > 0;
  if (herb) inv.herb -= 1;
  const satiety = Math.min(100, s.character.satiety + (herb ? 40 : 28));
  let c = bumpSkill(
    { ...s.character, inventory: inv, satiety },
    s.character.profession === "baker" ? "craft" : "survival",
    0.1,
  );
  useGame.setState({
    character: c,
    log: pushLog(s.log, herb ? "Похлёбка. Сытость. Сила сама капает." : "Подогрел еду. Сытость, не сила."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "горячее", tone: "ok" as const }].slice(-10),
  });
}

function craftAxe() {
  doCraft("axe");
}

function workDay() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || (!tile.caravan && tile.building !== "board")) {
    speak("Подёнщина — у лавки на тракте или у доски биржи.", s.character.x, s.character.y, "не здесь", "bad");
    return;
  }
  if (s.character.energy < 4) {
    speak("Слишком устал для подёнщины.", tile.x, tile.y, "нет сил", "bad");
    return;
  }
  const pay = 8;
  let c = bumpSkill(
    {
      ...s.character,
      gold: s.character.gold + pay,
      energy: s.character.energy - 4,
      satiety: Math.max(0, s.character.satiety - 6),
    },
    "survival",
    0.08,
  );
  useGame.setState({
    character: c,
    log: pushLog(s.log, `Подёнщина: +${goldTxt(pay)}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${goldTxt(pay)}`, tone: "gold" as const }].slice(-10),
  });
}

function collectShop() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || tile.building !== "shop" || !isYours(tile)) {
    speak("чужой двор", s.character.x, s.character.y, "чужой двор", "bad");
    return;
  }
  const n = tile.takings || 0;
  if (n <= 0) {
    speak("Касса пуста. Клади товар в тайник лавки — за день кто-нибудь купит.", tile.x, tile.y, "пусто", "bad");
    return;
  }
  tile.takings = 0;
  useGame.setState({
    character: { ...s.character, gold: s.character.gold + n },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Забрал из лавки ${goldTxt(n)}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${goldTxt(n)}`, tone: "gold" as const }].slice(-10),
  });
}

function equipHand(item: ItemId | null) {
  const s = useGame.getState();
  if (item && !TOOL_ITEMS.includes(item as (typeof TOOL_ITEMS)[number])) {
    speak("Это не снасть.", s.character.x, s.character.y, "не снасть", "bad");
    return;
  }
  if (item && s.character.inventory[item] <= 0) {
    speak(`Нет: ${ITEM_LABEL[item]}.`, s.character.x, s.character.y, "нет", "bad");
    return;
  }
  const tile = hereTile();
  const prev = s.character.hand;
  let c = gripHand(s.character, item);
  if (!item && prev && isWearId(prev) && loadRatio(c.inventory, c.transport, wornKg(c) + pailKg(c.pail)) > 1 && tile) {
    pileAdd(tile, prev, 1);
    const inv = { ...c.inventory, [prev]: Math.max(0, (c.inventory[prev] ?? 0) - 1) };
    const bagWear = { ...(c.bagWear ?? {}) };
    delete bagWear[prev];
    c = { ...c, inventory: inv, bagWear };
    useGame.setState({
      character: c,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, `Ноша не тянет. ${ITEM_LABEL[prev]} на клетке.`),
      hint: { text: `${ITEM_LABEL[prev]} на земле.`, tone: "ok" },
    });
    return;
  }
  useGame.setState({
    character: c,
    log: pushLog(s.log, item ? `В руке: ${ITEM_LABEL[item]}.` : "Рука пуста."),
  });
  if (item === "rod") dropHint({ theme: "rod" });
  if (item === "rope") dropHint({ theme: "rope" });
}

function takeOffSlot(c: Character, slot: "body" | "shield" | "helm", tile: ReturnType<typeof hereTile>): Character {
  const id = c[slot];
  if (!id) return { ...c, [slot]: null };
  const stripped = { ...c, [slot]: null as ItemId | null };
  const inv = { ...c.inventory, [id]: (c.inventory[id] ?? 0) + 1 };
  const next = { ...stripped, inventory: inv };
  if (tile && loadRatio(inv, c.transport, wornKg(next) + pailKg(next.pail)) > 1) {
    pileAdd(tile, id, 1);
    return stripped;
  }
  return next;
}

function equipWear(item: ItemId | null, slot?: "body" | "shield" | "helm") {
  const s = useGame.getState();
  const tile = hereTile();
  let c = s.character;
  const resolved = slot ?? (item ? gearSlot(item) : null);
  if (!resolved) {
    speak("Это не броня и не щит.", c.x, c.y, "не броня", "bad");
    return;
  }
  if (!item) {
    const was = c[resolved];
    if (!was) return;
    c = takeOffSlot(c, resolved, tile);
    const piled = was && c[resolved] === null && (c.inventory[was] ?? 0) === (s.character.inventory[was] ?? 0);
    useGame.setState({
      character: c,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, piled ? `Ноша не тянет. ${ITEM_LABEL[was]} на клетке.` : `Снял: ${ITEM_LABEL[was]}.`),
    });
    return;
  }
  if (gearSlot(item) !== resolved) {
    speak("Не на то место.", c.x, c.y, "не сюда", "bad");
    return;
  }
  if (c[resolved] === item) {
    equipWear(null, resolved);
    return;
  }
  if ((c.inventory[item] ?? 0) <= 0) {
    speak(`Нет: ${ITEM_LABEL[item]}.`, c.x, c.y, "нет", "bad");
    return;
  }
  if (c[resolved]) c = takeOffSlot(c, resolved, tile);
  const inv = { ...c.inventory, [item]: Math.max(0, (c.inventory[item] ?? 0) - 1) };
  c = { ...c, inventory: inv, [resolved]: item };
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Надел: ${ITEM_LABEL[item]}.`),
  });
}

function huntHere() {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (s.travel) {
    speak("Сначала дойди.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  if (busyBlock()) return;
  const tile = hereTile();
  if (!tile?.herd || !tile.herd.wild || (tile.herd.kind !== "hare" && tile.herd.kind !== "deer")) {
    speak("Дичи здесь нет. Заяц на равнине, олень в лесу.", s.character.x, s.character.y, "нет дичи", "bad");
    return;
  }
  if (!needStrength(s.character, 2, tile.x, tile.y)) return;
  const ms = workMs("hunt", tile.herd.kind, s.character);
  let c = { ...s.character, energy: Math.max(0, s.character.energy - 2) };
  if (c.hand === "spear") {
    const worn = takeWear(c, "spear");
    c = worn.c;
  }
  startBusy(
    c,
    makeBusy("hunt", tile.x, tile.y, Date.now() + ms),
    `Охота на ${ANIMAL_LABEL[tile.herd.kind]} · ${Math.ceil(ms / 1000)} с. Копьё быстрее.`,
    tile.x,
    tile.y,
    `охота ${Math.ceil(ms / 1000)}с`,
  );
}

function catchHorse() {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (s.travel) {
    speak("Сначала дойди.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  if (busyBlock()) return;
  const tile = hereTile();
  if (!tile?.herd || tile.herd.kind !== "horse" || !tile.herd.wild || tile.herd.count <= 0) {
    if ((s.character.horses ?? 0) > 0) {
      speak("Здесь уже никого. Конь при тебе.", s.character.x, s.character.y, "пусто", "ok", { theme: "horse" });
    } else {
      speak("Диких лошадей нет. Ищи табун на равнине.", s.character.x, s.character.y, "нет табуна", "bad");
    }
    return;
  }
  if (s.character.hand !== "rope") {
    speak("Нужна верёвка в руке.", tile.x, tile.y, "нет верёвки", "bad", { theme: "rope" });
    return;
  }
  if (!needStrength(s.character, 1, tile.x, tile.y)) return;
  const ms = workMs("catch", "horse", s.character);
  useGame.setState({
    character: {
      ...s.character,
      energy: Math.max(0, s.character.energy - 1),
      busy: makeBusy("catch", tile.x, tile.y, Date.now() + ms),
      resting: false,
    },
    inspect: null,
    hint: null,
    log: pushLog(s.log, `Ловлю лошадь · ${Math.ceil(ms / 1000)} с.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `ловлю ${Math.ceil(ms / 1000)}с`, tone: "ok" as const }].slice(-10),
  });
  scheduleNotice("busy", "Лошадь", "Лов кончился.", Date.now() + ms);
}

function fishHere() {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (s.travel) {
    speak("Сначала дойди.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  if (busyBlock()) return;
  const tile = hereTile();
  if (!tile || !canFishOn(s.world, tile)) {
    speak("Ловят на броду или у берега реки. Нужна удочка в руке.", s.character.x, s.character.y, "не берег", "bad");
    return;
  }
  if (s.character.hand !== "rod" && tile.building !== "net") {
    speak("Нужна удочка в руке. Сколотить дома: 1 дерево и 1 верёвка. Или поставь сеть на берегу.", tile.x, tile.y, "нужна удочка", "bad", { theme: "rod" });
    return;
  }
  if (!needStrength(s.character, 2, tile.x, tile.y)) return;
  if ((tile.resource === "fish" ? tile.amount : 6 - tile.takings) <= 0) {
    speak("Разгнали. Завтра подойдут.", tile.x, tile.y, "пусто", "bad");
    return;
  }
  const ms = workMs("fish", null, s.character);
  useGame.setState({
    character: {
      ...s.character,
      energy: Math.max(0, s.character.energy - 2),
      busy: makeBusy("fish", tile.x, tile.y, Date.now() + ms),
      resting: false,
    },
    inspect: null,
    hint: null,
    log: pushLog(s.log, `Ловлю рыбу · ${Math.ceil(ms / 1000)} с.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `ловлю ${Math.ceil(ms / 1000)}с`, tone: "ok" as const }].slice(-10),
  });
  scheduleNotice("busy", "Рыба", "Вытащил — смотри клетку.", Date.now() + ms);
  useGame.getState().persist();
}

function resolveBusy() {
  const s = useGame.getState();
  const b = s.character.busy;
  if (!b) return;
  cancelNotice("busy");
  maybePingHidden("Дело готово", BUSY_LABEL[b.kind], "busy");
  const tile = tileAt(s.world, b.x, b.y);
  const c0 = { ...s.character, busy: null };
  if (!tile) {
    useGame.setState({ character: c0, log: pushLog(s.log, "Дело сорвалось.") });
    return;
  }
  if (b.kind === "hunt") resolveHunt(s, c0, tile);
  else if (b.kind === "catch") resolveCatch(s, c0, tile);
  else if (b.kind === "fish") resolveFish(s, c0, tile);
  else if (b.kind === "chop" || b.kind === "mine" || b.kind === "forage") resolveGather(s, c0, tile, b.item);
  else if (b.kind === "build") resolveBuild(s, c0, tile, b.build);
  else if (b.kind === "craft") resolveCraft(s, c0, tile, b.craft);
  else if (b.kind === "road") resolveRoad(s, c0, tile, b.road);
  else if (b.kind === "dig") resolveDig(s, c0, tile);
  else if (b.kind === "fill") resolveFill(s, c0, tile);
  else useGame.setState({ character: c0 });
}

function resolveGather(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>, item?: ItemId) {
  const res = item ?? tile.resource;
  if (!res || tile.resource !== res || tile.amount <= 0) {
    useGame.setState({
      character: c0,
      log: pushLog(s.log, "Уже пусто."),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "пусто", tone: "bad" as const }].slice(-10),
    });
    return;
  }
  let got = Math.min(GATHER_YIELD[res] || 1, tile.amount);
  const match = PROFESSION_BIOME[c0.profession]?.includes(tile.biome);
  if (match) got = Math.min(tile.amount, got + 1);
  if (c0.hand === "axe" && res === "wood") got = Math.min(tile.amount, got + 1);
  if (c0.hand === "pick" && (res === "stone" || res === "ore" || res === "crystal")) got = Math.min(tile.amount, got + 1);
  if (res === "wood" && c0.hand !== "axe") got = Math.max(1, Math.floor(got * 0.4));
  if ((res === "stone" || res === "ore") && c0.hand !== "pick") got = Math.max(1, Math.floor(got * 0.4));
  if (s.phase === "night") got = Math.max(1, Math.floor(got * 0.5));
  tile.amount -= got;
  if (tile.amount <= 0) markDepleted(tile);
  else if (res === "herb") tile.regen = Math.max(tile.regen ?? 0, REGROW_WAIT.herb ?? 2);
  const given = giveOrPile({ ...c0.inventory }, c0.transport, tile, res, got);
  const c = bumpSkill({ ...c0, inventory: given.inv }, match ? PROF_SKILL[c0.profession] : "survival", 0.12);
  const extra = given.piled ? ` Лишнее (${given.piled}) на клетке.` : "";
  const phrase =
    res === "herb"
      ? `Нарвал траву ×${got}.${extra} Отрастёт.`
      : `Собрал ${got} ${ITEM_LABEL[res]}. Ноша ${cargoWeight(given.inv).toFixed(1)} кг.${extra}`;
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, phrase),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${got} ${ITEM_LABEL[res]}`, tone: "ok" as const }].slice(-10),
  });
  noteDeed(res === "wood" ? "chop" : "gather");
  useGame.getState().persist();
}

function resolveBuild(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>, kind?: BuildingKind) {
  if (!kind || kind === "none") {
    useGame.setState({ character: c0, log: pushLog(s.log, "Стройка сорвалась.") });
    return;
  }
  if (tile.building !== "none" && !(kind === "house" && tile.building === "shack")) {
    useGame.setState({ character: c0, log: pushLog(s.log, "Клетка уже занята.") });
    return;
  }
  tile.building = kind;
  tile.matter = defaultMatter(kind);
  tile.hp = MATTER_HP[tile.matter];
  tile.burned = false;
  const c = bumpSkill(c0, "build", 0.2);
  useGame.setState({
    character: c,
    selected: { x: tile.x, y: tile.y },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Поставил ${BUILDING_LABEL[kind]}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: BUILDING_LABEL[kind], tone: "ok" as const }].slice(-10),
  });
  noteDeed("build");
  useGame.getState().persist();
}

function resolveCraft(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>, craftId?: string) {
  const def = CRAFTS.find((d) => d.id === craftId);
  if (!def) {
    useGame.setState({ character: c0, log: pushLog(s.log, "Ремесло сорвалось.") });
    return;
  }
  const inv0 = { ...c0.inventory };
  for (const [k, n] of Object.entries(def.need) as [ItemId, number][]) {
    if ((inv0[k] ?? 0) < n) {
      useGame.setState({ character: c0, log: pushLog(s.log, "Мало сырья — дело сорвалось.") });
      return;
    }
  }
  for (const [k, n] of Object.entries(def.need) as [ItemId, number][]) inv0[k] -= n;
  const given = giveOrPile(inv0, c0.transport, tile, def.out, def.n);
  let hand = c0.hand;
  let wear = { ...(c0.wear ?? {}) };
  const toolOut = def.out === "axe" || def.out === "pick" || def.out === "spear" || def.out === "rope" || def.out === "bucket" || def.out === "shovel" || def.out === "rod" || def.out === "club" || def.out === "knife";
  if (toolOut && !c0.hand && (given.inv[def.out] ?? 0) > 0) {
    hand = def.out;
    if (isWearId(def.out)) wear[def.out] = TOOL_LIFE[def.out];
  }
  const c = bumpSkill({ ...c0, inventory: given.inv, hand, wear }, PROF_SKILL[c0.profession], 0.15);
  const extra = given.piled ? " Лишнее на клетке станка." : "";
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(
      s.log,
      (def.who === "any" ? `Сделал: ${def.label} ×${def.n}.` : `${PROFESSION_LABEL[c0.profession]}: ${def.label} ×${def.n}.`) + extra,
    ),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${def.label}`, tone: "ok" as const }].slice(-10),
  });
  useGame.getState().persist();
}

function resolveRoad(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>, kind?: "dirt" | "stone" | "bridge") {
  if (!kind) {
    useGame.setState({ character: c0 });
    return;
  }
  tile.road = kind === "bridge" ? "bridge" : kind;
  const label = kind === "dirt" ? "грунт" : kind === "stone" ? "камень" : "мост";
  useGame.setState({
    character: c0,
    selected: { x: tile.x, y: tile.y },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Положил ${label}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: label, tone: "ok" as const }].slice(-10),
  });
  noteDeed("road");
  useGame.getState().persist();
}

function resolveDig(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>) {
  if (tile.pit) {
    useGame.setState({ character: c0, log: pushLog(s.log, "Уже яма.") });
    return;
  }
  const bank = !!tile.bank;
  let clay = bank ? 2 : 1;
  tile.pit = true;
  tile.bank = false;
  let ore = 0;
  if (!bank && Math.random() < 0.08) ore = 1;
  let inv = { ...c0.inventory };
  const clayOut = giveOrPile(inv, c0.transport, tile, "clay", clay);
  inv = clayOut.inv;
  if (ore) {
    const oreOut = giveOrPile(inv, c0.transport, tile, "ore", ore);
    inv = oreOut.inv;
  }
  const c = bumpSkill({ ...c0, inventory: inv }, "mine", 0.08);
  const bits = [`+${clay} глина`];
  if (ore) bits.push("+руда");
  useGame.setState({
    character: c,
    inspect: null,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Выкопал. ${bits.join(" · ")}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: bits[0]!, tone: "ok" as const }].slice(-10),
  });
  noteDeed("pit");
  useGame.getState().persist();
}

function resolveFill(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>) {
  if (!tile.pit) {
    useGame.setState({ character: c0, log: pushLog(s.log, "Ямы уже нет.") });
    return;
  }
  tile.pit = false;
  tile.bank = false;
  if (tile.biome !== "plains" && tile.biome !== "fertile") tile.biome = "plains";
  if (tile.resource === "ore" && tile.amount <= 0) tile.resource = null;
  useGame.setState({
    character: c0,
    inspect: null,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, "Засыпал яму. Снова равнина."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "засыпал", tone: "ok" as const }].slice(-10),
  });
  noteDeed("pit");
  useGame.getState().persist();
}

function resolveHunt(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>) {
  if (!tile.herd || !tile.herd.wild || (tile.herd.kind !== "hare" && tile.herd.kind !== "deer")) {
    useGame.setState({
      character: c0,
      log: pushLog(s.log, "Зверя уже нет."),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "ушёл", tone: "bad" as const }].slice(-10),
    });
    return;
  }
  const spear = c0.hand === "spear";
  const chance = spear ? 0.85 : c0.hand === "axe" ? 0.55 : 0.35;
  if (Math.random() > chance) {
    tile.herd.count -= Math.random() < 0.4 ? 1 : 0;
    if (tile.herd.count <= 0) tile.herd = null;
    useGame.setState({
      character: c0,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, "Зверь ушёл. Копьё в руке бьёт вернее."),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "ушёл", tone: "bad" as const }].slice(-10),
    });
    noteDeed("hunt");
    useGame.getState().persist();
    return;
  }
  const got = spear ? 2 : 1;
  const kind = tile.herd.kind;
  tile.herd.count -= 1;
  if (tile.herd.count <= 0) tile.herd = null;
  const given = giveOrPile({ ...c0.inventory }, c0.transport, tile, "food", got);
  const c = bumpSkill({ ...c0, inventory: given.inv }, "survival", 0.15);
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Добыл ${got} еды (${ANIMAL_LABEL[kind]}).`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${got} еда`, tone: "ok" as const }].slice(-10),
  });
  noteDeed("hunt");
  useGame.getState().persist();
}

function resolveCatch(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>) {
  if (!tile.herd || tile.herd.kind !== "horse" || !tile.herd.wild || tile.herd.count <= 0) {
    useGame.setState({
      character: c0,
      log: pushLog(s.log, (c0.horses ?? 0) > 0 ? "Здесь уже никого. Конь при тебе." : "Табуна уже нет."),
      hint: { text: (c0.horses ?? 0) > 0 ? "Здесь уже никого. Конь при тебе." : "Табуна уже нет.", tone: "ok", theme: "horse" },
    });
    return;
  }
  const chance = 0.4 + c0.skills.agro * 0.04;
  if (Math.random() > chance) {
    useGame.setState({
      character: c0,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, "Лошадь вырвалась. Ещё раз — верёвка в руке."),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "сорвалась", tone: "bad" as const }].slice(-10),
    });
    noteDeed("catch");
    useGame.getState().persist();
    return;
  }
  tile.herd.count -= 1;
  if (tile.herd.count <= 0) tile.herd = null;
  const c = bumpSkill({ ...c0, horses: c0.horses + 1 }, "agro", 0.2);
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    hint: null,
    log: pushLog(s.log, "Поймал лошадь. Седлай в сумке — транспорт «лошадь», не второй лов."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "+лошадь", tone: "ok" as const }].slice(-10),
  });
  noteDeed("catch");
  useGame.getState().persist();
}

function resolveFish(s: GameState, c0: Character, tile: NonNullable<ReturnType<typeof tileAt>>) {
  const stock = tile.resource === "fish" ? tile.amount : Math.max(0, 6 - (tile.takings ?? 0));
  if (stock <= 0) {
    useGame.setState({
      character: c0,
      log: pushLog(s.log, "Разгнали. Завтра подойдут."),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "пусто", tone: "bad" as const }].slice(-10),
    });
    return;
  }
  const fisher = c0.profession === "fisher";
  let got = 1;
  if (c0.hand === "rod") got += 1;
  if (c0.skills.survival >= 3 || fisher) got += 1;
  if (c0.hand === "spear") got = Math.max(1, got - 1);
  got = Math.min(3, stock, got);
  tile.takings = (tile.takings ?? 0) + 1;
  if (tile.resource === "fish") tile.amount = Math.max(0, tile.amount - got);
  const given = giveOrPile({ ...c0.inventory }, c0.transport, tile, "fish", got);
  const c = bumpSkill({ ...c0, inventory: given.inv }, "survival", 0.12);
  dropHint({ theme: "rod" });
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    hint: null,
    log: pushLog(s.log, `Вытащил ${got} рыбы.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${got} рыба`, tone: "ok" as const }].slice(-10),
  });
  noteDeed("fish");
  useGame.getState().persist();
}

function cancelBusy() {
  const s = useGame.getState();
  const b = s.character.busy;
  if (!b) return;
  cancelNotice("busy");
  const tile = tileAt(s.world, b.x, b.y);
  if ((b.kind === "hunt" || b.kind === "catch") && tile?.herd && Math.random() < 0.4) {
    tile.herd.count -= 1;
    if (tile.herd.count <= 0) tile.herd = null;
    useGame.setState({
      character: { ...s.character, busy: null },
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, "Бросил. Зверя спугнул."),
      floaters: [...s.floaters, { id: ++floaterSeq, x: s.character.x, y: s.character.y, text: "спугнул", tone: "bad" as const }].slice(-10),
    });
    noteDeed("hunt");
    useGame.getState().persist();
    return;
  }
  useGame.setState({
    character: { ...s.character, busy: null },
    log: pushLog(s.log, "Бросил дело."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: s.character.x, y: s.character.y, text: "бросил", tone: "ok" as const }].slice(-10),
  });
}

function skipBusy() {
  const s = useGame.getState();
  if (isHeld(s.character)) {
    speak(heldLine(s.character) ?? "Нельзя.", s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (!s.character.busy) return;
  if (s.character.gold < SKIP_GOLD) {
    speak(`Ускорить дело — ${goldTxt(SKIP_GOLD)}.`, s.character.x, s.character.y, "мало золота", "bad");
    return;
  }
  useGame.setState({
    character: { ...s.character, gold: s.character.gold - SKIP_GOLD, busy: { ...s.character.busy, until: Date.now() } },
    log: pushLog(s.log, `Подорожная −${goldTxt(SKIP_GOLD)}.`),
  });
  resolveBusy();
}

function hireBusy() {
  const s = useGame.getState();
  if (isHeld(s.character)) {
    speak(heldLine(s.character) ?? "Нельзя.", s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (!s.character.busy) return;
  if (s.character.busy.hired) {
    speak("Руки уже работают. Можно отойти.", s.character.x, s.character.y, "наняты", "ok");
    return;
  }
  if (s.character.gold < HIRE_GOLD) {
    speak(`Нанять руки — ${goldTxt(HIRE_GOLD)}.`, s.character.x, s.character.y, "мало золота", "bad");
    return;
  }
  useGame.setState({
    character: {
      ...s.character,
      gold: s.character.gold - HIRE_GOLD,
      busy: { ...s.character.busy, hired: true },
    },
    log: pushLog(s.log, `Нанял руки −${goldTxt(HIRE_GOLD)}. Можно отойти — доделают.`),
    hint: { text: `Нанял руки −${goldTxt(HIRE_GOLD)}. Можно отойти.`, tone: "gold" },
  });
}

function burnHere() {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (busyBlock()) return;
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile) return;
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Огонь — рядом.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  if (s.character.energy < 2) {
    speak("Нет сил на огонь.", tile.x, tile.y, "нет сил", "bad");
    return;
  }
  const foreign = !!(tile.owner && tile.owner !== "you");
  const energy = Math.max(0, s.character.energy - 2);

  if (tile.building !== "none" && !tile.burned) {
    const matter = tile.matter || defaultMatter(tile.building);
    if (!canBurnMatter(matter)) {
      speak("Камень не берёт огонь.", tile.x, tile.y, "камень", "bad");
      return;
    }
    tile.burned = true;
    tile.hp = 0;
    const chest = chestOf(tile);
    const dropN = Math.ceil((chest.wood + chest.food) * 0.4);
    if (dropN > 0) {
      const item = chest.wood >= chest.food ? "wood" : "food";
      const n = Math.min(dropN, chest[item]);
      chest[item] -= n;
      tile.chest = chest;
      pileAdd(tile, item, n);
    }
    let c: Character = { ...s.character, energy };
    const law = hasLaw(s.world, tile);
    if (foreign) {
      const who = hamletTitle(tile.owner);
      c = applyCatch(c, law, `поджог у ${who}`);
      if (isJailed(c)) {
        cancelNotice("walk");
        const spot = jailSpot(s.world, tile.x, tile.y);
        c = { ...c, x: spot.x, y: spot.y, px: spot.x, py: spot.y, busy: null };
        viewPos.x = spot.x;
        viewPos.y = spot.y;
      }
    }
    const jailedNow = isJailed(c);
    useGame.setState({
      character: c,
      inspect: null,
      travel: jailedNow ? null : s.travel,
      preview: jailedNow ? null : s.preview,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(
        s.log,
        foreign
          ? `Поджег ${BUILDING_LABEL[tile.building]} (${MATTER_LABEL[matter]}). Крыши нет. ${jailedNow ? `Яма двора ${hamletTitle(tile.owner)}. Залог ${goldTxt(BAIL_GOLD)}.` : "Закона нет — ямы нет, розыск."}`
          : `Поджег свой ${BUILDING_LABEL[tile.building]}. Крыши нет.`,
      ),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "огонь", tone: "bad" as const }].slice(-10),
    });
    return;
  }

  const edge = burnableFence(tile, s.world);
  if (edge) {
    applyFenceBurn(tile, s.world, edge.side);
    let c: Character = { ...s.character, energy };
    const law = hasLaw(s.world, tile);
    if (foreign) {
      c = applyCatch(c, law, `поджог тына у ${hamletTitle(tile.owner)}`);
      if (isJailed(c)) {
        cancelNotice("walk");
        const spot = jailSpot(s.world, tile.x, tile.y);
        c = { ...c, x: spot.x, y: spot.y, px: spot.x, py: spot.y, busy: null };
        viewPos.x = spot.x;
        viewPos.y = spot.y;
      }
    }
    useGame.setState({
      character: c,
      inspect: null,
      travel: isJailed(c) ? null : s.travel,
      preview: isJailed(c) ? null : s.preview,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, "Тын горит. Дыра в заборе."),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "тын горит", tone: "bad" as const }].slice(-10),
    });
    return;
  }
  if (stoneFence(tile, s.world) || (tile.building !== "none" && (tile.matter || defaultMatter(tile.building)) === "stone")) {
    speak("Камень не берёт огонь.", tile.x, tile.y, "камень", "bad");
    return;
  }
  speak("Нечему гореть. Хворост и дерево — да. Камень — нет.", tile.x, tile.y, "нечему", "bad");
}

function cladStone() {
  const s = useGame.getState();
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile || tile.building !== "house") {
    speak("Камнем обкладывают дом.", s.character.x, s.character.y, "не дом", "bad");
    return;
  }
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Подойди к дому.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  if (tile.burned) {
    speak("Сначала разбери уголь.", tile.x, tile.y, "уголь", "bad");
    return;
  }
  if ((tile.matter || "wood") === "stone") {
    speak("Уже камень.", tile.x, tile.y, "камень", "ok");
    return;
  }
  if (s.character.inventory.stone < CLAD_STONE) {
    speak(`Нужно ${CLAD_STONE} камня.`, tile.x, tile.y, "мало камня", "bad");
    return;
  }
  tile.matter = "stone";
  tile.hp = MATTER_HP.stone;
  const inv = { ...s.character.inventory, stone: s.character.inventory.stone - CLAD_STONE };
  const c = bumpSkill({ ...s.character, inventory: inv }, "build", 0.2);
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, "Дом в камне. Огонь его почти не берёт."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "камень", tone: "ok" as const }].slice(-10),
  });
}

function scrapBurned() {
  const s = useGame.getState();
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile?.burned || tile.building === "none") {
    speak("Угля нет.", s.character.x, s.character.y, "нет угля", "bad");
    return;
  }
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Подойди.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  const wood = tile.matter === "stone" ? 0 : 2;
  tile.building = "none";
  tile.burned = false;
  tile.hp = 0;
  const inv = { ...s.character.inventory, wood: s.character.inventory.wood + wood };
  useGame.setState({
    character: { ...s.character, inventory: inv },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, wood ? "Разобрал уголь. +2 дерева." : "Разобрал камень."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "разобрал", tone: "ok" as const }].slice(-10),
  });
}

function offerFriend() {
  const s = useGame.getState();
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile?.owner || tile.owner === "you") {
    speak("Дружат с чужим двором. Сосед — к юго-западу.", s.character.x, s.character.y, "не с кем", "bad");
    return;
  }
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Договор у калитки.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  if (s.character.pacts[tile.owner] === "friend") {
    speak("Уже друзья.", tile.x, tile.y, "друзья", "ok");
    return;
  }
  useGame.setState({
    character: { ...s.character, pacts: { ...s.character.pacts, [tile.owner]: "friend" } },
    inspect: null,
    log: pushLog(s.log, `${tile.owner} кивнул. Вы друзья. Воровать у друга — предательство.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "друг", tone: "ok" as const }].slice(-10),
  });
}

function formVillage(name?: string) {
  const s = useGame.getState();
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile) return;
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Сход — у калитки.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  if (!hasOwnYard(s.world)) {
    speak("Сначала свой двор — два угла в режиме Двор.", s.character.x, s.character.y, "нет двора", "bad");
    return;
  }
  const friends = friendNames(s.character.pacts);
  if (!canFoundVillage(s.world, s.character.pacts)) {
    speak(
      friends.length < 4
        ? `Нужны 4 друга-двора в кусте. Сейчас ${friends.length}.`
        : "Сход только если дворы вплотную (Чебышёв ≤2). Свой двор ставь к кусту хуторов.",
      tile.x,
      tile.y,
      "не куст",
      "bad",
    );
    return;
  }
  const nm = (name || s.character.village || "Выселки").trim() || "Выселки";
  stampVillage(s.world, ["you", ...friends], nm);
  useGame.setState({
    character: { ...s.character, village: nm },
    inspect: null,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Сход. Деревня «${nm}». Ты староста — повинность, не корона.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: nm, tone: "ok" as const }].slice(-10),
  });
}

function dissolveVillage() {
  const s = useGame.getState();
  const name = s.character.village;
  if (!name) {
    speak("Деревни нет.", s.character.x, s.character.y, "нет", "bad");
    return;
  }
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile?.plot || (tile.owner && tile.owner !== "you" && tile.village !== name)) {
    speak("Распускают у своей калитки.", s.character.x, s.character.y, "не здесь", "bad");
    return;
  }
  clearVillage(s.world, name);
  useGame.setState({
    character: { ...s.character, village: "" },
    inspect: null,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Деревня «${name}» распущена.`),
  });
}

function fillBucket() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile) return;
  if ((s.character.inventory.bucket ?? 0) <= 0) {
    speak("Нужно ведро в ноше.", tile.x, tile.y, "нет ведра", "bad", { theme: "bucket" });
    return;
  }
  if (tile.biome !== "river" && tile.biome !== "ford" && tile.building !== "well") {
    speak("Воду берут из реки, брода или колодца.", tile.x, tile.y, "нет воды", "bad");
    return;
  }
  useGame.setState({
    character: { ...s.character, pail: 3, hand: s.character.hand === "bucket" ? "bucket" : s.character.hand },
    hint: null,
    log: pushLog(s.log, "Ведро полное · 3 глотка в путь. Это не питьё тела."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "ведро", tone: "ok" as const }].slice(-10),
  });
}

function drinkWater() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile) return;
  if (tile.biome !== "river" && tile.biome !== "ford" && tile.building !== "well") {
    speak("Напиться — у реки, брода или колодца.", tile.x, tile.y, "нет воды", "bad");
    return;
  }
  if (s.character.water >= 100) {
    speak("Уже полный.", tile.x, tile.y, "полный", "ok");
    return;
  }
  useGame.setState({
    character: { ...s.character, water: 100 },
    hint: null,
    log: pushLog(s.log, "Напился досыта. Вода тела 100."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "вода 100", tone: "ok" as const }].slice(-10),
  });
}

function sipPail() {
  const s = useGame.getState();
  if ((s.character.pail ?? 0) <= 0) {
    speak("Ведро пустое. Набери у реки.", s.character.x, s.character.y, "пусто", "bad");
    return;
  }
  if (s.character.water >= 100) {
    speak("Уже полный.", s.character.x, s.character.y, "полный", "ok");
    return;
  }
  const water = Math.min(100, s.character.water + 25);
  useGame.setState({
    character: { ...s.character, pail: s.character.pail - 1, water },
    hint: null,
    log: pushLog(s.log, `Глоток из ведра. Вода тела ${Math.round(water)}. Глотков ${s.character.pail - 1}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: s.character.x, y: s.character.y, text: "+25 вода", tone: "ok" as const }].slice(-10),
  });
}

function pourWater() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile) return;
  if ((s.character.pail ?? 0) <= 0) {
    speak("Ведро пустое. Набери у реки.", tile.x, tile.y, "пусто", "bad");
    return;
  }
  tile.cistern = Math.min(12, (tile.cistern ?? 0) + 5);
  useGame.setState({
    character: { ...s.character, pail: s.character.pail - 1 },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Вылил воду. Запас клетки ${tile.cistern}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "полил", tone: "ok" as const }].slice(-10),
  });
}

function buyCart() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile?.caravan) {
    speak("Тачку продаёт лавка на тракте.", s.character.x, s.character.y, "нет лавки", "bad");
    return;
  }
  if ((s.character.carts ?? 0) > 0) {
    speak("Тачка уже есть.", tile.x, tile.y, "есть", "ok");
    return;
  }
  if (s.character.gold < CART_GOLD) {
    speak(`Тачка ${goldTxt(CART_GOLD)}. Сдай дерево в лавку или сколоти дома.`, tile.x, tile.y, "мало золота", "bad");
    return;
  }
  useGame.setState({
    character: {
      ...s.character,
      gold: s.character.gold - CART_GOLD,
      carts: 1,
      transport: "cart",
    },
    log: pushLog(
      s.log,
      `Купил тачку за ${goldTxt(CART_GOLD)}. Ноша ${CAPACITY.cart} кг, шаг как пешком.`,
    ),
    hint: { text: `Тачка. Ноша ${CAPACITY.cart} кг, шаг как пешком.`, tone: "gold" },
    floaters: [
      ...s.floaters,
      { id: ++floaterSeq, x: tile.x, y: tile.y, text: `−${goldTxt(CART_GOLD)}`, tone: "gold" as const },
    ].slice(-10),
  });
}

function sellCart() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile?.caravan) {
    speak("Продают в лавке на тракте.", s.character.x, s.character.y, "нет лавки", "bad");
    return;
  }
  if ((s.character.carts ?? 0) < 1) {
    speak("Нет тачки.", tile.x, tile.y, "нет", "bad");
    return;
  }
  const pay = Math.floor(CART_GOLD / 2);
  const transport = s.character.transport === "cart" ? "walk" : s.character.transport;
  useGame.setState({
    character: { ...s.character, carts: 0, gold: s.character.gold + pay, transport },
    log: pushLog(s.log, `Продал тачку. +${goldTxt(pay)}.`),
    hint: { text: `Продал тачку. +${goldTxt(pay)}.`, tone: "gold" },
    floaters: [
      ...s.floaters,
      { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${goldTxt(pay)}`, tone: "gold" as const },
    ].slice(-10),
  });
}

function craftCart() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || (tile.building !== "shack" && tile.building !== "house" && tile.building !== "bench")) {
    speak("Тачку сколачивают в шалаше, доме или на верстаке.", s.character.x, s.character.y, "не здесь", "bad");
    return;
  }
  if ((s.character.carts ?? 0) > 0) {
    speak("Тачка уже есть.", tile.x, tile.y, "есть", "ok");
    return;
  }
  if (s.character.inventory.wood < CART_WOOD) {
    speak(`Нужно ${CART_WOOD} ${ITEM_LABEL.wood}.`, tile.x, tile.y, "мало дерева", "bad");
    return;
  }
  const inv = { ...s.character.inventory, wood: s.character.inventory.wood - CART_WOOD };
  let c = bumpSkill({ ...s.character, inventory: inv, carts: 1, transport: "cart" }, "craft", 0.1);
  useGame.setState({
    character: c,
    log: pushLog(s.log, `Сколотил тачку. Ноша ${CAPACITY.cart} кг, шаг как пешком.`),
    hint: { text: `Тачка. Ноша ${CAPACITY.cart} кг, шаг как пешком.`, tone: "ok" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "тачка", tone: "ok" as const }].slice(-10),
  });
}

function parkWagonNear(world: GameState["world"], x: number, y: number, owner: string) {
  const tryTile = (tx: number, ty: number) => {
    const t = tileAt(world, tx, ty);
    if (!t) return false;
    if (t.biome === "river" || t.building === "moat") return false;
    if (t.wagon) return false;
    t.wagon = owner || "you";
    return true;
  };
  if (tryTile(x, y)) return true;
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (tryTile(x + dx, y + dy)) return true;
      }
    }
  }
  return false;
}

function wagonTileOf(s: GameState) {
  if (s.inspect) {
    const t = tileAt(s.world, s.inspect.x, s.inspect.y);
    if (t?.wagon) return t;
  }
  return hereTile();
}

function playerHasWagon(s: GameState) {
  if (s.character.wagon || s.character.transport === "wagon") return true;
  for (const t of s.world.tiles) {
    if (t.wagon === "you") return true;
  }
  return false;
}

function hitchWagon() {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (s.travel) {
    speak("Сначала дойди.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  if (s.character.wagon || s.character.transport === "wagon") {
    speak("Телега уже за тобой.", s.character.x, s.character.y, "уже", "ok");
    return;
  }
  if (s.character.horses < 1) {
    speak("Телегу ведёт лошадь. Купи или поймай — пешком не утащишь, в карман не спрячешь.", s.character.x, s.character.y, "нет лошади", "bad");
    return;
  }
  const tile = wagonTileOf(s);
  if (!tile?.wagon) {
    speak("Телеги здесь нет. Купи в лавке или сколоти на верстаке — плотник, два колеса и слиток.", s.character.x, s.character.y, "нет телеги", "bad");
    return;
  }
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Подойди к телеге.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  if (tile.wagon !== "you") {
    stealWagon();
    return;
  }
  tile.wagon = "";
  useGame.setState({
    character: { ...s.character, wagon: true, transport: "wagon", resting: false },
    world: { ...s.world, tiles: s.world.tiles },
    travel: null,
    preview: null,
    log: pushLog(s.log, `Зацепил телегу. Ноша ${CAPACITY.wagon} кг. Медленнее пустой лошади, быстрее тачки.`),
    hint: { text: `Телега. ${CAPACITY.wagon} кг. Не в сумке — отцепишь, останется на клетке.`, tone: "ok" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "зацепил", tone: "ok" as const }].slice(-10),
  });
}

function unhitchWagon() {
  const s = useGame.getState();
  if (!s.character.wagon && s.character.transport !== "wagon") {
    speak("Телега не зацеплена.", s.character.x, s.character.y, "нет", "bad");
    return;
  }
  if (s.travel) {
    speak("Сначала стой.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  const tile = hereTile();
  if (!tile || tile.biome === "river" || tile.building === "moat") {
    speak("В реку телегу не бросают.", s.character.x, s.character.y, "река", "bad");
    return;
  }
  const ok = parkWagonNear(s.world, tile.x, tile.y, "you");
  if (!ok) {
    speak("Здесь некуда ставить.", tile.x, tile.y, "нет места", "bad");
    return;
  }
  const yard = !!(tile.plot && (tile.owner === "you" || tile.owned));
  useGame.setState({
    character: { ...s.character, wagon: false, transport: s.character.horses > 0 ? "horse" : "walk" },
    world: { ...s.world, tiles: s.world.tiles },
    travel: null,
    preview: null,
    log: pushLog(
      s.log,
      yard
        ? "Отцепил у двора. Своя — пока не уведут."
        : "Бросил телегу на клетке. В карман не кладётся. Кто найдёт — может увести.",
    ),
    hint: {
      text: yard ? "Телега у двора." : "Телега на клетке. Её можно украсть.",
      tone: "ok",
    },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "отцепил", tone: "ok" as const }].slice(-10),
  });
}

function stealWagon() {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (s.travel) {
    speak("В пути не крадут.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  if (s.character.wagon || s.character.transport === "wagon") {
    speak("Своя телега уже за тобой.", s.character.x, s.character.y, "уже", "ok");
    return;
  }
  if (s.character.horses < 1) {
    speak("Увести телегу — только на лошади.", s.character.x, s.character.y, "нет лошади", "bad");
    return;
  }
  const tile = wagonTileOf(s);
  if (!tile?.wagon) {
    speak("Телеги нет.", s.character.x, s.character.y, "нет", "bad");
    return;
  }
  if (tile.wagon === "you") {
    hitchWagon();
    return;
  }
  const near = Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) <= 1;
  if (!near) {
    speak("Подойди к телеге.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  if (s.character.energy < 2) {
    speak("Нет сил уводить телегу.", tile.x, tile.y, "нет силы", "bad");
    return;
  }
  const who = tile.wagon;
  const p = stealChance(s.world, tile, s.character, s.phase === "night");
  const caught = Math.random() < Math.min(0.85, p + 0.12);
  tile.mark = { who: s.character.name, at: Date.now() };
  let c = {
    ...s.character,
    energy: Math.max(0, s.character.energy - 2),
  };
  c = bumpSkill(c, "stealth", caught ? 0.05 : 0.2);
  const betrayal = s.character.pacts[who] === "friend" || (!!s.character.village && tile.village === s.character.village);
  if (betrayal) c = { ...c, pacts: { ...c.pacts, [who]: "feud" }, wanted: (c.wanted ?? 0) + 2 };
  if (caught) {
    const law = hasLaw(s.world, tile);
    c = applyCatch(c, law, `телега ${who}`);
    if (isJailed(c)) {
      cancelNotice("walk");
      const spot = jailSpot(s.world, tile.x, tile.y);
      c = { ...c, x: spot.x, y: spot.y, px: spot.x, py: spot.y, busy: null, wagon: false, transport: c.horses > 0 ? "horse" : "walk" };
      viewPos.x = spot.x;
      viewPos.y = spot.y;
    }
    useGame.setState({
      character: c,
      inspect: null,
      travel: null,
      preview: null,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(
        s.log,
        law
          ? `Поймали за телегу. Закон — яма. Телега осталась.`
          : `Видели: уводил телегу. Ямы нет, розыск. Телега на месте.`,
      ),
      hint: { text: "Поймали. Телега осталась.", tone: "bad" },
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: law ? "яма" : "видели", tone: "bad" as const }].slice(-10),
    });
    return;
  }
  tile.wagon = "";
  c = { ...c, wagon: true, transport: "wagon" };
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Увёл телегу у ${who}. Тихо. В карман не спрячешь — бросишь, снова украдут.`),
    hint: { text: "Увёл телегу. За лошадью.", tone: "ok" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "увёл", tone: "ok" as const }].slice(-10),
  });
}

function buyWagon() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile?.caravan) {
    speak("Телегу продаёт лавка на тракте.", s.character.x, s.character.y, "нет лавки", "bad");
    return;
  }
  if (playerHasWagon(s) || tile.wagon) {
    speak("Телега уже есть — своя или стоит здесь.", tile.x, tile.y, "есть", "ok");
    return;
  }
  if (s.character.gold < WAGON_GOLD) {
    speak(`Телега ${goldTxt(WAGON_GOLD)}. Или плотник: два колеса, 4 дерева, слиток.`, tile.x, tile.y, "мало золота", "bad");
    return;
  }
  const hitch = s.character.horses > 0;
  if (!hitch) {
    const parked = parkWagonNear(s.world, tile.x, tile.y, "you");
    if (!parked) {
      speak("Некуда ставить телегу.", tile.x, tile.y, "нет места", "bad");
      return;
    }
  }
  useGame.setState({
    character: {
      ...s.character,
      gold: s.character.gold - WAGON_GOLD,
      wagon: hitch,
      transport: hitch ? "wagon" : s.character.transport,
    },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(
      s.log,
      hitch
        ? `Купил телегу за ${goldTxt(WAGON_GOLD)}. Зацепил к лошади. ${CAPACITY.wagon} кг.`
        : `Купил телегу за ${goldTxt(WAGON_GOLD)}. Стоит на клетке — в сумку не кладётся. Приведи лошадь.`,
    ),
    hint: {
      text: hitch ? `Телега. ${CAPACITY.wagon} кг.` : "Телега на клетке. Нужна лошадь.",
      tone: "gold",
    },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `−${goldTxt(WAGON_GOLD)}`, tone: "gold" as const }].slice(-10),
  });
}

function sellWagon() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile?.caravan) {
    speak("Продают в лавке на тракте.", s.character.x, s.character.y, "нет лавки", "bad");
    return;
  }
  const hereWagon = tile.wagon === "you";
  const hitched = s.character.wagon || s.character.transport === "wagon";
  if (!hereWagon && !hitched) {
    speak("Нет телеги. Привези — отцепи у лавки или стой зацепленным.", tile.x, tile.y, "нет", "bad");
    return;
  }
  const pay = Math.floor(WAGON_GOLD / 2);
  if (hereWagon) tile.wagon = "";
  useGame.setState({
    character: {
      ...s.character,
      wagon: false,
      transport: hitched ? (s.character.horses > 0 ? "horse" : "walk") : s.character.transport,
      gold: s.character.gold + pay,
    },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Продал телегу. +${goldTxt(pay)}.`),
    hint: { text: `Продал телегу. +${goldTxt(pay)}.`, tone: "gold" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${goldTxt(pay)}`, tone: "gold" as const }].slice(-10),
  });
}

function craftWagon() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || (tile.building !== "bench" && tile.building !== "workshop")) {
    speak("Телегу собирают на верстаке. Колёса — дело плотника.", s.character.x, s.character.y, "не верстак", "bad");
    return;
  }
  if (s.character.profession !== "carpenter") {
    speak("Телегу сколачивает плотник. Смени профессию или купи в лавке за 24 золота.", tile.x, tile.y, "не плотник", "bad");
    return;
  }
  if (playerHasWagon(s)) {
    speak("Телега уже есть.", tile.x, tile.y, "есть", "ok");
    return;
  }
  const inv = { ...s.character.inventory };
  if ((inv.wheel ?? 0) < 2 || inv.wood < 4 || inv.bar < 1) {
    speak("Нужно 2 колеса, 4 дерева и слиток на ось. Колесо — 2 доски, плотник.", tile.x, tile.y, "мало", "bad");
    return;
  }
  if (s.character.energy < 3) {
    speak("Нет сил собирать телегу.", tile.x, tile.y, "нет сил", "bad");
    return;
  }
  inv.wheel -= 2;
  inv.wood -= 4;
  inv.bar -= 1;
  const hitch = s.character.horses > 0;
  if (!hitch && !parkWagonNear(s.world, tile.x, tile.y, "you")) {
    speak("Некуда ставить телегу.", tile.x, tile.y, "нет места", "bad");
    return;
  }
  let c = bumpSkill(
    {
      ...s.character,
      inventory: inv,
      energy: Math.max(0, s.character.energy - 3),
      wagon: hitch,
      transport: hitch ? "wagon" : s.character.transport,
    },
    "build",
    0.3,
  );
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(
      s.log,
      hitch
        ? `Сколотил телегу и зацепил. ${CAPACITY.wagon} кг. В сумку не кладётся.`
        : `Сколотил телегу. Стоит на клетке. Приведи лошадь — зацепишь.`,
    ),
    hint: { text: hitch ? `Телега. ${CAPACITY.wagon} кг.` : "Телега на клетке.", tone: "ok" },
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "телега", tone: "ok" as const }].slice(-10),
  });
}

function buyLivestock(kind: "cow" | "horse") {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile?.caravan) {
    speak("Живость продаёт лавка на тракте.", s.character.x, s.character.y, "нет лавки", "bad");
    return;
  }
  const price = kind === "cow" ? COW_PRICE : HORSE_PRICE;
  if (s.character.gold < price) {
    speak(`Нужно ${goldTxt(price)}.`, tile.x, tile.y, "мало золота", "bad");
    return;
  }
  if (kind === "horse") {
    const c = { ...s.character, gold: s.character.gold - price, horses: s.character.horses + 1 };
    useGame.setState({
      character: c,
      log: pushLog(s.log, `Купил лошадь за ${goldTxt(price)}. Седлай в сумке.`),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `−${goldTxt(price)}`, tone: "gold" as const }].slice(-10),
    });
    return;
  }
  const pen = s.world.tiles.find((t) => t.building === "pen" && (t.owned || !t.commons));
  const dest = tileAt(s.world, s.character.x, s.character.y);
  const home = dest && dest.building === "pen" ? dest : pen;
  if (!home) {
    speak("Сначала загон на равнине. Потом тёлку ведут туда.", tile.x, tile.y, "нет загона", "bad");
    return;
  }
  const n = (home.herd && home.herd.kind === "cow" ? home.herd.count : 0) + 1;
  home.herd = makeHerd("cow", n, false);
  useGame.setState({
    character: { ...s.character, gold: s.character.gold - price },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Купил корову за ${goldTxt(price)}. Живёт в загоне. Корми и держи у воды.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `−${goldTxt(price)}`, tone: "gold" as const }].slice(-10),
  });
}

function sellLivestock(kind: "cow" | "horse") {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile?.caravan) {
    speak("Продают в лавке на тракте.", s.character.x, s.character.y, "нет лавки", "bad");
    return;
  }
  if (kind === "horse") {
    if (s.character.horses < 1) {
      speak("Нет лошади.", tile.x, tile.y, "нет", "bad");
      return;
    }
    const pay = Math.floor(HORSE_PRICE / 2);
    const horses = s.character.horses - 1;
    let transport = s.character.transport;
    let wagon = s.character.wagon;
    if (horses < 1) {
      if (wagon || transport === "wagon") parkWagonNear(s.world, s.character.x, s.character.y, "you");
      wagon = false;
      transport = "walk";
    }
    useGame.setState({
      character: { ...s.character, horses, gold: s.character.gold + pay, transport, wagon },
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, `Продал лошадь. +${goldTxt(pay)}.`),
      floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${goldTxt(pay)}`, tone: "gold" as const }].slice(-10),
    });
    return;
  }
  const pen = s.world.tiles.find((t) => t.building === "pen" && t.herd?.kind === "cow" && (t.herd.count ?? 0) > 0);
  if (!pen?.herd) {
    speak("Нет коровы в загоне.", tile.x, tile.y, "нет", "bad");
    return;
  }
  pen.herd.count -= 1;
  if (pen.herd.count <= 0) pen.herd = null;
  const pay = Math.floor(COW_PRICE / 2);
  useGame.setState({
    character: { ...s.character, gold: s.character.gold + pay },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Продал корову. +${goldTxt(pay)}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${goldTxt(pay)}`, tone: "gold" as const }].slice(-10),
  });
}

function craftGear(item: "rope" | "bucket" | "spear" | "rod") {
  doCraft(item);
}

function doCraft(kind: CraftKind) {
  const s = useGame.getState();
  if (meetBlock()) return;
  if (busyBlock()) return;
  if (s.travel) {
    speak("Сначала дойди.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  const def = CRAFTS.find((c) => c.id === kind);
  if (!def) return;
  const tile = hereTile();
  if (tile && isForeignYard(tile)) {
    speak("чужой двор", tile.x, tile.y, "чужой двор", "bad");
    return;
  }
  if (!atBench(tile, def.bench)) {
    const where =
      def.bench === "home"
        ? "Сколотить — стой в шалаше или доме."
        : def.bench === "bench" || def.bench === "workshop"
          ? "Этот рецепт — у верстака."
          : def.bench === "forge"
            ? "Этот рецепт — у горна."
            : def.bench === "oven"
              ? "Этот рецепт — у печи."
              : def.bench === "smoke"
                ? "Этот рецепт — у коптильни."
                : def.bench === "herbs"
                  ? "Этот рецепт — у стола трав."
                  : def.bench === "coalpit"
                    ? "Этот рецепт — у дровницы."
                    : "Не здесь.";
    speak(where, s.character.x, s.character.y, "не здесь", "bad");
    return;
  }
  if (def.who !== "any" && s.character.profession !== def.who) {
    speak(`Это дело ${PROFESSION_LABEL[def.who]}. Смени профессию в книге → Кем быть, или купи у того, кто умеет.`, tile!.x, tile!.y, "не твоё", "bad");
    return;
  }
  const wet = tile ? isWatered(s.world, tile) : false;
  const slow = (def.bench === "forge" || def.bench === "oven") && !wet;
  const needE = def.energy + (slow ? 1 : 0);
  if (s.character.energy < needE) {
    speak(NO_STRENGTH, tile!.x, tile!.y, "нет сил", "bad");
    return;
  }
  const inv = { ...s.character.inventory };
  for (const [k, n] of Object.entries(def.need) as [ItemId, number][]) {
    if ((inv[k] ?? 0) < n) {
      speak(`Мало: ${def.hint}.`, tile!.x, tile!.y, "мало", "bad");
      return;
    }
  }
  const next = { ...s.character, energy: Math.max(0, s.character.energy - needE) };
  const ms = craftMs(needE, slow, next);
  startBusy(
    next,
    makeBusy("craft", tile!.x, tile!.y, Date.now() + ms, { craft: def.id, item: def.out }),
    `Делаю: ${def.label} · ${Math.ceil(ms / 1000)} с.`,
    tile!.x,
    tile!.y,
    "делаю",
  );
}

function prospectHere() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || (tile.biome !== "ore" && tile.biome !== "mountain")) {
    speak("Ищут в жиле или в горах.", s.character.x, s.character.y, "не здесь", "bad");
    return;
  }
  if (s.character.profession !== "miner") {
    speak("Кристалл ищет рудокоп. Другие тут только камень и руду.", tile.x, tile.y, "не рудокоп", "bad");
    return;
  }
  if (s.character.energy < 2) {
    speak("Нет сил искать.", tile.x, tile.y, "нет сил", "bad");
    return;
  }
  const hit = Math.random() < 0.28;
  let inv = { ...s.character.inventory };
  let piled = 0;
  if (hit) {
    const given = giveOrPile(inv, s.character.transport, tile, "crystal", 1);
    inv = given.inv;
    piled = given.piled;
  }
  let c = bumpSkill(
    { ...s.character, inventory: inv, energy: s.character.energy - 2 },
    "mine",
    0.12,
  );
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, hit ? (piled ? "Нашёл кристалл. На клетке — ноша не взяла." : "Нашёл кристалл.") : "Пусто. Жила молчит."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: hit ? "+кристалл" : "пусто", tone: hit ? ("ok" as const) : ("bad" as const) }].slice(-10),
  });
}

function sowField() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || tile.building !== "field") {
    speak("Сеют на своём поле.", s.character.x, s.character.y, "не поле", "bad");
    return;
  }
  if (isForeignYard(tile) || !isYours(tile)) {
    speak("чужой двор", tile.x, tile.y, "чужой двор", "bad");
    return;
  }
  if (s.character.profession !== "farmer") {
    speak("Засев — дело крестьянина. Другие ждут всходы неделями.", tile.x, tile.y, "не крестьянин", "bad");
    return;
  }
  if (tile.amount > 0) {
    speak("Уже всходит.", tile.x, tile.y, "всходит", "ok");
    return;
  }
  if (s.character.inventory.food < 1) {
    speak("Нужно зерно — 1 еда.", tile.x, tile.y, "нет зерна", "bad");
    return;
  }
  const inv = { ...s.character.inventory, food: s.character.inventory.food - 1 };
  tile.resource = "food";
  tile.amount = isWatered(s.world, tile) ? 4 : 2;
  tile.scarred = false;
  tile.regen = 0;
  let c = bumpSkill({ ...s.character, inventory: inv }, "agro", 0.12);
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, "Засеял поле. Всходы сразу."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "посев", tone: "ok" as const }].slice(-10),
  });
}

function drinkTonic() {
  const s = useGame.getState();
  if ((s.character.inventory.tonic ?? 0) <= 0) {
    speak("Настоя нет. Варит целитель.", s.character.x, s.character.y, "нет настоя", "bad");
    return;
  }
  if (s.character.hp >= 100) {
    speak("Цел. Настой береги.", s.character.x, s.character.y, "цел", "ok");
    return;
  }
  const inv = { ...s.character.inventory, tonic: s.character.inventory.tonic - 1 };
  const hp = Math.min(100, s.character.hp + 28);
  useGame.setState({
    character: { ...s.character, inventory: inv, hp },
    log: pushLog(s.log, `Настой. Раны ${Math.round(hp)}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: s.character.x, y: s.character.y, text: "+раны", tone: "ok" as const }].slice(-10),
  });
}

function buyFromShop(item: ItemId, qty: number) {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || tile.building !== "shop") {
    speak("Это не лавка. Трактовая — на дороге, чужая — во дворе соседа.", s.character.x, s.character.y, "не лавка", "bad");
    return;
  }
  const n = Math.min(qty, tile.chest[item] ?? 0);
  if (n <= 0) {
    speak("Этого нет на витрине.", tile.x, tile.y, "нет", "bad");
    return;
  }
  const unit = caravanSell(item, s.season);
  const cost = unit * n;
  if (s.character.gold < cost) {
    speak(`Нужно ${goldTxt(cost)}.`, tile.x, tile.y, "мало золота", "bad");
    return;
  }
  tile.chest = { ...tile.chest, [item]: tile.chest[item] - n };
  if (tile.owner && tile.owner !== "you") tile.takings += cost;
  const inv = { ...s.character.inventory, [item]: s.character.inventory[item] + n };
  let c = bumpSkill({ ...s.character, inventory: inv, gold: s.character.gold - cost }, "trade", 0.1);
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Купил в лавке ${n} ${ITEM_LABEL[item]} за ${goldTxt(cost)}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `−${goldTxt(cost)}`, tone: "gold" as const }].slice(-10),
  });
}

function sellToShop(item: ItemId, qty: number) {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || tile.building !== "shop") {
    speak("Сдают в лавке. Свою — клади в тайник. Чужую — если берут.", s.character.x, s.character.y, "не лавка", "bad");
    return;
  }
  if (tile.owner === "you" || (tile.owned && !tile.owner)) {
    storeItem(item, qty);
    return;
  }
  const have = s.character.inventory[item] ?? 0;
  const n = Math.min(qty, have);
  if (n <= 0) {
    speak("Нечего сдавать.", tile.x, tile.y, "пусто", "bad");
    return;
  }
  const quote = sellQuote(item, n, s.season, s.character.profession === "trader");
  if (quote.take <= 0 || quote.gold <= 0) {
    speak("Мало для лавки.", tile.x, tile.y, "мало для лавки", "bad");
    return;
  }
  const inv = { ...s.character.inventory, [item]: have - quote.take };
  tile.chest = { ...tile.chest, [item]: (tile.chest[item] ?? 0) + quote.take };
  let c = bumpSkill({ ...s.character, inventory: inv, gold: s.character.gold + quote.gold }, "trade", 0.12);
  useGame.setState({
    character: c,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `Сдал в лавку ${tile.owner}: ${quote.take} ${ITEM_LABEL[item]} за ${goldTxt(quote.gold)}.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: `+${goldTxt(quote.gold)}`, tone: "gold" as const }].slice(-10),
  });
}

function feedHere() {
  const s = useGame.getState();
  const tile = hereTile();
  if (!tile || (tile.building !== "pen" && tile.building !== "stable") || !tile.herd) {
    speak("Кормят в загоне или конюшне.", s.character.x, s.character.y, "не здесь", "bad");
    return;
  }
  if (isForeignYard(tile) || !isYours(tile)) {
    speak("чужой двор", tile.x, tile.y, "чужой двор", "bad");
    return;
  }
  const inv = { ...s.character.inventory };
  const feed = inv.herb > 0 ? "herb" : inv.food > 0 ? "food" : null;
  if (!feed) {
    speak("Нужна трава или еда.", tile.x, tile.y, "нет корма", "bad");
    return;
  }
  inv[feed] -= 1;
  const chest = chestOf(tile);
  chest[feed] += 2;
  tile.chest = chest;
  tile.herd.hunger = 0;
  useGame.setState({
    character: { ...s.character, inventory: inv },
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, "Положил корм в ясли. На пару дней."),
    floaters: [...s.floaters, { id: ++floaterSeq, x: tile.x, y: tile.y, text: "корм", tone: "ok" as const }].slice(-10),
  });
}

function excavateHere() {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (s.travel) {
    speak("Сначала дойди.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  if (busyBlock()) return;
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile) return;
  if (s.character.x !== tile.x || s.character.y !== tile.y) {
    speak("Копают стоя на клетке.", tile.x, tile.y, "встань", "bad");
    return;
  }
  const why = canDigReason(s.world, tile, s.character.hand);
  if (why) {
    speak(why === "чужой двор" ? "чужой двор" : why, tile.x, tile.y, why, "bad");
    return;
  }
  if (!needStrength(s.character, 2, tile.x, tile.y)) return;
  let c = { ...s.character, energy: Math.max(0, s.character.energy - 2) };
  const worn = takeWear(c, "shovel");
  c = worn.c;
  const ms = workMs("dig", null, c);
  startBusy(c, makeBusy("dig", tile.x, tile.y, Date.now() + ms), `Копаю · ${Math.ceil(ms / 1000)} с.`, tile.x, tile.y, "копаю");
}

function fillPitHere() {
  const s = useGame.getState();
  const hold = actHeld(s.character);
  if (hold) {
    speak(hold, s.character.x, s.character.y, "нельзя", "bad");
    return;
  }
  if (s.travel) {
    speak("Сначала дойди.", s.character.x, s.character.y, "в пути", "bad");
    return;
  }
  if (busyBlock()) return;
  const tile = s.inspect ? tileAt(s.world, s.inspect.x, s.inspect.y) : hereTile();
  if (!tile || !tile.pit) {
    speak("Здесь нет ямы.", s.character.x, s.character.y, "нет ямы", "bad");
    return;
  }
  if (Math.max(Math.abs(s.character.x - tile.x), Math.abs(s.character.y - tile.y)) > 1) {
    speak("Засыпают рядом.", tile.x, tile.y, "подойди", "bad");
    return;
  }
  if (s.character.hand !== "shovel") {
    speak("нужна лопата", tile.x, tile.y, "нужна лопата", "bad");
    return;
  }
  if (isForeignYard(tile)) {
    speak("чужой двор", tile.x, tile.y, "чужой двор", "bad");
    return;
  }
  const pay = fillPay(s.character.inventory);
  if (!pay) {
    speak(fillNeedLine(s.character.inventory), tile.x, tile.y, "мало глины", "bad");
    return;
  }
  if (s.character.energy < 1) {
    speak("Нет сил засыпать.", tile.x, tile.y, "нет сил", "bad");
    return;
  }
  const inv = takePaid({ ...s.character.inventory }, pay);
  let c = { ...s.character, inventory: inv, energy: Math.max(0, s.character.energy - 1) };
  const worn = takeWear(c, "shovel");
  c = worn.c;
  const ms = workMs("fill", null, c);
  startBusy(c, makeBusy("fill", tile.x, tile.y, Date.now() + ms), `Засыпаю · ${Math.ceil(ms / 1000)} с.`, tile.x, tile.y, "засыпаю");
}

function foeOf(s: GameState) {
  if (!s.meet) return null;
  return foeById(s.dummies ?? [], s.others ?? [], s.meet.foeId);
}

function meetWhy(s: GameState, foe: Dummy): string | null {
  const c = s.character;
  if (s.travel) return "Сначала дойди.";
  const hold = actHeld(c);
  if (hold) return hold;
  if (isBusy(c) && !c.busy?.hired) return `Занят: ${BUSY_LABEL[c.busy!.kind]}.`;
  if (foe.life !== "alive") return "Лежит. Не добивать.";
  if (c.x !== foe.x || c.y !== foe.y) return "Встань на его клетку.";
  const tile = tileAt(s.world, c.x, c.y);
  if (tile && (tile.biome === "river" || tile.building === "moat") && tile.road !== "bridge") return "Река или ров. Нужен мост.";
  return null;
}

function dumpBagKeepHand(c: Character, tile: NonNullable<ReturnType<typeof tileAt>>): Character {
  const drop = { ...c.inventory };
  const hand = c.hand;
  if (hand && (drop[hand] ?? 0) > 0) drop[hand] = Math.max(0, drop[hand] - 1);
  dumpAllOn(tile, drop, 0);
  const keep = emptyTheInv(c.inventory);
  if (hand) keep[hand] = Math.min(1, c.inventory[hand] ?? 0);
  return { ...c, inventory: keep, hand: hand && keep[hand] ? hand : null };
}

function yardFlags(s: GameState, x: number, y: number, who: string) {
  const tile = tileAt(s.world, x, y);
  const owner = tile?.owner || "";
  return {
    ownYard: !!owner && owner === who,
    foreignYard: !!owner && owner !== who,
    atYard: !!tile?.plot,
    tile,
  };
}

function startMeet(foeId: string) {
  const s = useGame.getState();
  const foe = foeById(s.dummies ?? [], s.others ?? [], foeId);
  if (!foe) {
    speak("Никого.", s.character.x, s.character.y, "пусто", "bad");
    return;
  }
  const why = meetWhy(s, foe);
  if (why) {
    speak(why, foe.x, foe.y, "нельзя", "bad");
    return;
  }
  cancelNotice("walk");
  useGame.setState({
    meet: { foeId, turn: "you", steps: 0, spoke: false, firstDone: false, live: !foe.dummy },
    inspect: null,
    travel: null,
    preview: null,
    log: pushLog(s.log, `Встреча с ${foe.name}. Один шаг — один выбор.`),
    hint: { text: `Встреча: ${foe.name}. Удар, отойти, сдаться.`, tone: "ok" },
  });
  useGame.getState().persist();
}

function closeMeet(extra?: Partial<GameState>) {
  noteMeetClosed();
  useGame.setState({ meet: null, ...extra });
  useGame.getState().persist();
}

function noteMeetClosed() {
  const s = useGame.getState();
  if (!s.meet) return;
  const foe = foeById(s.dummies ?? [], s.others ?? [], s.meet.foeId);
  if (foe && foe.x === s.character.x && foe.y === s.character.y) meetIgnore = `${foe.x},${foe.y},${foe.id}`;
}

function applyDummy(dummies: Dummy[], next: Dummy): Dummy[] {
  return dummies.map((d) => (d.id === next.id ? next : d));
}

function meetHit() {
  const s = useGame.getState();
  if (!s.meet || s.meet.turn !== "you") return;
  const foe = foeOf(s);
  if (!foe) {
    closeMeet();
    return;
  }
  const why = meetWhy(s, foe);
  if (why) {
    speak(why, foe.x, foe.y, "нельзя", "bad");
    return;
  }
  let c = { ...s.character, energy: Math.max(0, s.character.energy - 2), resting: false };
  const strikeHand = c.hand;
  if (isWearId(c.hand)) {
    const worn = takeWear(c, c.hand);
    c = worn.c;
  }
  const you = youFighter({ ...c, hand: strikeHand });
  const flags = yardFlags(s, c.x, c.y, "you");
  const first = !s.meet.firstDone;
  const hit = strikeDmg(you, {
    night: s.phase === "night",
    first,
    winter: s.season === "winter",
    roof: isRoof(flags.tile),
    ownYard: flags.ownYard,
    foreignYard: flags.foreignYard,
    atYard: flags.atYard,
    foeStealth: foe.skills.stealth ?? 0,
  }, foe);
  let nextFoe: Dummy = { ...foe, hp: Math.max(0, foe.hp - hit.dmg), energy: Math.max(0, foe.energy) };
  c = bumpSkill(c, "fight", 0.12);
  if (hit.sneak) c = bumpSkill(c, "stealth", 0.08);
  if (c.pacts[foe.id] === "friend") {
    c = { ...c, pacts: { ...c.pacts, [foe.id]: "feud" } };
  }
  const live = !!(s.meet.live || !foe.dummy);
  if (live) {
    useGame.setState({
      character: c,
      meet: { ...s.meet, firstDone: true, steps: s.meet.steps + 1, live: true },
      log: pushLog(s.log, `Ударил ${foe.name}. Ждёт его шага. Можно отойти.`),
      hint: { text: `Удар. ${foe.name} стоит.`, tone: "ok" },
      floaters: [...s.floaters, { id: ++floaterSeq, x: foe.x, y: foe.y, text: "удар", tone: "ok" as const }].slice(-10),
    });
    useGame.getState().persist();
    return;
  }
  const tile = tileAt(s.world, foe.x, foe.y);
  const lawNow = tile ? hasLaw(s.world, tile) && isForeignYard(tile) : false;
  let jailed = false;
  if (lawNow) {
    const p = stealChance(s.world, tile!, c, s.phase === "night");
    if (Math.random() < p) {
      c = applyCatch(c, true, `удар у ${foe.name}`);
      jailed = isJailed(c);
      if (jailed) {
        const spot = jailSpot(s.world, tile!.x, tile!.y);
        c = { ...c, x: spot.x, y: spot.y, px: spot.x, py: spot.y, busy: null };
        viewPos.x = spot.x;
        viewPos.y = spot.y;
        c = bumpSkill(c, "law", 0.08);
      }
    }
  }
  const bits = [`удар ${hit.dmg}`];
  if (hit.sneak) bits.unshift("сбоку");
  if (nextFoe.hp <= 0) {
    nextFoe = { ...nextFoe, hp: 0, life: "down", downAt: Date.now() };
    if (tile) {
      const drop = { ...emptyTheInv(c.inventory), ...nextFoe.inventory };
      dumpAllOn(tile, drop, 0);
      nextFoe = { ...nextFoe, inventory: {} };
    }
    useGame.setState({
      character: c,
      dummies: applyDummy(s.dummies, nextFoe),
      meet: null,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, `${foe.name} упал. Ноша на клетке. Не добивать.`),
      hint: { text: `${foe.name} упал.`, tone: "ok" },
      floaters: [...s.floaters, { id: ++floaterSeq, x: foe.x, y: foe.y, text: bits.join(" · "), tone: "ok" as const }].slice(-10),
    });
    useGame.getState().persist();
    return;
  }
  if (jailed) {
    useGame.setState({
      character: c,
      dummies: applyDummy(s.dummies, nextFoe),
      meet: null,
      travel: null,
      preview: null,
      inspect: null,
      log: pushLog(s.log, `Удар прошёл (${hit.dmg}). Закон двора — яма.`),
      hint: { text: "Поймали после удара. Яма.", tone: "bad", keep: "jail" },
      floaters: [...s.floaters, { id: ++floaterSeq, x: foe.x, y: foe.y, text: bits.join(" · "), tone: "bad" as const }].slice(-10),
    });
    useGame.getState().persist();
    return;
  }
  useGame.setState({
    character: c,
    dummies: applyDummy(s.dummies, nextFoe),
    meet: { ...s.meet, turn: "foe", steps: s.meet.steps + 1, firstDone: true },
    log: pushLog(s.log, `Ударил ${foe.name}: −${hit.dmg} ран. Ждёт ответа.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: foe.x, y: foe.y, text: bits.join(" · "), tone: "ok" as const }].slice(-10),
  });
  useGame.getState().persist();
  window.setTimeout(() => dummyAnswer(), 420);
}

function dummyAnswer() {
  const s = useGame.getState();
  if (!s.meet || s.meet.turn !== "foe") return;
  if (s.meet.live) return;
  const foe = foeOf(s);
  if (!foe || foe.life !== "alive") {
    closeMeet();
    return;
  }
  const c0 = s.character;
  if (chebyshev(c0.x, c0.y, foe.x, foe.y) > 1) {
    closeMeet({ log: pushLog(s.log, "Встреча закрылась.") });
    return;
  }
  const scared = foe.hp < 22 || foe.energy < 2;
  if (scared && Math.random() < 0.55) {
    const tile = tileAt(s.world, foe.x, foe.y);
    if (tile && foe.inventory) dumpAllOn(tile, { ...emptyTheInv(c0.inventory), ...foe.inventory }, 0);
    const home = dummyHome(s.world, foe.id);
    const nextFoe: Dummy = {
      ...foe,
      inventory: {},
      energy: Math.max(0, foe.energy - 1),
      x: home?.x ?? foe.x,
      y: home?.y ?? foe.y,
    };
    useGame.setState({
      dummies: applyDummy(s.dummies, nextFoe),
      meet: null,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, `${foe.name} отступил. Ноша на клетке.`),
      hint: { text: `${foe.name} отступил.`, tone: "ok" },
    });
    useGame.getState().persist();
    return;
  }
  const flags = yardFlags(s, foe.x, foe.y, foe.id);
  const hit = strikeDmg(foe, {
    night: s.phase === "night",
    first: !s.meet.firstDone,
    winter: s.season === "winter",
    roof: isRoof(flags.tile),
    ownYard: flags.ownYard,
    foreignYard: flags.foreignYard,
    atYard: flags.atYard,
    foeStealth: c0.skills.stealth ?? 0,
  }, youFighter(c0));
  const hp = Math.max(0, c0.hp - hit.dmg);
  let c: Character = { ...c0, hp, energy: Math.max(0, c0.energy) };
  const nextFoe: Dummy = { ...foe, energy: Math.max(0, foe.energy - 2) };
  if (hp <= 0) {
    dumpCargo(s.world, c.x, c.y, c.inventory, 0, [c.body, c.shield, c.helm]);
    c = {
      ...c,
      inventory: emptyTheInv(c.inventory),
      hand: null,
      body: null,
      shield: null,
      helm: null,
      hp: 0,
      life: "down",
      downAt: Date.now(),
      busy: null,
      resting: false,
      wagon: false,
      transport: "walk",
    };
    if (c0.wagon || c0.transport === "wagon") parkWagonNear(s.world, c.x, c.y, "you");
    useGame.setState({
      character: c,
      dummies: applyDummy(s.dummies, nextFoe),
      meet: null,
      travel: null,
      preview: null,
      world: { ...s.world, tiles: s.world.tiles },
      log: pushLog(s.log, `Упал от удара ${foe.name}. Ноша на клетке. Ползи к шалашу.`),
      hint: { text: "Упал. Ползи к шалашу.", tone: "bad", keep: "down" },
      floaters: [...s.floaters, { id: ++floaterSeq, x: c.x, y: c.y, text: `−${hit.dmg}`, tone: "bad" as const }].slice(-10),
    });
    useGame.getState().persist();
    return;
  }
  useGame.setState({
    character: c,
    dummies: applyDummy(s.dummies, nextFoe),
    meet: { ...s.meet, turn: "you", firstDone: true },
    log: pushLog(s.log, `${foe.name} ударил: −${hit.dmg} ран.`),
    floaters: [...s.floaters, { id: ++floaterSeq, x: c.x, y: c.y, text: `−${hit.dmg}`, tone: "bad" as const }].slice(-10),
  });
  useGame.getState().persist();
}

function stepAwayCell(s: GameState, fromX: number, fromY: number, foeX: number, foeY: number) {
  const opts: { x: number; y: number; d: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = fromX + dx;
      const y = fromY + dy;
      const t = tileAt(s.world, x, y);
      if (!t || !isWalkable(t, s.world)) continue;
      if (!canCrossDiag(s.world, fromX, fromY, x, y, "you")) continue;
      const d = chebyshev(x, y, foeX, foeY);
      if (d < chebyshev(fromX, fromY, foeX, foeY)) continue;
      opts.push({ x, y, d });
    }
  }
  opts.sort((a, b) => b.d - a.d);
  return opts[0] ?? null;
}

function meetLeave() {
  const s = useGame.getState();
  if (!s.meet || s.meet.turn !== "you") return;
  const foe = foeOf(s);
  if (!foe) {
    closeMeet();
    return;
  }
  const c0 = { ...s.character, energy: Math.max(0, s.character.energy - 1) };
  const live = !!(s.meet.live || !foe.dummy);
  if (!live && s.phase === "night" && Math.random() > leaveChance(true, c0.skills.stealth ?? 0)) {
    useGame.setState({
      character: c0,
      meet: { ...s.meet, turn: "foe", steps: s.meet.steps + 1, firstDone: true },
      log: pushLog(s.log, "Не оторвался. Ночь держит."),
      hint: { text: "Не оторвался.", tone: "bad" },
    });
    useGame.getState().persist();
    window.setTimeout(() => dummyAnswer(), 420);
    return;
  }
  const step = stepAwayCell(s, c0.x, c0.y, foe.x, foe.y);
  if (!step) {
    speak("Отойти некуда.", c0.x, c0.y, "некуда", "bad");
    return;
  }
  const c = { ...c0, x: step.x, y: step.y, px: step.x, py: step.y };
  viewPos.x = step.x;
  viewPos.y = step.y;
  useGame.setState({
    character: c,
    meet: null,
    inspect: null,
    log: pushLog(s.log, "Отошёл. Встреча закрылась."),
    hint: { text: "Встреча закрылась.", tone: "ok" },
  });
  useGame.getState().persist();
}

function meetDrop() {
  const s = useGame.getState();
  if (!s.meet || s.meet.turn !== "you") return;
  const foe = foeOf(s);
  if (!foe) {
    closeMeet();
    return;
  }
  const tile = tileAt(s.world, s.character.x, s.character.y);
  if (!tile) return;
  noteMeetClosed();
  const c = dumpBagKeepHand(s.character, tile);
  useGame.setState({
    character: c,
    meet: null,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, "Кинул ношу. Рука и золото при себе. Встреча закрылась."),
    hint: { text: "Ноша на клетке. Встреча закрылась.", tone: "ok" },
  });
  useGame.getState().persist();
}

function meetYield() {
  const s = useGame.getState();
  if (!s.meet || s.meet.turn !== "you") return;
  const foe = foeOf(s);
  if (!foe) {
    closeMeet();
    return;
  }
  const tile = tileAt(s.world, s.character.x, s.character.y);
  if (!tile) return;
  let c = dumpBagKeepHand(s.character, tile);
  const step = stepAwayCell(s, c.x, c.y, foe.x, foe.y);
  if (step) {
    c = { ...c, x: step.x, y: step.y, px: step.x, py: step.y };
    viewPos.x = step.x;
    viewPos.y = step.y;
  }
  useGame.setState({
    character: c,
    meet: null,
    world: { ...s.world, tiles: s.world.tiles },
    inspect: null,
    log: pushLog(s.log, "Сдался. Ноша на клетке. Живой."),
    hint: { text: "Сдался. Не упал.", tone: "ok" },
  });
  useGame.getState().persist();
}

function meetTalk() {
  const s = useGame.getState();
  if (!s.meet || s.meet.turn !== "you") return;
  const foe = foeOf(s);
  if (!foe) {
    closeMeet();
    return;
  }
  if (s.meet.spoke) {
    speak("Уже говорил.", s.character.x, s.character.y, "уже", "ok");
    return;
  }
  const friend = s.character.pacts[foe.id] === "friend";
  if ((s.character.skills.speech ?? 0) < 3 && !friend) {
    speak("Говорить — красноречие 3 или друг.", s.character.x, s.character.y, "молчит", "bad");
    return;
  }
  const live = !!(s.meet.live || !foe.dummy);
  const you = youFighter(s.character);
  const ok = Math.random() < talkChance(you, s.character.profession === "trader") || friend;
  if (!ok) {
    useGame.setState({
      meet: live
        ? { ...s.meet, spoke: true, firstDone: true, steps: s.meet.steps + 1, live: true }
        : { ...s.meet, turn: "foe", spoke: true, firstDone: true, steps: s.meet.steps + 1 },
      log: pushLog(s.log, `${foe.name} не отдал. Молчание.`),
      hint: { text: "Не вышло.", tone: "bad" },
    });
    useGame.getState().persist();
    if (!live) window.setTimeout(() => dummyAnswer(), 420);
    return;
  }
  if (live) {
    const c = bumpSkill(s.character, "speech", 0.2);
    noteMeetClosed();
    useGame.setState({
      character: c,
      meet: null,
      log: pushLog(s.log, `Поговорил с ${foe.name}. Сумки свои.`),
      hint: { text: "Разошлись. Сумки свои.", tone: "ok" },
    });
    useGame.getState().persist();
    return;
  }
  const tile = tileAt(s.world, foe.x, foe.y);
  if (tile) dumpAllOn(tile, { ...emptyTheInv(s.character.inventory), ...foe.inventory }, 0);
  const c = bumpSkill(s.character, "speech", 0.2);
  useGame.setState({
    character: c,
    dummies: applyDummy(s.dummies, { ...foe, inventory: {} }),
    meet: null,
    world: { ...s.world, tiles: s.world.tiles },
    log: pushLog(s.log, `${foe.name} отдал ношу без крови.`),
    hint: { text: "Отдал. Встреча закрылась.", tone: "ok" },
  });
  useGame.getState().persist();
}



