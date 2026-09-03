import { canCross, canCrossDiag, edgeBetween } from "./fence";
import { enterCost } from "./travel";
import type { Inventory, Transport, TravelLeg, Weather, World } from "./types";
import { isWalkable, tileAt } from "./worldgen";

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

class MinHeap {
  keys: number[] = [];
  vals: number[] = [];
  size = 0;

  push(k: number, v: number) {
    let i = this.size++;
    this.keys[i] = k;
    this.vals[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number | undefined {
    if (this.size === 0) return undefined;
    const top = this.vals[0];
    const lastK = this.keys[--this.size]!;
    const lastV = this.vals[this.size]!;
    if (this.size > 0) {
      this.keys[0] = lastK;
      this.vals[0] = lastV;
      this.down(0);
    }
    return top;
  }

  private down(i: number) {
    const n = this.size;
    for (;;) {
      let s = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < n && this.keys[l]! < this.keys[s]!) s = l;
      if (r < n && this.keys[r]! < this.keys[s]!) s = r;
      if (s === i) break;
      this.swap(i, s);
      i = s;
    }
  }

  private swap(i: number, j: number) {
    const k = this.keys[i]!;
    const v = this.vals[i]!;
    this.keys[i] = this.keys[j]!;
    this.vals[i] = this.vals[j]!;
    this.keys[j] = k;
    this.vals[j] = v;
  }
}

function octile(ax: number, ay: number, bx: number, by: number) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function stepCost(
  world: World,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  ctx: { transport: Transport; inventory: Inventory; weather: Weather },
): number {
  const from = tileAt(world, fromX, fromY)!;
  const to = tileAt(world, toX, toY)!;
  const diagonal = fromX !== toX && fromY !== toY;
  let step = enterCost(from, to, { ...ctx, diagonal });
  if (edgeBetween(world, fromX, fromY, toX, toY) === "gate") step *= 1.2;
  return step;
}

export function findPath(
  world: World,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  ctx: { transport: Transport; inventory: Inventory; weather: Weather },
): TravelLeg[] | null {
  const w = world.width;
  const h = world.height;
  if (sx === tx && sy === ty) return [];
  const startT = tileAt(world, sx, sy);
  const goalT = tileAt(world, tx, ty);
  if (!isWalkable(startT, world) || !isWalkable(goalT, world)) return null;

  const open = new MinHeap();
  const gScore = new Float64Array(w * h);
  gScore.fill(Infinity);
  const came = new Int32Array(w * h);
  came.fill(-1);
  const closed = new Uint8Array(w * h);

  const si = sy * w + sx;
  gScore[si] = 0;
  open.push(octile(sx, sy, tx, ty), si);

  while (open.size) {
    const current = open.pop();
    if (current === undefined) break;
    if (closed[current]) continue;
    closed[current] = 1;
    const cx = current % w;
    const cy = (current / w) | 0;
    if (cx === tx && cy === ty) {
      const legs: TravelLeg[] = [];
      let i = current;
      while (i !== si && i >= 0) {
        const x = i % w;
        const y = (i / w) | 0;
        const prev = came[i]!;
        const px = prev % w;
        const py = (prev / w) | 0;
        const cost = stepCost(world, px, py, x, y, ctx);
        legs.push({ x, y, cost });
        i = prev;
      }
      legs.reverse();
      return legs;
    }

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (dx !== 0 && dy !== 0) {
        const a = tileAt(world, cx + dx, cy);
        const b = tileAt(world, cx, cy + dy);
        if (!isWalkable(a, world) || !isWalkable(b, world)) continue;
        if (!canCrossDiag(world, cx, cy, nx, ny)) continue;
      } else if (!canCross(world, cx, cy, nx, ny)) {
        continue;
      }
      const to = tileAt(world, nx, ny)!;
      if (!isWalkable(to, world)) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const step = stepCost(world, cx, cy, nx, ny, ctx);
      if (!Number.isFinite(step)) continue;
      const ng = gScore[current]! + step;
      if (ng >= gScore[ni]!) continue;
      gScore[ni] = ng;
      came[ni] = current;
      open.push(ng + octile(nx, ny, tx, ty) * BASE_HEUR, ni);
    }
  }
  return null;
}

const BASE_HEUR = 0.35;

export function pathTotal(path: TravelLeg[]): number {
  return path.reduce((s, l) => s + l.cost, 0);
}
