import type { FenceKind, Tile, World } from "./types";
import { asPile, pileSet } from "./pile";
import { tileAt } from "./worldgen";

export const FENCE_LABEL: Record<FenceKind, string> = {
  none: "нет",
  wood: "тын",
  palisade: "частокол",
  wall: "стена",
  gate: "калитка",
};

export const FENCE_STR: Record<FenceKind, number> = {
  none: 0,
  gate: 1,
  wood: 2,
  palisade: 4,
  wall: 6,
};

export const MAX_PLOT = 6;

export function normRect(ax: number, ay: number, bx: number, by: number) {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function edgeCount(w: number, h: number) {
  return 2 * (w + h);
}

export function yardWoodCost(w: number, h: number) {
  return edgeCount(w, h);
}

export function fenceOn(tile: Tile | null, side: "n" | "w"): FenceKind {
  if (!tile) return "none";
  return side === "n" ? tile.fenceN : tile.fenceW;
}

export function edgeBetween(world: World, ax: number, ay: number, bx: number, by: number): FenceKind {
  if (bx === ax && by === ay - 1) return fenceOn(tileAt(world, ax, ay), "n");
  if (bx === ax && by === ay + 1) return fenceOn(tileAt(world, ax, ay + 1), "n");
  if (by === ay && bx === ax - 1) return fenceOn(tileAt(world, ax, ay), "w");
  if (by === ay && bx === ax + 1) return fenceOn(tileAt(world, ax + 1, ay), "w");
  return "none";
}

export function fenceBlocks(kind: FenceKind): boolean {
  return kind === "wood" || kind === "palisade" || kind === "wall";
}

/** Orthogonal step. Gate is the only hole in a yard. A locked gate is a wall to strangers. */
export function canCross(world: World, ax: number, ay: number, bx: number, by: number, who = "you"): boolean {
  const kind = edgeBetween(world, ax, ay, bx, by);
  if (fenceBlocks(kind)) return false;
  if (kind === "gate") {
    const dest = tileAt(world, bx, by);
    if (dest?.plot && dest.gateLock && dest.owner && dest.owner !== who) {
      const src = tileAt(world, ax, ay);
      if (!(src?.plot && src.owner === dest.owner)) return false;
    }
  }
  return true;
}

/** Diagonal: угол тына — оба кардинальных пути. Река на угле сушу не режет. */
export function canCrossDiag(world: World, ax: number, ay: number, bx: number, by: number, who = "you"): boolean {
  if (ax === bx || ay === by) return canCross(world, ax, ay, bx, by, who);
  const mx = bx;
  const my = ay;
  const nx = ax;
  const ny = by;
  const viaX = canCross(world, ax, ay, mx, my, who) && canCross(world, mx, my, bx, by, who);
  const viaY = canCross(world, ax, ay, nx, ny, who) && canCross(world, nx, ny, bx, by, who);
  return viaX && viaY;
}

export function setEdge(world: World, ax: number, ay: number, bx: number, by: number, kind: FenceKind) {
  if (bx === ax && by === ay - 1) {
    const t = tileAt(world, ax, ay);
    if (t) t.fenceN = kind;
  } else if (bx === ax && by === ay + 1) {
    const t = tileAt(world, ax, ay + 1);
    if (t) t.fenceN = kind;
  } else if (by === ay && bx === ax - 1) {
    const t = tileAt(world, ax, ay);
    if (t) t.fenceW = kind;
  } else if (by === ay && bx === ax + 1) {
    const t = tileAt(world, ax + 1, ay);
    if (t) t.fenceW = kind;
  }
}

export function stampYard(world: World, x0: number, y0: number, x1: number, y1: number, gateX: number, gateY: number) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = tileAt(world, x, y);
      if (!t) continue;
      t.owned = true;
      t.plot = true;
      t.owner = t.owner || "you";
    }
  }
  for (let x = x0; x <= x1; x++) {
    const top = tileAt(world, x, y0);
    if (top) top.fenceN = "wood";
    const bot = tileAt(world, x, y1 + 1);
    if (bot) bot.fenceN = "wood";
  }
  for (let y = y0; y <= y1; y++) {
    const left = tileAt(world, x0, y);
    if (left) left.fenceW = "wood";
    const right = tileAt(world, x1 + 1, y);
    if (right) right.fenceW = "wood";
  }
  const gx = Math.min(x1, Math.max(x0, gateX));
  const gy = Math.min(y1, Math.max(y0, gateY));
  let best: [number, number, number, number] | null = null;
  let bestD = 99;
  const tryEdge = (ax: number, ay: number, bx: number, by: number) => {
    const d = Math.abs(ax - gateX) + Math.abs(ay - gateY);
    if (d < bestD) {
      bestD = d;
      best = [ax, ay, bx, by];
    }
  };
  tryEdge(gx, y0, gx, y0 - 1);
  tryEdge(gx, y1, gx, y1 + 1);
  tryEdge(x0, gy, x0 - 1, gy);
  tryEdge(x1, gy, x1 + 1, gy);
  if (best) setEdge(world, best[0], best[1], best[2], best[3], "gate");
  void gy;
}

export function plotBounds(world: World, x: number, y: number) {
  const start = tileAt(world, x, y);
  if (!start?.plot) return null;
  let x0 = x;
  let x1 = x;
  let y0 = y;
  let y1 = y;
  while (tileAt(world, x0 - 1, y)?.plot) x0 -= 1;
  while (tileAt(world, x1 + 1, y)?.plot) x1 += 1;
  while (tileAt(world, x, y0 - 1)?.plot) y0 -= 1;
  while (tileAt(world, x, y1 + 1)?.plot) y1 += 1;
  return { x0, y0, x1, y1 };
}

export function yardSealed(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let x = x0; x <= x1; x++) {
    if (FENCE_STR[fenceOn(tileAt(world, x, y0), "n")] <= 0) return false;
    if (FENCE_STR[fenceOn(tileAt(world, x, y1 + 1), "n")] <= 0) return false;
  }
  for (let y = y0; y <= y1; y++) {
    if (FENCE_STR[fenceOn(tileAt(world, x0, y), "w")] <= 0) return false;
    if (FENCE_STR[fenceOn(tileAt(world, x1 + 1, y), "w")] <= 0) return false;
  }
  return true;
}

export function yardStrength(world: World, x0: number, y0: number, x1: number, y1: number): number {
  if (!yardSealed(world, x0, y0, x1, y1)) return 0;
  let min = 99;
  const consider = (k: FenceKind) => {
    if (k === "none") min = 0;
    else min = Math.min(min, FENCE_STR[k]);
  };
  for (let x = x0; x <= x1; x++) {
    consider(fenceOn(tileAt(world, x, y0), "n"));
    consider(fenceOn(tileAt(world, x, y1 + 1), "n"));
  }
  for (let y = y0; y <= y1; y++) {
    consider(fenceOn(tileAt(world, x0, y), "w"));
    consider(fenceOn(tileAt(world, x1 + 1, y), "w"));
  }
  let tower = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (tileAt(world, x, y)?.building === "tower") tower += 3;
    }
  }
  return (min === 99 ? 0 : min) + tower;
}

export function upgradeYard(world: World, x0: number, y0: number, x1: number, y1: number, to: "palisade" | "wall") {
  const bump = (t: Tile | null, side: "n" | "w") => {
    if (!t) return;
    const cur = side === "n" ? t.fenceN : t.fenceW;
    if (cur === "none" || cur === "gate") return;
    if (side === "n") t.fenceN = to;
    else t.fenceW = to;
  };
  for (let x = x0; x <= x1; x++) {
    bump(tileAt(world, x, y0), "n");
    bump(tileAt(world, x, y1 + 1), "n");
  }
  for (let y = y0; y <= y1; y++) {
    bump(tileAt(world, x0, y), "w");
    bump(tileAt(world, x1 + 1, y), "w");
  }
}

export function clearYard(world: World, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = tileAt(world, x, y);
      if (!t) continue;
      t.plot = false;
      t.gateLock = false;
      if (t.building === "none") t.owned = false;
    }
  }
  for (let x = x0; x <= x1; x++) {
    const top = tileAt(world, x, y0);
    if (top) top.fenceN = "none";
    const bot = tileAt(world, x, y1 + 1);
    if (bot) bot.fenceN = "none";
  }
  for (let y = y0; y <= y1; y++) {
    const left = tileAt(world, x0, y);
    if (left) left.fenceW = "none";
    const right = tileAt(world, x1 + 1, y);
    if (right) right.fenceW = "none";
  }
}

export function putGate(world: World, x: number, y: number) {
  const b = plotBounds(world, x, y);
  if (!b) return false;
  const { x0, y0, x1, y1 } = b;
  if (y === y0) {
    const t = tileAt(world, x, y0);
    if (t) t.fenceN = "gate";
    return true;
  }
  if (y === y1) {
    const t = tileAt(world, x, y1 + 1);
    if (t) t.fenceN = "gate";
    return true;
  }
  if (x === x0) {
    const t = tileAt(world, x0, y);
    if (t) t.fenceW = "gate";
    return true;
  }
  if (x === x1) {
    const t = tileAt(world, x1 + 1, y);
    if (t) t.fenceW = "gate";
    return true;
  }
  return false;
}

export function setYardGateLock(world: World, x: number, y: number, on: boolean): boolean {
  const b = plotBounds(world, x, y);
  if (!b) return false;
  for (let yy = b.y0; yy <= b.y1; yy++) {
    for (let xx = b.x0; xx <= b.x1; xx++) {
      const t = tileAt(world, xx, yy);
      if (t) t.gateLock = on;
    }
  }
  return true;
}

const LOOT: Array<"food" | "wood" | "herb" | "fish"> = ["food", "wood", "herb", "fish"];

export function raidNight(world: World, gold: number): { gold: number; notes: string[] } {
  const notes: string[] = [];
  let nextGold = gold;
  const seen = new Set<string>();
  for (const t of world.tiles) {
    if (!t.plot && !t.owned) {
      const pile = asPile(t.pile);
      const keys = (Object.keys(pile) as Array<keyof typeof pile>).filter((k) => (pile[k] ?? 0) > 0);
      if (keys.length && Math.random() < 0.22) {
        const item = keys[0]!;
        const n = Math.min(pile[item] ?? 0, 1 + Math.floor(Math.random() * 3));
        pile[item] = (pile[item] ?? 0) - n;
        if ((pile[item] ?? 0) <= 0) delete pile[item];
        pileSet(t, pile);
        notes.push(`Ночью с кучи утащили ${n}. Двор без забора не держит.`);
      }
      continue;
    }
    const b = plotBounds(world, t.x, t.y);
    const key = b ? `${b.x0},${b.y0}` : `o${t.x},${t.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const str = b ? yardStrength(world, b.x0, b.y0, b.x1, b.y1) : 0;
    const chance = Math.max(0.04, 0.42 / (1 + str));
    if (Math.random() > chance) continue;
    const stealFrom = b
      ? world.tiles.filter((q) => q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1)
      : [t];
    if (stealFrom.some((q) => q.gateLock)) continue;
    let took = false;
    for (const q of stealFrom) {
      if (q.chestLock) continue;
      const chest = q.chest;
      const item = LOOT.find((k) => (chest[k] ?? 0) > 0);
      if (item) {
        const n = Math.min(chest[item], 1 + Math.floor(Math.random() * 3));
        chest[item] -= n;
        notes.push(
          str > 0
            ? `Набег. Через калитку унесли ${n} ${item}. Частокол/стена держат лучше.`
            : `Набег на открытый двор. Унесли ${n} ${item}. Поставь забор.`,
        );
        took = true;
        break;
      }
      if (q.building === "field" && q.amount > 0) {
        const n = Math.min(q.amount, 2);
        q.amount -= n;
        notes.push(`Набег. С поля сняли ${n} еды.`);
        took = true;
        break;
      }
    }
    if (!took && nextGold > 0 && Math.random() < 0.4) {
      const n = Math.min(nextGold, 4 + Math.floor(Math.random() * 6));
      nextGold -= n;
      notes.push(`Набег. Срезали кошель на ${n} золота. Башня и стена снижают риск.`);
    }
  }
  return { gold: nextGold, notes: notes.slice(0, 3) };
}
