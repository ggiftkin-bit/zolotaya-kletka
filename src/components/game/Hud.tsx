import { useEffect, useState } from "react";
import { BAG_CELLS, CAPACITY, GAME_VERSION, ITEM_LABEL, ITEM_WEIGHT, ITEMS, TICK_SEC, TICKS_PER_DAY, TRANSPORT_LABEL, WEATHER_LABEL } from "@/game/constants";
import { BUILDING_LABEL, CART_GOLD, CART_WOOD, goldTxt } from "@/game/economy";
import { EAT_ORDER, EAT_SAT } from "@/game/craft";
import { nextGoal } from "@/game/goal";
import { BAIL_GOLD, BOOST_GOLD, DOWN_MS, ENERGY_MAX, HIRE_GOLD, SKIP_GOLD, deathFee, formatWait, nextEnergyIn, regenPaused } from "@/game/pace";
import { isHeld, isJailed, isStill, isYours } from "@/game/crime";
import { TOOL_ITEMS } from "@/game/life";
import { BUSY_LABEL, isRoof, isWearId, remainingWear, type WearId } from "@/game/work";
import { useGame } from "@/game/store";
import { pawnKg } from "@/game/travel";
import { asPile, pileEmpty, pileLabel } from "@/game/pile";
import { foeById, gearSlot, ghostLiveFoe } from "@/game/fight";
import type { BuildingKind, ItemId, ToolMode, Weather } from "@/game/types";
import { tileAt } from "@/game/worldgen";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Floaters } from "./Floaters";
import { Book, type BookTab } from "./HowTo";
import { ICO, Ico, ItemPic, WeatherPic, GearPic, GEAR_ICO } from "./Sprite";
import { TileBubble } from "./TileBubble";
import { UserButton } from "@/lib/auth/gates";

const BUILDINGS: Exclude<BuildingKind, "none" | "workshop" | "shop" | "board" | "mine" | "stable">[] = [
  "shack",
  "house",
  "field",
  "well",
  "pen",
  "shed",
  "tower",
  "jail",
  "bench",
  "forge",
  "oven",
  "smoke",
  "herbs",
  "stall",
  "coalpit",
  "adit",
  "stakes",
  "moat",
];

const GEAR_PACK: ItemId[] = [
  "axe",
  "pick",
  "rope",
  "spear",
  "shovel",
  "rod",
  "club",
  "knife",
  "board_shield",
  "bar_shield",
  "wadded",
  "helm",
];

const HINT: Partial<Record<ToolMode, string>> = {
  move: "тап — наклейки. Пойти — отдельная",
  gather: "стой на клетке с деревьями / дичью и жми ещё раз",
  claim: "два тапа — два угла двора, забор сам по краю",
  dirt: "тапни соседнюю — грунт. Тракт быстрее, путь его держит",
  stone: "тапни соседнюю — камень",
  bridge: "тапни реку — мост",
  build: "выбери постройку в ряду выше и тапни соседнюю клетку",
};

export function Hud() {
  const g = useGame();
  const [bag, setBag] = useState(false);
  const [tab, setTab] = useState<"pack" | "tools" | "chest">("pack");
  const [bye, setBye] = useState(false);
  const [help, setHelp] = useState(false);
  const [bookTab, setBookTab] = useState<BookTab>("table");
  const [power, setPower] = useState(false);
  const [vitals, setVitals] = useState<"hp" | "water" | null>(null);
  const [food, setFood] = useState(false);
  const [cell, setCell] = useState<ItemId | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inv = g.character.inventory;
  const here = tileAt(g.world, g.character.x, g.character.y);
  const weight = pawnKg(g.character);
  const cap = CAPACITY[g.character.transport];
  const hungry = g.character.satiety < 25;
  const thirsty = g.character.water < 25;
  const cold = g.character.warmth < 20;
  const tired = g.character.energy < 3;
  const goal = nextGoal(g);
  const jailed = isJailed(g.character, now);
  const held = isHeld(g.character, now);
  const down = g.character.life === "down";
  const dead = g.character.life === "dead";
  const still = isStill(g.character, now);
  const wait = nextEnergyIn(g.character, now, isRoof(here) || (g.character.profession === "hireling" && g.character.resting), !!g.travel);
  const busy = !held && g.character.busy && g.character.busy.until > now ? g.character.busy : null;
  const walkLeft = g.travel
    ? Math.ceil(g.travel.path.slice(g.travel.index).reduce((a, l) => a + l.cost, 0) - g.travel.elapsed)
    : 0;
  const paused = regenPaused(g.character, now, !!g.travel);
  const wounded = g.character.hp < 40;
  const ownChest =
    here &&
    isYours(here) &&
    (here.building === "shack" || here.building === "house" || here.building === "shed" || here.owned);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (g.inspect || g.meet) {
      setBag(false);
      setHelp(false);
      setPower(false);
      setVitals(null);
      setFood(false);
    }
  }, [g.inspect, g.meet]);

  useEffect(() => {
    if (!bag) return;
    if (tab === "chest" && !ownChest) {
      setTab("pack");
      setCell(null);
      return;
    }
    if (!cell) return;
    if (tab === "chest") {
      if ((here?.chest?.[cell] ?? 0) > 0) return;
      setCell(null);
      return;
    }
    if ((inv[cell] ?? 0) > 0) return;
    setCell(null);
  }, [bag, tab, cell, inv, ownChest, here]);

  useEffect(() => {
    if (!bye) return;
    const id = window.setTimeout(() => setBye(false), 2500);
    return () => window.clearTimeout(id);
  }, [bye]);

  const openBag = (next: "pack" | "tools" = "pack") => {
    g.closeInspect();
    setHelp(false);
    setPower(false);
    setVitals(null);
    setFood(false);
    if (bag && tab === next) {
      setBag(false);
      return;
    }
    setTab(next);
    setCell(null);
    setBag(true);
  };

  const openHelp = () => {
    g.closeInspect();
    setBag(false);
    setPower(false);
    setFood(false);
    setHelp((v) => !v);
  };

  const openFood = () => {
    g.closeInspect();
    setBag(false);
    setHelp(false);
    setPower(false);
    setVitals(null);
    setFood((v) => !v);
  };

  return (
    <>
      <Floaters />
      {g.meet && <MeetSheet />}
      {!g.meet && !bag && !help && !food && <TileBubble />}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 px-2 pt-[max(0.4rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto mx-auto flex max-w-lg items-stretch gap-1">
          <Chip ico={ICO.gold} value={g.character.gold} label="золото" onClick={() => openBag("pack")} wide />
          <Chip
            ico={ICO.boots}
            value={Math.floor(g.character.energy)}
            label={jailed ? "яма" : down ? "упал" : dead ? "погиб" : still ? "лежит" : "сила"}
            warn={tired || jailed || down || dead || still}
            onClick={() => {
              g.closeInspect();
              setBag(false);
              setHelp(false);
              setVitals(null);
              setPower((v) => !v);
            }}
          />
          <Chip
            ico={ICO.eat}
            value={Math.round(g.character.satiety)}
            label="сытость"
            warn={hungry}
            onClick={() => openFood()}
          />
          <Chip
            ico={ICO.house}
            value={Math.round(g.character.warmth)}
            label="тепло"
            warn={cold}
            onClick={() => openBag("pack")}
          />
          <Chip
            ico={ICO.stake}
            value={Math.round(g.character.hp)}
            label="здоровье"
            warn={wounded || down}
            onClick={() => {
              g.closeInspect();
              setBag(false);
              setHelp(false);
              setPower(false);
              setVitals((v) => (v === "hp" ? null : "hp"));
            }}
          />
          <button
            type="button"
            aria-label="Как играть"
            onClick={openHelp}
            className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-panel shadow-panel"
          >
            <Ico i={ICO.help} className="size-7 overflow-hidden rounded-md" alt="" />
          </button>
        </div>
        <PhaseStrip
          phase={g.phase}
          weather={g.weather}
          tickOfDay={g.tickOfDay}
          tickAt={g.tickAt || now}
          water={g.character.water}
          thirsty={thirsty}
          onWater={() => {
            g.closeInspect();
            setBag(false);
            setHelp(false);
            setPower(false);
            setVitals((v) => (v === "water" ? null : "water"));
          }}
        />
        {jailed && (
          <button
            type="button"
            onClick={() => g.bailOut()}
            className="pointer-events-auto mx-auto mt-1 flex h-12 w-full max-w-lg items-center justify-center rounded-2xl border border-danger bg-panel px-3 font-display text-base shadow-panel"
          >
            залог {goldTxt(BAIL_GOLD)}
          </button>
        )}
        {(jailed || down || dead || still || busy || g.travel || ((goal || g.hint) && !busy && !g.travel)) && (
          <p className="pointer-events-none mx-auto mt-1 max-w-lg line-clamp-2 rounded-xl bg-table/75 px-2 py-1 text-center text-xs leading-snug text-panel">
          {dead
            ? `Погиб. Выйдешь дома через ${formatWait(Math.max(0, g.character.deadUntil - now))}`
            : down
              ? isRoof(here)
                ? `Упал. Ползи к шалашу. Под крышей ${formatWait(Math.max(0, 3000 - (now - (g.character.downAt || now))))}`
                : `Упал. Ползи к шалашу. Без крыши ${formatWait(Math.max(0, DOWN_MS - (now - (g.character.downAt || now))))} — погиб`
              : jailed
            ? `Яма${g.character.jailWhy ? ` · ${g.character.jailWhy}` : ""}. Залог ${goldTxt(BAIL_GOLD)}. Ещё ${formatWait(g.character.jailedUntil - now)}`
            : still
              ? `Сутки без хода · ${formatWait(g.character.stillUntil - now)}`
              : busy
                ? `${BUSY_LABEL[busy.kind]} ещё ${formatWait(busy.until - now)}`
                : g.travel
                  ? `идёшь ${walkLeft} с`
              : g.hint
                ? g.hint.text
              : goal}
        </p>
        )}
        {power && (
          <div className="pointer-events-auto mx-auto mt-1.5 max-w-lg rounded-2xl border border-border bg-panel p-3 shadow-panel">
            <p className="flex items-center gap-2 font-display text-xl leading-none">
              <Ico i={ICO.boots} className="size-8 overflow-hidden rounded-md" alt="" />
              Сила {Math.floor(g.character.energy)}/{ENERGY_MAX}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {dead
                ? "Двор стоит. Сундук дома цел. Выйдешь на своём дворе, потом сутки без хода."
                : down
                  ? isRoof(here)
                    ? "Ты под крышей. Через миг поднимешься. Ноша выпала на клетку — подбери."
                    : `Упал. Ноша выпала. Дойди до шалаша — там поднимешься. Без крыши через ${formatWait(Math.max(0, DOWN_MS - (now - (g.character.downAt || now))))} погибнешь.`
                  : jailed
                ? `Сидишь${g.character.jailWhy ? ` · ${g.character.jailWhy}` : ""}. Жди или залог.`
                : still
                  ? `Отлёживаешься. Ход через ${formatWait(g.character.stillUntil - now)}.`
                : g.character.energy >= ENERGY_MAX
                  ? "Полная."
                  : paused && busy
                    ? `пока ${BUSY_LABEL[busy.kind]} — сила не растёт`
                    : `Следующая +1 через ${formatWait(wait)}. Поле 90 с, крыша 45 с, сон 20 с. Еда сытость, не сила.`}
            </p>
            {g.character.wanted > 0 && (
              <p className="mt-1 text-[12px] text-danger">Розыск {g.character.wanted}</p>
            )}
            {g.hint && (
              <p className={cn("mt-2 text-sm leading-snug", g.hint.tone === "bad" && "text-danger")}>{g.hint.text}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <Button className="h-12" variant="outline" onClick={() => g.restHere()}>
                {g.character.resting ? "встать" : "лечь дома"}
              </Button>
              <Button className="h-12" onClick={() => g.boostEnergy()} disabled={jailed || down || dead}>
                кружка {goldTxt(BOOST_GOLD)}
              </Button>
              {jailed && (
                <Button className="col-span-2 h-12" onClick={() => g.bailOut()}>
                  залог {goldTxt(BAIL_GOLD)}
                </Button>
              )}
            </div>
          </div>
        )}
        {vitals === "hp" && (
          <div className="pointer-events-auto mx-auto mt-1.5 max-w-lg rounded-2xl border border-border bg-panel p-3 shadow-panel">
            <p className="font-display text-xl leading-none">Здоровье {Math.round(g.character.hp)}</p>
            <p className="mt-2 text-sm leading-snug text-muted-foreground">
              Ест здоровье: сытость 0, тепло 0, вода тела 0. Растёт под крышей при сытости больше 40 — +3 за тик; в поле, если сытость, тепло и вода все больше 40 — +1. Настой как был. На нуле — упал.
            </p>
          </div>
        )}
        {vitals === "water" && (
          <WaterSheet onClose={() => setVitals(null)} />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-50 p-2 pb-[max(0.4rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto mx-auto max-w-lg">
            {busy && !bag && !help && !food && (
              <div className="mb-1.5 grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => g.skipBusy()}
                  className="h-11 min-w-0 rounded-[16px] border border-border bg-panel px-1.5 text-[12px] font-display leading-tight shadow-panel"
                >
                  ускорить {goldTxt(SKIP_GOLD)}
                </button>
                <button
                  type="button"
                  onClick={() => g.hireBusy()}
                  className="h-11 min-w-0 rounded-[16px] border border-border bg-panel px-1.5 text-[12px] leading-tight shadow-panel"
                >
                  руки {goldTxt(HIRE_GOLD)}
                </button>
                <button
                  type="button"
                  onClick={() => g.cancelBusy()}
                  className="h-11 min-w-0 rounded-[16px] border border-border bg-panel px-1.5 text-[12px] leading-tight shadow-panel"
                >
                  бросить
                </button>
              </div>
            )}
          {g.travel && !bag && !help && !food && !held && (
              <button
                type="button"
                onClick={() => g.skipTravel()}
                className="mb-1.5 flex h-11 w-full items-center justify-center rounded-[16px] border border-border bg-panel px-3 text-[13px] font-display shadow-panel"
              >
                ускорить {goldTxt(SKIP_GOLD)}
              </button>
            )}
            {!bag &&
              !help &&
              (g.tool === "build" || g.tool === "dirt" || g.tool === "stone" || g.tool === "bridge" || g.tool === "claim") && (
              <div className="mb-1.5 flex gap-1 overflow-x-auto rounded-[18px] border border-border bg-panel p-1 shadow-panel">
                {g.tool === "claim" ? (
                  <>
                    <p className="flex h-11 min-w-0 flex-1 items-center px-2 text-xs leading-snug text-muted-foreground">
                      {g.plotMark
                        ? `Угол 1: ${g.plotMark.x},${g.plotMark.y}. Ткни второй.`
                        : "Первый тап — угол, второй — замкнуть тын."}
                    </p>
                    {g.plotMark && (
                      <Button size="sm" className="h-11 shrink-0" variant="outline" onClick={() => g.cancelPlot()}>
                        снять угол
                      </Button>
                    )}
                  </>
                ) : g.tool !== "build" ? (
                  (["dirt", "stone", "bridge"] as const).map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      className="h-11 flex-1"
                      variant={g.tool === k ? "default" : "outline"}
                      onClick={() => g.setTool(k)}
                    >
                      {k === "dirt" ? "грунт" : k === "stone" ? "камень" : "мост"}
                    </Button>
                  ))
                ) : (
                  BUILDINGS.map((b) => (
                    <Button
                      key={b}
                      size="sm"
                      className="h-11 shrink-0 px-3"
                      variant={g.buildKind === b ? "default" : "outline"}
                      onClick={() => g.setBuildKind(b)}
                    >
                      {BUILDING_LABEL[b]}
                    </Button>
                  ))
                )}
              </div>
            )}
            {!bag && !help && !g.inspect && (
              <p className="mb-1 text-center text-[11px] text-panel/90">{HINT[g.tool]}</p>
            )}
            <div className="flex gap-1 rounded-[20px] border border-border bg-panel p-1 shadow-panel">
              {g.travel || busy ? (
                <button
                  type="button"
                  onClick={() => {
                    if (g.travel) g.stopWalk();
                    else if (busy) g.cancelBusy();
                  }}
                  className="flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] bg-accent text-accent-foreground"
                >
                  <Ico i={ICO.boots} className="size-7 overflow-hidden rounded-md" alt="" />
                  <span className="text-[10px] font-medium leading-none">Стоп</span>
                </button>
              ) : (
                <div className="h-12 min-w-0 flex-1" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => {
                  setBag(false);
                  setHelp(false);
                  setFood(false);
                  g.focusMe();
                }}
                className="flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] text-foreground"
              >
                <Ico i={ICO.boots} className="size-7 overflow-hidden rounded-md" alt="" />
                <span className="text-[10px] font-medium leading-none">Ко мне</span>
              </button>
              <button
                type="button"
                onClick={() => openFood()}
                className={cn(
                  "flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px]",
                  food ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <Ico i={ICO.eat} className="size-7 overflow-hidden rounded-md" alt="" />
                <span className="text-[10px] font-medium leading-none">Съесть</span>
              </button>
              <button
                type="button"
                onClick={() => openBag("pack")}
                className={cn(
                  "flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px]",
                  bag && "bg-accent text-accent-foreground",
                )}
              >
                <Ico i={ICO.bag} className="size-7 overflow-hidden rounded-md" alt="" />
                <span className="text-[10px] font-medium leading-none">Сумка</span>
              </button>
            </div>
          </div>
        </div>

      {food && (
        <div className="absolute inset-0 z-40 bg-table/50" onClick={() => setFood(false)} role="presentation">
          <div
            className="absolute inset-x-0 bottom-[var(--hud-dock)] mx-auto max-w-lg overflow-y-auto rounded-t-[24px] border border-border bg-panel px-4 pb-4 pt-3 shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-display text-2xl leading-none">Еда</p>
              <button type="button" className="size-11 text-xl text-muted-foreground" onClick={() => setFood(false)}>
                ×
              </button>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">Сытость. Силу еда не копирует.</p>
            <div className="mt-3 flex flex-col gap-2">
              {EAT_ORDER.filter((k) => (inv[k] ?? 0) > 0).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="flex h-14 items-center gap-3 rounded-[16px] border border-border bg-raised px-3 text-left"
                  onClick={() => {
                    g.eat(k);
                    setFood(false);
                  }}
                >
                  <ItemPic id={k} className="size-10 overflow-hidden rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-xl leading-none">{ITEM_LABEL[k]}</span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      ×{inv[k]} · сытость +{EAT_SAT[k] ?? 14}
                    </span>
                  </span>
                </button>
              ))}
              {EAT_ORDER.every((k) => (inv[k] ?? 0) <= 0) && (
                <p className="rounded-[14px] bg-raised px-3 py-3 text-sm text-muted-foreground">Еды нет</p>
              )}
            </div>
          </div>
        </div>
      )}
      {help && (
        <div className="absolute inset-0 z-40 bg-table/50" onClick={() => setHelp(false)} role="presentation">
          <div
            className="absolute inset-x-0 bottom-[var(--hud-dock)] mx-auto max-h-[min(62dvh,calc(100dvh-var(--hud-top)-var(--hud-dock)))] max-w-lg overflow-y-auto rounded-t-[24px] border border-border bg-panel p-4 shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <img
              src="/game/help-sign.jpg"
              alt=""
              className="mb-3 h-16 w-full rounded-[16px] object-cover object-center"
            />
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl leading-none">Книга</h2>
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground">версия {GAME_VERSION}</span>
              <button type="button" className="size-11 text-xl text-muted-foreground" onClick={() => setHelp(false)}>
                ×
              </button>
            </div>
            <div className="mt-3">
              <UserButton />
            </div>
            <div className="mt-4">
              <Book tab={bookTab} onTab={setBookTab} />
            </div>
            <Button
              className="mt-4 h-12 w-full"
              variant="secondary"
              onClick={() => g.askNotify()}
            >
              Включить оповещения
            </Button>
            <Button
              className="mt-2 h-12 w-full"
              variant={bye ? "default" : "outline"}
              onClick={() => {
                if (!bye) {
                  setBye(true);
                  return;
                }
                g.reset();
              }}
            >
              {bye ? "Точно начать сначала?" : "Начать сначала"}
            </Button>
          </div>
        </div>
      )}

      {bag && (
        <div className="absolute inset-0 z-40 bg-table/50" onClick={() => setBag(false)} role="presentation">
          <div
            className="absolute inset-x-0 bottom-[var(--hud-dock)] mx-auto max-h-[min(62dvh,calc(100dvh-var(--hud-top)-var(--hud-dock)))] max-w-lg overflow-y-auto rounded-t-[24px] border border-border bg-panel p-4 shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate font-display text-2xl leading-none">{g.character.name}</h2>
                <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                  {weight.toFixed(0)} / {cap} кг · {TRANSPORT_LABEL[g.character.transport]}
                </p>
              </div>
              <button type="button" className="size-11 shrink-0 text-xl text-muted-foreground" onClick={() => setBag(false)}>
                ×
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setTab("pack");
                  setCell(null);
                }}
                className={cn(
                  "h-14 flex-1 rounded-[16px] font-display text-lg",
                  tab === "pack" ? "bg-accent text-accent-foreground" : "bg-raised text-muted-foreground",
                )}
              >
                ноша
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("tools");
                  setCell(null);
                }}
                className={cn(
                  "h-14 flex-1 rounded-[16px] font-display text-lg",
                  tab === "tools" ? "bg-accent text-accent-foreground" : "bg-raised text-muted-foreground",
                )}
              >
                снасть
              </button>
              {ownChest && (
                <button
                  type="button"
                  onClick={() => {
                    setTab("chest");
                    setCell(null);
                  }}
                  className={cn(
                    "h-14 w-[4.6rem] shrink-0 rounded-[16px] text-sm",
                    tab === "chest" ? "bg-accent text-accent-foreground" : "bg-raised text-muted-foreground",
                  )}
                >
                  сундук
                </button>
              )}
            </div>

            {tab === "pack" && (
              <div className="mt-3 space-y-2">
                {ownChest && here && (
                  <p className="text-[12px] text-muted-foreground">
                    ноша {packCount(inv)} · сундук {packCount(here.chest)}
                  </p>
                )}
                <BagGrid
                  amounts={inv}
                  selected={cell}
                  onSelect={(k) => setCell((c) => (c === k ? null : k))}
                />
                {cell && (inv[cell] ?? 0) > 0 && (
                  <BagActs
                    k={cell}
                    n={inv[cell]}
                    canChest={!!ownChest}
                    canHand={(TOOL_ITEMS as readonly string[]).includes(cell)}
                    hand={g.character.hand === cell}
                    wearSlot={gearSlot(cell)}
                    worn={wornOf(g.character, cell)}
                    onEat={() => g.eat(cell)}
                    onDrink={() => g.drinkTonic()}
                    onDrop={(q) => g.dropItem(cell, q)}
                    onChest={(q) => g.storeItem(cell, q)}
                    onHand={() => g.equipHand(g.character.hand === cell ? null : cell)}
                    onWear={() =>
                      g.equipWear(gearSlot(cell) && wornOf(g.character, cell) ? null : cell, gearSlot(cell) ?? undefined)
                    }
                  />
                )}
                {here && !pileEmpty(asPile(here.pile)) && (
                  <button
                    type="button"
                    className="flex h-12 w-full items-center justify-between rounded-[14px] bg-accent px-3 text-accent-foreground"
                    onClick={() => g.pickupPile()}
                  >
                    <span>Поднять</span>
                    <span className="font-display text-right text-[13px] leading-tight">
                      {pileLabel(asPile(here.pile))}
                    </span>
                  </button>
                )}
                {(here?.goldDrop ?? 0) > 0 && (
                  <button
                    type="button"
                    className="flex h-12 w-full items-center justify-between rounded-[14px] bg-accent px-3 text-accent-foreground"
                    onClick={() => g.pickupPile()}
                  >
                    <span>Поднять золото</span>
                    <span className="font-display">{goldTxt(here!.goldDrop)}</span>
                  </button>
                )}
              </div>
            )}

            {tab === "tools" && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-2">
                  <GearSocket
                    label="рука"
                    item={g.character.hand}
                    wear={isWearId(g.character.hand) ? remainingWear(g.character, g.character.hand) : null}
                    onClick={() => g.equipHand(null)}
                  />
                  <GearSocket
                    label="тело"
                    item={g.character.body}
                    wear={null}
                    onClick={() => g.equipWear(null, "body")}
                  />
                  <GearSocket
                    label="голова"
                    item={g.character.helm}
                    wear={null}
                    onClick={() => g.equipWear(null, "helm")}
                  />
                </div>
                {g.character.shield && (
                  <button
                    type="button"
                    className="flex h-12 w-full items-center gap-2 rounded-[14px] bg-raised px-3"
                    onClick={() => g.equipWear(null, "shield")}
                  >
                    <ItemPic id={g.character.shield} className="size-9 overflow-hidden rounded-md" />
                    <span className="font-display text-lg leading-none">{ITEM_LABEL[g.character.shield]}</span>
                    <span className="ml-auto text-[12px] text-muted-foreground">снять</span>
                  </button>
                )}
                <BagGrid
                  amounts={Object.fromEntries(GEAR_PACK.map((k) => [k, inv[k] ?? 0]))}
                  selected={null}
                  marks={[g.character.hand, g.character.body, g.character.shield, g.character.helm]}
                  onSelect={(k) => {
                    const slot = gearSlot(k);
                    if (slot) {
                      g.equipWear(g.character[slot] === k ? null : k, slot);
                      return;
                    }
                    g.equipHand(g.character.hand === k ? null : k);
                  }}
                />
              </div>
            )}

            {tab === "chest" && ownChest && here && (
              <div className="mt-3 space-y-2">
                <p className="text-[12px] text-muted-foreground">
                  ноша {packCount(inv)} · сундук {packCount(here.chest)}
                  {here.chestLock ? " · на замке, для тебя открыт" : ""}
                </p>
                <BagGrid
                  amounts={here.chest}
                  selected={cell}
                  onSelect={(k) => setCell((c) => (c === k ? null : k))}
                />
                {cell && (here.chest[cell] ?? 0) > 0 && (
                  <div className="rounded-[14px] bg-raised p-3">
                    <p className="font-display text-lg leading-none">{ITEM_LABEL[cell]}</p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {ITEM_WEIGHT[cell]} кг · в сундуке {here.chest[cell]}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <Button className="h-12 flex-1" onClick={() => g.takeChest(cell, 1)}>
                        из сундука
                      </Button>
                      {(here.chest[cell] ?? 0) > 1 && (
                        <Button className="h-12 flex-1" variant="secondary" onClick={() => g.takeChest(cell, here.chest[cell])}>
                          всё
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 flex gap-1.5">
              {(["walk", "cart", "horse"] as const).map((id) => {
                const wagonOn = id === "horse" && (g.character.transport === "wagon" || g.character.wagon);
                const on = wagonOn || g.character.transport === id;
                return (
                  <Button
                    key={id}
                    size="sm"
                    className="h-12 flex-1 gap-1.5"
                    variant={on ? "default" : "outline"}
                    onClick={() => g.setTransport(id)}
                  >
                    <Ico
                      i={wagonOn ? ICO.road : id === "walk" ? ICO.boots : id === "cart" ? ICO.road : ICO.stake}
                      className="size-7 overflow-hidden rounded-md"
                    />
                    {wagonOn ? "телега" : id === "horse" ? `лошадь ${g.character.horses}` : TRANSPORT_LABEL[id]}
                  </Button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
              Пешком {CAPACITY.walk} кг. Тачка {CAPACITY.cart} кг, шаг как пешком
              {g.character.carts < 1 ? ` — ${CART_GOLD} золота в лавке или ${CART_WOOD} дерева дома` : ""}. Лошадь в 2½ раза быстрее, ноша{" "}
              {CAPACITY.horse} кг. Телега — к лошади, {CAPACITY.wagon} кг, быстрее тачки; 24 золота или плотник. В карман не
              кладётся.
            </p>
          </div>
        </div>
      )}
      {dead && !help && (
        <div className="absolute inset-0 z-[45] bg-table/60">
          <div className="absolute inset-x-0 bottom-[var(--hud-dock)] mx-auto max-w-lg rounded-t-[24px] border border-border bg-panel p-4 shadow-panel">
            <p className="font-display text-2xl leading-none">Погиб</p>
            <p className="mt-2 text-[14px] leading-snug text-muted-foreground">
              Двор стоит, сундук дома цел. Выйдешь дома через {formatWait(Math.max(0, g.character.deadUntil - now))}, потом сутки без хода.
              {g.character.deaths <= 1
                ? " Этот раз даром."
                : ` Сняли ${goldTxt(deathFee(g.character.deaths - 1))}.`}{" "}
              Следующий раз — {goldTxt(deathFee(g.character.deaths))}. Партию не стираем.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function MeetSheet() {
  const g = useGame();
  const meet = g.meet;
  if (!meet) return null;
  const found = foeById(g.dummies ?? [], g.others ?? [], meet.foeId);
  const foe =
    found ??
    ghostLiveFoe(meet.foeId, { x: g.character.x, y: g.character.y }, {
      hp: meet.foeHp,
      hand: meet.foeHand,
      body: meet.foeBody,
      shield: meet.foeShield,
      helm: meet.foeHelm,
    });
  const you = g.character;
  const mine = meet.turn === "you";
  const foeHp = meet.foeHp ?? foe.hp;
  const foeHand = meet.foeHand !== undefined ? meet.foeHand : foe.hand;
  const friend = you.pacts[foe.id] === "friend";
  const canTalk = !meet.spoke && ((you.skills.speech ?? 0) >= 3 || friend);
  const [more, setMore] = useState(false);
  return (
    <div className="pointer-events-none absolute inset-0 z-[42]">
      <div
        className="pointer-events-auto absolute inset-x-0 bottom-[var(--hud-dock)] mx-auto max-w-lg overflow-y-auto rounded-t-[24px] border border-border bg-panel px-3 pb-3 pt-2 shadow-panel"
        style={{ maxHeight: "min(42vh, 18rem)" }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
        <div className="flex items-end justify-between gap-3">
          <p className="font-display text-[22px] leading-none">{you.name || "ты"}</p>
          <p className="text-[13px] font-medium text-muted-foreground">
            {mine ? "твой шаг" : meet.incoming && !meet.firstDone ? "на тебя напали" : "ждёт ответа"}
          </p>
          <p className="font-display text-[22px] leading-none">{foe.name}</p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <div className="h-2.5 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-[#6b3a2a]" style={{ width: `${Math.max(0, Math.min(100, you.hp))}%` }} />
            </div>
            <p className="mt-0.5 font-display text-lg tabular-nums leading-none">{Math.round(you.hp)}</p>
            <p className="text-[11px] text-muted-foreground">твои раны</p>
          </div>
          <div className="text-right">
            <div className="h-2.5 overflow-hidden rounded-full bg-raised">
              <div className="ml-auto h-full rounded-full bg-[#6b3a2a]" style={{ width: `${Math.max(0, Math.min(100, foeHp))}%` }} />
            </div>
            <p className="mt-0.5 font-display text-lg tabular-nums leading-none">{Math.round(foeHp)}</p>
            <p className="text-[11px] text-muted-foreground">его раны</p>
          </div>
        </div>
        <p className="mt-2 text-[13px] leading-snug text-foreground">
          сила {Math.floor(you.energy)} · в руке {you.hand ? ITEM_LABEL[you.hand] : "пусто"}
          {foeHand ? ` · у него ${ITEM_LABEL[foeHand]}` : " · у него пусто"}
        </p>
        {!mine && (
          <p className="mt-1 text-[14px] font-medium">
            {meet.incoming && !meet.firstDone ? "Напали. Жди удара — потом твой шаг." : "Ждёт ответа"}
          </p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button className="h-11" disabled={!mine} onClick={() => g.meetHit()}>
            Ударить · −2 силы
          </Button>
          <Button className="h-11" variant="secondary" onClick={() => g.meetPass()}>
            Пройти мимо
          </Button>
          <Button className="h-11 col-span-2" variant="secondary" disabled={!mine} onClick={() => g.meetYield()}>
            Сдаться
          </Button>
        </div>
        <button
          type="button"
          className="mt-2 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setMore((v) => !v)}
        >
          {more ? "скрыть" : "ещё"}
        </button>
        {more && (
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Button className="h-10" variant="secondary" disabled={!mine} onClick={() => g.meetDrop()}>
              Кинуть ношу
            </Button>
            {canTalk ? (
              <Button className="h-10" variant="secondary" disabled={!mine} onClick={() => g.meetTalk()}>
                Говорить
              </Button>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function packCount(amounts: Partial<Record<ItemId, number>> | undefined) {
  if (!amounts) return 0;
  let n = 0;
  for (const k of ITEMS) n += amounts[k] ?? 0;
  return n;
}

function wornOf(c: { body: ItemId | null; shield: ItemId | null; helm: ItemId | null }, k: ItemId) {
  const slot = gearSlot(k);
  if (!slot) return false;
  return c[slot] === k;
}

function GearSocket({
  label,
  item,
  wear,
  onClick,
}: {
  label: string;
  item: ItemId | null;
  wear: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!item}
      className={cn(
        "flex min-h-[72px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] border-2 px-1",
        item ? "border-border bg-raised" : "border-dashed border-muted-foreground/35 bg-transparent",
      )}
    >
      {item ? (
        <ItemPic id={item} className="size-10 overflow-hidden rounded-md" />
      ) : (
        <span className="text-[12px] text-muted-foreground">{label}</span>
      )}
      {item && (
        <span className="text-[10px] leading-tight text-muted-foreground">
          {label}
          {wear != null ? ` · ${wear}` : ""}
        </span>
      )}
    </button>
  );
}

function BagGrid({
  amounts,
  selected,
  onSelect,
  marks,
}: {
  amounts: Partial<Record<ItemId, number>>;
  selected: ItemId | null;
  onSelect: (k: ItemId) => void;
  marks?: Array<ItemId | null>;
}) {
  const seen = new Set<ItemId>();
  const cells: ItemId[] = [];
  for (const k of BAG_CELLS) {
    if (seen.has(k)) continue;
    seen.add(k);
    if ((amounts[k] ?? 0) > 0) cells.push(k);
  }
  for (const k of ITEMS) {
    if (seen.has(k)) continue;
    seen.add(k);
    if ((amounts[k] ?? 0) > 0) cells.push(k);
  }
  const lit = new Set((marks ?? [selected]).filter((x): x is ItemId => !!x));
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {cells.map((k) => {
        const n = amounts[k] ?? 0;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onSelect(k)}
            className={cn(
              "flex min-h-[52px] flex-col items-center justify-center rounded-[12px] border border-border bg-raised py-1",
              lit.has(k) && "border-accent bg-accent/20",
            )}
          >
            <ItemPic id={k} className="size-8 overflow-hidden rounded-md" />
            {n > 1 && <span className="mt-0.5 font-display text-sm tabular-nums leading-none">{n}</span>}
          </button>
        );
      })}
      {cells.length === 0 && (
        <p className="col-span-5 py-3 text-sm text-muted-foreground">пусто</p>
      )}
    </div>
  );
}

function BagActs({
  k,
  n,
  canChest,
  canHand,
  hand,
  wearSlot,
  worn,
  onEat,
  onDrink,
  onDrop,
  onChest,
  onHand,
  onWear,
}: {
  k: ItemId;
  n: number;
  canChest: boolean;
  canHand: boolean;
  hand: boolean;
  wearSlot: "body" | "shield" | "helm" | null;
  worn: boolean;
  onEat: () => void;
  onDrink: () => void;
  onDrop: (q: number) => void;
  onChest: (q: number) => void;
  onHand: () => void;
  onWear: () => void;
}) {
  const food = (EAT_ORDER as readonly string[]).includes(k);
  const wearLbl = wearSlot === "helm" ? "на голову" : wearSlot === "shield" ? "в щит" : "на тело";
  return (
    <div className="rounded-[14px] bg-raised p-3">
      <p className="font-display text-lg leading-none">{ITEM_LABEL[k]}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {ITEM_WEIGHT[k]} кг{n > 1 ? ` · ×${n}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {food && (
          <Button className="h-12 flex-1" onClick={onEat}>
            съесть
          </Button>
        )}
        {k === "tonic" && (
          <Button className="h-12 flex-1" variant="secondary" onClick={onDrink}>
            выпить
          </Button>
        )}
        {canHand && (
          <Button className="h-12 flex-1" variant={hand ? "default" : "secondary"} disabled={n <= 0 && !hand} onClick={onHand}>
            {hand ? "из руки" : "в руку"}
          </Button>
        )}
        {wearSlot && (
          <Button className="h-12 flex-1" variant={worn ? "default" : "secondary"} disabled={n <= 0 && !worn} onClick={onWear}>
            {worn ? "снять" : wearLbl}
          </Button>
        )}
        <Button className="h-12 flex-1" variant="outline" disabled={n <= 0} onClick={() => onDrop(1)}>
          на землю
        </Button>
        {n > 1 && (
          <Button className="h-12 flex-1" variant="outline" onClick={() => onDrop(n)}>
            всё
          </Button>
        )}
        {canChest && (
          <Button className="h-12 flex-1" variant="secondary" disabled={n <= 0} onClick={() => onChest(1)}>
            в сундук
          </Button>
        )}
        {canChest && n > 1 && (
          <Button className="h-12 flex-1" variant="secondary" onClick={() => onChest(n)}>
            всё в сундук
          </Button>
        )}
      </div>
    </div>
  );
}

function Chip({
  ico,
  value,
  label,
  warn,
  onClick,
  wide,
}: {
  ico: number;
  value: number;
  label: string;
  warn?: boolean;
  onClick: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`${label} ${value}`}
      onClick={onClick}
      className={cn(
        "flex h-12 min-w-0 items-center gap-1 overflow-hidden rounded-2xl border border-border bg-panel px-1 shadow-panel",
        wide ? "flex-[1.15]" : "flex-1",
        warn && "border-danger",
      )}
    >
      <Ico i={ico} className="size-6 shrink-0 overflow-hidden rounded-md" alt="" />
      <span className="min-w-0 flex-1 text-left">
        <span className={cn("block font-display text-[17px] leading-none tabular-nums", warn && "text-danger")}>
          {value}
        </span>
        <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[9px] leading-none text-muted-foreground">
          {label}
        </span>
      </span>
    </button>
  );
}

function PhaseStrip({
  phase,
  weather,
  tickOfDay,
  tickAt,
  water,
  thirsty,
  onWater,
}: {
  phase: "day" | "night";
  weather: Weather;
  tickOfDay: number;
  tickAt: number;
  water: number;
  thirsty: boolean;
  onWater: () => void;
}) {
  const now = Date.now();
  const span = TICKS_PER_DAY / 2;
  const pos = phase === "night" ? Math.max(0, tickOfDay - span) : Math.min(tickOfDay, span - 0.001);
  const frac = Math.max(0, Math.min(1, (now - tickAt) / (TICK_SEC * 1000)));
  const prog = Math.max(0, Math.min(1, (pos + frac) / span));
  return (
    <div className="mx-auto mt-1 flex max-w-lg items-center gap-2 rounded-2xl bg-table/90 px-2.5 py-1.5 text-panel">
      <WeatherPic weather={weather} night={phase === "night"} className="size-7 shrink-0 overflow-hidden rounded-md" />
      <span className="pointer-events-none shrink-0 font-display text-sm leading-none">{phase === "night" ? "Ночь" : "День"}</span>
      <span className="pointer-events-none relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel/20">
        <span className="absolute inset-y-0 left-0 rounded-full bg-panel/90" style={{ width: `${Math.round(prog * 100)}%` }} />
      </span>
      <button
        type="button"
        onClick={onWater}
        className={cn("pointer-events-auto ml-1 flex shrink-0 items-center gap-1", thirsty && "text-danger")}
      >
        <GearPic i={GEAR_ICO.water} className="size-5 overflow-hidden rounded-sm" alt="" />
        <span className="font-display text-base leading-none tabular-nums">{Math.round(water)}</span>
      </button>
    </div>
  );
}

function WaterSheet({ onClose }: { onClose: () => void }) {
  const g = useGame();
  const here = tileAt(g.world, g.character.x, g.character.y);
  const at = here && (here.biome === "river" || here.biome === "ford" || here.building === "well");
  const pail = g.character.pail ?? 0;
  const hasBucket = (g.character.inventory.bucket ?? 0) > 0;
  const where = at
    ? here!.building === "well"
      ? "колодец"
      : here!.biome === "ford"
        ? "брод"
        : "река"
    : "набери у реки, брода или колодца";
  return (
    <div className="pointer-events-auto mx-auto mt-1.5 max-w-lg rounded-2xl border border-border bg-panel p-3 shadow-panel">
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-xl leading-none">Вода</p>
        <button type="button" className="size-9 text-lg text-muted-foreground" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="mt-2 text-sm leading-snug text-muted-foreground">
        Тело {Math.round(g.character.water)} · глотков в ведре {pail} · {where}
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        {at && (
          <Button className="h-12" onClick={() => g.drinkWater()}>
            Напиться досыта
          </Button>
        )}
        {at && (
          <Button className="h-12" variant="secondary" onClick={() => g.fillBucket()} disabled={!hasBucket}>
            {hasBucket ? "Набрать ведро · 3 глотка" : "Набрать ведро · нужно ведро"}
          </Button>
        )}
        {pail > 0 && (
          <Button className="h-12" variant="secondary" onClick={() => g.sipPail()}>
            Глоток из ведра · тело +25
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({
  k,
  v,
  warn,
  ico,
  water,
}: {
  k: string;
  v: number;
  warn?: boolean;
  ico?: number;
  water?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[12px] bg-raised px-2 py-2">
      {water ? (
        <GearPic i={GEAR_ICO.water} className="size-8 overflow-hidden rounded-lg" alt="" />
      ) : (
        <Ico i={ico ?? 0} className="size-8 overflow-hidden rounded-lg" alt="" />
      )}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
        <p className={cn("font-display text-xl leading-none tabular-nums", warn && "text-danger")}>{v}</p>
      </div>
    </div>
  );
}
