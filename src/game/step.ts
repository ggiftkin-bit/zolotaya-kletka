import { canCrossDiag } from "./fence";
import type { Tile, Travel, World } from "./types";
import { isWalkable, tileAt } from "./worldgen";

export const STEP_HINT = "сюда не шагнул";

export function chebyshev(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Если в теле путь — только следующая клетка, не конец маршрута. */
export function nextTravelCell(
  from: { x: number; y: number },
  travel: Travel | null | undefined,
): { x: number; y: number } | null {
  const path = travel?.path;
  if (!path?.length) return null;
  const idx = Math.max(0, Math.min(path.length - 1, Math.floor(Number(travel?.index) || 0)));
  const cur = path[idx];
  if (cur && (cur.x !== from.x || cur.y !== from.y)) return { x: cur.x, y: cur.y };
  const nxt = path[idx + 1];
  return nxt ? { x: nxt.x, y: nxt.y } : null;
}

export function planBookStep(
  world: World,
  from: { x: number; y: number },
  want: { x: number; y: number },
  travel: Travel | null | undefined,
  who: string,
): { x: number; y: number; hint?: string } {
  if (from.x === want.x && from.y === want.y) return from;
  const dest = nextTravelCell(from, travel) ?? want;
  const d = chebyshev(from.x, from.y, dest.x, dest.y);
  if (d === 0) return from;
  if (d > 1) return { ...from, hint: STEP_HINT };
  const tile = tileAt(world, dest.x, dest.y);
  if (!isWalkable(tile, world) || !canCrossDiag(world, from.x, from.y, dest.x, dest.y, who)) {
    return { ...from, hint: STEP_HINT };
  }
  return { x: dest.x, y: dest.y };
}

export function patchStepWorld(width: number, height: number, cells: Tile[]): World {
  const tiles: Tile[] = new Array(width * height);
  for (const t of cells) {
    if (t.x >= 0 && t.y >= 0 && t.x < width && t.y < height) tiles[t.y * width + t.x] = t;
  }
  return { seed: "", width, height, tiles };
}
