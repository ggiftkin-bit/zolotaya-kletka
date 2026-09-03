import { TILE } from "./constants";

export const cam = { x: 0, y: 0, z: 1, w: 800, h: 600 };

/** One-shot camera pan to a tile. Not a walk. */
export const look = { x: 0, y: 0, until: 0 };

export function requestLook(tx: number, ty: number) {
  look.x = tx * TILE + TILE / 2;
  look.y = ty * TILE + TILE / 2;
  look.until = performance.now() + 900;
}

export function tileToScreen(tx: number, ty: number) {
  const wx = tx * TILE + TILE / 2;
  const wy = ty * TILE + TILE / 2;
  return {
    x: cam.w / 2 + (wx - cam.x) * cam.z,
    y: cam.h / 2 + (wy - cam.y) * cam.z,
  };
}
