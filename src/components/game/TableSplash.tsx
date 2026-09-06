import { GAME_VERSION } from "@/game/constants";
import { EmailGate } from "./EmailGate";

export function TableSplash({ text = "Открываю стол…" }: { text?: string }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-table p-6">
      <img
        src="/game/start.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div className="pointer-events-none absolute inset-0 bg-table/45" />
      <div className="relative z-10 max-w-sm text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-panel/80">Золотая Клетка · {GAME_VERSION}</p>
        <h1 className="mt-2 font-display text-4xl leading-none text-panel">Стол</h1>
        <p className="mt-4 text-sm text-panel/80">{text}</p>
      </div>
    </div>
  );
}

export function TableEnter() {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-table p-6">
      <img
        src="/game/start.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div className="pointer-events-none absolute inset-0 bg-table/50" />
      <EmailGate title="Одна поляна" />
    </div>
  );
}
