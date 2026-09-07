import type { Character, Tile, World } from "./types";

export const PACT_LABEL = {
  friend: "друг",
  feud: "вражда",
  village: "деревня",
} as const;

/** 2×2 куст у поляны: 3×3 дворы, щель 1, Чебышёв между краями = 2. */
export const HAMLETS = [
  { owner: "сосед", title: "Хутор соседа", dx: -10, dy: 6, w: 3, h: 3, shop: true },
  { owner: "Игнат", title: "Хутор Игната", dx: -6, dy: 6, w: 3, h: 3, shop: false },
  { owner: "Маша", title: "Хутор Маши", dx: -10, dy: 10, w: 3, h: 3, shop: false },
  { owner: "Степан", title: "Хутор Степана", dx: -6, dy: 10, w: 3, h: 3, shop: false },
] as const;

const HAMLET_OWNER = new Set<string>(HAMLETS.map((h) => h.owner));

/** Свободное 4×4 под двор игрока — вплотную к кусту. */
export const PLAYER_FIELD = { dx: -8, dy: 1, w: 4, h: 4 } as const;

export function hamletTitle(owner: string): string {
  return HAMLETS.find((h) => h.owner === owner)?.title ?? owner;
}

export function isHamletOwner(owner: string): boolean {
  return HAMLET_OWNER.has(owner);
}

/** Живая почта или «you». Хутор — нет. */
export function isLivingOwner(owner: string): boolean {
  return !!owner && !HAMLET_OWNER.has(owner);
}

export function friendNames(pacts: Character["pacts"]): string[] {
  return Object.entries(pacts)
    .filter(([, v]) => v === "friend")
    .map(([k]) => k);
}

export function hasOwnYard(world: World): boolean {
  return world.tiles.some((t) => t.plot && t.owner === "you");
}

function chebyshev(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function yardTiles(world: World, owner: string) {
  return world.tiles.filter((t) => t.plot && t.owner === owner);
}

export function yardsTouch(world: World, a: string, b: string): boolean {
  const ta = yardTiles(world, a);
  const tb = yardTiles(world, b);
  for (const x of ta) {
    for (const y of tb) {
      if (chebyshev(x.x, x.y, y.x, y.y) <= 2) return true;
    }
  }
  return false;
}

/** ≥5 дворов (ты + друзья) одной связкой Чебышёв ≤2. */
export function canFoundVillage(world: World, pacts: Character["pacts"]): boolean {
  if (!hasOwnYard(world)) return false;
  const friends = friendNames(pacts);
  if (friends.length < 4) return false;
  const owners = ["you", ...friends];
  const seen = new Set<string>(["you"]);
  const q = ["you"];
  while (q.length) {
    const cur = q.pop()!;
    for (const o of owners) {
      if (seen.has(o)) continue;
      if (yardsTouch(world, cur, o)) {
        seen.add(o);
        q.push(o);
      }
    }
  }
  return seen.size >= 5;
}

export function liveNeighbors(world: World, you = "you"): string[] {
  const others = new Set<string>();
  for (const t of world.tiles) {
    if (t.plot && t.owner && t.owner !== you && isLivingOwner(t.owner)) others.add(t.owner);
  }
  return [...others].filter((o) => yardsTouch(world, you, o));
}

export function canPutLiveName(world: World, you = "you"): boolean {
  if (!hasOwnYard(world)) return false;
  if (villageOf(world, you)) return false;
  return liveNeighbors(world, you).length > 0;
}

export function clusterHint(world: World, pacts: Character["pacts"]): string {
  const friends = friendNames(pacts);
  if (!hasOwnYard(world)) return "Сначала свой двор — два угла.";
  if (villageOf(world, "you")) return "";
  if (canFoundVillage(world, pacts) || canPutLiveName(world)) return "";
  if (friends.length < 4) return `Сход с ${friends.length}/4 друзей хуторов. Или второй двор рядом — имя у калитки.`;
  return "Дворы не в кусте. Свой двор ставь вплотную к хуторам или ко второму двору.";
}

export function normVillageName(raw: string | undefined): string {
  const n = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  return n || "Выселки";
}

export function planFoundOwners(
  world: World,
  pacts: Character["pacts"],
  you = "you",
): { ok: true; owners: string[]; via: "hamlet" | "live" } | { ok: false; hint: string } {
  if (!hasOwnYard(world)) return { ok: false, hint: "Сначала свой двор — два угла." };
  if (villageOf(world, you)) return { ok: false, hint: "Уже в имени." };
  if (canFoundVillage(world, pacts)) return { ok: true, owners: [you, ...friendNames(pacts)], via: "hamlet" };
  if (canPutLiveName(world, you)) return { ok: true, owners: [you], via: "live" };
  return { ok: false, hint: clusterHint(world, pacts) || "Нужен второй двор рядом или 4 друга хуторов." };
}

function paintStreets(world: World, owners: string[], name: string) {
  const plots = world.tiles.filter((t) => t.plot && owners.includes(t.owner));
  if (plots.length === 0) return;
  for (const t of world.tiles) {
    if (t.plot || t.caravan || t.biome === "river") continue;
    let n = 0;
    const near = new Set<string>();
    for (const p of plots) {
      if (chebyshev(t.x, t.y, p.x, p.y) === 1) {
        n += 1;
        near.add(p.owner);
      }
    }
    if (n >= 2 || near.size >= 2) {
      t.commons = true;
      t.village = name;
    }
  }
}

export function stampVillage(world: World, owners: string[], name: string) {
  for (const t of world.tiles) {
    if (t.plot && owners.includes(t.owner)) t.village = name;
  }
  paintStreets(world, owners, name);
}

export function clearVillage(world: World, name: string) {
  for (const t of world.tiles) {
    if (t.village === name) t.village = "";
  }
}

export function villageOf(world: World, owner: string): string {
  const t = world.tiles.find((x) => x.plot && x.owner === owner && x.village);
  return t?.village ?? "";
}

export function livingOwnersOf(world: World, name: string): string[] {
  const set = new Set<string>();
  if (!name) return [];
  for (const t of world.tiles) {
    if (t.village === name && t.plot && t.owner && isLivingOwner(t.owner)) set.add(t.owner);
  }
  return [...set];
}

export function hamletsInName(world: World, name: string): boolean {
  if (!name) return false;
  return world.tiles.some((t) => t.village === name && t.plot && isHamletOwner(t.owner));
}

export function namesTouchingYard(world: World, owner: string): string[] {
  const mine = yardTiles(world, owner);
  if (!mine.length) return [];
  const mineName = villageOf(world, owner);
  const names = new Set<string>();
  for (const t of world.tiles) {
    if (!t.village || t.village === mineName) continue;
    for (const m of mine) {
      if (chebyshev(t.x, t.y, m.x, m.y) <= 2) {
        names.add(t.village);
        break;
      }
    }
  }
  return [...names];
}

export function canJoinVillage(world: World, owner: string, name: string): boolean {
  if (!name || villageOf(world, owner)) return false;
  return namesTouchingYard(world, owner).includes(name);
}

function streetStill(world: World, tile: Tile, owners: string[]): boolean {
  if (tile.plot || tile.caravan || tile.biome === "river") return false;
  const plots = world.tiles.filter((t) => t.plot && owners.includes(t.owner));
  let n = 0;
  const near = new Set<string>();
  for (const p of plots) {
    if (chebyshev(tile.x, tile.y, p.x, p.y) === 1) {
      n += 1;
      near.add(p.owner);
    }
  }
  return n >= 2 || near.size >= 2;
}

/** Снять имя только со своих клеток. Последний живой, хуторов нет — стереть имя. */
export function leaveVillage(
  world: World,
  owner: string,
): { ok: true; name: string; cleared: boolean } | { ok: false; hint: string } {
  const name = villageOf(world, owner);
  if (!name) return { ok: false, hint: "Имени нет." };
  for (const t of world.tiles) {
    if (t.plot && t.owner === owner && t.village === name) t.village = "";
  }
  const remainOwners = [...new Set(world.tiles.filter((t) => t.plot && t.village === name).map((t) => t.owner))];
  for (const t of world.tiles) {
    if (t.village !== name || t.plot) continue;
    if (!streetStill(world, t, remainOwners)) t.village = "";
  }
  const living = livingOwnersOf(world, name);
  const hamlets = hamletsInName(world, name);
  if (living.length === 0 && !hamlets) {
    clearVillage(world, name);
    return { ok: true, name, cleared: true };
  }
  return { ok: true, name, cleared: false };
}

export function snapVillage(world: World): string[] {
  return world.tiles.map((t) => t.village || "");
}

export function villageChangedCells(world: World, before: string[]): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let i = 0; i < world.tiles.length; i++) {
    const t = world.tiles[i]!;
    if ((t.village || "") !== (before[i] || "")) cells.push({ x: t.x, y: t.y });
  }
  return cells;
}

export function setVillageLaw(world: World, name: string, law: boolean) {
  if (!name) return;
  for (const t of world.tiles) {
    if (t.village === name) t.law = law;
  }
}

export function villageBounds(world: World, name: string) {
  let x0 = 99;
  let y0 = 99;
  let x1 = 0;
  let y1 = 0;
  let n = 0;
  for (const t of world.tiles) {
    if (t.village !== name) continue;
    n += 1;
    if (t.x < x0) x0 = t.x;
    if (t.y < y0) y0 = t.y;
    if (t.x > x1) x1 = t.x;
    if (t.y > y1) y1 = t.y;
  }
  return n ? { x0, y0, x1, y1 } : null;
}

function at(world: World, x: number, y: number) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  return world.tiles[y * world.width + x] ?? null;
}

export function isOutsideYard(world: World, x: number, y: number): boolean {
  const t = at(world, x, y);
  if (!t || t.plot) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = at(world, x + dx, y + dy);
      if (n?.plot) return true;
    }
  }
  return false;
}

export function canPlaceBoard(tile: Tile, mine: boolean): boolean {
  if (!tile.village || tile.burned) return false;
  if (tile.building !== "none") return false;
  if (tile.plot) return mine;
  return true;
}

export function atNameSpot(world: World, tile: Tile, owner = "you"): boolean {
  if (tile.plot && tile.owner === owner) return true;
  if (tile.fenceN === "gate" || tile.fenceW === "gate") return true;
  if (tile.commons) return true;
  if (tile.village && !tile.plot) return true;
  if (isOutsideYard(world, tile.x, tile.y)) return true;
  return false;
}

