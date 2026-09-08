import { ITEM_LABEL } from "./constants";
import { BUILDING_LABEL } from "./economy";
import { ownerFace } from "./pact";
import { asPile, pileLabel, pileTotal } from "./pile";
import type { ItemId, OtherPawn, Tile, World } from "./types";
import { canFishOn } from "./work";

export type Loot = {
  id: string;
  kind: "resource" | "pile";
  item: ItemId;
  n: number;
  label: string;
};

export function lootOn(tile: Tile): Loot[] {
  const out: Loot[] = [];
  const pile = asPile(tile.pile);
  if (pileTotal(pile) > 0) {
    out.push({
      id: "pile",
      kind: "pile",
      item: (Object.keys(pile) as ItemId[]).find((k) => (pile[k] ?? 0) > 0) ?? "wood",
      n: pileTotal(pile),
      label: `На клетке ${pileLabel(pile)}`,
    });
  }
  if (tile.goldDrop > 0) {
    out.push({
      id: "gold",
      kind: "pile",
      item: "wood",
      n: tile.goldDrop,
      label: `На клетке золото ×${tile.goldDrop}`,
    });
  }
  if (tile.resource && tile.amount > 0 && tile.resource !== "fish") {
    out.push({
      id: "res",
      kind: "resource",
      item: tile.resource,
      n: tile.amount,
      label: tile.resource === "herb" ? `Трава ×${tile.amount} · нарвать` : `${ITEM_LABEL[tile.resource]} ×${tile.amount}`,
    });
  }
  return out;
}

export function canOpenPlace(tile: Tile) {
  return tile.caravan || tile.building !== "none";
}

export function placeTitle(tile: Tile, others: OtherPawn[] = []) {
  if (tile.caravan) return "Лавка на тракте";
  if (tile.bank && tile.building === "none") return "берег";
  if (tile.wagon) {
    if (tile.building !== "none") return `${BUILDING_LABEL[tile.building]} · телега`;
    return tile.wagon === "you" ? "Телега" : `Телега · ${tile.wagon}`;
  }
  if (tile.cart) {
    if (tile.building !== "none") return `${BUILDING_LABEL[tile.building]} · тачка`;
    return tile.cart === "you" ? "Тачка" : `Тачка · ${tile.cart}`;
  }
  if (tile.horse) {
    if (tile.building !== "none") return `${BUILDING_LABEL[tile.building]} · лошадь`;
    return tile.horse === "you" ? "Лошадь" : `Лошадь · ${tile.horse}`;
  }
  if (tile.building === "none") return "";
  const lock =
    tile.chestLock || tile.gateLock ? " · на замке" : "";
  if (tile.owner && tile.owner !== "you") return `${BUILDING_LABEL[tile.building]} · ${ownerFace(tile.owner, others) || "чужой"}${lock}`;
  return BUILDING_LABEL[tile.building] + lock;
}

export function placeHint(tile: Tile) {
  if (tile.caravan) return "Тачка и лошадь стоят на клетке, не в сумке. Телега 48, замок 16. Сырьё пачкой. Дверь — контора.";
  switch (tile.building) {
    case "shack":
      return "Сон, очаг, простое ремесло. Сундук. Замок — кузнец или лавка.";
    case "house":
      return "Крепкий сон, очаг, ремесло, сундук. Замок держит чужих.";
    case "workshop":
    case "bench":
      return "Верстак. Доска и колесо — плотник. Телега: 2 колеса, 4 дерева, слиток. В сумку не кладётся.";
    case "forge":
      return "Горн. Руда+2 угля → слиток, топор, кирка, замок. Без воды дольше.";
    case "oven":
      return "Печь. 2 муки → хлеб. Мука — 2 зерна, любой, дом или печь. Без воды дольше.";
    case "smoke":
      return "Коптильня. Рыба + дерево → копчёное.";
    case "herbs":
      return "Стол трав. 3 травы → настой.";
    case "coalpit":
      return "Дровница. 4 дерева → 1 уголь.";
    case "stall":
      return tile.owner === "you"
        ? "Твой прилавок. Положи вещь и цену словом. Вторая почта берёт в пятне."
        : "Чужой прилавок. Встань рядом — возьми, если хватает золота.";
    case "shop":
      return tile.owner === "you" ? "Твоя лавка. Товар из тайника, выручка сверху." : "Чужая лавка. Смотри, что продают и что берут.";
    case "field":
      return "Урожай или засев.";
    case "pen":
    case "stable":
      return "Корм и вода для живности.";
    case "well":
      return "Ведро сюда.";
    case "board":
      if (tile.burned) return "Обгорела. Листа нет. Головешку можно разобрать.";
      return tile.village
        ? "Знак на дороге. Заказы хозяина столба и этой улицы. Цель — клетка дела. Сюда услугу не вешают."
        : "Знак на дороге. Заказы хозяина столба. Без имени лист не пуст, если висят заказы. Сюда услугу не вешают.";
    case "mine":
    case "adit":
      return "Добыча из жилы.";
    case "shed":
      return "Склад. Сундук, ноша не весит.";
    case "jail":
      return "Яма. Сажают только по закону.";
    case "tower":
      return "Дозор. Не стреляет. Отдых на посту.";
    case "stakes":
      return "Колья снаружи тына.";
    case "moat":
      return "Ров. Как река — только мостом.";
    case "net":
      return "Сеть на берегу. Ловят стоя на клетке, удочка не нужна.";
    case "camp":
      return "Костёр. Греет рядом. Готовить — еда и полено. Спать нельзя.";
    default:
      return "";
  }
}

export function wildActs(tile: Tile, world: World) {
  const acts: Array<{ id: string; label: string; sub: string }> = [];
  if (tile.herd && tile.herd.wild && (tile.herd.kind === "hare" || tile.herd.kind === "deer")) {
    acts.push({ id: "hunt", label: "Охота", sub: "ждёт · копьё быстрее" });
  }
  if (tile.herd && tile.herd.wild && tile.herd.kind === "horse") {
    acts.push({ id: "catch", label: "Ловить лошадь", sub: "верёвка в руке" });
  }
  if (canFishOn(world, tile)) {
    acts.push({ id: "fish", label: "Рыба", sub: tile.building === "net" ? "сеть · стой здесь" : "удочка · дерево + верёвка дома" });
  }
  return acts;
}
