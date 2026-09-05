import { useEffect, useState } from "react";
import { GAME_VERSION, MEEPLE_COLORS } from "@/game/constants";
import { useGame } from "@/game/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HowToList } from "./HowTo";
import { ICO, Ico } from "./Sprite";

type Props = {
  error?: string | null;
  onStart: (name: string, color: string, seed: string) => void;
};

export function StartScreen({ error, onStart }: Props) {
  const [name, setName] = useState("Испытатель");
  const [color, setColor] = useState<string>(MEEPLE_COLORS[0]);
  const [seed, setSeed] = useState("kletka-land-02");
  const [more, setMore] = useState(false);
  const [help, setHelp] = useState(false);
  const bookStatus = useGame((s) => s.bookStatus);
  const bookOn = useGame((s) => s.bookOn);

  useEffect(() => {
    useGame.getState().warmup();
  }, []);

  const go = () => onStart(name, color, seed);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-table">
      <img
        src="/game/start.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div className="pointer-events-none absolute inset-0 bg-table/40" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-table via-table/80 to-transparent" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-end px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-panel">
          одна поляна
        </p>
        <h1 className="mt-2 font-display text-4xl leading-none tracking-tight text-panel md:text-5xl">
          Золотая Клетка
        </h1>
        <p className="mt-1 text-[11px] font-medium tracking-wide text-panel/70">версия {GAME_VERSION}</p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-panel/80">
          Клетка пишется в книгу мира. Пока ты один — та же поляна, на которую потом выйдут другие.
        </p>
        <div className="mt-4 flex gap-2">
          {[ICO.gold, ICO.wood, ICO.food, ICO.stake, ICO.house, ICO.bag].map((i) => (
            <Ico key={i} i={i} className="size-11 overflow-hidden rounded-[12px] shadow-sm" alt="" />
          ))}
        </div>

        <form
          className="mt-5 rounded-[28px] border border-border bg-panel p-5 shadow-panel"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="name">
            Имя фишки
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 h-12 w-full rounded-[12px] border border-border bg-raised px-3 text-base text-foreground outline-none ring-ring focus:ring-2"
          />

          <p className="mt-4 text-xs font-medium text-muted-foreground">Цвет</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {MEEPLE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn(
                  "size-11 rounded-full border-2",
                  color === c ? "border-foreground" : "border-transparent",
                )}
                style={{ background: c }}
              />
            ))}
          </div>

          {!bookOn && (
            <>
          <button
            type="button"
            className="mt-4 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setMore((v) => !v)}
          >
            {more ? "Скрыть семя карты" : "Семя карты"}
          </button>
          {more && (
            <input
              id="seed"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="mt-2 h-12 w-full rounded-[12px] border border-border bg-raised px-3 font-mono text-sm text-foreground outline-none ring-ring focus:ring-2"
            />
          )}
            </>
          )}

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <button
            type="button"
            className="mt-4 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setHelp((v) => !v)}
          >
            {help ? "Скрыть как играть" : "Как играть"}
          </button>
          {help && (
            <div className="mt-3 rounded-[16px] bg-raised px-3 py-3">
              <HowToList />
            </div>
          )}

          <Button type="submit" className="mt-5 h-12 w-full text-base" size="lg" disabled={bookStatus === "loading"}>
            {bookStatus === "loading" ? "Книга открывается…" : "Выйти на поляну"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function Splash({ label }: { label: string }) {
  return (
    <div className="relative flex min-h-dvh items-end justify-center overflow-hidden bg-table">
      <img src="/game/start.jpg" alt="" className="pointer-events-none absolute inset-0 size-full object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-table/50" />
      <p className="relative z-10 mb-16 px-6 text-center font-display text-2xl text-panel">{label}</p>
    </div>
  );
}
