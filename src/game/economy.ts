import type { Inventory, ItemId, JobPost, Profession, Season, Skill, Trader } from "./types";
import { zeroInv } from "./constants";

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
  net: "сеть",
  camp: "костёр",
} as const;

export const BUILD_COST: Record<
  Exclude<keyof typeof BUILDING_LABEL, "none">,
  { wood: number; stone: number; gold: number }
> = {
  shack: { wood: 6, stone: 0, gold: 0 },
  house: { wood: 14, stone: 6, gold: 0 },
  field: { wood: 0, stone: 0, gold: 0 },
  workshop: { wood: 8, stone: 0, gold: 0 },
  shop: { wood: 8, stone: 0, gold: 0 },
  board: { wood: 6, stone: 0, gold: 0 },
  mine: { wood: 6, stone: 0, gold: 0 },
  pen: { wood: 6, stone: 0, gold: 0 },
  stable: { wood: 8, stone: 0, gold: 0 },
  well: { wood: 0, stone: 6, gold: 0 },
  tower: { wood: 8, stone: 4, gold: 0 },
  bench: { wood: 8, stone: 0, gold: 0 },
  forge: { wood: 0, stone: 6, gold: 0 },
  oven: { wood: 0, stone: 6, gold: 0 },
  smoke: { wood: 6, stone: 0, gold: 0 },
  herbs: { wood: 3, stone: 0, gold: 0 },
  stall: { wood: 8, stone: 0, gold: 0 },
  coalpit: { wood: 3, stone: 0, gold: 0 },
  adit: { wood: 6, stone: 0, gold: 0 },
  shed: { wood: 6, stone: 0, gold: 0 },
  jail: { wood: 0, stone: 4, gold: 0 },
  stakes: { wood: 3, stone: 0, gold: 0 },
  moat: { wood: 2, stone: 0, gold: 0 },
  net: { wood: 4, stone: 0, gold: 0 },
  camp: { wood: 2, stone: 0, gold: 0 },
};

/** Сырьё лавка берёт пачкой. Штука дерева золота не даёт. Готовое — по штуке. */
export const SELL_PACK: Partial<Record<ItemId, { n: number; gold: number }>> = {
  wood: { n: 8, gold: 1 },
  stone: { n: 5, gold: 1 },
  clay: { n: 6, gold: 1 },
  herb: { n: 10, gold: 1 },
  food: { n: 4, gold: 1 },
  fish: { n: 3, gold: 1 },
  ore: { n: 2, gold: 1 },
  coal: { n: 3, gold: 1 },
};

const WINTER_PLUS = new Set<ItemId>(["food", "fish", "bread", "smoked", "coal"]);

/** Что лавка платит за штуку готового. Сырьё из пачки здесь 0. */
export const SELL_GOLD: Record<ItemId, number> = {
  wood: 0,
  stone: 0,
  ore: 0,
  food: 0,
  fish: 0,
  axe: 4,
  pick: 5,
  herb: 0,
  clay: 0,
  crystal: 12,
  rope: 1,
  bucket: 1,
  spear: 1,
  shovel: 1,
  rod: 2,
  bread: 2,
  plank: 1,
  bar: 4,
  tonic: 3,
  smoked: 2,
  coal: 0,
  wheel: 2,
  lock: 3,
  club: 1,
  knife: 3,
  board_shield: 2,
  bar_shield: 5,
  wadded: 2,
  helm: 5,
};

/** Покупка в лавке. Не ×2 к сдаче. */
export const BUY_GOLD: Record<ItemId, number> = {
  wood: 1,
  stone: 1,
  ore: 2,
  food: 1,
  fish: 1,
  axe: 14,
  pick: 16,
  herb: 1,
  clay: 1,
  crystal: 36,
  rope: 4,
  bucket: 5,
  spear: 5,
  shovel: 5,
  rod: 7,
  bread: 6,
  plank: 4,
  bar: 14,
  tonic: 9,
  smoked: 6,
  coal: 1,
  wheel: 8,
  lock: 10,
  club: 5,
  knife: 12,
  board_shield: 8,
  bar_shield: 16,
  wadded: 8,
  helm: 16,
};

export function goldTxt(n: number): string {
  return `${n} золота`;
}

/** Wheelbarrow at the caravan. Same pace as walk, triple cargo. */
export const CART_GOLD = 20;
/** Home / bench: 8 wood → one cart. */
export const CART_WOOD = 8;
/** Wagon at the caravan. Hitch to a horse. Never a bag item. */
export const WAGON_GOLD = 48;
/** Padlock at the caravan. Hang on a gate or a chest. */
export const LOCK_GOLD = 16;

function winterBonus(item: ItemId, season: Season): number {
  return season === "winter" && WINTER_PLUS.has(item) ? 1 : 0;
}

export function sellLot(item: ItemId): number {
  return SELL_PACK[item]?.n ?? 1;
}

/** Полные пачки, без округления вверх. Меньше пачки — 0 золота. */
export function sellQuote(
  item: ItemId,
  qty: number,
  season: Season,
  trader: boolean,
): { take: number; gold: number } {
  if (qty <= 0) return { take: 0, gold: 0 };
  const pack = SELL_PACK[item];
  if (pack) {
    const packs = Math.floor(qty / pack.n);
    if (packs <= 0) return { take: 0, gold: 0 };
    const take = packs * pack.n;
    let gold = packs * pack.gold;
    if (trader) gold += packs;
    gold += packs * winterBonus(item, season);
    return { take, gold };
  }
  const unit = (SELL_GOLD[item] ?? 0) + winterBonus(item, season);
  return { take: qty, gold: unit * qty };
}

export function seasonPrice(item: ItemId, season: Season): number {
  return sellQuote(item, 1, season, false).gold;
}

/** Золото за одну пачку сырья или за штуку готового. */
export function caravanBuy(item: ItemId, season: Season, trader: boolean): number {
  return sellQuote(item, sellLot(item), season, trader).gold;
}

export function caravanSell(item: ItemId, _season: Season): number {
  return BUY_GOLD[item] ?? 1;
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
  return zeroInv();
}

export function makeTrader(week: number): Trader {
  const demand = zInv();
  demand.wood = 16;
  demand.stone = 10;
  demand.food = 8;
  demand.fish = 6;
  demand.ore = 4;
  demand.herb = 10;
  demand.clay = 12;
  demand.crystal = 2;
  demand.axe = 1;
  demand.plank = 6;
  demand.bread = 6;
  demand.smoked = 5;
  demand.coal = 9;
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
  if (week % 3 === 0) wares.knife = 1;
  if (week % 4 === 0) wares.helm = 1;
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
