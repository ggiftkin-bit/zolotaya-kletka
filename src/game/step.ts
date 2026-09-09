import { canCrossDiag } from "./fence";
import type { Tile, Travel, TravelLeg, World } from "./types";
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

function at(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x === b.x && a.y === b.y;
}

function stepOk(
  world: World,
  from: { x: number; y: number },
  to: { x: number; y: number },
  who: string,
): boolean {
  if (at(from, to)) return true;
  if (chebyshev(from.x, from.y, to.x, to.y) !== 1) return false;
  const tile = tileAt(world, to.x, to.y);
  return isWalkable(tile, world) && canCrossDiag(world, from.x, from.y, to.x, to.y, who);
}

/** Путь с клетки книги (или с соседа) шагами по 1. Река и чужой тын — нет. */
function walkBookPath(
  world: World,
  from: { x: number; y: number },
  want: { x: number; y: number },
  path: TravelLeg[],
  who: string,
): { x: number; y: number } | null {
  const legs = path.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!legs.length) return null;
  const on = legs.findIndex((p) => at(p, from));
  const seq: Array<{ x: number; y: number }> =
    on >= 0 ? [from, ...legs.slice(on + 1)] : chebyshev(from.x, from.y, legs[0]!.x, legs[0]!.y) <= 1 ? [from, ...legs] : [];
  if (!seq.length) return null;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1]!;
    const b = seq[i]!;
    if (!stepOk(world, a, b, who)) return null;
    if (at(b, want)) return { x: want.x, y: want.y };
  }
  return seq.some((p) => at(p, want)) ? { x: want.x, y: want.y } : null;
}

export function planBookStep(
  world: World,
  from: { x: number; y: number },
  want: { x: number; y: number },
  travel: Travel | null | undefined,
  who: string,
): { x: number; y: number; hint?: string } {
  if (from.x === want.x && from.y === want.y) return from;
  const path = travel?.path;
  if (path?.length) {
    const landed = walkBookPath(world, from, want, path, who);
    if (landed) return landed;
    return { ...from, hint: STEP_HINT };
  }
  const d = chebyshev(from.x, from.y, want.x, want.y);
  if (d === 0) return from;
  if (d > 1) return { ...from, hint: STEP_HINT };
  if (!stepOk(world, from, want, who)) return { ...from, hint: STEP_HINT };
  return { x: want.x, y: want.y };
}

export function patchStepWorld(width: number, height: number, cells: Tile[]): World {
  const tiles: Tile[] = new Array(width * height);
  for (const t of cells) {
    if (t.x >= 0 && t.y >= 0 && t.x < width && t.y < height) tiles[t.y * width + t.x] = t;
  }
  return { seed: "", width, height, tiles };
}
