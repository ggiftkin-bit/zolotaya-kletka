export type Biome =
  | "plains"
  | "forest"
  | "mountain"
  | "river"
  | "swamp"
  | "fertile"
  | "ore"
  | "ford";

export type RoadKind = "none" | "dirt" | "stone" | "bridge";

export type FenceKind = "none" | "wood" | "palisade" | "wall" | "gate";

export type Matter = "wattle" | "wood" | "stone";

export type BusyKind =
  | "hunt"
  | "catch"
  | "fish"
  | "chop"
  | "mine"
  | "forage"
  | "build"
  | "craft"
  | "dig"
  | "fill"
  | "road"
  | "lock"
  | "burn"
  | "watch"
  | "haul"
  | "bring";

export type Busy = {
  kind: BusyKind;
  x: number;
  y: number;
  until: number;
  item?: ItemId;
  build?: BuildingKind;
  craft?: string;
  road?: "dirt" | "stone" | "bridge";
  lock?: "chest" | "gate";
  hired?: boolean;
  /** Услуга двух почт. Не руки за 16. */
  service?: boolean;
};

export type Weather = "clear" | "rain" | "snow";

export type Season = "spring" | "summer" | "autumn" | "winter";

export type Transport = "walk" | "cart" | "horse" | "wagon";

export type ToolMode =
  | "move"
  | "dirt"
  | "stone"
  | "bridge"
  | "gather"
  | "claim"
  | "build";

export type BuildingKind =
  | "none"
  | "shack"
  | "house"
  | "field"
  | "workshop"
  | "shop"
  | "board"
  | "mine"
  | "pen"
  | "stable"
  | "well"
  | "tower"
  | "bench"
  | "forge"
  | "oven"
  | "smoke"
  | "herbs"
  | "stall"
  | "coalpit"
  | "adit"
  | "shed"
  | "jail"
  | "stakes"
  | "moat"
  | "net"
  | "camp";

export type Profession =
  | "wanderer"
  | "lumberjack"
  | "miner"
  | "fisher"
  | "farmer"
  | "baker"
  | "carpenter"
  | "smith"
  | "trader"
  | "healer"
  | "hireling";

export type Skill =
  | "survival"
  | "craft"
  | "build"
  | "trade"
  | "agro"
  | "mine"
  | "fight"
  | "stealth"
  | "speech"
  | "lead"
  | "law"
  | "med";

export type ItemId =
  | "wood"
  | "stone"
  | "ore"
  | "food"
  | "fish"
  | "axe"
  | "pick"
  | "herb"
  | "clay"
  | "crystal"
  | "rope"
  | "bucket"
  | "spear"
  | "shovel"
  | "rod"
  | "bread"
  | "plank"
  | "bar"
  | "tonic"
  | "smoked"
  | "coal"
  | "wheel"
  | "lock"
  | "club"
  | "knife"
  | "board_shield"
  | "bar_shield"
  | "wadded"
  | "helm"
  | "brick"
  | "grain"
  | "flour";

export type GiftId = "gift_pin" | "gift_mug" | "gift_nft";

export type WearKind = "axe" | "pick" | "spear" | "shovel" | "club" | "knife";

export type AnimalKind = "hare" | "deer" | "horse" | "cow";

export type Herd = {
  kind: AnimalKind;
  count: number;
  wild: boolean;
  hunger: number;
  /** Дни коровы во дворе. Дикие без срока. */
  age?: number;
};

export type StallOrder = {
  item: ItemId;
  n: number;
  gold: number;
};

export type ServiceKind = "watch" | "haul" | "build" | "craft" | "bring";

/** Контракт двух почт. Золото и сырьё в эскро клетки, не в воздухе. */
export type ServiceJob = {
  kind: ServiceKind;
  gold: number;
  /** 0 — вывеска без часа. Срок на until только после «Взять». */
  until: number;
  by: string;
  take?: string;
  /** Постой: 15/30/60 мин. Живёт в заказе, на until садится при «Взять». */
  doSec?: number;
  item?: ItemId;
  n?: number;
  destX?: number;
  destY?: number;
  build?: BuildingKind;
  craft?: string;
  cargo?: Partial<Record<ItemId, number>>;
};

export type Tile = {
  x: number;
  y: number;
  biome: Biome;
  road: RoadKind;
  resource: ItemId | null;
  amount: number;
  commons: boolean;
  owned: boolean;
  building: BuildingKind;
  caravan: boolean;
  pile: Partial<Record<ItemId, number>> | null;
  goldDrop: number;
  chest: Inventory;
  scarred: boolean;
  takings: number;
  regen: number;
  herd: Herd | null;
  cistern: number;
  plot: boolean;
  fenceN: FenceKind;
  fenceW: FenceKind;
  owner: string;
  law: boolean;
  mark: { who: string; at: number } | null;
  matter: Matter;
  hp: number;
  burned: boolean;
  village: string;
  /** Owner id if a wagon is parked here. Empty = none. Never in a bag. */
  wagon: string;
  /** Padlock on this building's chest. Owner opens it; others pick. */
  chestLock: boolean;
  /** Yard-wide latch: locked gates block non-owners. */
  gateLock: boolean;
  /** Dug pit. Neighbors merge visually. */
  pit: boolean;
  /** Yellow clay bank along the river. Dig → 2 clay, then pit. */
  bank: boolean;
  /** Витрина прилавка. Вещь в эскро на клетке, не в воздухе. */
  order: StallOrder | null;
  /** Услуга двух почт. Золото в книге с первого тыка. */
  service: ServiceJob | null;
};

export type Inventory = Record<ItemId, number>;

export type Skills = Record<Skill, number>;

export type TravelLeg = {
  x: number;
  y: number;
  cost: number;
};

export type Travel = {
  path: TravelLeg[];
  index: number;
  elapsed: number;
  total: number;
  /** Wall-clock ms; catch-up uses now - t0 so AFK still walks. */
  t0: number;
};

export type JobPost = {
  id: string;
  title: string;
  pay: number;
  item: ItemId;
  need: number;
  status: "open" | "done";
};

export type World = {
  seed: string;
  width: number;
  height: number;
  tiles: Tile[];
  /** 0 тьма · 1 отпечаток · 2 живое пятно. Нет массива — всё живое (карман v8). */
  fog?: number[];
  /** Версия клетки в книге. */
  ver?: number[];
};


export type Character = {
  name: string;
  color: string;
  x: number;
  y: number;
  px: number;
  py: number;
  gold: number;
  inventory: Inventory;
  transport: Transport;
  energy: number;
  satiety: number;
  warmth: number;
  hp: number;
  profession: Profession;
  skills: Skills;
  seasonSkillGain: number;
  profWeek: number;
  hand: ItemId | null;
  /** Стёганка. Пусто — нет. */
  body: ItemId | null;
  /** Тесовый или кованый щит. Двух щитов нет. */
  shield: ItemId | null;
  /** Шлем на голове. */
  helm: ItemId | null;
  horses: number;
  carts: number;
  /** True while a wagon is hitched to the horse. Not an inventory item. */
  wagon: boolean;
  /** 0–100 · жажда тела. Ведро — `pail`. */
  water: number;
  /** Глотков в ведре (0–3). Не путать с водой тела. */
  pail: number;
  /** Мировой тик последнего «Напиться» у реки/колодца. */
  sipTick?: number;
  energyAt: number;
  wanted: number;
  jailedUntil: number;
  jailWhy: string;
  life: "alive" | "down" | "jailed" | "dead";
  downAt: number;
  deadUntil: number;
  deaths: number;
  stillUntil: number;
  resting: boolean;
  busy: Busy | null;
  /** Остаток ударов снасти в руке. Старый сейв = полный запас. */
  wear: Partial<Record<WearKind, number>>;
  /** Износ снятой снасти в сумке (один экземпляр на тип). Второй без записи — новый. */
  bagWear?: Partial<Record<WearKind, number>>;
  pacts: Record<string, "friend" | "feud">;
  village: string;
  /** Призы конторы. Не вещь сумки. */
  gifts?: Partial<Record<GiftId, "ordered">>;
};

export type Floater = {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: "ok" | "bad" | "gold";
};

export type Trader = {
  name: string;
  demand: Inventory;
  wares: Inventory;
  last: string;
};

export type OtherPawn = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  hp?: number;
  life?: "alive" | "down";
  hand?: ItemId | null;
  body?: ItemId | null;
  shield?: ItemId | null;
  helm?: ItemId | null;
};

export type Meet = {
  foeId: string;
  turn: "you" | "foe";
  steps: number;
  spoke: boolean;
  firstDone: boolean;
  /** Живой человек, не манекен. */
  live?: boolean;
  /** Лист открылся потому что напали, не ты ткнул. */
  incoming?: boolean;
  foeHp?: number;
  foeHand?: ItemId | null;
  foeBody?: ItemId | null;
  foeShield?: ItemId | null;
  foeHelm?: ItemId | null;
};

export type Dummy = {
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
  inventory: Partial<Inventory>;
};

export type GameState = {
  world: World;
  character: Character;
  weather: Weather;
  season: Season;
  year: number;
  week: number;
  day: number;
  clock: number;
  tickOfDay: number;
  phase: "day" | "night";
  timeScale: number;
  tool: ToolMode;
  buildKind: BuildingKind;
  selected: { x: number; y: number } | null;
  inspect: { x: number; y: number } | null;
  hover: { x: number; y: number } | null;
  preview: TravelLeg[] | null;
  travel: Travel | null;
  clockAt: number;
  /** Когда прошёл последний мировой тик — полоса суток без скачка. */
  tickAt: number;
  jobs: JobPost[];
  trader: Trader;
  /** Склад тракта. Книга держит, не неделя лавки. */
  stock: Partial<Record<ItemId, number>>;
  plotMark: { x: number; y: number } | null;
  log: string[];
  started: boolean;
  floaters: Floater[];
  hint: { text: string; tone: "ok" | "bad" | "gold"; theme?: string; keep?: "jail" | "down" } | null;
  /** Книга мира открыта. Карман v8 — только сетка. */
  bookOn: boolean;
  bookAt: string;
  bookStatus: "idle" | "loading" | "ready" | "offline";
  others: OtherPawn[];
  /** Встреча двух фишек. Нет — листа боя нет. */
  meet: Meet | null;
  /** Манекены хуторов. */
  dummies: Dummy[];
  /** Кто вошёл. Двор в книге пишется этим id, на столе это «ты». */
  selfId: string;
};
