import { useEffect, useRef } from "react";
import { tileToScreen } from "@/game/cam";
import { useGame } from "@/game/store";
import { cn } from "@/lib/utils";

export function Floaters() {
  const floaters = useGame((s) => s.floaters);
  const drop = useGame((s) => s.dropFloater);
  const nodes = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      for (const f of useGame.getState().floaters) {
        const el = nodes.current.get(f.id);
        if (!el) continue;
        const p = tileToScreen(f.x, f.y);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y - 18}px`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-[42] overflow-hidden">
      {floaters.map((f) => (
        <div
          key={f.id}
          ref={(el) => {
            if (el) nodes.current.set(f.id, el);
            else nodes.current.delete(f.id);
          }}
          onAnimationEnd={() => drop(f.id)}
          className={cn(
            "kletka-floater absolute left-0 top-0 whitespace-nowrap rounded-full border border-border bg-panel px-2.5 py-1 font-display text-sm shadow-panel",
            f.tone === "bad" && "text-danger",
            f.tone === "gold" && "text-foreground",
          )}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
}
