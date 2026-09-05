import { useEffect, useRef } from "react";
import { LIFE_INDEX, TILE_ATLAS_PAD, biomeIndex, drawAtlas, ensureArt, getArt, propIndex } from "@/game/art";
import { isWatered } from "@/game/life";
import { isWooded } from "@/game/grow";
import { FENCE_STR, normRect } from "@/game/fence";
import { TILE, MEEPLE_COLORS } from "@/game/constants";
import { cam as viewCam, look } from "@/game/cam";
import { useGame } from "@/game/store";
import type { Biome, Tile, World } from "@/game/types";
import { viewPos } from "@/game/view-pos";
import { tileAt } from "@/game/worldgen";
import { FOG_DARK, FOG_MEM, fogAt } from "@/game/book";
import { asPile, pileTotal } from "@/game/pile";

const BIOME_FILL: Record<Biome, string> = {
  plains: "#c5b48a",
  fertile: "#b7b37a",
  forest: "#6f7d55",
  mountain: "#8a8176",
  ore: "#7a6e62",
  swamp: "#5f6a52",
  river: "#4a6570",
  ford: "#6a8490",
};

const BANK = 12;
const SAND = "#d2bc86";
const SAND_WET = "#b89568";

function isWater(t: Tile | null | undefined): boolean {
  return !!t && (t.biome === "river" || t.biome === "ford");
}

function hash01(x: number, y: number, s: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + s * 45.164) * 43758.5453;
  return n - Math.floor(n);
}

function sides4(world: World, x: number, y: number) {
  return {
    n: tileAt(world, x, y - 1),
    e: tileAt(world, x + 1, y),
    s: tileAt(world, x, y + 1),
    w: tileAt(world, x - 1, y),
  };
}

export function BoardCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ x: 0, y: 0, z: 1, panX: 0, panY: 0 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );
  const keys = useRef(new Set<string>());
  const last = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; z: number } | null>(null);
  const hold = useRef<number | null>(null);
  const held = useRef(false);
  const pinched = useRef(false);

  useEffect(() => {
    void ensureArt();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    cam.current.x = viewPos.x * TILE;
    cam.current.y = viewPos.y * TILE;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (down) keys.current.add(e.code);
      else keys.current.delete(e.code);
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);

    window.__controlsTest = {
      getYaw: () => cam.current.panX,
      getSpeed: () => Math.hypot(cam.current.panX, cam.current.panY),
      setKeys: (codes: string[]) => {
        keys.current = new Set(codes);
      },
    };

    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last.current) / 1000 || 0);
      last.current = now;
      useGame.getState().stepSim(dt);

      const g = useGame.getState();
      const c = cam.current;
      viewCam.x = c.x;
      viewCam.y = c.y;
      viewCam.z = c.z;
      viewCam.w = canvas.clientWidth;
      viewCam.h = canvas.clientHeight;
      const panSpeed = 420 / c.z;
      let ax = 0;
      let ay = 0;
      if (keys.current.has("KeyA") || keys.current.has("ArrowLeft")) ax -= 1;
      if (keys.current.has("KeyD") || keys.current.has("ArrowRight")) ax += 1;
      if (keys.current.has("KeyW") || keys.current.has("ArrowUp")) ay -= 1;
      if (keys.current.has("KeyS") || keys.current.has("ArrowDown")) ay += 1;
      c.panX = ax;
      c.panY = ay;
      if (ax || ay) {
        c.x += ax * panSpeed * dt;
        c.y += ay * panSpeed * dt;
      } else if (look.until > now) {
        c.x += (look.x - c.x) * (1 - Math.exp(-dt * 6));
        c.y += (look.y - c.y) * (1 - Math.exp(-dt * 6));
      } else if (g.travel && !drag.current) {
        const tx = viewPos.x * TILE + TILE / 2;
        const ty = viewPos.y * TILE + TILE / 2;
        c.x += (tx - c.x) * (1 - Math.exp(-dt * 4));
        c.y += (ty - c.y) * (1 - Math.exp(-dt * 4));
      }

      draw(ctx, canvas, g, c);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const toTile = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const c = cam.current;
    const wx = c.x + (clientX - rect.left - w / 2) / c.z;
    const wy = c.y + (clientY - rect.top - h / 2) / c.z;
    const x = Math.floor(wx / TILE);
    const y = Math.floor(wy / TILE);
    const world = useGame.getState().world;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
    return { x, y };
  };

  return (
    <canvas
      ref={canvasRef}
      className="block size-full touch-none bg-table"
      onPointerDown={(e) => {
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = {
            dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
            z: cam.current.z,
          };
          drag.current = null;
          pinched.current = true;
          return;
        }
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          cx: cam.current.x,
          cy: cam.current.y,
          moved: false,
        };
        held.current = false;
        if (hold.current) window.clearTimeout(hold.current);
        const startX = e.clientX;
        const startY = e.clientY;
        hold.current = window.setTimeout(() => {
          hold.current = null;
          const t = toTile(startX, startY);
          if (!t) return;
          held.current = true;
          useGame.getState().inspectTile(t.x, t.y);
        }, 420);
      }}
      onPointerMove={(e) => {
        const t = toTile(e.clientX, e.clientY);
        if (t) useGame.getState().setHover(t.x, t.y);
        else useGame.getState().setHover(null, null);
        if (pointers.current.has(e.pointerId)) {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        if (pointers.current.size === 2 && pinch.current) {
          const [a, b] = [...pointers.current.values()];
          const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          const z = pinch.current.z * (dist / Math.max(24, pinch.current.dist));
          cam.current.z = Math.max(0.35, Math.min(2.4, z));
          return;
        }
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.hypot(dx, dy) > 22) d.moved = true;
        if (d.moved) {
          if (hold.current) {
            window.clearTimeout(hold.current);
            hold.current = null;
          }
          cam.current.x = d.cx - dx / cam.current.z;
          cam.current.y = d.cy - dy / cam.current.z;
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (hold.current) {
          window.clearTimeout(hold.current);
          hold.current = null;
        }
        const d = drag.current;
        drag.current = null;
        const skip = held.current || d?.moved || pointers.current.size > 0 || pinched.current;
        if (pointers.current.size === 0) pinched.current = false;
        if (held.current) held.current = false;
        if (d?.moved) useGame.getState().closeInspect();
        if (skip) return;
        const t = toTile(e.clientX, e.clientY);
        if (t) useGame.getState().clickTile(t.x, t.y);
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
        drag.current = null;
        held.current = false;
        pinched.current = false;
        if (hold.current) {
          window.clearTimeout(hold.current);
          hold.current = null;
        }
      }}
      onWheel={(e) => {
        e.preventDefault();
        const z = cam.current.z * (e.deltaY > 0 ? 0.92 : 1.08);
        cam.current.z = Math.max(0.35, Math.min(2.4, z));
      }}
    />
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  g: ReturnType<typeof useGame.getState>,
  cam: { x: number; y: number; z: number },
) {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  ctx.fillStyle = "#1c1612";
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.save();
  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  const viewL = cam.x - cssW / 2 / cam.z;
  const viewT = cam.y - cssH / 2 / cam.z;
  const viewR = cam.x + cssW / 2 / cam.z;
  const viewB = cam.y + cssH / 2 / cam.z;
  const x0 = Math.max(0, Math.floor(viewL / TILE) - 1);
  const y0 = Math.max(0, Math.floor(viewT / TILE) - 1);
  const x1 = Math.min(g.world.width - 1, Math.ceil(viewR / TILE) + 1);
  const y1 = Math.min(g.world.height - 1, Math.ceil(viewB / TILE) + 1);

  const night = g.phase === "night" ? 0.22 : g.weather === "snow" ? 0.08 : 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const fog = fogAt(g.world, x, y);
      if (fog === FOG_DARK) {
        ctx.fillStyle = "#1c1612";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        continue;
      }
      const tile = tileAt(g.world, x, y);
      if (!tile) continue;
      paintTile(ctx, tile, night, g.world);
      if (fog === FOG_MEM) {
        ctx.fillStyle = "rgba(28, 22, 18, 0.5)";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  if (g.plotMark) {
    const hx = g.hover?.x ?? g.plotMark.x;
    const hy = g.hover?.y ?? g.plotMark.y;
    const r = normRect(g.plotMark.x, g.plotMark.y, hx, hy);
    ctx.save();
    ctx.strokeStyle = "rgba(107, 58, 42, 0.95)";
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(r.x0 * TILE, r.y0 * TILE, r.w * TILE, r.h * TILE);
    ctx.fillStyle = "rgba(107, 58, 42, 0.12)";
    ctx.fillRect(r.x0 * TILE, r.y0 * TILE, r.w * TILE, r.h * TILE);
    ctx.restore();
  }

  if (g.preview) {
    const trail = g.travel ? g.travel.path.slice(g.travel.index) : g.preview;
    ctx.strokeStyle = "rgba(239,230,214,0.85)";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([7, 8]);
    ctx.beginPath();
    ctx.moveTo(viewPos.x * TILE + TILE / 2, viewPos.y * TILE + TILE / 2);
    for (const p of trail) {
      ctx.lineTo(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const ring = g.inspect ?? g.selected;
  if (ring) {
    ctx.strokeStyle = "#efe6d6";
    ctx.lineWidth = 3;
    ctx.strokeRect(ring.x * TILE + 3, ring.y * TILE + 3, TILE - 6, TILE - 6);
  }
  if (g.hover && !g.inspect) {
    ctx.strokeStyle = "rgba(239,230,214,0.4)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(g.hover.x * TILE + 5, g.hover.y * TILE + 5, TILE - 10, TILE - 10);
  }

  const share =
    (g.dummies ?? []).some((d) => d.x === g.character.x && d.y === g.character.y) ||
    (g.others ?? []).some((o) => o.x === g.character.x && o.y === g.character.y);
  const mx = viewPos.x * TILE + TILE / 2 + (share ? -TILE * 0.22 : 0);
  const my = viewPos.y * TILE + TILE / 2;
  if (g.character.wagon || g.character.transport === "wagon") {
    paintWagon(ctx, mx - TILE * 0.62, my - TILE * 0.08, 0.82);
  }
  ctx.fillStyle = "rgba(28,22,18,0.22)";
  ctx.beginPath();
  ctx.ellipse(mx, my + 11, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const art = getArt();
  const frame = Math.floor(performance.now() / 280) % 4;
  if (art) {
    paintMeeple(ctx, art.meeple, mx - 16, my - 26, 32, 36, frame);
  } else {
    ctx.fillStyle = g.character.color;
    ctx.beginPath();
    ctx.arc(mx, my - 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#efe6d6";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const o of g.others ?? []) {
    if (fogAt(g.world, o.x, o.y) !== 2) continue;
    const same = o.x === g.character.x && o.y === g.character.y;
    const ox = o.x * TILE + TILE / 2 + (same ? TILE * 0.42 : 0);
    const oy = o.y * TILE + TILE / 2 + (same ? -TILE * 0.18 : 0);
    ctx.fillStyle = "rgba(28,22,18,0.22)";
    ctx.beginPath();
    ctx.ellipse(ox, oy + 11, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const tint = o.color && o.color !== g.character.color ? o.color : MEEPLE_COLORS[1]!;
    if (art) {
      paintMeeple(ctx, art.meeple, ox - 16, oy - 26, 32, 36, frame, tint);
    } else {
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(ox, oy - 2, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#efe6d6";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.font = "600 9px Manrope, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#1c1612";
    ctx.fillText(o.name, ox + 0.5, oy + 18.5);
    ctx.fillStyle = "#efe6d6";
    ctx.fillText(o.name, ox, oy + 18);
  }

  for (const d of g.dummies ?? []) {
    if (fogAt(g.world, d.x, d.y) !== 2 && fogAt(g.world, d.x, d.y) !== 1) continue;
    const same = d.x === g.character.x && d.y === g.character.y;
    const ox = d.x * TILE + TILE / 2 + (same ? TILE * 0.42 : 0);
    const oy = d.y * TILE + TILE / 2 + (same ? -TILE * 0.18 : 0);
    ctx.globalAlpha = d.life === "down" ? 0.4 : 1;
    ctx.fillStyle = "rgba(28,22,18,0.22)";
    ctx.beginPath();
    ctx.ellipse(ox, oy + 11, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (art) {
      paintMeeple(ctx, art.meeple, ox - 16, oy - 26, 32, 36, frame, d.color);
    } else {
      ctx.fillStyle = d.color || "#6b3a2a";
      ctx.beginPath();
      ctx.arc(ox, oy - 2, d.life === "down" ? 7 : 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#efe6d6";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  if (g.weather === "rain" || g.weather === "snow") {
    ctx.fillStyle = g.weather === "rain" ? "rgba(40,55,62,0.12)" : "rgba(232,223,208,0.14)";
    ctx.fillRect(0, 0, cssW, cssH);
  }

  if (cssW >= 720) drawMinimap(ctx, g, cssW, cssH);
}

function paintBiome(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null | undefined,
  biome: Biome,
  x: number,
  y: number,
  wooded = true,
) {
  ctx.fillStyle = BIOME_FILL[biome];
  ctx.fillRect(x, y, TILE, TILE);
  if (img) drawAtlas(ctx, img, 3, 3, biomeIndex(biome, false, wooded), x, y, TILE, TILE, TILE_ATLAS_PAD);
}

function paintRiverGround(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  world: World,
  x: number,
  y: number,
  art: ReturnType<typeof getArt>,
) {
  const n = sides4(world, tile.x, tile.y);
  const nW = isWater(n.n);
  const eW = isWater(n.e);
  const sW = isWater(n.s);
  const wW = isWater(n.w);
  const ford = tile.biome === "ford";
  const anyBank = !nW || !eW || !sW || !wW;
  const waterFill = ford ? BIOME_FILL.ford : BIOME_FILL.river;

  if (anyBank) {
    ctx.fillStyle = SAND;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = SAND_WET;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(x + 12 + hash01(tile.x, tile.y, 1) * 18, y + 14, 7, 4, 0.2, 0, Math.PI * 2);
    ctx.ellipse(x + 28, y + 30, 6, 3.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = waterFill;
    ctx.fillRect(x, y, TILE, TILE);
  }

  const padN = nW ? 0 : BANK;
  const padE = eW ? 0 : BANK;
  const padS = sW ? 0 : BANK;
  const padW = wW ? 0 : BANK;
  const ix = x + padW;
  const iy = y + padN;
  const iw = TILE - padW - padE;
  const ih = TILE - padN - padS;
  const radii: [number, number, number, number] = [
    padN && padW ? BANK : 0,
    padN && padE ? BANK : 0,
    padS && padE ? BANK : 0,
    padS && padW ? BANK : 0,
  ];

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(ix, iy, iw, ih, radii);
  ctx.clip();
  ctx.fillStyle = waterFill;
  ctx.fillRect(x, y, TILE, TILE);
  if (art) {
    drawAtlas(ctx, art.tiles, 3, 3, biomeIndex(tile.biome, false, true), x, y, TILE, TILE, TILE_ATLAS_PAD);
    if (ford) {
      ctx.fillStyle = "rgba(210, 214, 200, 0.16)";
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
  if (ford) {
    ctx.fillStyle = "rgba(90, 92, 86, 0.72)";
    for (let i = 0; i < 3; i++) {
      const sx = x + 12 + i * 9 + hash01(tile.x, tile.y, 4 + i) * 3;
      const sy = y + 18 + (i % 2) * 8;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 3.2, 2.2, 0.2 * i, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  if (anyBank) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ix, iy, iw, ih, radii);
    ctx.strokeStyle = "rgba(90, 70, 42, 0.5)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
    if (!nW) paintShoreGrass(ctx, x, y, "n", tile.x, tile.y);
    if (!eW) paintShoreGrass(ctx, x, y, "e", tile.x, tile.y);
    if (!sW) paintShoreGrass(ctx, x, y, "s", tile.x, tile.y);
    if (!wW) paintShoreGrass(ctx, x, y, "w", tile.x, tile.y);
  }
}

function paintShoreGrass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: "n" | "e" | "s" | "w",
  tx: number,
  ty: number,
) {
  const n = 2 + (hash01(tx, ty, side.charCodeAt(0)) > 0.55 ? 1 : 0);
  ctx.fillStyle = "#5a7a42";
  for (let i = 0; i < n; i++) {
    const t = (i + 0.35 + hash01(tx, ty, 10 + i) * 0.4) / (n + 0.2);
    let gx = x + 6;
    let gy = y + 6;
    if (side === "n") {
      gx = x + 6 + t * (TILE - 12);
      gy = y + 5 + hash01(tx, ty, 20 + i) * 4;
    } else if (side === "s") {
      gx = x + 6 + t * (TILE - 12);
      gy = y + TILE - 7 - hash01(tx, ty, 21 + i) * 4;
    } else if (side === "w") {
      gx = x + 5 + hash01(tx, ty, 22 + i) * 4;
      gy = y + 8 + t * (TILE - 16);
    } else {
      gx = x + TILE - 8 - hash01(tx, ty, 23 + i) * 4;
      gy = y + 8 + t * (TILE - 16);
    }
    ctx.beginPath();
    ctx.moveTo(gx, gy + 3);
    ctx.lineTo(gx + 1.6, gy - 4);
    ctx.lineTo(gx + 3.2, gy + 3);
    ctx.closePath();
    ctx.fill();
  }
}

function paintForestGround(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  world: World,
  x: number,
  y: number,
  art: ReturnType<typeof getArt>,
) {
  const n = sides4(world, tile.x, tile.y);
  const nF = !!n.n && isWooded(n.n);
  const eF = !!n.e && isWooded(n.e);
  const sF = !!n.s && isWooded(n.s);
  const wF = !!n.w && isWooded(n.w);
  const count = (nF ? 1 : 0) + (eF ? 1 : 0) + (sF ? 1 : 0) + (wF ? 1 : 0);
  const interior = count >= 4;
  if (interior || tile.plot || tile.building !== "none") {
    paintBiome(ctx, art?.tiles, "forest", x, y, true);
    return;
  }

  paintBiome(ctx, art?.tiles, "plains", x, y, true);

  let x0 = x + (wF ? -3 : TILE * 0.36);
  let y0 = y + (nF ? -3 : TILE * 0.36);
  let x1 = x + TILE + (eF ? 3 : -TILE * 0.36);
  let y1 = y + TILE + (sF ? 3 : -TILE * 0.36);
  if (x1 - x0 < 16) {
    const mid = (x0 + x1) / 2;
    x0 = mid - 8;
    x1 = mid + 8;
  }
  if (y1 - y0 < 16) {
    const mid = (y0 + y1) / 2;
    y0 = mid - 8;
    y1 = mid + 8;
  }

  ctx.save();
  ctx.beginPath();
  const clipX = x + (wF ? -5 : 1);
  const clipY = y + (nF ? -5 : 1);
  const clipW = TILE + (wF ? 5 : -1) + (eF ? 5 : -1);
  const clipH = TILE + (nF ? 5 : -1) + (sF ? 5 : -1);
  ctx.rect(clipX, clipY, clipW, clipH);
  ctx.clip();

  const trees = 3 + Math.floor(hash01(tile.x, tile.y, 2) * 3);
  for (let i = 0; i < trees; i++) {
    const u = hash01(tile.x, tile.y, 30 + i);
    const v = hash01(tile.x, tile.y, 50 + i);
    let cx = x0 + 6 + u * Math.max(8, x1 - x0 - 12);
    let cy = y0 + 8 + v * Math.max(8, y1 - y0 - 14);
    if (tile.road !== "none") {
      const dx = cx - (x + TILE / 2);
      const dy = cy - (y + TILE / 2);
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        cx += dx >= 0 ? 12 : -12;
        cy += dy >= 0 ? 8 : -8;
      }
    }
    const s = 0.78 + hash01(tile.x, tile.y, 70 + i) * 0.32;
    paintTree(ctx, cx, cy, s);
  }
  ctx.restore();
}

function paintTree(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.fillStyle = "#3a2a18";
  ctx.fillRect(cx - 1.3 * s, cy - 1, 2.6 * s, 7.5 * s);
  ctx.fillStyle = "#2a3d1c";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 7 * s, 8.2 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3d5c28";
  ctx.beginPath();
  ctx.ellipse(cx - 2.2 * s, cy - 9 * s, 5 * s, 5.4 * s, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a6b32";
  ctx.beginPath();
  ctx.ellipse(cx + 1.4 * s, cy - 8.2 * s, 3.2 * s, 3.4 * s, 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function paintWaterShade(ctx: CanvasRenderingContext2D, tile: Tile, world: World, x: number, y: number) {
  const n = sides4(world, tile.x, tile.y);
  ctx.fillStyle = "rgba(28, 22, 18, 0.2)";
  if (isWater(n.n)) ctx.fillRect(x, y, TILE, 3);
  if (isWater(n.s)) ctx.fillRect(x, y + TILE - 3, TILE, 3);
  if (isWater(n.w)) ctx.fillRect(x, y, 3, TILE);
  if (isWater(n.e)) ctx.fillRect(x + TILE - 3, y, 3, TILE);
}

function paintTile(ctx: CanvasRenderingContext2D, tile: Tile, night: number, world: World) {
  const x = tile.x * TILE;
  const y = tile.y * TILE;
  const lushForest = isWooded(tile);
  const crops = tile.amount > 0 && (tile.biome === "fertile" || tile.building === "field");
  const ground: Biome =
    tile.biome === "forest" && !lushForest
      ? "plains"
      : (tile.biome === "fertile" || tile.building === "field") && !crops
        ? "plains"
        : tile.biome;
  const art = getArt();
  if (tile.commons) {
    ctx.fillStyle = "#c2ad7e";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "rgba(90, 70, 40, 0.16)";
    ctx.fillRect(x + 4, y + 10, TILE - 8, 6);
    ctx.fillRect(x + 8, y + 22, TILE - 16, 5);
    ctx.fillStyle = "rgba(70, 56, 36, 0.18)";
    ctx.fillRect(x + 12, y + 30, 10, 4);
  } else if (isWater(tile)) {
    paintRiverGround(ctx, tile, world, x, y, art);
  } else if (lushForest) {
    paintForestGround(ctx, tile, world, x, y, art);
  } else {
    ctx.fillStyle = BIOME_FILL[ground];
    ctx.fillRect(x, y, TILE, TILE);
    if (art) {
      const lush = tile.biome === "fertile" ? crops : true;
      drawAtlas(ctx, art.tiles, 3, 3, biomeIndex(tile.biome, false, lush), x, y, TILE, TILE, TILE_ATLAS_PAD);
    }
  }

  if (!isWater(tile)) paintWaterShade(ctx, tile, world, x, y);

  paintCut(ctx, tile, x, y);

  if (tile.bank && !tile.pit) paintBank(ctx, x, y);
  if (tile.pit) paintPit(ctx, tile, world, x, y);

  if (tile.village) {
    ctx.fillStyle = "rgba(70, 90, 110, 0.2)";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = "rgba(40, 55, 70, 0.55)";
    ctx.lineWidth = 2;
    const n = tileAt(world, tile.x, tile.y - 1);
    const s = tileAt(world, tile.x, tile.y + 1);
    const w = tileAt(world, tile.x - 1, tile.y);
    const e = tileAt(world, tile.x + 1, tile.y);
    ctx.beginPath();
    if (!n || n.village !== tile.village) {
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + TILE, y + 1);
    }
    if (!s || s.village !== tile.village) {
      ctx.moveTo(x, y + TILE - 1);
      ctx.lineTo(x + TILE, y + TILE - 1);
    }
    if (!w || w.village !== tile.village) {
      ctx.moveTo(x + 1, y);
      ctx.lineTo(x + 1, y + TILE);
    }
    if (!e || e.village !== tile.village) {
      ctx.moveTo(x + TILE - 1, y);
      ctx.lineTo(x + TILE - 1, y + TILE);
    }
    ctx.stroke();
  } else if (tile.plot) {
    ctx.fillStyle = "rgba(90, 70, 40, 0.14)";
    ctx.fillRect(x, y, TILE, TILE);
  }

  if (tile.road !== "none") paintRoad(ctx, tile, world, x, y);

  if (tile.owned && !tile.plot) {
    ctx.fillStyle = "#6b3a2a";
    ctx.beginPath();
    ctx.moveTo(x + TILE - 8, y + 6);
    ctx.lineTo(x + TILE - 8, y + 22);
    ctx.lineTo(x + TILE - 20, y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + TILE - 10, y + 6, 3, 20);
  }

  paintFence(ctx, tile, x, y, world);

  paintHerb(ctx, tile, x, y);

  if (
    tile.amount > 0 &&
    tile.resource &&
    tile.resource !== "herb" &&
    tile.building === "none" &&
    !tile.caravan &&
    !(lushForest && tile.resource === "wood")
  ) {
    const n = Math.min(3, Math.max(1, Math.ceil(tile.amount / 3)));
    const col =
      tile.resource === "wood"
        ? "#3f4d2e"
        : tile.resource === "stone"
          ? "#5c564e"
          : tile.resource === "ore"
            ? "#6b4a2f"
            : tile.resource === "fish"
              ? "#3a5560"
              : tile.resource === "clay"
                ? "#8a623c"
                : tile.resource === "crystal"
                  ? "#5a4a7a"
                  : "#8a6230";
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(x + 10 + i * 9, y + TILE - 10, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const pileN = pileTotal(asPile(tile.pile));
  if (pileN > 0 || (tile.goldDrop ?? 0) > 0) {
    ctx.fillStyle = "#6b4a2f";
    ctx.beginPath();
    ctx.ellipse(x + TILE * 0.72, y + TILE * 0.72, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#efe6d6";
    ctx.font = "700 9px Manrope, sans-serif";
    ctx.textAlign = "center";
    const n = pileN || tile.goldDrop || 0;
    ctx.fillText(String(Math.min(99, n)), x + TILE * 0.72, y + TILE * 0.76);
    ctx.textAlign = "start";
  }

  if (tile.building === "moat") {
    ctx.fillStyle = "#3a5560";
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = "rgba(70, 110, 120, 0.55)";
    ctx.beginPath();
    ctx.ellipse(x + TILE * 0.5, y + TILE * 0.55, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (tile.building === "stakes") {
    ctx.fillStyle = "#4a3224";
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 8 + i * 8, y + TILE - 8);
      ctx.lineTo(x + 11 + i * 8, y + 10);
      ctx.lineTo(x + 14 + i * 8, y + TILE - 8);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (tile.building === "net") {
    ctx.strokeStyle = "#4a3a30";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 10);
    ctx.lineTo(x + 8, y + TILE - 8);
    ctx.moveTo(x + TILE - 8, y + 10);
    ctx.lineTo(x + TILE - 8, y + TILE - 8);
    ctx.stroke();
    ctx.strokeStyle = "rgba(90, 110, 120, 0.85)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 14 + i * 6);
      ctx.lineTo(x + TILE - 8, y + 16 + i * 6);
      ctx.stroke();
    }
  }
  if (tile.building === "camp" && !tile.burned) {
    ctx.fillStyle = "#3a2a20";
    ctx.beginPath();
    ctx.moveTo(x + 10, y + TILE - 10);
    ctx.lineTo(x + TILE / 2, y + 16);
    ctx.lineTo(x + TILE - 10, y + TILE - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#c45a28";
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y + TILE * 0.58, 7, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8c45a";
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y + TILE * 0.55, 3.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (art && tile.caravan) {
    drawAtlas(ctx, art.props, 3, 3, 7, x - 2, y - 10, TILE + 4, TILE + 6);
  }
  if (art && tile.building !== "none") {
    if (tile.building === "pen" || tile.building === "stable" || tile.building === "well") {
      drawAtlas(ctx, art.life, 3, 3, LIFE_INDEX[tile.building], x - 2, y - 8, TILE + 4, TILE + 4);
    } else {
      const pi = propIndex(tile.building);
      if (pi >= 0 && !(tile.building === "field" && tile.amount <= 0)) {
        drawAtlas(ctx, art.props, 3, 3, pi, x - 2, y - 10, TILE + 4, TILE + 6);
      }
    }
    if (tile.burned) {
      ctx.fillStyle = "rgba(28, 18, 14, 0.55)";
      ctx.fillRect(x + 6, y + 8, TILE - 12, TILE - 14);
      ctx.fillStyle = "rgba(50, 36, 28, 0.9)";
      ctx.beginPath();
      ctx.ellipse(x + TILE * 0.5, y + TILE * 0.72, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (tile.matter === "stone" && tile.building !== "well") {
      ctx.strokeStyle = "rgba(70, 66, 60, 0.7)";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 8, y + 10, TILE - 16, TILE - 18);
    }
  }
  if (art && tile.herd && tile.herd.count > 0) {
    drawAtlas(ctx, art.life, 3, 3, LIFE_INDEX[tile.herd.kind], x + 6, y + 8, 28, 28);
  }
  if (tile.wagon) {
    paintWagon(ctx, x + 8, y + 16, 1);
  }
  if (tile.chestLock && tile.building !== "none") {
    const px = x + TILE - 11;
    const py = y + TILE - 13;
    ctx.fillStyle = "#2e241c";
    ctx.fillRect(px, py, 7, 6);
    ctx.strokeStyle = "#c4a46a";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(px + 3.5, py, 2.4, Math.PI, 0);
    ctx.stroke();
  }
  if (isWatered(world, tile) && tile.building !== "none" && tile.building !== "well") {
    ctx.fillStyle = "rgba(70, 130, 150, 0.85)";
    ctx.beginPath();
    ctx.ellipse(x + 8, y + 8, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (night) {
    ctx.fillStyle = `rgba(20,16,14,${night})`;
    ctx.fillRect(x, y, TILE, TILE);
  }
}

let meepleTint: HTMLCanvasElement | null = null;

function paintMeeple(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  frame: number,
  tint?: string,
) {
  if (!tint) {
    drawAtlas(ctx, img, 2, 2, frame, dx, dy, dw, dh, 0.08);
    return;
  }
  if (!meepleTint) meepleTint = document.createElement("canvas");
  const w = Math.max(1, Math.ceil(dw));
  const h = Math.max(1, Math.ceil(dh));
  if (meepleTint.width !== w) meepleTint.width = w;
  if (meepleTint.height !== h) meepleTint.height = h;
  const t = meepleTint.getContext("2d");
  if (!t) {
    drawAtlas(ctx, img, 2, 2, frame, dx, dy, dw, dh, 0.08);
    return;
  }
  t.clearRect(0, 0, w, h);
  drawAtlas(t, img, 2, 2, frame, 0, 0, dw, dh, 0.08);
  t.globalCompositeOperation = "source-atop";
  t.fillStyle = tint;
  t.globalAlpha = 0.48;
  t.fillRect(0, 0, w, h);
  t.globalAlpha = 1;
  t.globalCompositeOperation = "source-over";
  ctx.drawImage(meepleTint, dx, dy);
}

function paintWagon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(28,22,18,0.22)";
  ctx.beginPath();
  ctx.ellipse(16, 18, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6b4a2f";
  ctx.fillRect(2, 4, 26, 11);
  ctx.fillStyle = "#8a623c";
  ctx.fillRect(3, 5, 24, 5);
  ctx.fillStyle = "#4a3224";
  ctx.fillRect(2, 1, 26, 3);
  ctx.fillRect(2, 1, 2, 9);
  ctx.fillRect(26, 1, 2, 9);
  ctx.fillRect(13, 2, 4, 14);
  ctx.fillStyle = "#2e241c";
  ctx.beginPath();
  ctx.arc(8, 16, 4.4, 0, Math.PI * 2);
  ctx.arc(24, 16, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#c4a46a";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(8, 16, 2.2, 0, Math.PI * 2);
  ctx.arc(24, 16, 2.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function hasRoad(world: World, x: number, y: number) {
  const t = tileAt(world, x, y);
  return !!t && t.road !== "none";
}

function paintRoad(ctx: CanvasRenderingContext2D, tile: Tile, world: World, x: number, y: number) {
  const n = hasRoad(world, tile.x, tile.y - 1);
  const s = hasRoad(world, tile.x, tile.y + 1);
  const w = hasRoad(world, tile.x - 1, tile.y);
  const e = hasRoad(world, tile.x + 1, tile.y);
  const col =
    tile.road === "stone" ? "#7a7368" : tile.road === "bridge" ? "#8a623c" : "#c4a46a";
  const shade =
    tile.road === "stone" ? "#5c564e" : tile.road === "bridge" ? "#6b4a2f" : "#a07848";
  const half = 9;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  ctx.fillStyle = col;
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
  if (n) ctx.fillRect(cx - half, y, half * 2, TILE / 2 + 1);
  if (s) ctx.fillRect(cx - half, cy, half * 2, TILE / 2 + 1);
  if (w) ctx.fillRect(x, cy - half, TILE / 2 + 1, half * 2);
  if (e) ctx.fillRect(cx, cy - half, TILE / 2 + 1, half * 2);
  ctx.fillStyle = shade;
  if (n || s) {
    ctx.fillRect(cx - 3, n ? y : cy - half, 2, n && s ? TILE : TILE / 2 + half);
    ctx.fillRect(cx + 1, n ? y : cy - half, 2, n && s ? TILE : TILE / 2 + half);
  }
  if (w || e) {
    ctx.fillRect(w ? x : cx - half, cy - 3, w && e ? TILE : TILE / 2 + half, 2);
    ctx.fillRect(w ? x : cx - half, cy + 1, w && e ? TILE : TILE / 2 + half, 2);
  }
  if (tile.road === "stone") {
    ctx.fillStyle = "rgba(239,230,214,0.28)";
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(cx - 6 + (i % 3) * 5, cy - 5 + Math.floor(i / 3) * 6, 3, 3);
    }
  }
  if (tile.road === "bridge") {
    ctx.strokeStyle = "rgba(40,28,18,0.35)";
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 4, cy + i * 4);
      ctx.lineTo(x + TILE - 4, cy + i * 4);
      ctx.stroke();
    }
  }
}

function paintFence(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, world: World) {
  const lockedEdge = (side: "n" | "w") => {
    const inner = side === "n" ? tileAt(world, tile.x, tile.y - 1) : tileAt(world, tile.x - 1, tile.y);
    return !!(tile.gateLock || inner?.gateLock);
  };
  const padlock = (cx: number, cy: number) => {
    ctx.fillStyle = "#2e241c";
    ctx.fillRect(cx - 3, cy, 6, 5);
    ctx.strokeStyle = "#c4a46a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, Math.PI, 0);
    ctx.stroke();
  };
  const drawH = (kind: typeof tile.fenceN, yy: number) => {
    if (kind === "none" || FENCE_STR[kind] <= 0) return;
    if (kind === "gate") {
      ctx.fillStyle = "#5a4030";
      ctx.fillRect(x + 2, yy - 2, 8, 8);
      ctx.fillRect(x + TILE - 10, yy - 2, 8, 8);
      if (lockedEdge("n")) padlock(x + TILE / 2, yy - 1);
      return;
    }
    ctx.fillStyle = kind === "wall" ? "#5c564e" : kind === "palisade" ? "#3d3228" : "#6b4a2f";
    const h = kind === "wall" ? 7 : kind === "palisade" ? 6 : 4;
    ctx.fillRect(x, yy - h / 2, TILE, h);
    if (kind !== "wood") {
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 6 + i * 10, yy - h - 3, 4, 5);
    }
  };
  const drawV = (kind: typeof tile.fenceW, xx: number) => {
    if (kind === "none" || FENCE_STR[kind] <= 0) return;
    if (kind === "gate") {
      ctx.fillStyle = "#5a4030";
      ctx.fillRect(xx - 2, y + 2, 8, 8);
      ctx.fillRect(xx - 2, y + TILE - 10, 8, 8);
      if (lockedEdge("w")) padlock(xx, y + TILE / 2);
      return;
    }
    ctx.fillStyle = kind === "wall" ? "#5c564e" : kind === "palisade" ? "#3d3228" : "#6b4a2f";
    const w = kind === "wall" ? 7 : kind === "palisade" ? 6 : 4;
    ctx.fillRect(xx - w / 2, y, w, TILE);
    if (kind !== "wood") {
      for (let i = 0; i < 4; i++) ctx.fillRect(xx - w - 3, y + 6 + i * 10, 5, 4);
    }
  };
  drawH(tile.fenceN, y);
  drawV(tile.fenceW, x);
  if (tile.building === "tower") {
    ctx.fillStyle = "#4a3a30";
    ctx.fillRect(x + 12, y + 6, 20, 28);
    ctx.fillStyle = "#6b3a2a";
    ctx.fillRect(x + 10, y + 4, 24, 8);
    ctx.fillStyle = "#efe6d6";
    ctx.fillRect(x + 18, y + 14, 8, 6);
  }
}

function paintBank(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "rgba(201, 168, 82, 0.42)";
  ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.fillStyle = "rgba(166, 124, 58, 0.55)";
  ctx.beginPath();
  ctx.ellipse(x + 14, y + TILE - 12, 6, 4, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + TILE - 13, y + TILE - 16, 5, 3.5, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function paintPit(ctx: CanvasRenderingContext2D, tile: Tile, world: World, x: number, y: number) {
  const n = tileAt(world, tile.x, tile.y - 1)?.pit;
  const s = tileAt(world, tile.x, tile.y + 1)?.pit;
  const w = tileAt(world, tile.x - 1, tile.y)?.pit;
  const e = tileAt(world, tile.x + 1, tile.y)?.pit;
  const padN = n ? 0 : 7;
  const padS = s ? 0 : 7;
  const padW = w ? 0 : 7;
  const padE = e ? 0 : 7;
  const rx = x + padW;
  const ry = y + padN;
  const rw = TILE - padW - padE;
  const rh = TILE - padN - padS;
  ctx.fillStyle = "rgba(28, 22, 18, 0.82)";
  ctx.beginPath();
  ctx.roundRect(rx, ry, rw, rh, n || s || w || e ? 4 : 12);
  ctx.fill();
  ctx.fillStyle = "rgba(58, 48, 36, 0.9)";
  ctx.beginPath();
  ctx.ellipse(x + TILE / 2, y + TILE / 2 + 2, rw * 0.28, rh * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  if (tile.resource === "ore" && tile.amount > 0) {
    ctx.fillStyle = "#6b4a2f";
    ctx.beginPath();
    ctx.arc(x + TILE * 0.62, y + TILE * 0.58, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintHerb(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number) {
  if (tile.building !== "none" || tile.caravan || tile.commons) return;
  const has = tile.resource === "herb" && tile.amount > 0;
  const meadow = tile.biome === "plains" && !tile.commons;
  if (meadow && has) {
    ctx.fillStyle = "rgba(86, 118, 58, 0.28)";
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  }
  if (!has) {
    if (meadow && tile.resource === "herb" && tile.scarred) {
      ctx.fillStyle = "rgba(120, 108, 72, 0.28)";
      ctx.fillRect(x + 6, y + 16, TILE - 12, 14);
    }
    return;
  }
  const n = Math.min(5, Math.max(1, tile.amount));
  const tufts: Array<[number, number]> = [
    [8, 30],
    [20, 34],
    [32, 28],
    [14, 20],
    [28, 18],
  ];
  for (let i = 0; i < n; i++) {
    const [ox, oy] = tufts[i]!;
    const dark = i % 2 === 0 ? "#3d5c32" : "#4a6b3a";
    const light = i % 2 === 0 ? "#5a7a42" : "#6a8a4a";
    for (let b = 0; b < 3; b++) {
      const bx = x + ox + b * 3.2;
      const tip = y + oy - (10 + (b === 1 ? 4 : 0) + (i === 0 ? 2 : 0));
      ctx.fillStyle = b === 1 ? light : dark;
      ctx.beginPath();
      ctx.moveTo(bx, y + oy);
      ctx.lineTo(bx + 2.2, tip);
      ctx.lineTo(bx + 4.4, y + oy);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function paintCut(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number) {
  if (tile.biome === "forest" && tile.amount < 4) {
    const stumps = tile.amount <= 0 ? 4 : 2;
    ctx.fillStyle = "rgba(62, 48, 32, 0.92)";
    for (let i = 0; i < stumps; i++) {
      const sx = x + 8 + i * 9;
      const sy = y + 20 + (i % 2) * 6;
      ctx.fillRect(sx, sy, 7, 9);
      ctx.beginPath();
      ctx.fillStyle = "rgba(108, 86, 58, 0.95)";
      ctx.arc(sx + 3.5, sy, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(62, 48, 32, 0.92)";
    }
    if (tile.amount > 0) {
      ctx.fillStyle = "rgba(62, 92, 44, 0.9)";
      for (let i = 0; i < tile.amount; i++) {
        const sx = x + 10 + i * 10;
        ctx.beginPath();
        ctx.moveTo(sx + 4, y + 8);
        ctx.lineTo(sx + 10, y + 22);
        ctx.lineTo(sx - 2, y + 22);
        ctx.closePath();
        ctx.fill();
      }
    }
    return;
  }
  if ((tile.building === "field" || tile.biome === "fertile") && tile.amount <= 0) {
    ctx.fillStyle = "rgba(122, 96, 58, 0.55)";
    ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
    ctx.strokeStyle = "rgba(72, 54, 32, 0.7)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 10 + i * 8);
      ctx.lineTo(x + TILE - 6, y + 12 + i * 8);
      ctx.stroke();
    }
    return;
  }
  if ((tile.biome === "mountain" || tile.biome === "ore") && tile.amount <= 0 && tile.scarred) {
    ctx.fillStyle = "rgba(28, 24, 20, 0.62)";
    ctx.beginPath();
    ctx.ellipse(x + TILE * 0.5, y + TILE * 0.58, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(18, 16, 14, 0.5)";
    ctx.beginPath();
    ctx.ellipse(x + TILE * 0.5, y + TILE * 0.6, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (tile.amount <= 0 && tile.scarred && (tile.biome === "plains" || tile.biome === "swamp")) {
    ctx.fillStyle = "rgba(90, 80, 60, 0.35)";
    ctx.fillRect(x + 8, y + 14, TILE - 16, 16);
  }
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  g: ReturnType<typeof useGame.getState>,
  cssW: number,
  cssH: number,
) {
  const s = 1.35;
  const mw = g.world.width * s;
  const mh = g.world.height * s;
  const ox = cssW - mw - 16;
  const oy = 92;
  ctx.fillStyle = "rgba(28,22,18,0.82)";
  ctx.fillRect(ox - 6, oy - 6, mw + 12, mh + 12);
  const step = 2;
  for (let y = 0; y < g.world.height; y += step) {
    for (let x = 0; x < g.world.width; x += step) {
      const fog = fogAt(g.world, x, y);
      if (fog === FOG_DARK) continue;
      const t = tileAt(g.world, x, y);
      if (!t) continue;
      ctx.fillStyle = BIOME_FILL[t.biome === "forest" && t.amount < 4 ? "plains" : t.biome];
      if (fog === FOG_MEM) ctx.fillStyle = "#3a3228";
      if (t.bank && !t.pit) ctx.fillStyle = "#c9b06a";
      if (t.pit) ctx.fillStyle = "#3a3228";
      ctx.fillRect(ox + x * s, oy + y * s, s * step, s * step);
      if (t.road !== "none") {
        ctx.fillStyle = fog === FOG_MEM ? "#4a3c2c" : "#5c4a32";
        ctx.fillRect(ox + x * s, oy + y * s, s * step, s * step);
      }
    }
  }
  ctx.fillStyle = g.character.color;
  ctx.fillRect(ox + g.character.x * s - 2, oy + g.character.y * s - 2, 5, 5);
}
