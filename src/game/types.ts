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

export type BusyKind = "hunt" | "catch" | "fish";

export type Busy = {
  kind: BusyKind;
  x: number;
  y: number;
  until: number;
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
  | "moat";

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
  | "herb"
  | "clay"
  | "crystal"
  | "rope"
  | "bucket"
  | "spear"
  | "bread"
  | "plank"
  | "bar"
  | "tonic"
  | "smoked"
  | "coal"
  | "wheel"
  | "lock";

export type AnimalKind = "hare" | "deer" | "horse" | "cow";

export type Herd = {
  kind: AnimalKind;
  count: number;
  wild: boolean;
  hunger: number;
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
  pile: { item: ItemId; amount: number } | null;
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
  horses: number;
  carts: number;
  /** True while a wagon is hitched to the horse. Not an inventory item. */
  wagon: boolean;
  water: number;
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
  pacts: Record<string, "friend" | "feud">;
  village: string;
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
  jobs: JobPost[];
  trader: Trader;
  plotMark: { x: number; y: number } | null;
  log: string[];
  started: boolean;
  floaters: Floater[];
  hint: { text: string; tone: "ok" | "bad" | "gold" } | null;
};
