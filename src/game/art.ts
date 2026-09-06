import type { Biome, BuildingKind } from "./types";

export type ArtPack = {
  tiles: HTMLImageElement;
  props: HTMLImageElement;
  meeple: HTMLImageElement;
  tokens: HTMLImageElement;
  life: HTMLImageElement;
  fillWater: HTMLImageElement | null;
  fillMeadow: HTMLImageElement | null;
  fillMoss: HTMLImageElement | null;
  fillStone: HTMLImageElement | null;
  fillSand: HTMLImageElement | null;
};

const TILE_INDEX: Record<Biome, number> = {
  plains: 0,
  fertile: 1,
  forest: 2,
  mountain: 3,
  ore: 4,
  swamp: 5,
  river: 6,
  ford: 7,
};

const PROP_INDEX: Record<Exclude<BuildingKind, "none">, number> = {
  shack: 0,
  house: 1,
  field: 2,
  workshop: 3,
  shop: 4,
  board: 5,
  mine: 6,
  pen: -1,
  stable: -1,
  well: -1,
  tower: 1,
  bench: 3,
  forge: 3,
  oven: 4,
  smoke: 3,
  herbs: 5,
  stall: 4,
  coalpit: 3,
  adit: 6,
  shed: 0,
  jail: 6,
  stakes: -1,
  moat: -1,
  net: -1,
  camp: -1,
};

export const LIFE_INDEX = {
  hare: 0,
  deer: 1,
  horse: 2,
  cow: 3,
  pen: 4,
  stable: 5,
  well: 6,
  rope: 7,
  spear: 8,
} as const;

let pack: ArtPack | null = null;
let pending: Promise<ArtPack> | null = null;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

export function getArt() {
  return pack;
}

export function ensureArt() {
  if (pack) return Promise.resolve(pack);
  if (pending) return pending;
  pending = Promise.all([
    loadImage("/game/tiles.png"),
    loadImage("/game/props.png"),
    loadImage("/game/meeple.png"),
    loadImage("/game/tokens.png"),
    loadImage("/game/life.png"),
    loadImage("/game/fill-water.jpg").catch(() => null),
    loadImage("/game/fill-meadow.jpg").catch(() => null),
    loadImage("/game/fill-moss.jpg").catch(() => null),
    loadImage("/game/fill-stone.jpg").catch(() => null),
    loadImage("/game/fill-sand.jpg").catch(() => null),
  ]).then(([tiles, props, meeple, tokens, life, fillWater, fillMeadow, fillMoss, fillStone, fillSand]) => {
    pack = { tiles, props, meeple, tokens, life, fillWater, fillMeadow, fillMoss, fillStone, fillSand };
    return pack;
  });
  return pending;
}

/** Transparent frame of each tiles.png cell (10 / 128). Crop only that — not a visual inset. */
export const TILE_ATLAS_PAD = 10 / 128;

export function drawAtlas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cols: number,
  rows: number,
  index: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  inset = 0,
) {
  const cw = img.width / cols;
  const ch = img.height / rows;
  const padX = cw * inset;
  const padY = ch * inset;
  const sx = (index % cols) * cw + padX;
  const sy = Math.floor(index / cols) * ch + padY;
  ctx.drawImage(img, sx, sy, cw - padX * 2, ch - padY * 2, dx, dy, dw, dh);
}

export function biomeIndex(biome: Biome, commons: boolean, wooded = true) {
  if (commons) return 8;
  if (biome === "forest" && !wooded) return 0;
  if (biome === "fertile" && !wooded) return 0;
  return TILE_INDEX[biome];
}

export function propIndex(kind: BuildingKind | "caravan") {
  if (kind === "caravan") return 7;
  if (kind === "none") return -1;
  return PROP_INDEX[kind];
}
