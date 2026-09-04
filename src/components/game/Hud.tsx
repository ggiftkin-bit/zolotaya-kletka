import { useEffect, useState } from "react";
import { BAG_CELLS, CAPACITY, ITEM_LABEL, ITEMS, TICK_SEC, TICKS_PER_DAY, TRANSPORT_LABEL, WEATHER_LABEL } from "@/game/constants";
import { BUILDING_LABEL, PROFESSION_LABEL, SKILL_LABEL, goldTxt } from "@/game/economy";
import { PROF_BLURB } from "@/game/craft";
import { nextGoal, personLevel, skillHow } from "@/game/goal";
import { BAIL_GOLD, BOOST_GOLD, DOWN_MS, ENERGY_MAX, HIRE_GOLD, SKIP_GOLD, deathFee, formatWait, nextEnergyIn } from "@/game/pace";
import { isHeld, isJailed, isStill, isYours } from "@/game/crime";
import { TOOL_ITEMS } from "@/game/life";
import { BUSY_LABEL, isRoof, isWearId, remainingWear, type WearId } from "@/game/work";
import { useGame } from "@/game/store";
import { pawnKg } from "@/game/travel";
import { asPile, pileEmpty, pileLabel } from "@/game/pile";
import { gearSlot } from "@/game/fight";
import type { BuildingKind, ItemId, Profession, Skill, ToolMode, Weather } from "@/game/types";
import { tileAt } from "@/game/worldgen";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Floaters } from "./Floaters";
import { Book, type BookTab } from "./HowTo";
import { ICO, Ico, ItemPic, JobPic, WeatherPic, GearPic, GEAR_ICO } from "./Sprite";
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

const MODES: { id: ToolMode; label: string; ico: number }[] = [
  { id: "move", label: "Стой", ico: ICO.boots },
  { id: "gather", label: "Сбор", ico: ICO.gather },
  { id: "claim", label: "Двор", ico: ICO.stake },
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

const PROFESSIONS: Profession[] = [
  "wanderer",
  "lumberjack",
  "miner",
  "fisher",
  "farmer",
  "baker",
  "carpenter",
  "smith",
  "trader",
  "healer",
  "hireling",
];

export function Hud() {
  const g = useGame();
  const [bag, setBag] = useState(false);
  const [tab, setTab] = useState<"pack" | "tools" | "chest" | "grow">("pack");
  const [bye, setBye] = useState(false);
  const [help, setHelp] = useState(false);
  const [bookTab, setBookTab] = useState<BookTab>("table");
  const [power, setPower] = useState(false);
  const [cell, setCell] = useState<ItemId | null>("food");
  const [now, setNow] = useState(() => Date.now());
  const inv = g.character.inventory;
  const here = tileAt(g.world, g.character.x, g.character.y);
  const weight = pawnKg(g.character);
  const cap = CAPACITY[g.character.transport];
  const hungry = g.character.satiety < 25;
  const thirsty = g.character.water < 25;
  const cold = g.character.warmth < 20;
  const tired = g.character.energy < 3;
  const level = personLevel(g.character.skills);
  const goal = nextGoal(g);
  const jailed = isJailed(g.character, now);
  const held = isHeld(g.character, now);
  const down = g.character.life === "down";
  const dead = g.character.life === "dead";
  const still = isStill(g.character, now);
  const wait = nextEnergyIn(g.character, now, isRoof(here) || (g.character.profession === "hireling" && g.character.resting));
  const busy = !held && g.character.busy && g.character.busy.until > now ? g.character.busy : null;
  const ownChest =
    here &&
    isYours(here) &&
    (here.building === "shack" || here.building === "house" || here.building === "shed" || here.owned);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (g.inspect) {
      setBag(false);
      setHelp(false);
      setPower(false);
    }
  }, [g.inspect]);

  useEffect(() => {
    if (!bag || tab !== "pack") return;
    if (cell && (inv[cell] > 0 || BAG_CELLS.includes(cell))) return;
    const first = BAG_CELLS.find((k) => inv[k] > 0) ?? ITEMS.find((k) => inv[k] > 0) ?? "wood";
    setCell(first);
  }, [bag, tab]);

  useEffect(() => {
    if (!bye) return;
    const id = window.setTimeout(() => setBye(false), 2500);
    return () => window.clearTimeout(id);
  }, [bye]);

  const openBag = (next: "pack" | "tools" | "chest" | "grow" = "pack") => {
    g.closeInspect();
    setHelp(false);
    setPower(false);
    if (bag && tab === next) {
      setBag(false);
      return;
    }
    setTab(next);
    setBag(true);
  };

  const openHelp = () => {
    g.closeInspect();
    setBag(false);
    setPower(false);
    setHelp((v) => !v);
  };

  return (
    <>
      <Floaters />
      {g.meet && <MeetSheet />}
      {!g.meet && !bag && !help && <TileBubble />}

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
              setPower((v) => !v);
            }}
          />
          <Chip
            ico={ICO.eat}
            value={Math.round(g.character.satiety)}
            label="сытость"
            warn={hungry}
            onClick={() => g.eat()}
          />
          <Chip
            ico={ICO.house}
            value={Math.round(g.character.warmth)}
            label="тепло"
            warn={cold}
            onClick={() => openBag("pack")}
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
        />
        {(jailed || down || dead || still || busy || goal || g.hint) && (
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
                  : `Следующая +1 через ${formatWait(wait)}. Дома быстрее. Еда сытость, не сила.`}
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
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-50 p-2 pb-[max(0.4rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto mx-auto max-w-lg">
            {busy && !bag && !help && (
              <div className="mb-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={() => g.skipBusy()}
                  className="flex h-11 flex-1 items-center justify-between rounded-[16px] border border-border bg-panel px-3 text-[13px] shadow-panel"
                >
                  <span>
                    {BUSY_LABEL[busy.kind]} {formatWait(busy.until - now)}
                  </span>
                  <span className="font-display">ускорить {goldTxt(SKIP_GOLD)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => g.hireBusy()}
                  className="h-11 shrink-0 rounded-[16px] border border-border bg-panel px-3 text-[13px] shadow-panel"
                >
                  руки {goldTxt(HIRE_GOLD)}
                </button>
                <button
                  type="button"
                  onClick={() => g.cancelBusy()}
                  className="h-11 shrink-0 rounded-[16px] border border-border bg-panel px-3 text-[13px] shadow-panel"
                >
                  бросить
                </button>
              </div>
            )}
          {g.travel && !bag && !help && !held && (
              <button
                type="button"
                onClick={() => g.skipTravel()}
                className="mb-1.5 flex h-11 w-full items-center justify-between rounded-[16px] border border-border bg-panel px-3 text-[13px] shadow-panel"
              >
                <span>
                  идёшь{" "}
                  {Math.ceil(
                    g.travel.path.slice(g.travel.index).reduce((a, l) => a + l.cost, 0) - g.travel.elapsed,
                  )}{" "}
                  с
                </span>
                <span className="font-display">ускорить {goldTxt(SKIP_GOLD)}</span>
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
              {MODES.map((m) => {
                const on = g.tool === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (bag || help) {
                        setBag(false);
                        setHelp(false);
                      }
                      if (m.id === "move") {
                        g.stopWalk();
                        g.setTool("move");
                        return;
                      }
                      g.setTool(on ? "move" : m.id);
                    }}
                    className={cn(
                      "flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px]",
                      m.id === "move"
                        ? g.travel
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground"
                        : on
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground",
                    )}
                  >
                    <Ico i={m.ico} className="size-7 overflow-hidden rounded-md" alt="" />
                    <span className="text-[10px] font-medium leading-none">{m.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setBag(false);
                  setHelp(false);
                  g.focusMe();
                }}
                className="flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] text-foreground"
              >
                <Ico i={ICO.boots} className="size-7 overflow-hidden rounded-md" alt="" />
                <span className="text-[10px] font-medium leading-none">Ко мне</span>
              </button>
              <button
                type="button"
                onClick={() => g.eat()}
                className="flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] text-foreground"
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
            <img
              src="/game/bag-hero.jpg"
              alt=""
              className="mb-3 h-20 w-full rounded-[16px] object-cover object-[center_40%]"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <JobPic job={g.character.profession} className="size-14 overflow-hidden rounded-[14px]" />
                <div>
                  <h2 className="font-display text-2xl leading-none">{g.character.name}</h2>
                  <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <WeatherPic
                      weather={g.weather}
                      night={g.phase === "night"}
                      className="size-6 overflow-hidden rounded-md"
                    />
                    {g.phase === "night" ? "ночь" : WEATHER_LABEL[g.weather]}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {[
                      g.character.transport !== "walk" ? TRANSPORT_LABEL[g.character.transport] : null,
                      g.character.transport !== "cart" && g.character.carts > 0 ? "тачка" : null,
                      g.character.horses > 0 && g.character.transport !== "horse" && g.character.transport !== "wagon"
                        ? `лошадей ${g.character.horses}`
                        : null,
                      g.character.hand ? `в руке ${ITEM_LABEL[g.character.hand]}` : null,
                      g.character.body ? ITEM_LABEL[g.character.body] : null,
                      g.character.shield ? ITEM_LABEL[g.character.shield] : null,
                      g.character.helm ? ITEM_LABEL[g.character.helm] : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "пешком"}
                  </p>
                </div>
              </div>
              <button type="button" className="size-11 text-xl text-muted-foreground" onClick={() => setBag(false)}>
                ×
              </button>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">ноша {weight.toFixed(0)}/{cap} кг</p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat k="сытость" v={Math.round(g.character.satiety)} warn={hungry} ico={ICO.eat} />
              <Stat k="сила" v={Math.round(g.character.energy)} warn={g.character.energy < 4} ico={ICO.boots} />
              <Stat k="тепло" v={Math.round(g.character.warmth)} warn={cold} ico={ICO.house} />
              <Stat k="вода" v={Math.round(g.character.water)} warn={thirsty} water />
            </div>

            <div className="mt-4 flex gap-1 rounded-[14px] bg-raised p-1">
              {(
                [
                  ["pack", "ноша"],
                  ["tools", "снасть"],
                  ["chest", "сундук"],
                  ["grow", "рост"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "h-11 flex-1 rounded-[10px] text-sm",
                    tab === id ? "bg-accent text-accent-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "pack" && (
              <div className="mt-3 space-y-2">
                <p className="text-[12px] text-muted-foreground">
                  Тап: на землю, в сундук, в руку, надеть щит / стёганку / шлем.
                </p>
                <BagGrid
                  amounts={inv}
                  selected={cell}
                  onSelect={setCell}
                  extras={ITEMS.filter((k) => !BAG_CELLS.includes(k) && inv[k] > 0)}
                />
                {cell && (
                  <BagActs
                    k={cell}
                    n={inv[cell]}
                    canChest={!!ownChest}
                    canHand={(TOOL_ITEMS as readonly string[]).includes(cell)}
                    hand={g.character.hand === cell}
                    wearSlot={gearSlot(cell)}
                    worn={
                      gearSlot(cell) === "body"
                        ? g.character.body === cell
                        : gearSlot(cell) === "shield"
                          ? g.character.shield === cell
                          : gearSlot(cell) === "helm"
                            ? g.character.helm === cell
                            : false
                    }
                    onDrop={(q) => g.dropItem(cell, q)}
                    onChest={(q) => g.storeItem(cell, q)}
                    onHand={() => g.equipHand(g.character.hand === cell ? null : cell)}
                    onWear={() => g.equipWear(gearSlot(cell) && g.character[gearSlot(cell)!] === cell ? null : cell, gearSlot(cell) ?? undefined)}
                  />
                )}
                {inv.tonic > 0 && (
                  <Button className="h-11 w-full" variant="secondary" onClick={() => g.drinkTonic()}>
                    Выпить настой · раны, не сила
                  </Button>
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
              <div className="mt-3 space-y-2">
                <p className="text-[12px] text-muted-foreground">
                  Карман снасти. Топор — дрова. Кирка — камень и руда. Копьё — охота. Удочка — рыба. Верёвка — лошадь. Ведро — вода вдаль от реки. Лопата — яма. Снасть ломается.
                </p>
                <p className="text-sm">
                  В руке:{" "}
                  <span className="font-display text-lg">
                    {g.character.hand ? ITEM_LABEL[g.character.hand] : "пусто"}
                  </span>
                </p>
                <p className="text-[12px] text-muted-foreground">
                  тело {g.character.body ? ITEM_LABEL[g.character.body] : "нет"} · щит{" "}
                  {g.character.shield ? ITEM_LABEL[g.character.shield] : "нет"} · голова{" "}
                  {g.character.helm ? ITEM_LABEL[g.character.helm] : "нет"}
                </p>
                {(["body", "shield", "helm"] as const).map((slot) => {
                  const id = g.character[slot];
                  if (!id) return null;
                  return (
                    <Button key={slot} className="h-11 w-full" variant="secondary" onClick={() => g.equipWear(null, slot)}>
                      снять {ITEM_LABEL[id]}
                    </Button>
                  );
                })}
                {TOOL_ITEMS.map((k) => (
                  <div key={k} className="flex items-center gap-2 rounded-[14px] bg-raised px-2 py-2">
                    <ItemPic id={k} className="size-10 overflow-hidden rounded-[10px]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-muted-foreground">{ITEM_LABEL[k]}</p>
                      <p className="font-display text-lg leading-none tabular-nums">{inv[k]}</p>
                      {(k === "axe" || k === "pick" || k === "spear" || k === "shovel" || k === "club" || k === "knife") && inv[k] > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          {g.character.hand === k
                            ? `в руке ещё ${remainingWear(g.character, k as WearId)}`
                            : ""}
                          {inv[k] - (g.character.hand === k ? 1 : 0) > 0
                            ? `${g.character.hand === k ? " · " : ""}${
                                g.character.bagWear?.[k as WearId]
                                  ? `сумка ещё ${g.character.bagWear[k as WearId]}`
                                  : "в сумке новый"
                              }`
                            : g.character.hand === k
                              ? ""
                              : g.character.bagWear?.[k as WearId]
                                ? `ещё ${g.character.bagWear[k as WearId]}`
                                : "новый"}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="h-11"
                      variant={g.character.hand === k ? "default" : "outline"}
                      disabled={inv[k] <= 0}
                      onClick={() => g.equipHand(g.character.hand === k ? null : k)}
                    >
                      {g.character.hand === k ? "убрать" : "в руку"}
                    </Button>
                  </div>
                ))}
                <p className="text-[12px] text-muted-foreground">
                  Ремесло — не в сумке. Открой шалаш, дом или мастерскую наклейкой «Открыть».
                </p>
              </div>
            )}

            {tab === "chest" && (
              <div className="mt-3">
                {ownChest && here ? (
                  <div className="space-y-2">
                    <p className="text-[12px] text-muted-foreground">
                      {here.chestLock ? "Сундук на замке. Для тебя открыт. Чужой — только взлом." : "Сундук. В ношу / из ноши. Не весит."}
                    </p>
                    <BagGrid
                      amounts={here.chest}
                      selected={cell}
                      onSelect={setCell}
                      extras={ITEMS.filter((k) => !BAG_CELLS.includes(k) && (here.chest[k] ?? 0) > 0)}
                    />
                    {cell && (
                      <div className="rounded-[14px] bg-raised p-2">
                        <p className="font-display text-lg leading-none">{ITEM_LABEL[cell]}</p>
                        <p className="mt-1 text-[12px] text-muted-foreground">в ношу / из ноши</p>
                        <div className="mt-2 flex gap-1">
                          {([1, Math.max(1, Math.floor((here.chest[cell] || 0) / 4)), here.chest[cell] || 0] as const).map((q, i) => (
                            <button
                              key={`out-${i}`}
                              type="button"
                              disabled={(here.chest[cell] || 0) < q || q <= 0}
                              className="h-11 min-w-10 flex-1 rounded-[10px] bg-panel text-[12px] disabled:opacity-30"
                              onClick={() => g.takeChest(cell, q)}
                            >
                              {i === 0 ? "1 в ношу" : i === 1 ? "¼" : "всё"}
                            </button>
                          ))}
                        </div>
                        <div className="mt-1 flex gap-1">
                          {([1, Math.max(1, Math.floor((inv[cell] || 0) / 4)), inv[cell] || 0] as const).map((q, i) => (
                            <button
                              key={`in-${i}`}
                              type="button"
                              disabled={(inv[cell] || 0) < q || q <= 0}
                              className="h-11 min-w-10 flex-1 rounded-[10px] bg-panel text-[12px] disabled:opacity-30"
                              onClick={() => g.storeItem(cell, q)}
                            >
                              {i === 0 ? "1 из ноши" : i === 1 ? "¼" : "всё"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Сундук — в своём шалаше, доме или складе. Встань на клетку.
                  </p>
                )}
              </div>
            )}

            {tab === "grow" && (
              <div className="mt-3">
                <p className="font-display text-3xl leading-none">Уровень {level}</p>
                <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
                  Отдельной кнопки «прокачать» нет. Рубишь, строишь, торгуешь — навык растёт, уровень сам
                  складывается. Профессия даёт бонус к своему делу, раз в неделю можно сменить.
                </p>
                <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
                  {PROF_BLURB[g.character.profession]}
                </p>
                <p className="mt-4 text-[11px] uppercase tracking-wide text-muted-foreground">Профессия</p>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                  {PROFESSIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => g.setProfession(p)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-[14px] p-1.5",
                        g.character.profession === p ? "bg-accent text-accent-foreground" : "bg-raised",
                      )}
                    >
                      <JobPic job={p} className="size-12 overflow-hidden rounded-[10px]" />
                      <span className="text-[10px] leading-tight">{PROFESSION_LABEL[p]}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-[11px] uppercase tracking-wide text-muted-foreground">Навыки</p>
                <ul className="mt-2 space-y-1.5">
                  {(Object.entries(g.character.skills) as [Skill, number][]).map(([k, n]) => (
                    <li key={k}>
                      <div className="flex items-center gap-2">
                        <span className="w-24 text-[12px] text-muted-foreground">{SKILL_LABEL[k]}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, n * 5)}%` }} />
                        </span>
                        <span className="w-8 font-display tabular-nums">{n.toFixed(1)}</span>
                      </div>
                      <p className="pl-0 text-[11px] text-muted-foreground">{skillHow(k)}</p>
                    </li>
                  ))}
                </ul>
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
              {g.character.carts < 1 ? " — 8 золота в лавке или 8 дерева дома" : ""}. Лошадь в 2½ раза быстрее, ноша{" "}
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
  const foe = g.dummies.find((d) => d.id === meet.foeId);
  if (!foe) return null;
  const you = g.character;
  const mine = meet.turn === "you";
  const friend = you.pacts[foe.id] === "friend";
  const canTalk = !meet.spoke && ((you.skills.speech ?? 0) >= 3 || friend);
  return (
    <div className="pointer-events-none absolute inset-0 z-[42]">
      <div
        className="pointer-events-auto absolute inset-x-0 bottom-[var(--hud-dock)] mx-auto max-w-lg overflow-y-auto rounded-t-[24px] border border-border bg-panel px-4 pb-4 pt-3 shadow-panel"
        style={{ maxHeight: "min(62vh, 28rem)" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <p className="font-display text-2xl leading-none">Встреча</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {foe.name}
          {friend ? " · друг" : you.pacts[foe.id] === "feud" ? " · вражда" : ""}
          {foe.dummy ? " · манекен хутора" : ""}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <p>
            Ты · раны <span className="font-display text-lg tabular-nums">{Math.round(you.hp)}</span>
          </p>
          <p>
            {foe.name} · <span className="font-display text-lg tabular-nums">{Math.round(foe.hp)}</span>
          </p>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {mine ? "Твой шаг." : "Ждёт ответа."} Сила {Math.floor(you.energy)} · в руке{" "}
          {you.hand ? ITEM_LABEL[you.hand] : "пусто"}
          {you.body ? ` · ${ITEM_LABEL[you.body]}` : ""}
          {you.shield ? ` · ${ITEM_LABEL[you.shield]}` : ""}
          {you.helm ? ` · ${ITEM_LABEL[you.helm]}` : ""}
          {foe.hand ? ` · у него ${ITEM_LABEL[foe.hand]}` : " · у него пусто"}
          {foe.shield ? `+${ITEM_LABEL[foe.shield]}` : ""}
          {foe.body ? `+${ITEM_LABEL[foe.body]}` : ""}
        </p>
        <div className="mt-3 space-y-2">
          <Button className="h-12 w-full" disabled={!mine} onClick={() => g.meetHit()}>
            Ударить · −2 силы
          </Button>
          <Button className="h-12 w-full" variant="secondary" disabled={!mine} onClick={() => g.meetLeave()}>
            Отойти
          </Button>
          <Button className="h-12 w-full" variant="secondary" disabled={!mine} onClick={() => g.meetDrop()}>
            Кинуть ношу
          </Button>
          <Button className="h-12 w-full" variant="secondary" disabled={!mine} onClick={() => g.meetYield()}>
            Сдаться
          </Button>
          {canTalk && (
            <Button className="h-12 w-full" variant="secondary" disabled={!mine} onClick={() => g.meetTalk()}>
              Говорить · ноша без удара
            </Button>
          )}
        </div>
        <p className="mt-3 text-[12px] leading-snug text-muted-foreground">
          Упал — не погиб. Закон после удара, не вместо. Добивать лежачего нельзя.
        </p>
      </div>
    </div>
  );
}

function BagGrid({
  amounts,
  selected,
  onSelect,
  extras,
}: {
  amounts: Partial<Record<ItemId, number>>;
  selected: ItemId | null;
  onSelect: (k: ItemId) => void;
  extras: ItemId[];
}) {
  const seen = new Set<ItemId>();
  const cells: ItemId[] = [];
  for (const k of [...BAG_CELLS, ...extras]) {
    if (seen.has(k)) continue;
    seen.add(k);
    if ((amounts[k] ?? 0) > 0) cells.push(k);
  }
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {cells.map((k) => {
        const n = amounts[k] ?? 0;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onSelect(k)}
            className={cn(
              "flex aspect-square flex-col items-center justify-center rounded-[14px] border border-border bg-raised",
              selected === k && "border-accent bg-accent/20",
            )}
          >
            <ItemPic id={k} className="size-9 overflow-hidden rounded-md" />
            <span className="mt-0.5 font-display text-sm tabular-nums leading-none">{n}</span>
          </button>
        );
      })}
      {cells.length === 0 && (
        <p className="col-span-3 text-sm text-muted-foreground">Пусто.</p>
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
  onDrop: (q: number) => void;
  onChest: (q: number) => void;
  onHand: () => void;
  onWear: () => void;
}) {
  const q4 = Math.max(1, Math.floor(n / 4));
  return (
    <div className="rounded-[14px] bg-raised p-2">
      <p className="font-display text-lg leading-none">{ITEM_LABEL[k]}</p>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">На землю</p>
      <div className="mt-1 flex gap-1">
        {([1, q4, n] as const).map((q, i) => (
          <button
            key={`d-${i}`}
            type="button"
            disabled={n < q || q <= 0}
            className="h-11 flex-1 rounded-[10px] bg-panel text-[12px] disabled:opacity-30"
            onClick={() => onDrop(q)}
          >
            {i === 0 ? "1" : i === 1 ? "¼" : "всё"}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">В сундук</p>
      <div className="mt-1 flex gap-1">
        {([1, q4, n] as const).map((q, i) => (
          <button
            key={`c-${i}`}
            type="button"
            disabled={!canChest || n < q || q <= 0}
            className="h-11 flex-1 rounded-[10px] bg-panel text-[12px] disabled:opacity-30"
            onClick={() => onChest(q)}
          >
            {i === 0 ? "1" : i === 1 ? "¼" : "всё"}
          </button>
        ))}
      </div>
      {canHand && (
        <Button className="mt-2 h-11 w-full" variant={hand ? "default" : "outline"} disabled={n <= 0 && !hand} onClick={onHand}>
          {hand ? "из руки" : "в руку"}
        </Button>
      )}
      {wearSlot && (
        <Button className="mt-2 h-11 w-full" variant={worn ? "default" : "outline"} disabled={n <= 0 && !worn} onClick={onWear}>
          {worn ? "снять" : wearSlot === "shield" ? "в щит" : wearSlot === "helm" ? "на голову" : "на тело"}
        </Button>
      )}
      {!canChest && (
        <p className="mt-1 text-[11px] text-muted-foreground">Сундук — свой шалаш, дом или склад.</p>
      )}
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
}: {
  phase: "day" | "night";
  weather: Weather;
  tickOfDay: number;
  tickAt: number;
  water: number;
  thirsty: boolean;
}) {
  const now = Date.now();
  const span = TICKS_PER_DAY / 2;
  const pos = phase === "night" ? Math.max(0, tickOfDay - span) : Math.min(tickOfDay, span - 0.001);
  const frac = Math.max(0, Math.min(1, (now - tickAt) / (TICK_SEC * 1000)));
  const prog = Math.max(0, Math.min(1, (pos + frac) / span));
  return (
    <div className="pointer-events-none mx-auto mt-1 flex max-w-lg items-center gap-2 rounded-2xl bg-table/90 px-2.5 py-1.5 text-panel">
      <WeatherPic weather={weather} night={phase === "night"} className="size-7 shrink-0 overflow-hidden rounded-md" />
      <span className="shrink-0 font-display text-sm leading-none">{phase === "night" ? "Ночь" : "День"}</span>
      <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel/20">
        <span className="absolute inset-y-0 left-0 rounded-full bg-panel/90" style={{ width: `${Math.round(prog * 100)}%` }} />
      </span>
      <span className={cn("ml-1 flex shrink-0 items-center gap-1", thirsty && "text-danger")}>
        <GearPic i={GEAR_ICO.water} className="size-5 overflow-hidden rounded-sm" alt="" />
        <span className="font-display text-base leading-none tabular-nums">{Math.round(water)}</span>
      </span>
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
