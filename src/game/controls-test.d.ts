export {};

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys?: (codes: string[]) => void;
    };
    __gameTest?: {
      clickTile: (x: number, y: number) => void;
      startNew: () => void;
      inspect: (x: number, y: number) => void;
      closeInspect: () => void;
      goTo: (x: number, y: number) => void;
      stopWalk: () => void;
      catchUp: () => void;
      fastTravel: () => boolean;
      pos: () => { x: number; y: number; t: string };
      debug: () => unknown;
      pace: () => unknown;
      focusMe: () => void;
      excavateHere: () => void;
      fillPit: () => void;
      burnHere: () => void;
      fishHere: () => void;
      setHand: (item: string | null) => void;
      grant: (k: "wood" | "stone" | "cart" | "horse" | "gold" | "wagon" | "lock") => void;
      hangLock: (kind: "chest" | "gate") => void;
      takeLock: (kind: "chest" | "gate") => void;
      pickLock: (kind: "chest" | "gate") => void;
      buyLock: () => void;
      stealHere: () => void;
      drop: (item: string, n: number) => void;
      restHere: () => void;
      sleepHere: () => void;
      putRoof: () => void;
      setEnergy: (n: number) => void;
      setWarmth: (n: number) => void;
      setPos: (x: number, y: number) => void;
      setLife: (life: "alive" | "down" | "dead") => void;
      jail: (ms?: number) => void;
      buyCart: () => void;
      craftCart: () => void;
      setTransport: (t: "walk" | "cart" | "horse" | "wagon") => void;
      hitchWagon: () => void;
      unhitchWagon: () => void;
      stealWagon: () => void;
      craftWagon: () => void;
      buyWagon: () => void;
      putWagon: (who?: string) => void;
      putBench: () => void;
      setProfession: (p: "wanderer" | "carpenter" | "smith") => void;
      give: (item: string, n: number) => void;
      clearWagon: () => void;
      setTool: (
        t: "move" | "dirt" | "stone" | "bridge" | "gather" | "claim" | "build",
      ) => void;
    };
  }
}
