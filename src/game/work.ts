import type { BuildingKind, Busy, BusyKind, Character, Matter, Tile, World } from "./types";
import { tileAt } from "./worldgen";

export const MATTER_LABEL: Record<Matter, string> = {
  wattle: "хворост",
  wood: "дерево",
  stone: "камень",
};

export const MATTER_HP: Record<Matter, number> = {
  wattle: 8,
  wood: 20,
  stone: 40,
};

export const BUSY_LABEL: Record<BusyKind, string> = {
  hunt: "охота",
  catch: "ловлю",
  fish: "ловлю рыбу",
  chop: "рублю",
  mine: "долблю",
  forage: "собираю",
  build: "ставлю",
  craft: "делаю",
  dig: "копаю",
  fill: "засыпаю",
  road: "кладу путь",
};

export const TOOL_LIFE = {
  axe: 160,
  pick: 120,
  spear: 60,
  shovel: 80,
  club: 80,
  knife: 50,
} as const;

export type WearId = keyof typeof TOOL_LIFE;

export const TOOL_BREAK: Record<WearId, string> = {
  axe: "топор кончился",
  pick: "кирка кончилась",
  spear: "копьё кончилось",
  shovel: "лопата кончилась",
  club: "дубина кончилась",
  knife: "нож кончился",
};

export const CLAD_STONE = 16;

export function defaultMatter(kind: BuildingKind): Matter {
  if (kind === "none") return "wood";
  if (kind === "shack" || kind === "stakes" || kind === "camp") return "wattle";
  if (kind === "well" || kind === "forge" || kind === "oven" || kind === "jail" || kind === "moat") return "stone";
  return "wood";
}

export function nearCamp(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(world, x + dx, y + dy);
      if (t && t.building === "camp" && !t.burned) return true;
    }
  }
  return false;
}

export function isRoof(tile: Tile | null | undefined): boolean {
  if (!tile) return false;
  if (tile.burned) return false;
  return tile.building === "shack" || tile.building === "house";
}

export function canBurnMatter(m: Matter): boolean {
  return m === "wattle" || m === "wood";
}

export function canFishOn(world: World, tile: Tile): boolean {
  if (tile.building === "net") return true;
  if (tile.biome === "ford") return true;
  if (tile.biome === "river") return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = tileAt(world, tile.x + dx, tile.y + dy);
      if (n && (n.biome === "river" || n.biome === "ford")) return true;
    }
  }
  return false;
}

export function workMs(kind: BusyKind, herdKind: string | null, c: Character): number {
  let sec = 35;
  if (kind === "hunt") sec = herdKind === "deer" ? 45 : 25;
  if (kind === "catch") sec = 40;
  if (kind === "fish") sec = 35;
  if (kind === "chop") sec = c.hand === "axe" ? 12 : 20;
  if (kind === "mine") sec = c.hand === "pick" ? 14 : 22;
  if (kind === "forage") sec = 7;
  if (kind === "dig") sec = 18;
  if (kind === "fill") sec = 14;
  if (kind === "build") sec = 28;
  if (kind === "craft") sec = 14;
  if (kind === "road") sec = 16;
  if (kind === "hunt" && c.hand === "spear") sec *= 0.7;
  if (kind === "catch" && c.hand === "rope") sec *= 0.85;
  if (kind === "fish" && c.hand === "rod") sec *= 0.8;
  const skill =
    kind === "catch"
      ? c.skills.agro
      : kind === "hunt"
        ? c.skills.fight + c.skills.survival
        : kind === "build"
          ? c.skills.build
          : kind === "craft"
            ? c.skills.craft
            : kind === "mine" || kind === "dig"
              ? c.skills.mine
              : c.skills.survival;
  sec *= Math.max(0.6, 1 - skill * 0.03);
  return Math.round(sec * 1000);
}

export function buildMs(kind: BuildingKind, c: Character): number {
  let sec = 28;
  if (kind === "shack" || kind === "stakes" || kind === "field" || kind === "herbs" || kind === "coalpit" || kind === "camp" || kind === "net") sec = 18;
  if (kind === "house") sec = 42;
  if (kind === "well" || kind === "forge" || kind === "oven" || kind === "jail" || kind === "moat") sec = 48;
  if (kind === "tower") sec = 40;
  sec *= Math.max(0.6, 1 - c.skills.build * 0.03);
  return Math.round(sec * 1000);
}

export function craftMs(energy: number, slow: boolean, c: Character): number {
  let sec = 8 + energy * 6;
  if (slow) sec += 8;
  sec *= Math.max(0.6, 1 - c.skills.craft * 0.03);
  return Math.round(sec * 1000);
}

export function makeBusy(
  kind: BusyKind,
  x: number,
  y: number,
  until: number,
  extra?: Partial<Busy>,
): Busy {
  return { kind, x, y, until, ...extra };
}

export function remainingWear(c: Character, id: WearId): number {
  if (c.hand === id) {
    const n = c.wear?.[id];
    if (typeof n === "number") return n;
    return TOOL_LIFE[id];
  }
  const bag = c.bagWear?.[id];
  if (typeof bag === "number") return bag;
  return TOOL_LIFE[id];
}

export function isWearId(id: string | null | undefined): id is WearId {
  return id === "axe" || id === "pick" || id === "spear" || id === "shovel" || id === "club" || id === "knife";
}

/** Минус одно использование в начале дела. На нуле вещь пропадает. Удар с руки. */
export function useTool(
  c: Character,
  id: WearId,
): { c: Character; broke: boolean; missing: boolean } {
  if ((c.inventory[id] ?? 0) <= 0 && c.hand !== id) return { c, broke: false, missing: true };
  const wear = { ...(c.wear ?? {}) };
  const bagWear = { ...(c.bagWear ?? {}) };
  const inHand = c.hand === id;
  const current = inHand ? (typeof wear[id] === "number" ? wear[id]! : TOOL_LIFE[id]) : (bagWear[id] ?? TOOL_LIFE[id]);
  const left = current - 1;
  if (left > 0) {
    if (inHand) wear[id] = left;
    else bagWear[id] = left;
    return { c: { ...c, wear, bagWear }, broke: false, missing: false };
  }
  const inv = { ...c.inventory, [id]: Math.max(0, (c.inventory[id] ?? 0) - 1) };
  let hand = c.hand;
  if (inv[id] > 0) {
    const next = bagWear[id] ?? TOOL_LIFE[id];
    delete bagWear[id];
    if (inHand) wear[id] = next;
  } else {
    wear[id] = 0;
    delete bagWear[id];
    if (hand === id) hand = null;
  }
  return { c: { ...c, inventory: inv, hand, wear, bagWear }, broke: true, missing: false };
}

export function burnableFence(tile: Tile, world: World): { side: "n" | "w" | "s" | "e" } | null {
  if (tile.fenceN === "wood" || tile.fenceN === "palisade") return { side: "n" };
  if (tile.fenceW === "wood" || tile.fenceW === "palisade") return { side: "w" };
  const south = tileAt(world, tile.x, tile.y + 1);
  if (south && (south.fenceN === "wood" || south.fenceN === "palisade")) return { side: "s" };
  const east = tileAt(world, tile.x + 1, tile.y);
  if (east && (east.fenceW === "wood" || east.fenceW === "palisade")) return { side: "e" };
  return null;
}

export function stoneFence(tile: Tile, world: World): boolean {
  if (tile.fenceN === "wall" || tile.fenceW === "wall") return true;
  const south = tileAt(world, tile.x, tile.y + 1);
  if (south?.fenceN === "wall") return true;
  const east = tileAt(world, tile.x + 1, tile.y);
  if (east?.fenceW === "wall") return true;
  return false;
}

export function applyFenceBurn(tile: Tile, world: World, side: "n" | "w" | "s" | "e") {
  if (side === "n") tile.fenceN = "none";
  else if (side === "w") tile.fenceW = "none";
  else if (side === "s") {
    const south = tileAt(world, tile.x, tile.y + 1);
    if (south) south.fenceN = "none";
  } else {
    const east = tileAt(world, tile.x + 1, tile.y);
    if (east) east.fenceW = "none";
  }
}
