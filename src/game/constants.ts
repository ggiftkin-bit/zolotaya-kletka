import type { Biome, BuildingKind, Inventory, ItemId, Profession, Season, Transport, Weather } from "./types";

/** Альфа. Вторая цифра — новая механика, третья — доработка. */
export const GAME_VERSION = "0.8.3";

export const MAP_W = 96;
export const MAP_H = 96;
export const TILE = 44;
export const DEFAULT_SEED = "kletka-land-02";

export const ITEMS: ItemId[] = [
  "wood",
  "stone",
  "ore",
  "food",
  "fish",
  "herb",
  "clay",
  "crystal",
  "axe",
  "pick",
  "rope",
  "bucket",
  "spear",
  "shovel",
  "rod",
  "bread",
  "plank",
  "bar",
  "tonic",
  "smoked",
  "coal",
  "wheel",
  "lock",
  "club",
  "knife",
  "board_shield",
  "bar_shield",
  "wadded",
  "helm",
];

export const ITEM_WEIGHT: Record<ItemId, number> = {
  wood: 2,
  stone: 3,
  ore: 4,
  food: 0.5,
  fish: 0.4,
  axe: 2,
  pick: 2.4,
  herb: 0.2,
  clay: 1.5,
  crystal: 0.8,
  rope: 0.4,
  bucket: 1.2,
  spear: 1.5,
  shovel: 1.4,
  rod: 0.8,
  bread: 0.4,
  plank: 1.6,
  bar: 2.2,
  tonic: 0.3,
  smoked: 0.4,
  coal: 0.8,
  wheel: 1.4,
  lock: 0.6,
  club: 1.6,
  knife: 0.5,
  board_shield: 2.0,
  bar_shield: 3.2,
  wadded: 1.8,
  helm: 2.0,
};

export const CAPACITY: Record<Transport, number> = {
  walk: 22,
  cart: 72,
  horse: 28,
  wagon: 180,
};

export const BIOME_LABEL: Record<Biome, string> = {
  plains: "равнина",
  forest: "лес",
  mountain: "горы",
  river: "река",
  swamp: "болото",
  fertile: "пашня",
  ore: "жила",
  ford: "брод",
};

export const ROAD_LABEL = {
  none: "нет дороги",
  dirt: "грунт",
  stone: "камень",
  bridge: "мост",
} as const;

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: "ясно",
  rain: "дождь",
  snow: "снег",
};

export const SEASON_LABEL: Record<Season, string> = {
  spring: "весна",
  summer: "лето",
  autumn: "осень",
  winter: "зима",
};

export const ITEM_LABEL: Record<ItemId, string> = {
  wood: "дерево",
  stone: "камень",
  ore: "руда",
  food: "еда",
  fish: "рыба",
  axe: "топор",
  pick: "кирка",
  herb: "трава",
  clay: "глина",
  crystal: "кристалл",
  rope: "верёвка",
  bucket: "ведро",
  spear: "копьё",
  shovel: "лопата",
  rod: "удочка",
  bread: "хлеб",
  plank: "доска",
  bar: "слиток",
  tonic: "настой",
  smoked: "копчёное",
  coal: "уголь",
  wheel: "колесо",
  lock: "замок",
  club: "дубина",
  knife: "нож",
  board_shield: "щит тесовый",
  bar_shield: "щит кованый",
  wadded: "стёганка",
  helm: "шлем",
};

export const TRANSPORT_LABEL: Record<Transport, string> = {
  walk: "пешком",
  cart: "тачка",
  horse: "лошадь",
  wagon: "телега",
};

export const MEEPLE_COLORS = [
  "#6b3a2a",
  "#2f4a3c",
  "#3d4a6b",
  "#6b4a2f",
  "#4a3a55",
  "#3a5550",
  "#5c2e2e",
  "#2e3a3c",
] as const;

/** Seconds to enter a plains tile on foot, no load, clear weather. */
export const BASE_SEC = 5;

export const TERRAIN_COST: Record<Biome, number> = {
  plains: 1,
  fertile: 1.08,
  forest: 1.65,
  swamp: 2.15,
  mountain: 5.6,
  ore: 4.8,
  ford: 1.55,
  river: Infinity,
};

export const ROAD_COST = {
  dirt: { wood: 4, stone: 0, work: 2.4 },
  stone: { wood: 2, stone: 3, work: 3.6 },
  bridge: { wood: 8, stone: 4, work: 5.2 },
} as const;

export const GATHER_YIELD: Record<ItemId, number> = {
  wood: 2,
  stone: 2,
  ore: 1,
  food: 1,
  fish: 2,
  herb: 1,
  clay: 2,
  crystal: 1,
  axe: 0,
  pick: 0,
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
  club: 0,
  knife: 0,
  board_shield: 0,
  bar_shield: 0,
  wadded: 0,
  helm: 0,
};

export const GATHER_TABLE: Partial<Record<Biome, { item: ItemId; yield: number }>> = {
  forest: { item: "wood", yield: 2 },
  mountain: { item: "stone", yield: 2 },
  ore: { item: "ore", yield: 1 },
  fertile: { item: "food", yield: 2 },
  plains: { item: "herb", yield: 1 },
  ford: { item: "fish", yield: 2 },
  swamp: { item: "herb", yield: 1 },
};

export const SEASON_WEATHER: Record<Season, Weather[]> = {
  spring: ["clear", "rain", "rain", "clear"],
  summer: ["clear", "clear", "rain", "clear"],
  autumn: ["rain", "clear", "rain", "clear"],
  winter: ["snow", "snow", "clear", "snow"],
};

/** Real seconds per world tick at ×1. День и ночь по 2 мин (4 тика × 30 с). */
export const TICK_SEC = 30;
export const TICKS_PER_DAY = 8;
export const DAYS_PER_WEEK = 6;
export const WEEKS_PER_SEASON = 3;

export const PROFESSION_BIOME: Partial<Record<Profession, Biome[]>> = {
  lumberjack: ["forest"],
  miner: ["mountain", "ore"],
  fisher: ["ford"],
  farmer: ["fertile", "plains"],
};

export const BUILD_OK: Record<Exclude<BuildingKind, "none">, Biome[]> = {
  shack: ["plains", "forest", "fertile", "mountain", "swamp"],
  house: ["plains", "fertile", "forest"],
  field: ["fertile", "plains"],
  workshop: ["plains", "fertile", "mountain", "ore"],
  shop: ["plains", "fertile", "forest"],
  board: ["plains", "fertile"],
  mine: ["mountain", "ore"],
  pen: ["plains", "fertile"],
  stable: ["plains", "fertile", "forest"],
  well: ["plains", "fertile", "forest", "mountain"],
  tower: ["plains", "fertile", "forest", "mountain"],
  bench: ["plains", "fertile", "forest"],
  forge: ["plains", "fertile", "mountain", "ore"],
  oven: ["plains", "fertile", "forest"],
  smoke: ["plains", "fertile", "forest", "ford"],
  herbs: ["plains", "fertile", "forest", "swamp"],
  stall: ["plains", "fertile", "forest"],
  coalpit: ["plains", "forest"],
  adit: ["mountain", "ore"],
  shed: ["plains", "fertile", "forest"],
  jail: ["plains", "fertile", "forest"],
  stakes: ["plains", "fertile", "forest", "mountain", "swamp"],
  moat: ["plains", "fertile", "forest", "swamp"],
  net: ["plains", "fertile", "forest", "swamp", "ford"],
  camp: ["plains", "fertile", "forest", "swamp", "mountain"],
};

/** Ноша: все ненулевые, три квадрата в ряд. */
export const BAG_CELLS: ItemId[] = [...ITEMS];

export function zeroInv(): Inventory {
  const o = {} as Inventory;
  for (const k of ITEMS) o[k] = 0;
  return o;
}


