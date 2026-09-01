import { Component, useEffect, useState, type ReactNode } from "react";
import { ensureArt } from "@/game/art";
import { CAPACITY } from "@/game/constants";
import { deathFee } from "@/game/pace";
import { nextGoal } from "@/game/goal";
import { enterCost } from "@/game/travel";
import { useGame } from "@/game/store";
import { tileAt } from "@/game/worldgen";
import { BoardCanvas } from "./BoardCanvas";
import { Hud } from "./Hud";
import { StartScreen } from "./StartScreen";

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(err: Error) {
    return { err: err.message || "ошибка стола" };
  }
  render() {
    if (this.state.err) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-table p-6 text-center text-panel">
          <div>
            <p className="font-display text-2xl">Стол сбился</p>
            <p className="mt-2 text-sm text-panel/80">{this.state.err}</p>
            <button
              type="button"
              className="mt-4 h-12 rounded-[12px] bg-panel px-5 text-foreground"
              onClick={() => {
                useGame.getState().reset();
                this.setState({ err: null });
              }}
            >
              Начать заново
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function GameApp() {
  const started = useGame((s) => s.started);
  const boot = useGame((s) => s.boot);
  const persist = useGame((s) => s.persist);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureArt();
    try {
      boot();
    } catch {
      /* ignore broken save */
    }
    useGame.getState().warmup();
  }, [boot]);

  useEffect(() => {
    window.__gameTest = {
      clickTile: (x: number, y: number) => useGame.getState().clickTile(x, y),
      startNew: () => useGame.getState().startNew("Испытатель", "#6b3a2a", "kletka-seed-01"),
      inspect: (x: number, y: number) => useGame.getState().inspectTile(x, y),
      closeInspect: () => useGame.getState().closeInspect(),
      goTo: (x: number, y: number) => useGame.getState().goTo(x, y),
      stopWalk: () => useGame.getState().stopWalk(),
      catchUp: () => useGame.getState().catchUp(),
      fastTravel: () => {
        const t = useGame.getState().travel;
        if (!t) return false;
        useGame.setState({ travel: { ...t, t0: Date.now() - (t.total + 2) * 1000 } });
        useGame.getState().catchUp();
        return true;
      },
      pos: () => {
        const c = useGame.getState().character;
        return { x: c.x, y: c.y, t: c.transport };
      },
      debug: () => {
        const s = useGame.getState();
        const hamlets: Record<string, { x: number; y: number }> = {};
        for (const t of s.world.tiles) {
          if (t.plot && t.owner && t.owner !== "you" && !hamlets[t.owner]) hamlets[t.owner] = { x: t.x, y: t.y };
        }
        return {
          started: s.started,
          tiles: s.world.tiles.length,
          travel: s.travel,
          tool: s.tool,
          log0: s.log[0],
          x: s.character.x,
          y: s.character.y,
          busy: s.character.busy,
          life: s.character.life,
          jail: s.character.jailedUntil,
          jailWhy: s.character.jailWhy,
          gold: s.character.gold,
          hp: s.character.hp,
          invWood: s.character.inventory.wood,
          energy: s.character.energy,
          deaths: s.character.deaths,
          stillUntil: s.character.stillUntil,
          resting: s.character.resting,
          warmth: s.character.warmth,
          hint: s.hint?.text ?? "",
          goal: nextGoal(s),
          building: s.world.tiles[s.character.y * s.world.width + s.character.x]?.building ?? "none",
          transport: s.character.transport,
          carts: s.character.carts ?? 0,
          horses: s.character.horses ?? 0,
          wagon: !!(s.character.wagon || s.character.transport === "wagon"),
          tileWagon: s.world.tiles[s.character.y * s.world.width + s.character.x]?.wagon ?? "",
          cap: CAPACITY[s.character.transport],
          chestLock: !!s.world.tiles[s.character.y * s.world.width + s.character.x]?.chestLock,
          gateLock: !!s.world.tiles[s.character.y * s.world.width + s.character.x]?.gateLock,
          invLock: s.character.inventory.lock ?? 0,
          hamletHouse: (() => {
            const t = s.world.tiles.find((q) => q.chestLock && q.owner && q.owner !== "you" && (q.building === "shack" || q.building === "house"));
            return t ? { x: t.x, y: t.y, owner: t.owner } : null;
          })(),
          caravan: s.world.tiles.find((t) => t.caravan)
            ? { x: s.world.tiles.find((t) => t.caravan)!.x, y: s.world.tiles.find((t) => t.caravan)!.y }
            : null,
          hamlets,
        };
      },
      pace: () => {
        const s = useGame.getState();
        const from = tileAt(s.world, s.character.x, s.character.y);
        if (!from) return null;
        let to = tileAt(s.world, s.character.x + 1, s.character.y);
        if (!to || to.biome === "river") to = tileAt(s.world, s.character.x, s.character.y + 1);
        if (!from || !to) return null;
        const inv = { ...s.character.inventory };
        for (const k of Object.keys(inv) as (keyof typeof inv)[]) inv[k] = 0;
        const opts = { inventory: inv, weather: "clear" as const, diagonal: false };
        return {
          walk: enterCost(from, to, { ...opts, transport: "walk" }),
          cart: enterCost(from, to, { ...opts, transport: "cart" }),
          horse: enterCost(from, to, { ...opts, transport: "horse" }),
          wagon: enterCost(from, to, { ...opts, transport: "wagon" }),
          road: to.road,
          biome: to.biome,
        };
      },
      buyCart: () => useGame.getState().buyCart(),
      craftCart: () => useGame.getState().craftCart(),
      setTransport: (t: "walk" | "cart" | "horse" | "wagon") => useGame.getState().setTransport(t),
      grant: (k: "wood" | "stone" | "cart" | "horse" | "gold" | "wagon" | "lock") => useGame.getState().grant(k),
      hangLock: (kind: "chest" | "gate") => useGame.getState().hangLock(kind),
      takeLock: (kind: "chest" | "gate") => useGame.getState().takeLock(kind),
      pickLock: (kind: "chest" | "gate") => useGame.getState().pickLock(kind),
      buyLock: () => useGame.getState().buyLock(),
      stealHere: () => useGame.getState().stealHere(),
      hitchWagon: () => useGame.getState().hitchWagon(),
      unhitchWagon: () => useGame.getState().unhitchWagon(),
      stealWagon: () => useGame.getState().stealWagon(),
      craftWagon: () => useGame.getState().craftWagon(),
      buyWagon: () => useGame.getState().buyWagon(),
      putWagon: (who = "you") => {
        const s = useGame.getState();
        const t = s.world.tiles[s.character.y * s.world.width + s.character.x];
        if (!t) return;
        t.wagon = who;
        useGame.setState({ world: { ...s.world, tiles: s.world.tiles } });
      },
      putBench: () => {
        const s = useGame.getState();
        const t = s.world.tiles[s.character.y * s.world.width + s.character.x];
        if (!t) return;
        t.building = "bench";
        t.plot = true;
        t.owner = "you";
        t.owned = true;
        t.burned = false;
        t.matter = "wood";
        useGame.setState({ world: { ...s.world, tiles: s.world.tiles } });
      },
      setProfession: (p: "wanderer" | "carpenter" | "smith") => {
        const s = useGame.getState();
        useGame.setState({ character: { ...s.character, profession: p } });
      },
      give: (item: string, n: number) => {
        const s = useGame.getState();
        const inv = { ...s.character.inventory };
        const k = item as keyof typeof inv;
        if (!(k in inv)) return;
        inv[k] += n;
        useGame.setState({ character: { ...s.character, inventory: inv } });
      },
      clearWagon: () => {
        const s = useGame.getState();
        for (const t of s.world.tiles) if (t.wagon) t.wagon = "";
        useGame.setState({
          character: {
            ...s.character,
            wagon: false,
            transport: s.character.transport === "wagon" ? (s.character.horses > 0 ? "horse" : "walk") : s.character.transport,
          },
          world: { ...s.world, tiles: s.world.tiles },
        });
      },
      drop: (item: string, n: number) => useGame.getState().dropItem(item as "wood", n),
      restHere: () => useGame.getState().restHere(),
      sleepHere: () => useGame.getState().sleepHere(),
      putRoof: () => {
        const s = useGame.getState();
        const t = s.world.tiles[s.character.y * s.world.width + s.character.x];
        if (!t) return;
        t.building = "shack";
        t.plot = true;
        t.owner = "you";
        t.owned = true;
        t.burned = false;
        t.matter = "wattle";
        useGame.setState({ world: { ...s.world, tiles: s.world.tiles } });
      },
      setEnergy: (n: number) => {
        const s = useGame.getState();
        useGame.setState({
          character: { ...s.character, energy: n, energyAt: Date.now(), resting: n >= 18 ? false : s.character.resting },
        });
      },
      setWarmth: (n: number) => {
        const s = useGame.getState();
        useGame.setState({ character: { ...s.character, warmth: n } });
      },
      setPos: (x: number, y: number) => {
        const s = useGame.getState();
        useGame.setState({
          character: { ...s.character, x, y, px: x, py: y },
          travel: null,
          preview: null,
        });
      },
      setLife: (life: "alive" | "down" | "dead") => {
        const s = useGame.getState();
        const c = s.character;
        if (life === "down" && c.life === "alive") {
          const tile = s.world.tiles[c.y * s.world.width + c.x];
          if (tile && c.inventory.wood > 0) {
            tile.pile = { item: "wood", amount: (tile.pile?.item === "wood" ? tile.pile.amount : 0) + c.inventory.wood };
            c.inventory = { ...c.inventory, wood: 0 };
          }
          useGame.setState({
            travel: null,
            preview: null,
            character: {
              ...c,
              life,
              hp: 0,
              downAt: Date.now(),
              deadUntil: 0,
              inventory: { ...c.inventory, wood: 0 },
            },
            world: { ...s.world, tiles: s.world.tiles },
          });
          return;
        }
        if (life === "dead") {
          const n = c.deaths ?? 0;
          const fee = Math.min(c.gold, deathFee(n));
          useGame.setState({
            travel: null,
            preview: null,
            character: {
              ...c,
              life: "dead",
              hp: 0,
              gold: c.gold - fee,
              deaths: n + 1,
              downAt: c.downAt || Date.now(),
              deadUntil: Date.now() + 120000,
              jailedUntil: 0,
            },
          });
          return;
        }
        useGame.setState({
          character: {
            ...c,
            life,
            hp: 100,
            downAt: 0,
            deadUntil: 0,
            jailedUntil: 0,
            stillUntil: 0,
          },
        });
      },
      jail: (ms = 80000) => {
        const s = useGame.getState();
        const c = s.character;
        useGame.setState({
          travel: null,
          preview: null,
          character: { ...c, jailedUntil: Date.now() + ms, jailWhy: "кража", life: "jailed", busy: null },
        });
      },
      setTool: (t: "move" | "dirt" | "stone" | "bridge" | "gather" | "claim" | "build") =>
        useGame.getState().setTool(t),
    };
    let debounce = 0;
    const persistNow = () => useGame.getState().persist();
    const unsub = useGame.subscribe((s, prev) => {
      if (!s.started) return;
      if (
        s.world === prev.world &&
        s.character === prev.character &&
        s.started === prev.started &&
        s.travel === prev.travel &&
        s.jobs === prev.jobs &&
        s.trader === prev.trader &&
        s.day === prev.day &&
        s.clock === prev.clock
      ) {
        return;
      }
      window.clearTimeout(debounce);
      debounce = window.setTimeout(persistNow, 400);
    });
    const id = window.setInterval(() => {
      if (useGame.getState().started) persistNow();
    }, 20000);
    const onHide = () => {
      if (document.visibilityState === "hidden") persistNow();
      else useGame.getState().catchUp();
    };
    const onShow = () => useGame.getState().catchUp();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", persistNow);
    window.addEventListener("beforeunload", persistNow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/kletka-sw.js").catch(() => undefined);
    }
    return () => {
      unsub();
      window.clearInterval(id);
      window.clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", persistNow);
      window.removeEventListener("beforeunload", persistNow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [persist]);

  const onStart = (name: string, color: string, seed: string) => {
    setError(null);
    try {
      useGame.getState().startNew(name, color, seed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Стол не сложился. Попробуй ещё раз.");
    }
  };

  if (!started) {
    return <StartScreen error={error} onStart={onStart} />;
  }

  return (
    <Boundary>
      <div className="kletka-hud fixed inset-0 overflow-hidden bg-table">
        <BoardCanvas />
        <Hud />
      </div>
    </Boundary>
  );
}
