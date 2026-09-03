import type { ItemId, Profession, Tile } from "./types";

export type CraftKind = "coal" | "plank" | "bar" | "axe" | "bread" | "smoked" | "tonic" | "rope" | "bucket" | "spear" | "shovel" | "rod" | "wheel" | "lock";

export type BenchId = "home" | "bench" | "forge" | "oven" | "smoke" | "herbs" | "coalpit" | "workshop";

export type CraftDef = {
  id: CraftKind;
  out: ItemId;
  n: number;
  need: Partial<Record<ItemId, number>>;
  who: Profession | "any";
  bench: BenchId;
  energy: number;
  label: string;
  hint: string;
};

export const CRAFTS: CraftDef[] = [
  { id: "plank", out: "plank", n: 1, need: { wood: 2 }, who: "carpenter", bench: "bench", energy: 1, label: "доска", hint: "2 дерева · плотник · верстак. Сдать 4 золота" },
  { id: "wheel", out: "wheel", n: 1, need: { plank: 2 }, who: "carpenter", bench: "bench", energy: 2, label: "колесо", hint: "2 доски · плотник · верстак. На телегу нужно два" },
  { id: "coal", out: "coal", n: 2, need: { wood: 3 }, who: "lumberjack", bench: "coalpit", energy: 1, label: "уголь", hint: "3 дерева → 2 угля · дровосек · дровница" },
  { id: "bar", out: "bar", n: 1, need: { ore: 1, coal: 1 }, who: "smith", bench: "forge", energy: 2, label: "слиток", hint: "руда + уголь · кузнец · горн. Сдать 10 золота" },
  { id: "axe", out: "axe", n: 1, need: { bar: 1, wood: 1 }, who: "smith", bench: "forge", energy: 2, label: "топор", hint: "слиток + дерево · кузнец" },
  { id: "lock", out: "lock", n: 1, need: { bar: 1 }, who: "smith", bench: "forge", energy: 2, label: "замок", hint: "слиток · кузнец · горн. На калитку или сундук" },
  { id: "bread", out: "bread", n: 1, need: { food: 2 }, who: "baker", bench: "oven", energy: 1, label: "хлеб", hint: "2 еды · пекарь · печь. Сдать 6 золота" },
  { id: "smoked", out: "smoked", n: 1, need: { fish: 1 }, who: "fisher", bench: "smoke", energy: 1, label: "копчёное", hint: "рыба · рыбак · коптильня. Сдать 6 золота" },
  { id: "tonic", out: "tonic", n: 1, need: { herb: 3 }, who: "healer", bench: "herbs", energy: 1, label: "настой", hint: "3 травы · целитель · стол трав. Сдать 8 золота" },
  { id: "rope", out: "rope", n: 1, need: { herb: 2 }, who: "any", bench: "home", energy: 1, label: "верёвка", hint: "2 травы · любой дома" },
  { id: "bucket", out: "bucket", n: 1, need: { wood: 2 }, who: "any", bench: "home", energy: 1, label: "ведро", hint: "2 дерева · любой дома" },
  { id: "spear", out: "spear", n: 1, need: { wood: 2 }, who: "any", bench: "home", energy: 1, label: "копьё", hint: "2 дерева · любой дома" },
  { id: "shovel", out: "shovel", n: 1, need: { wood: 2 }, who: "any", bench: "home", energy: 1, label: "лопата", hint: "2 дерева · любой дома. Копать землю" },
  { id: "rod", out: "rod", n: 1, need: { wood: 1, rope: 1 }, who: "any", bench: "home", energy: 1, label: "удочка", hint: "1 дерево + 1 верёвка · любой дома. Рыба только ею" },
];

export const PROF_BLURB: Record<Profession, string> = {
  wanderer: "Своего станка нет. Дома — верёвка, копьё, ведро, лопата, удочка.",
  lumberjack: "Дровница: 3 дерева → 2 угля. Без угля кузнец не льёт.",
  miner: "Сруб у горы. Больше руды. Кристалл ищет только он.",
  fisher: "Коптильня: рыба → копчёное. Ловят удочкой: дерево + верёвка дома.",
  farmer: "Поле и загон. Верёвку дома сколотит любой.",
  baker: "Печь: 2 еды → хлеб. Сдать 6 золота.",
  carpenter: "Верстак: доска, колесо. Телега — 2 колеса, 4 дерева и слиток. В сумку не кладётся.",
  smith: "Горн: руда+уголь → слиток, топор, замок. Замок — на калитку или сундук. Свой открывается сам.",
  trader: "Прилавок у калитки. Курс как у тракта, сдача на 1 хуже.",
  healer: "Стол трав: 3 травы → настой. Сдать 8 золота.",
  hireling: "Башня. Вахта. Копьё дома сколотит любой.",
};

export const PROF_STATION: Record<Profession, string> = {
  wanderer: "дом",
  lumberjack: "дровница",
  miner: "сруб у горы",
  fisher: "коптильня",
  farmer: "поле и загон",
  baker: "печь",
  carpenter: "верстак",
  smith: "горн",
  trader: "прилавок",
  healer: "стол трав",
  hireling: "башня",
};

function isHome(tile: Tile) {
  return tile.building === "shack" || tile.building === "house";
}

export function atBench(tile: Tile | null, bench: BenchId) {
  if (!tile) return false;
  if (bench === "home") return isHome(tile);
  if (bench === "workshop" || bench === "bench") return tile.building === "bench" || tile.building === "workshop";
  if (bench === "forge") return tile.building === "forge";
  if (bench === "oven") return tile.building === "oven";
  if (bench === "smoke") return tile.building === "smoke";
  if (bench === "herbs") return tile.building === "herbs" || isHome(tile);
  if (bench === "coalpit") return tile.building === "coalpit";
  return false;
}

export function canDoCraft(def: CraftDef, profession: Profession, tile: Tile | null) {
  if (def.who !== "any" && def.who !== profession) return false;
  return atBench(tile, def.bench);
}

export const EAT_ORDER: ItemId[] = ["bread", "smoked", "food", "fish"];

export const EAT_SAT: Partial<Record<ItemId, number>> = {
  bread: 28,
  smoked: 26,
  food: 14,
  fish: 16,
};
