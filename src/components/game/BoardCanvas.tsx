import { useEffect, useRef } from "react";
import { LIFE_INDEX, TILE_ATLAS_PAD, biomeIndex, drawAtlas, ensureArt, getArt, propIndex } from "@/game/art";
import { isWatered } from "@/game/life";
import { isWooded } from "@/game/grow";
import { FENCE_STR, normRect } from "@/game/fence";
import { TILE, MEEPLE_COLORS, TICKS_PER_DAY } from "@/game/constants";
import { cam as viewCam, look } from "@/game/cam";
import { useGame } from "@/game/store";
import type { Biome, FenceKind, Tile, World } from "@/game/types";
import { viewPos } from "@/game/view-pos";
import { tileAt } from "@/game/worldgen";
import { FOG_DARK, FOG_MEM, FOG_LIVE, fogAt } from "@/game/book";
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

const BANK = 4;
const SAND = "#d2bc86";
const SAND_WET = "#b89568";
const YARD_STONE = "#7a7064";
const STREET_STONE = "#a3947c";

function isWater(t: Tile | null | undefined): boolean {
  return !!t && (t.biome === "river" || t.biome === "ford");
}

function isFieldFloor(t: Tile): boolean {
  return t.building === "field" || (t.biome === "fertile" && (t.amount > 0 || t.plot));
}

function isYardPave(t: Tile): boolean {
  return !!t.plot && !isFieldFloor(t) && !t.pit && !isWater(t);
}

function isStreetPave(t: Tile): boolean {
  return !!t.commons && !t.plot && !t.pit && !isWater(t) && t.building !== "field";
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

type Light = {
  sky: string;
  warm: string;
  grassA: number;
  stoneA: number;
  waterA: number;
  woodA: number;
  veil: string;
  veilLive: number;
  veilMem: number;
  mem: string;
  memA: number;
  dusk: number;
};

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u;
}

function lerpRgb(a: string, b: string, u: number) {
  const A = a.split(",").map(Number);
  const B = b.split(",").map(Number);
  return `${Math.round(lerp(A[0] ?? 0, B[0] ?? 0, u))},${Math.round(lerp(A[1] ?? 0, B[1] ?? 0, u))},${Math.round(lerp(A[2] ?? 0, B[2] ?? 0, u))}`;
}

function lightOf(tick: number): Light {
  const t = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  if (t === 0) {
    return {
      sky: "38,22,20",
      warm: "255,186,140",
      grassA: 0.08,
      stoneA: 0.07,
      waterA: 0.07,
      woodA: 0.07,
      veil: "36,42,58",
      veilLive: 0,
      veilMem: 0,
      mem: "72,42,40",
      memA: 0.4,
      dusk: 0.85,
    };
  }
  if (t === 3) {
    return {
      sky: "40,20,18",
      warm: "255,158,108",
      grassA: 0.09,
      stoneA: 0.08,
      waterA: 0.06,
      woodA: 0.08,
      veil: "40,32,48",
      veilLive: 0.05,
      veilMem: 0.08,
      mem: "70,38,36",
      memA: 0.42,
      dusk: 1,
    };
  }
  if (t >= 4) {
    const late = t === 7 ? 0.72 : 1;
    return {
      sky: "22,20,26",
      warm: "255,200,150",
      grassA: 0,
      stoneA: 0,
      waterA: 0,
      woodA: 0,
      veil: t === 7 ? "40,38,52" : "32,38,54",
      veilLive: 0.16 * late,
      veilMem: 0.34 * late,
      mem: t === 7 ? "48,40,48" : "22,24,32",
      memA: 0.46,
      dusk: t === 7 ? 0.22 : 0,
    };
  }
  return {
    sky: "28,22,18",
    warm: "255,216,140",
    grassA: 0.07,
    stoneA: 0.08,
    waterA: 0.09,
    woodA: 0.06,
    veil: "32,38,54",
    veilLive: 0,
    veilMem: 0,
    mem: "28,22,18",
    memA: 0.5,
    dusk: 0,
  };
}

function mixLight(a: Light, b: Light, u: number): Light {
  return {
    sky: lerpRgb(a.sky, b.sky, u),
    warm: lerpRgb(a.warm, b.warm, u),
    grassA: lerp(a.grassA, b.grassA, u),
    stoneA: lerp(a.stoneA, b.stoneA, u),
    waterA: lerp(a.waterA, b.waterA, u),
    woodA: lerp(a.woodA, b.woodA, u),
    veil: lerpRgb(a.veil, b.veil, u),
    veilLive: lerp(a.veilLive, b.veilLive, u),
    veilMem: lerp(a.veilMem, b.veilMem, u),
    mem: lerpRgb(a.mem, b.mem, u),
    memA: lerp(a.memA, b.memA, u),
    dusk: lerp(a.dusk, b.dusk, u),
  };
}

function currentLight(tickOfDay: number, tickAt: number, now: number): Light {
  const age = now - (tickAt || now);
  const u = age > 2500 ? 1 : clamp01(age / 1800);
  const to = ((tickOfDay % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  const from = (to + TICKS_PER_DAY - 1) % TICKS_PER_DAY;
  return mixLight(lightOf(from), lightOf(to), u);
}

function lightKind(tile: Tile): "water" | "stone" | "wood" | "grass" {
  if (isWater(tile)) return "water";
  if (isYardPave(tile) || isStreetPave(tile)) return "stone";
  if (isWooded(tile) || tile.biome === "forest") return "wood";
  return "grass";
}

function paintLight(
  ctx: CanvasRenderingContext2D,
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  L: Light,
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const fog = fogAt(world, x, y);
      if (fog === FOG_DARK) continue;
      const tile = tileAt(world, x, y);
      if (!tile) continue;
      const px = x * TILE;
      const py = y * TILE;
      if (fog === FOG_LIVE) {
        const kind = lightKind(tile);
        const a = kind === "water" ? L.waterA : kind === "stone" ? L.stoneA : kind === "wood" ? L.woodA : L.grassA;
        if (a > 0.003) {
          ctx.fillStyle = `rgba(${L.warm},${a})`;
          ctx.fillRect(px, py, TILE, TILE);
        }
        if (L.veilLive > 0.003) {
          ctx.fillStyle = `rgba(${L.veil},${L.veilLive})`;
          ctx.fillRect(px, py, TILE, TILE);
        }
        if (L.dusk > 0.25) {
          ctx.fillStyle = `rgba(48,22,28,${0.05 * L.dusk})`;
          ctx.fillRect(px, py, TILE, TILE);
        }
      } else {
        let a = L.memA;
        const nearLive =
          fogAt(world, x, y - 1) === FOG_LIVE ||
          fogAt(world, x + 1, y) === FOG_LIVE ||
          fogAt(world, x, y + 1) === FOG_LIVE ||
          fogAt(world, x - 1, y) === FOG_LIVE;
        const nearDark =
          fogAt(world, x, y - 1) === FOG_DARK ||
          fogAt(world, x + 1, y) === FOG_DARK ||
          fogAt(world, x, y + 1) === FOG_DARK ||
          fogAt(world, x - 1, y) === FOG_DARK;
        if (nearLive) a *= 0.68;
        else if (nearDark) a = Math.min(0.6, a * 1.08);
        if (L.veilMem > 0.003) {
          ctx.fillStyle = `rgba(${L.veil},${L.veilMem})`;
          ctx.fillRect(px, py, TILE, TILE);
        }
        ctx.fillStyle = `rgba(${L.mem},${a})`;
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }
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
  const now = Date.now();
  const L = currentLight(g.tickOfDay ?? 0, g.tickAt ?? now, now);
  ctx.fillStyle = `rgb(${L.sky})`;
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

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const fog = fogAt(g.world, x, y);
      if (fog === FOG_DARK) {
        ctx.fillStyle = `rgb(${L.sky})`;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        continue;
      }
      const tile = tileAt(g.world, x, y);
      if (!tile) continue;
      paintTile(ctx, tile, g.world);
    }
  }

  paintLight(ctx, g.world, x0, y0, x1, y1, L);

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
    const rainA = g.phase === "night" ? 0.06 : 0.12;
    ctx.fillStyle = g.weather === "rain" ? `rgba(40,55,62,${rainA})` : "rgba(232,223,208,0.14)";
    ctx.fillRect(0, 0, cssW, cssH);
  }

  if (cssW >= 720) drawMinimap(ctx, g, cssW, cssH);
}

function paintMeadow(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  x: number,
  y: number,
  fertile: boolean,
) {
  ctx.fillStyle = fertile ? "#a8b06c" : "#9aaa62";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = fertile ? "rgba(92, 118, 48, 0.22)" : "rgba(80, 108, 44, 0.2)";
  ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.fillStyle = fertile ? "rgba(122, 148, 64, 0.35)" : "rgba(110, 138, 58, 0.32)";
  for (let i = 0; i < 3; i++) {
    const gx = x + 6 + ((i * 13 + tile.x * 5) % (TILE - 12));
    const gy = y + 10 + ((i * 11 + tile.y * 7) % (TILE - 16));
    ctx.fillRect(gx, gy, 8, 2);
  }
  if (hash01(tile.x, tile.y, 3) > 0.82) {
    ctx.fillStyle = "rgba(120, 114, 96, 0.7)";
    ctx.beginPath();
    ctx.ellipse(x + 10 + hash01(tile.x, tile.y, 4) * 22, y + 14 + hash01(tile.x, tile.y, 5) * 16, 3.2, 2.1, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
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

const OUTER = 6;
const INNER = 4;

function paintRiverGround(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  world: World,
  x: number,
  y: number,
  _art: ReturnType<typeof getArt>,
) {
  const n = sides4(world, tile.x, tile.y);
  const nW = isWater(n.n);
  const eW = isWater(n.e);
  const sW = isWater(n.s);
  const wW = isWater(n.w);
  const ford = tile.biome === "ford";
  const waterN = (nW ? 1 : 0) + (eW ? 1 : 0) + (sW ? 1 : 0) + (wW ? 1 : 0);
  const anyBank = waterN < 4;
  const waterFill = ford ? BIOME_FILL.ford : BIOME_FILL.river;
  const seW = isWater(tileAt(world, tile.x + 1, tile.y + 1));
  const neW = isWater(tileAt(world, tile.x + 1, tile.y - 1));
  const swW = isWater(tileAt(world, tile.x - 1, tile.y + 1));
  const nwW = isWater(tileAt(world, tile.x - 1, tile.y - 1));

  if (waterN >= 2) {
    ctx.fillStyle = waterFill;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = SAND;
    if (!nW) ctx.fillRect(x, y, TILE, BANK);
    if (!sW) ctx.fillRect(x, y + TILE - BANK, TILE, BANK);
    if (!wW) ctx.fillRect(x, y, BANK, TILE);
    if (!eW) ctx.fillRect(x + TILE - BANK, y, BANK, TILE);
  } else if (anyBank) {
    ctx.fillStyle = SAND;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = SAND_WET;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
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
  const cap = waterN >= 2 ? 0 : OUTER;
  const radii: [number, number, number, number] = [
    padN && padW ? cap : 0,
    padN && padE ? cap : 0,
    padS && padE ? cap : 0,
    padS && padW ? cap : 0,
  ];

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(ix, iy, iw, ih, radii);
  ctx.clip();
  ctx.fillStyle = waterFill;
  ctx.fillRect(x, y, TILE, TILE);
  if (ford) {
    ctx.fillStyle = "rgba(210, 214, 200, 0.22)";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "rgba(90, 92, 86, 0.72)";
    for (let i = 0; i < 3; i++) {
      const sx = x + 12 + i * 9 + hash01(tile.x, tile.y, 4 + i) * 3;
      const sy = y + 18 + (i % 2) * 8;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 3.2, 2.2, 0.2 * i, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if ((nW ? 1 : 0) + (eW ? 1 : 0) + (sW ? 1 : 0) + (wW ? 1 : 0) >= 2) {
    ctx.fillStyle = "rgba(32, 52, 62, 0.16)";
    ctx.fillRect(ix, iy, iw, ih);
  }
  ctx.restore();

  const punch = (cx: number, cy: number, a0: number, a1: number) => {
    ctx.fillStyle = SAND;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, INNER, a0, a1, true);
    ctx.closePath();
    ctx.fill();
  };
  if (nW && eW && !neW) punch(x + TILE, y, Math.PI, Math.PI / 2);
  if (nW && wW && !nwW) punch(x, y, Math.PI / 2, 0);
  if (sW && eW && !seW) punch(x + TILE, y + TILE, (Math.PI * 3) / 2, Math.PI);
  if (sW && wW && !swW) punch(x, y + TILE, 0, (Math.PI * 3) / 2);

  if (anyBank) {
    ctx.save();
    ctx.strokeStyle = "rgba(70, 52, 32, 0.4)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    if (!nW) {
      ctx.moveTo(ix + radii[0], iy);
      ctx.lineTo(ix + iw - radii[1], iy);
    }
    if (!sW) {
      ctx.moveTo(ix + radii[3], iy + ih);
      ctx.lineTo(ix + iw - radii[2], iy + ih);
    }
    if (!wW) {
      ctx.moveTo(ix, iy + radii[0]);
      ctx.lineTo(ix, iy + ih - radii[3]);
    }
    if (!eW) {
      ctx.moveTo(ix + iw, iy + radii[1]);
      ctx.lineTo(ix + iw, iy + ih - radii[2]);
    }
    ctx.stroke();
    ctx.restore();
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
  const n = 3 + (hash01(tx, ty, side.charCodeAt(0)) > 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.3 + hash01(tx, ty, 10 + i) * 0.45) / (n + 0.15);
    let gx = x + 6;
    let gy = y + 6;
    if (side === "n") {
      gx = x + 5 + t * (TILE - 10);
      gy = y + 1 + hash01(tx, ty, 20 + i) * 3;
    } else if (side === "s") {
      gx = x + 5 + t * (TILE - 10);
      gy = y + TILE - 6 - hash01(tx, ty, 21 + i) * 2;
    } else if (side === "w") {
      gx = x + 1 + hash01(tx, ty, 22 + i) * 3;
      gy = y + 7 + t * (TILE - 14);
    } else {
      gx = x + TILE - 6 - hash01(tx, ty, 23 + i) * 2;
      gy = y + 7 + t * (TILE - 14);
    }
    ctx.fillStyle = i % 2 ? "#4a6b32" : "#5a7a42";
    ctx.beginPath();
    ctx.moveTo(gx, gy + 3);
    ctx.lineTo(gx + 1.6, gy - 3);
    ctx.lineTo(gx + 3.2, gy + 3);
    ctx.closePath();
    ctx.fill();
  }
}

function isOpenLand(t: Tile | null | undefined): boolean {
  return !!t && !isWater(t) && !isWooded(t);
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
  const fieldOpen = isOpenLand(n.n) || isOpenLand(n.e) || isOpenLand(n.s) || isOpenLand(n.w);
  const interior = count >= 4 || (count >= 3 && !fieldOpen);
  if (interior || tile.plot || tile.building !== "none") {
    ctx.fillStyle = "#5c6a42";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "rgba(42, 56, 28, 0.28)";
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y + TILE / 2, 16, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    const trees = tile.plot || tile.building !== "none" ? 2 : 5;
    for (let i = 0; i < trees; i++) {
      const u = hash01(tile.x, tile.y, 30 + i);
      const v = hash01(tile.x, tile.y, 50 + i);
      let cx = x + 8 + u * (TILE - 16);
      let cy = y + 12 + v * (TILE - 18);
      if (tile.road !== "none") {
        const dx = cx - (x + TILE / 2);
        const dy = cy - (y + TILE / 2);
        if (Math.abs(dx) < 11 && Math.abs(dy) < 11) {
          cx += dx >= 0 ? 13 : -13;
          cy += dy >= 0 ? 9 : -9;
        }
      }
      const s = 0.8 + hash01(tile.x, tile.y, 70 + i) * 0.3;
      paintTree(ctx, cx, cy, s);
    }
    return;
  }

  paintMeadow(ctx, tile, x, y, false);
  if (!nF) paintShoreGrass(ctx, x, y, "n", tile.x, tile.y);
  if (!eF) paintShoreGrass(ctx, x, y, "e", tile.x, tile.y);
  if (!sF) paintShoreGrass(ctx, x, y, "s", tile.x, tile.y);
  if (!wF) paintShoreGrass(ctx, x, y, "w", tile.x, tile.y);

  const edge = 12;
  let x0 = x + (wF ? -4 : edge);
  let y0 = y + (nF ? -4 : edge);
  let x1 = x + TILE + (eF ? 4 : -edge);
  let y1 = y + TILE + (sF ? 4 : -edge);
  if (x1 - x0 < 18) {
    const mid = (x0 + x1) / 2;
    x0 = mid - 9;
    x1 = mid + 9;
  }
  if (y1 - y0 < 18) {
    const mid = (y0 + y1) / 2;
    y0 = mid - 9;
    y1 = mid + 9;
  }

  ctx.save();
  ctx.beginPath();
  const clipX = x + (wF && !isWater(n.w) ? -6 : 1);
  const clipY = y + (nF && !isWater(n.n) ? -6 : 1);
  const clipW = TILE + (wF && !isWater(n.w) ? 6 : -1) + (eF && !isWater(n.e) ? 6 : -1);
  const clipH = TILE + (nF && !isWater(n.n) ? 6 : -1) + (sF && !isWater(n.s) ? 6 : -1);
  ctx.rect(clipX, clipY, clipW, clipH);
  ctx.clip();

  ctx.fillStyle = "rgba(58, 78, 40, 0.28)";
  ctx.beginPath();
  ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.max(8, (x1 - x0) / 2 - 2), Math.max(8, (y1 - y0) / 2 - 2), 0, 0, Math.PI * 2);
  ctx.fill();

  const trees = count >= 2 ? 4 + Math.floor(hash01(tile.x, tile.y, 2) * 2) : 3 + Math.floor(hash01(tile.x, tile.y, 2) * 2);
  for (let i = 0; i < trees; i++) {
    const u = hash01(tile.x, tile.y, 30 + i);
    const v = hash01(tile.x, tile.y, 50 + i);
    let cx = x0 + 7 + u * Math.max(8, x1 - x0 - 14);
    let cy = y0 + 10 + v * Math.max(8, y1 - y0 - 16);
    if (tile.road !== "none") {
      const dx = cx - (x + TILE / 2);
      const dy = cy - (y + TILE / 2);
      if (Math.abs(dx) < 11 && Math.abs(dy) < 11) {
        cx += dx >= 0 ? 13 : -13;
        cy += dy >= 0 ? 9 : -9;
      }
    }
    const s = 0.85 + hash01(tile.x, tile.y, 70 + i) * 0.35;
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

function paintFieldEarth(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#8a623c";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#9a7048";
  ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.fillStyle = "rgba(58, 40, 24, 0.28)";
  ctx.fillRect(x + 3, y + 8, TILE - 6, 3);
  ctx.fillRect(x + 4, y + 18, TILE - 8, 3);
  ctx.fillRect(x + 3, y + 28, TILE - 6, 3);
}

function paintCobbles(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, street: boolean) {
  ctx.fillStyle = street ? STREET_STONE : YARD_STONE;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, TILE, TILE);
  ctx.clip();
  let yy = y;
  for (let r = 0; r < 3; r++) {
    const rowH = r === 2 ? y + TILE - yy : 13 + hash01(tile.x, tile.y, 7 + r) * 3.5;
    const stagger = (r % 2) * (7 + hash01(tile.x, tile.y, 3 + r) * 6);
    let xx = x - stagger;
    let k = 0;
    while (xx < x + TILE + 2) {
      const w = 12 + hash01(tile.x, tile.y, 20 + r * 8 + k) * 8;
      const tone = hash01(tile.x, tile.y, 40 + r * 8 + k);
      if (street) {
        ctx.fillStyle = tone < 0.34 ? "#b7a68c" : tone < 0.67 ? "#c6b498" : "#a89074";
      } else {
        ctx.fillStyle = tone < 0.34 ? "#8c8274" : tone < 0.67 ? "#9c9182" : "#74685c";
      }
      ctx.fillRect(xx + 0.7, yy + 0.7, w - 1.4, rowH - 1.4);
      xx += w;
      k += 1;
    }
    yy += rowH;
  }
  ctx.fillStyle = "rgba(239, 230, 214, 0.28)";
  const chips = 1 + (hash01(tile.x, tile.y, 9) > 0.5 ? 1 : 0);
  for (let i = 0; i < chips; i++) {
    ctx.fillRect(
      x + 7 + hash01(tile.x, tile.y, 50 + i) * 28,
      y + 8 + hash01(tile.x, tile.y, 60 + i) * 26,
      2.6,
      2,
    );
  }
  ctx.restore();
}

function paintTile(ctx: CanvasRenderingContext2D, tile: Tile, world: World) {
  const x = tile.x * TILE;
  const y = tile.y * TILE;
  const lushForest = isWooded(tile);
  const crops = tile.amount > 0 && (tile.biome === "fertile" || tile.building === "field");
  const art = getArt();
  if (isWater(tile)) {
    paintRiverGround(ctx, tile, world, x, y, art);
  } else if (isYardPave(tile)) {
    paintCobbles(ctx, tile, x, y, false);
  } else if (isStreetPave(tile)) {
    paintCobbles(ctx, tile, x, y, true);
  } else if (tile.plot && isFieldFloor(tile)) {
    paintFieldEarth(ctx, x, y);
  } else if (lushForest) {
    paintForestGround(ctx, tile, world, x, y, art);
  } else if (tile.biome === "forest" || tile.biome === "plains" || (tile.biome === "fertile" && !crops)) {
    paintMeadow(ctx, tile, x, y, tile.biome === "fertile");
  } else {
    paintBiome(ctx, art?.tiles, tile.biome, x, y, true);
  }

  if (!isWater(tile)) paintWaterShade(ctx, tile, world, x, y);

  if (!isWater(tile)) paintCut(ctx, tile, x, y);

  if (tile.bank && !tile.pit) paintBank(ctx, x, y);
  if (tile.pit) paintPit(ctx, tile, world, x, y);

  if (tile.village) {
    if (!isYardPave(tile) && !isStreetPave(tile)) {
      ctx.fillStyle = "rgba(70, 90, 110, 0.2)";
      ctx.fillRect(x, y, TILE, TILE);
    }
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

  if (!isWater(tile)) paintHerb(ctx, tile, x, y);

  if (
    !isWater(tile) &&
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
  const live = (k: FenceKind | undefined): k is Exclude<FenceKind, "none"> => !!k && k !== "none" && FENCE_STR[k] > 0;
  const rank = (k: FenceKind | undefined) => (k === "wall" ? 4 : k === "palisade" ? 3 : k === "wood" ? 2 : k === "gate" ? 1 : 0);
  const stronger = (...ks: Array<FenceKind | undefined>): FenceKind => {
    let best: FenceKind = "none";
    for (const k of ks) {
      if (rank(k) > rank(best)) best = k ?? "none";
    }
    return best;
  };
  const spec = (kind: FenceKind) => {
    if (kind === "wall") return { fill: "#5c564e", top: "#8a8478", post: 7, rail: 5.5, pali: false };
    if (kind === "palisade") return { fill: "#3d3228", top: "#5a4030", post: 6.2, rail: 3.4, pali: true };
    return { fill: "#6b4a2f", top: "#8a623c", post: 5, rail: 3.2, pali: false };
  };

  const paintPost = (cx: number, cy: number, kind: FenceKind) => {
    if (!live(kind)) return;
    const look = kind === "gate" ? "wood" : kind;
    const s = spec(look);
    ctx.fillStyle = s.fill;
    if (look === "palisade") {
      ctx.fillRect(cx - 2.5, cy - 9, 5, 16);
      ctx.beginPath();
      ctx.moveTo(cx - 2.8, cy - 9);
      ctx.lineTo(cx, cy - 14);
      ctx.lineTo(cx + 2.8, cy - 9);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (look === "wall") {
      ctx.fillRect(cx - 3.6, cy - 5, 7.2, 10);
      ctx.fillStyle = s.top;
      ctx.fillRect(cx - 3.6, cy - 5, 7.2, 1.6);
      return;
    }
    ctx.fillRect(cx - 2.4, cy - 4.2, 4.8, 8.4);
    ctx.fillStyle = s.top;
    ctx.fillRect(cx - 2.4, cy - 4.2, 4.8, 1.4);
  };

  const paintRailH = (kind: FenceKind, yy: number) => {
    const s = spec(kind);
    const inset = s.post * 0.55 + 0.4;
    ctx.fillStyle = s.fill;
    ctx.fillRect(x + inset, yy - s.rail / 2, TILE - inset * 2, s.rail);
    ctx.fillStyle = s.top;
    ctx.fillRect(x + inset, yy - s.rail / 2, TILE - inset * 2, 1.2);
    if (!s.pali) return;
    ctx.fillStyle = s.fill;
    for (let i = 0; i < 3; i++) {
      const sx = x + 11 + i * 11;
      ctx.fillRect(sx - 1.6, yy - 8, 3.2, 12);
      ctx.beginPath();
      ctx.moveTo(sx - 1.9, yy - 8);
      ctx.lineTo(sx, yy - 12);
      ctx.lineTo(sx + 1.9, yy - 8);
      ctx.closePath();
      ctx.fill();
    }
  };

  const paintRailV = (kind: FenceKind, xx: number) => {
    const s = spec(kind);
    const inset = s.post * 0.55 + 0.4;
    ctx.fillStyle = s.fill;
    ctx.fillRect(xx - s.rail / 2, y + inset, s.rail, TILE - inset * 2);
    ctx.fillStyle = s.top;
    ctx.fillRect(xx - s.rail / 2, y + inset, 1.2, TILE - inset * 2);
    if (!s.pali) return;
    ctx.fillStyle = s.fill;
    for (let i = 0; i < 3; i++) {
      const sy = y + 11 + i * 11;
      ctx.fillRect(xx - 1.6, sy - 6, 3.2, 12);
      ctx.beginPath();
      ctx.moveTo(xx - 1.9, sy - 6);
      ctx.lineTo(xx, sy - 10);
      ctx.lineTo(xx + 1.9, sy - 6);
      ctx.closePath();
      ctx.fill();
    }
  };

  const nKind = tile.fenceN;
  const wKind = tile.fenceW;
  if (live(nKind) && nKind !== "gate") paintRailH(nKind, y);
  if (live(wKind) && wKind !== "gate") paintRailV(wKind, x);
  if (nKind === "gate") {
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(x + 8, y - 5.2, TILE - 16, 2.6);
    if (lockedEdge("n")) padlock(x + TILE / 2, y + 3);
  }
  if (wKind === "gate") {
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(x - 5.2, y + 8, 2.6, TILE - 16);
    if (lockedEdge("w")) padlock(x + 3, y + TILE / 2);
  }

  const east = tileAt(world, tile.x + 1, tile.y);
  const south = tileAt(world, tile.x, tile.y + 1);
  if (live(nKind) || live(wKind)) {
    paintPost(x, y, stronger(nKind, wKind));
  }
  if (live(nKind)) {
    paintPost(x + TILE, y, stronger(nKind, east?.fenceW));
  }
  if (live(wKind)) {
    paintPost(x, y + TILE, stronger(wKind, south?.fenceN));
  }

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
  if (tile.building !== "none" || tile.caravan || tile.commons || tile.plot) return;
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
      const keep = Math.min(2, tile.amount);
      for (let i = 0; i < keep; i++) {
        const sx = x + 12 + i * 14;
        paintTree(ctx, sx, y + 18, 0.7);
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
      if (t.plot && t.building !== "field" && !t.pit && t.biome !== "river" && t.biome !== "ford") ctx.fillStyle = "#8a7d64";
      else if (t.commons && !t.plot && t.biome !== "river") ctx.fillStyle = "#b09e82";
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
