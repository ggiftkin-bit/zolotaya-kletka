import type { Character, Tile, World } from "./types";
import { tileAt } from "./worldgen";

export type MountKind = "cart" | "horse" | "wagon";

export const MOUNT_LABEL: Record<MountKind, string> = {
  cart: "тачка",
  horse: "лошадь",
  wagon: "телега",
};

/** Река и ров без моста — не ставят. Туман не смотрим: стоишь на клетке. */
export function canParkOn(tile: Tile | null | undefined): boolean {
  if (!tile) return false;
  if (tile.building === "moat" && tile.road !== "bridge") return false;
  if (tile.biome === "river" && tile.road !== "bridge") return false;
  return true;
}

export function mountBusy(tile: Tile | null | undefined): boolean {
  if (!tile) return true;
  return !!(tile.cart || tile.horse || tile.wagon);
}

export function ownerOfMount(tile: Tile | null | undefined, kind: MountKind): string {
  if (!tile) return "";
  return tile[kind] || "";
}

export function ridingHorse(c: Character): boolean {
  return c.transport === "horse" || c.transport === "wagon" || !!c.wagon;
}

export function ridingKind(c: Character): MountKind | null {
  if (c.wagon || c.transport === "wagon") return "wagon";
  if (c.transport === "cart") return "cart";
  if (c.transport === "horse") return "horse";
  return null;
}

export function ownsMount(world: World, c: Character, kind: MountKind): boolean {
  if (kind === "cart" && c.transport === "cart") return true;
  if (kind === "horse" && ridingHorse(c)) return true;
  if (kind === "wagon" && (c.wagon || c.transport === "wagon")) return true;
  for (const t of world.tiles) {
    if (t[kind] === "you") return true;
  }
  return false;
}

export function countOwn(world: World, c: Character, kind: MountKind): number {
  let n = 0;
  if (kind === "cart" && c.transport === "cart") n += 1;
  if (kind === "horse" && ridingHorse(c)) n += 1;
  if (kind === "wagon" && (c.wagon || c.transport === "wagon")) n += 1;
  for (const t of world.tiles) if (t[kind] === "you") n += 1;
  return n;
}

export function ownNearby(world: World, x: number, y: number, kind: MountKind): Tile | null {
  const here = tileAt(world, x, y);
  if (here && here[kind] === "you") return here;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = tileAt(world, x + dx, y + dy);
      if (t && t[kind] === "you") return t;
    }
  }
  return null;
}

export function mountAt(world: World, x: number, y: number, kind: MountKind): Tile | null {
  const here = tileAt(world, x, y);
  if (here && here[kind]) return here;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = tileAt(world, x + dx, y + dy);
      if (t && t[kind]) return t;
    }
  }
  return null;
}

export function parkNear(world: World, x: number, y: number, kind: MountKind, owner: string): { x: number; y: number } | null {
  const who = owner || "you";
  const tryTile = (tx: number, ty: number) => {
    const t = tileAt(world, tx, ty);
    if (!t || !canParkOn(t) || mountBusy(t)) return false;
    t[kind] = who;
    return true;
  };
  if (tryTile(x, y)) return { x, y };
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (tryTile(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/** Снять с фишки на клетку. Яма, упал, погиб — без них. */
export function stripRidden(
  world: World,
  c: Character,
  x: number,
  y: number,
  owner = "you",
): { c: Character; cells: Array<{ x: number; y: number }> } {
  const cells: Array<{ x: number; y: number }> = [];
  let next = { ...c };
  const wasWagon = next.wagon || next.transport === "wagon";
  if (wasWagon) {
    const at = parkNear(world, x, y, "wagon", owner);
    if (at) cells.push(at);
    next.wagon = false;
  }
  if (next.transport === "cart") {
    const at = parkNear(world, x, y, "cart", owner);
    if (at) cells.push(at);
  }
  if (next.transport === "horse" || wasWagon) {
    const at = parkNear(world, x, y, "horse", owner);
    if (at) cells.push(at);
  }
  next.transport = "walk";
  next.wagon = false;
  return { c: next, cells };
}

/** Старый счёт carts/horses — один раз рядом, обнулить. Едущий экземпляр не дублируем. */
export function settleOldCounts(world: World, c: Character): { character: Character; cells: Array<{ x: number; y: number }> } {
  let carts = Math.max(0, Math.floor(c.carts ?? 0));
  let horses = Math.max(0, Math.floor(c.horses ?? 0));
  if (carts <= 0 && horses <= 0) return { character: c, cells: [] };
  if (c.transport === "cart" && carts > 0) carts -= 1;
  if ((c.transport === "horse" || c.transport === "wagon" || c.wagon) && horses > 0) horses -= 1;
  const cells: Array<{ x: number; y: number }> = [];
  while (carts > 0) {
    const at = parkNear(world, c.x, c.y, "cart", "you");
    if (!at) break;
    cells.push(at);
    carts -= 1;
  }
  while (horses > 0) {
    const at = parkNear(world, c.x, c.y, "horse", "you");
    if (!at) break;
    cells.push(at);
    horses -= 1;
  }
  return { character: { ...c, carts: 0, horses: 0 }, cells };
}

export function takeOwnMount(tile: Tile, kind: MountKind): boolean {
  if (tile[kind] !== "you") return false;
  tile[kind] = "";
  return true;
}

export function claimMount(tile: Tile, kind: MountKind, owner = "you"): boolean {
  if (!tile[kind] || tile[kind] === owner) return false;
  tile[kind] = owner;
  return true;
}
