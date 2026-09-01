import type { Inventory, ItemId, JobPost, Profession, Season, Skill, Trader } from "./types";

export const PROFESSION_LABEL: Record<Profession, string> = {
  wanderer: "бродяга",
  lumberjack: "дровосек",
  miner: "рудокоп",
  fisher: "рыбак",
  farmer: "крестьянин",
  baker: "пекарь",
  carpenter: "плотник",
  smith: "кузнец",
  trader: "торговец",
  healer: "целитель",
  hireling: "наёмник",
};

export const SKILL_LABEL: Record<Skill, string> = {
  survival: "выживание",
  craft: "ремесло",
  build: "стройка",
  trade: "торговля",
  agro: "агро",
  mine: "добыча",
  fight: "бой",
  stealth: "скрытность",
  speech: "красноречие",
  lead: "лидерство",
  law: "закон",
  med: "медицина",
};

export const BUILDING_LABEL = {
  none: "пусто",
  shack: "шалаш",
  house: "дом",
  field: "поле",
  workshop: "верстак",
  shop: "лавка",
  board: "биржа",
  mine: "сруб",
  pen: "загон",
  stable: "конюшня",
  well: "колодец",
  tower: "башня",
  bench: "верстак",
  forge: "горн",
  oven: "печь",
  smoke: "коптильня",
  herbs: "стол трав",
  stall: "прилавок",
  coalpit: "дровница",
  adit: "сруб",
  shed: "склад",
  jail: "яма",
  stakes: "колья",
  moat: "ров",
} as const;

export const BUILD_COST: Record<
  Exclude<keyof typeof BUILDING_LABEL, "none">,
  { wood: number; stone: number; gold: number }
> = {
  shack: { wood: 4, stone: 0, gold: 0 },
  house: { wood: 10, stone: 4, gold: 0 },
  field: { wood: 0, stone: 0, gold: 0 },
  workshop: { wood: 6, stone: 0, gold: 0 },
  shop: { wood: 8, stone: 0, gold: 0 },
  board: { wood: 6, stone: 0, gold: 0 },
  mine: { wood: 6, stone: 0, gold: 0 },
  pen: { wood: 6, stone: 0, gold: 0 },
  stable: { wood: 8, stone: 0, gold: 0 },
  well: { wood: 0, stone: 6, gold: 0 },
  tower: { wood: 8, stone: 4, gold: 0 },
  bench: { wood: 6, stone: 0, gold: 0 },
  forge: { wood: 0, stone: 4, gold: 0 },
  oven: { wood: 0, stone: 6, gold: 0 },
  smoke: { wood: 5, stone: 0, gold: 0 },
  herbs: { wood: 3, stone: 0, gold: 0 },
  stall: { wood: 8, stone: 0, gold: 0 },
  coalpit: { wood: 3, stone: 0, gold: 0 },
  adit: { wood: 6, stone: 0, gold: 0 },
  shed: { wood: 6, stone: 0, gold: 0 },
  jail: { wood: 0, stone: 4, gold: 0 },
  stakes: { wood: 3, stone: 0, gold: 0 },
  moat: { wood: 2, stone: 0, gold: 0 },
};

/** What the stall pays you. Buy is always ×2. */
export const SELL_GOLD: Record<ItemId, number> = {
  wood: 1,
  stone: 2,
  ore: 3,
  food: 2,
  fish: 3,
  axe: 8,
  herb: 1,
  clay: 1,
  crystal: 8,
  rope: 3,
  bucket: 3,
  spear: 4,
  bread: 6,
  plank: 4,
  bar: 10,
  tonic: 8,
  smoked: 6,
  coal: 3,
  wheel: 6,
  lock: 6,
};

export function goldTxt(n: number): string {
  return `${n} золота`;
}

/** Wheelbarrow at the caravan. Same pace as walk, triple cargo. */
export const CART_GOLD = 8;
/** Home / bench: 8 wood → one cart. */
export const CART_WOOD = 8;
/** Wagon at the caravan. Hitch to a horse. Never a bag item. */
export const WAGON_GOLD = 24;
/** Padlock at the caravan. Hang on a gate or a chest. */
export const LOCK_GOLD = 12;

export function seasonPrice(item: ItemId, season: Season): number {
  let m = 1;
  if (season === "winter") {
    if (item === "food" || item === "fish") m = 1.5;
    if (item === "bread" || item === "smoked" || item === "coal") m = 1.3;
  }
  return Math.max(1, Math.round(SELL_GOLD[item] * m));
}

export function caravanBuy(item: ItemId, season: Season, _trader: boolean): number {
  return seasonPrice(item, season);
}

export function caravanSell(item: ItemId, season: Season): number {
  return seasonPrice(item, season) * 2;
}

export function makeJobs(week: number): JobPost[] {
  const rot = week % 4;
  const extra: JobPost =
    rot === 0
      ? { id: `w${week}-herb`, title: "Травы лекаря", pay: 20, item: "herb", need: 4, status: "open" }
      : rot === 1
        ? { id: `w${week}-clay`, title: "Глина на печь", pay: 16, item: "clay", need: 6, status: "open" }
        : rot === 2
          ? { id: `w${week}-ore`, title: "Руда кузнецу", pay: 28, item: "ore", need: 4, status: "open" }
          : { id: `w${week}-fish`, title: "Рыба к столу", pay: 20, item: "fish", need: 5, status: "open" };
  return [
    {
      id: `w${week}-wood`,
      title: "Каравану дрова",
      pay: 22,
      item: "wood",
      need: 8,
      status: "open",
    },
    {
      id: `w${week}-food`,
      title: "Паёк на неделю",
      pay: 18,
      item: "food",
      need: 6,
      status: "open",
    },
    extra,
  ];
}

function zInv(): Inventory {
  return {
    wood: 0,
    stone: 0,
    ore: 0,
    food: 0,
    fish: 0,
    axe: 0,
    herb: 0,
    clay: 0,
    crystal: 0,
    rope: 0,
    bucket: 0,
    spear: 0,
    bread: 0,
    plank: 0,
    bar: 0,
    tonic: 0,
    smoked: 0,
    coal: 0,
    wheel: 0,
    lock: 0,
  };
}

export function makeTrader(week: number): Trader {
  const demand = zInv();
  demand.wood = 16;
  demand.stone = 10;
  demand.food = 8;
  demand.fish = 6;
  demand.ore = 4;
  demand.herb = 6;
  demand.clay = 8;
  demand.crystal = 2;
  demand.axe = 1;
  demand.plank = 6;
  demand.bread = 6;
  demand.smoked = 5;
  demand.coal = 8;
  demand.bar = 3;
  demand.tonic = 3;
  demand.wheel = 4;
  demand.lock = 3;
  const wares = zInv();
  wares.food = 8;
  wares.fish = 4;
  wares.axe = 2;
  wares.herb = 3;
  wares.rope = 2;
  wares.spear = 1;
  wares.bucket = 1;
  wares.bread = 2;
  wares.lock = 1;
  if (week % 2 === 0) wares.crystal = 1;
  return {
    name: "Лавка",
    demand,
    wares,
    last: "Придорожная лавка. Берёт добро до конца недели и продаёт своё.",
  };
}

export const PROF_SKILL: Record<Profession, Skill> = {
  wanderer: "survival",
  lumberjack: "survival",
  miner: "mine",
  fisher: "survival",
  farmer: "agro",
  baker: "craft",
  carpenter: "build",
  smith: "craft",
  trader: "trade",
  healer: "med",
  hireling: "fight",
};

export function emptySkills(): Record<Skill, number> {
  return {
    survival: 1,
    craft: 0,
    build: 0,
    trade: 0,
    agro: 0,
    mine: 0,
    fight: 0,
    stealth: 0,
    speech: 0,
    lead: 0,
    law: 0,
    med: 0,
  };
}
