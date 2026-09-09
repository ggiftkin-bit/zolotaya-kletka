import type { BuildingKind, GameState, Skills } from "./types";

export function personLevel(skills: Skills): number {
  let sum = 0;
  for (const n of Object.values(skills)) sum += n;
  return Math.max(1, 1 + Math.floor(sum / 2));
}

export const BUILD_HINT: Record<Exclude<BuildingKind, "none">, string> = {
  shack: "сон, верёвка, копьё, удочка",
  house: "крепкий сон, сундук",
  field: "растёт зерно",
  pen: "коровы, молоко",
  stable: "лошади",
  well: "вода вокруг",
  workshop: "верстак",
  shop: "продаёт из тайника",
  board: "знак у тракта. Повесить заказ на калитку",
  mine: "руда",
  tower: "смотрит ночь, не стреляет",
  bench: "доска · плотник",
  forge: "слиток, топор, кирка, замок · кузнец",
  oven: "мука · любой, хлеб · пекарь",
  mill: "2 зерна → 2 муки · любой",
  sawmill: "3 дерева → 2 доски · любой",
  smoke: "копчёное · рыбак",
  herbs: "настой · целитель",
  stall: "прилавок у калитки",
  coalpit: "уголь · дровосек",
  adit: "руда у горы",
  shed: "склад, сундук",
  jail: "яма. Без закона не сажают",
  stakes: "колья снаружи тына",
  moat: "ров как река. Нужен мост",
  net: "сеть на берегу. Ловят без удочки",
  camp: "костёр в поле. Готовить и греться без дома",
  hall: "зал поляны. Контора. Мир",
};

export function nextGoal(s: GameState): string {
  const c = s.character;
  const inv = c.inventory;
  const here = s.world.tiles[c.y * s.world.width + c.x];
  const roofNow = here && (here.building === "shack" || here.building === "house") && !here.burned;
  const ownRoof = s.world.tiles.some(
    (t) =>
      (t.building === "shack" || t.building === "house") &&
      !t.burned &&
      (!t.owner || t.owner === "you"),
  );
  const wet = s.weather === "rain" || s.weather === "snow";
  if ((c.stillUntil ?? 0) > Date.now() && c.life === "alive") return "Отлёживаешься. Сутки без хода";
  if (c.life === "dead") return "Погиб. Двор стоит";
  if (c.life === "down") {
    if (roofNow) return "Упал. Под крышей поднимешься";
    return ownRoof ? "Упал. Дойди до шалаша — там поднимешься" : "Упал. Нужна крыша";
  }
  if (!roofNow && (c.warmth < 35 || ((s.phase === "night" || wet) && c.warmth < 70))) {
    if (ownRoof) return "Зайди в шалаш — там тепло и сон";
    return "Холодно. Нужен шалаш";
  }
  if (c.satiety < 25) return roofNow ? "Голоден. Съешь" : "Голоден. Съешь из сумки";
  if (c.energy < 1) return roofNow ? "Силы нет. Нажми Спать" : "Силы нет. Лечь дома или кружка";
  if (c.hp < 50) return "Слаб. Крыша и настой";
  const own = s.world.tiles.some((t) => t.plot && t.owner === "you");
  if (!own) return "Застолби двор — два угла в режиме Двор";
  if (here?.building === "board" && !here.burned) {
    return "Доска: нажми Повесить. Заказ — на калитку или склад, не на этот столб";
  }
  if ((inv.wood >= 12 || (inv.plank ?? 0) >= 4) && c.gold < 40) return "Сдай лишнее в лавку";
  const hasBoard = s.world.tiles.some(
    (t) => t.building === "board" && !t.burned && (t.owner === "you" || (!t.owner && !t.plot)),
  );
  if (!hasBoard && (inv.wood ?? 0) >= 6) return "Вбей доску у тракта — там лист заказов";
  const hasJob = s.world.tiles.some((t) => t.service?.by === "you" || (t.order && t.owner === "you"));
  if (hasBoard && !hasJob) return "Открой доску → Повесить. Цель — калитка, не столб";
  if (c.village) return `Староста · ${c.village}`;
  return "";
}

export function skillHow(key: keyof Skills): string {
  const map: Record<string, string> = {
    survival: "лес, охота, рыба",
    craft: "своё ремесло профессии",
    build: "столб, дорога, дом, забор",
    trade: "лавка",
    agro: "поле, загон, лошадь",
    mine: "горы и жила",
    fight: "охота, встреча",
    stealth: "кража, взлом, ночь",
    speech: "пока спит",
    lead: "пока спит",
    law: "пока спит",
    med: "травы, целитель",
  };
  return map[key] ?? "";
}
