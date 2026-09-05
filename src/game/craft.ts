import type { ItemId, Profession, Tile } from "./types";

export type CraftKind = "coal" | "plank" | "bar" | "axe" | "pick" | "bread" | "smoked" | "tonic" | "rope" | "bucket" | "spear" | "shovel" | "rod" | "wheel" | "lock" | "club" | "knife" | "board_shield" | "bar_shield" | "wadded" | "helm";

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
  { id: "plank", out: "plank", n: 1, need: { wood: 3 }, who: "carpenter", bench: "bench", energy: 1, label: "доска", hint: "3 дерева · плотник · верстак. Сдать 1 золото" },
  { id: "wheel", out: "wheel", n: 1, need: { plank: 3 }, who: "carpenter", bench: "bench", energy: 2, label: "колесо", hint: "3 доски · плотник · верстак. На телегу нужно два" },
  { id: "coal", out: "coal", n: 1, need: { wood: 4 }, who: "lumberjack", bench: "coalpit", energy: 1, label: "уголь", hint: "4 дерева → 1 уголь · дровосек · дровница" },
  { id: "bar", out: "bar", n: 1, need: { ore: 1, coal: 2 }, who: "smith", bench: "forge", energy: 2, label: "слиток", hint: "руда + 2 угля · кузнец · горн. Сдать 4 золота" },
  { id: "axe", out: "axe", n: 1, need: { bar: 1, wood: 2 }, who: "smith", bench: "forge", energy: 2, label: "топор", hint: "слиток + 2 дерева · кузнец. Сдать 4, купить 14" },
  { id: "pick", out: "pick", n: 1, need: { bar: 1, wood: 2 }, who: "smith", bench: "forge", energy: 2, label: "кирка", hint: "слиток + 2 дерева · кузнец. Камень и руда" },
  { id: "lock", out: "lock", n: 1, need: { bar: 1 }, who: "smith", bench: "forge", energy: 2, label: "замок", hint: "слиток · кузнец · горн. На калитку или сундук" },
  { id: "bread", out: "bread", n: 1, need: { food: 3 }, who: "baker", bench: "oven", energy: 1, label: "хлеб", hint: "3 еды · пекарь · печь. Сдать 2 золота" },
  { id: "smoked", out: "smoked", n: 1, need: { fish: 1, wood: 1 }, who: "fisher", bench: "smoke", energy: 1, label: "копчёное", hint: "рыба + дерево · рыбак · коптильня. Сдать 2 золота" },
  { id: "tonic", out: "tonic", n: 1, need: { herb: 3 }, who: "healer", bench: "herbs", energy: 1, label: "настой", hint: "3 травы · целитель · стол трав. Сдать 3 золота" },
  { id: "rope", out: "rope", n: 1, need: { herb: 3 }, who: "any", bench: "home", energy: 1, label: "верёвка", hint: "3 травы · любой дома" },
  { id: "bucket", out: "bucket", n: 1, need: { wood: 4 }, who: "any", bench: "home", energy: 1, label: "ведро", hint: "4 дерева · любой дома" },
  { id: "spear", out: "spear", n: 1, need: { wood: 3 }, who: "any", bench: "home", energy: 1, label: "копьё", hint: "3 дерева · любой дома" },
  { id: "shovel", out: "shovel", n: 1, need: { wood: 3 }, who: "any", bench: "home", energy: 1, label: "лопата", hint: "3 дерева · любой дома. Копать землю" },
  { id: "rod", out: "rod", n: 1, need: { wood: 1, rope: 1 }, who: "any", bench: "home", energy: 1, label: "удочка", hint: "1 дерево + 1 верёвка · любой дома. Рыба только ею" },
  { id: "club", out: "club", n: 1, need: { wood: 3 }, who: "any", bench: "home", energy: 1, label: "дубина", hint: "3 дерева · любой дома" },
  { id: "wadded", out: "wadded", n: 1, need: { herb: 6, food: 1 }, who: "any", bench: "home", energy: 1, label: "стёганка", hint: "6 трав + еда · любой дома" },
  { id: "knife", out: "knife", n: 1, need: { bar: 1 }, who: "smith", bench: "forge", energy: 2, label: "нож", hint: "слиток · кузнец · горн" },
  { id: "helm", out: "helm", n: 1, need: { bar: 1 }, who: "smith", bench: "forge", energy: 2, label: "шлем", hint: "слиток · кузнец · горн" },
  { id: "bar_shield", out: "bar_shield", n: 1, need: { bar: 1, wood: 1 }, who: "smith", bench: "forge", energy: 2, label: "щит кованый", hint: "слиток + дерево · кузнец · горн" },
  { id: "board_shield", out: "board_shield", n: 1, need: { plank: 3 }, who: "carpenter", bench: "bench", energy: 2, label: "щит тесовый", hint: "3 доски · плотник · верстак" },
];

export const PROF_BLURB: Record<Profession, string> = {
  wanderer: "Своего станка нет. Дома — верёвка, копьё, ведро, лопата, удочка, дубина, стёганка.",
  lumberjack: "Дровница: 4 дерева → 1 уголь. Без угля кузнец не льёт.",
  miner: "Сруб у горы. Больше руды. Кристалл ищет только он.",
  fisher: "Коптильня: рыба + дерево → копчёное. Ловят удочкой: дерево + верёвка дома.",
  farmer: "Поле и загон. Верёвку дома сколотит любой.",
  baker: "Печь: 3 еды → хлеб. Сдать 2 золота.",
  carpenter: "Верстак: доска, колесо, щит тесовый. Телега — 2 колеса, 4 дерева и слиток. В сумку не кладётся.",
  smith: "Горн: руда+2 угля → слиток, топор, кирка, замок, нож, шлем, щит кованый. Замок — на калитку или сундук. Свой открывается сам.",
  trader: "Прилавок у калитки. Курс как у тракта. Купчина: +1 золото к пачке сырья.",
  healer: "Стол трав: 3 травы → настой. Сдать 3 золота.",
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
