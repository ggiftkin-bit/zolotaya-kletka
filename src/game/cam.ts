import { TILE } from "./constants";

export const cam = { x: 0, y: 0, z: 1, w: 800, h: 600 };

export function tileToScreen(tx: number, ty: number) {
  const wx = tx * TILE + TILE / 2;
  const wy = ty * TILE + TILE / 2;
  return {
    x: cam.w / 2 + (wx - cam.x) * cam.z,
    y: cam.h / 2 + (wy - cam.y) * cam.z,
  };
}
