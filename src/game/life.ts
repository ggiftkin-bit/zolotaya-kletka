import type { AnimalKind, BuildingKind, GameState, Herd, Tile, World } from "./types";
import { tileAt } from "./worldgen";

export const ANIMAL_LABEL: Record<AnimalKind, string> = {
  hare: "заяц",
  deer: "олень",
  horse: "лошадь",
  cow: "корова",
};

export const TOOL_ITEMS = ["axe", "pick", "rope", "bucket", "spear", "shovel", "rod", "club", "knife"] as const;

export const COW_PRICE = 32;
export const HORSE_PRICE = 40;

export function nearWater(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(world, x + dx, y + dy);
      if (!t) continue;
      if (t.biome === "river" || t.biome === "ford") return true;
      if (t.building === "well" || t.building === "moat") return true;
    }
  }
  return false;
}

export function isWatered(world: World, tile: Tile): boolean {
  return (tile.cistern ?? 0) > 0 || nearWater(world, tile.x, tile.y);
}

export function waterHint(world: World, tile: Tile): string {
  if (tile.biome === "river" || tile.biome === "ford") return "вода здесь";
  if (nearWater(world, tile.x, tile.y)) return "вода рядом — само течёт";
  if ((tile.cistern ?? 0) > 0) return `бочка ${tile.cistern}`;
  return "сухо · ведро, колодец или река";
}

export function needsWater(kind: BuildingKind): boolean {
  return kind === "field" || kind === "pen" || kind === "house" || kind === "shack" || kind === "stable";
}

export function makeHerd(kind: AnimalKind, count: number, wild: boolean): Herd {
  return { kind, count, wild, hunger: 0 };
}

export function tickDayLife(world: World, season: GameState["season"]): string[] {
  const notes: string[] = [];
  for (const t of world.tiles) {
    if (t.cistern > 0) t.cistern -= 1;
    const wet = isWatered(world, t);
    const herd = t.herd;
    if (!herd || herd.count <= 0) {
      if (herd) t.herd = null;
      continue;
    }
    if (herd.wild) continue;
    if (t.building !== "pen" && t.building !== "stable") continue;
    const chest = t.chest;
    const feed = chest.herb > 0 ? "herb" : chest.food > 0 ? "food" : null;
    if (feed) {
      chest[feed] -= 1;
      herd.hunger = 0;
    } else {
      herd.hunger += 1;
    }
    if (herd.kind === "cow" && t.building === "pen") {
      herd.age = (herd.age ?? 0) + 1;
      if (herd.age >= 36) {
        herd.count = 0;
        t.herd = null;
        notes.push("корова пала");
        continue;
      }
      if (feed && wet) {
        const old = herd.age >= 24;
        const milk = old ? (season === "winter" ? 0 : 1) : season === "winter" ? 1 : 2;
        if (milk > 0) {
          chest.food += milk;
          if (notes.length < 2) notes.push(old ? `Корова слабее. Молока +${milk}.` : `Коровы дали молоко (+${milk} еды).`);
        } else if (notes.length < 2) notes.push("Корова стара. Зимой молока нет.");
      } else if (!wet && feed) {
        if (notes.length < 2) notes.push("Загон без воды — молока нет. Колодец, река или ведро.");
      }
    }
    if (herd.hunger >= 4) {
      herd.count -= 1;
      herd.hunger = 2;
      notes.push(`${ANIMAL_LABEL[herd.kind]} ушла без корма.`);
    }
    if (herd.count <= 0) t.herd = null;
  }
  return notes;
}
