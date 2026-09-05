import { useEffect, useRef, useState, type ReactNode } from "react";
import { BIOME_LABEL, ITEM_LABEL, ITEMS } from "@/game/constants";
import { CRAFTS, canDoCraft } from "@/game/craft";
import { BUILD_COST, BUILDING_LABEL, CART_GOLD, CART_WOOD, LOCK_GOLD, WAGON_GOLD, caravanBuy, caravanSell, goldTxt, sellLot } from "@/game/economy";
import { ANIMAL_LABEL, COW_PRICE, HORSE_PRICE, waterHint } from "@/game/life";
import { LIFE_INDEX } from "@/game/art";
import { canOpenPlace, lootOn, placeHint, placeTitle, wildActs } from "@/game/places";
import { FOG_DARK, fogAt } from "@/game/book";
import { occupantAt } from "@/game/fight";
import { canFoundVillage, clusterHint, hamletTitle, hasOwnYard } from "@/game/pact";
import { isForeignYard, isYours } from "@/game/crime";
import { canDigReason, fillPay } from "@/game/pit";
import { useGame } from "@/game/store";
import type { BuildingKind, ItemId, Tile } from "@/game/types";
import { burnableFence, CLAD_STONE, isRoof, MATTER_LABEL, stoneFence } from "@/game/work";
import { isWalkable, tileAt } from "@/game/worldgen";
import { ENERGY_MAX, formatWait, nextEnergyIn } from "@/game/pace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BiomePic, GearPic, ICO, Ico, ItemPic, LifePic } from "./Sprite";

const BUILDINGS: Exclude<BuildingKind, "none" | "workshop" | "shop" | "board" | "mine">[] = [
  "shack",
  "house",
  "camp",
  "field",
  "well",
  "pen",
  "stable",
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
  "net",
];

type Pane = "pick" | "place" | "gather" | "build" | "yard";

export function TileBubble() {
  const g = useGame();
  const inspect = g.inspect;
  const opened = useRef(0);
  useEffect(() => {
    opened.current = Date.now();
  }, [inspect?.x, inspect?.y]);
  if (!inspect) return null;
  const tile = tileAt(g.world, inspect.x, inspect.y);
  if (!tile) return null;
  return (
    <div
      className="absolute inset-x-0 z-30 bg-table/40"
      style={{ top: "var(--hud-top)", bottom: "var(--hud-dock)" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        if (Date.now() - opened.current < 420) return;
        g.closeInspect();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") g.closeInspect();
      }}
      role="presentation"
    >
      <Sheet key={`${tile.x}-${tile.y}`} tile={tile} />
    </div>
  );
}

function Sheet({ tile }: { tile: Tile }) {
  const g = useGame();
  if (fogAt(g.world, tile.x, tile.y) === FOG_DARK) {
    return <UnknownSheet tile={tile} />;
  }
  const here = g.character.x === tile.x && g.character.y === tile.y;
  const near = Math.max(Math.abs(g.character.x - tile.x), Math.abs(g.character.y - tile.y)) <= 1;
  const loot = lootOn(tile);
  const [pane, setPane] = useState<Pane>("pick");
  const [live, setLive] = useState(false);
  useEffect(() => setPane("pick"), [tile.x, tile.y]);
  useEffect(() => {
    setLive(false);
    const id = window.setTimeout(() => setLive(true), 280);
    return () => window.clearTimeout(id);
  }, [tile.x, tile.y]);
  const title =
    pane === "place"
      ? placeTitle(tile)
      : pane === "gather"
        ? "Что взять"
        : pane === "build"
          ? "Строить"
          : pane === "yard"
            ? "Двор"
            : tile.bank && tile.building === "none"
              ? "берег"
              : tile.pit
                ? "яма"
                : tile.caravan
                  ? "Лавка"
                  : tile.building !== "none"
                    ? BUILDING_LABEL[tile.building]
                    : tile.commons
                      ? "поляна"
                      : BIOME_LABEL[tile.biome];

  return (
    <div
      className="absolute inset-x-0 bottom-0 mx-auto max-h-full max-w-lg overflow-y-auto rounded-t-[24px] border border-border bg-panel px-4 pb-4 pt-3 shadow-panel"
      style={{ pointerEvents: live ? "auto" : "none" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
      <div className="flex items-start gap-3">
        {pane !== "pick" ? (
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-lg"
            onClick={() => setPane("pick")}
          >
            ←
          </button>
        ) : (
          <BiomePic
            biome={tile.biome}
            commons={tile.commons}
            className="size-16 overflow-hidden rounded-[16px] shadow-sm"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl leading-none tracking-tight">{title}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {here ? "ты здесь" : near ? "рядом" : "далеко"}
            {tile.plot ? (tile.owner === "you" ? " · твой двор" : ` · ${hamletTitle(tile.owner)}`) : ""}
            {tile.village ? ` · ${tile.village}` : ""}
            {tile.building !== "none" && pane === "pick" ? ` · ${MATTER_LABEL[tile.matter || "wood"]}` : ""}
            {tile.chestLock ? " · сундук на замке" : ""}
            {tile.gateLock ? " · калитка на засове" : ""}
            {tile.burned ? " · обгорел" : ""}
            {tile.biome === "forest" && tile.amount <= 0 ? " · пни" : ""}
            {tile.resource === "herb" && tile.amount > 0 ? ` · трава ×${tile.amount}` : ""}
            {tile.resource === "herb" && tile.amount <= 0 ? " · трава сорвана" : ""}
            {tile.building === "field" && tile.amount <= 0 ? " · пустое поле" : ""}
            {tile.bank && !tile.pit ? " · глина · лопатой две" : ""}
            {tile.pit ? " · яма" : ""}
            {tile.regen > 0 && tile.amount <= 0 ? ` · ${tile.regen} нед.` : ""}
            {tile.herd ? ` · ${ANIMAL_LABEL[tile.herd.kind]} ×${tile.herd.count}` : ""}
          </p>
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-xl leading-none text-muted-foreground"
          onClick={() => g.closeInspect()}
        >
          ×
        </button>
      </div>

      {pane === "pick" && (
        <PickPane tile={tile} here={here} near={near} loot={loot} onPane={setPane} />
      )}
      {pane === "place" && <PlacePane tile={tile} here={here} near={near} />}
      {pane === "gather" && <GatherPane tile={tile} loot={loot} />}
      {pane === "build" && <BuildPane tile={tile} />}
      {pane === "yard" && <YardPane tile={tile} />}
    </div>
  );
}

function UnknownSheet({ tile }: { tile: Tile }) {
  const g = useGame();
  const here = g.character.x === tile.x && g.character.y === tile.y;
  return (
    <div
      className="absolute inset-x-0 bottom-0 mx-auto max-h-full max-w-lg overflow-y-auto rounded-t-[24px] border border-border bg-panel px-4 pb-4 pt-3 shadow-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
      <div className="flex items-start gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-[16px] bg-raised text-2xl text-muted-foreground shadow-sm">
          ?
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl leading-none tracking-tight">неизвестная клетка</p>
          <p className="mt-1 text-[12px] text-muted-foreground">тьма. Пока не подойдёшь — не видно, что там</p>
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-xl leading-none text-muted-foreground"
          onClick={() => g.closeInspect()}
        >
          ×
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {!here && (
          <Sticker
            title="Пойти"
            sub="увидишь, когда дойдёшь"
            ico={<Ico i={ICO.boots} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => g.goTo(tile.x, tile.y)}
          />
        )}
      </div>
    </div>
  );
}

function Sticker({
  title,
  sub,
  ico,
  onClick,
  dim,
}: {
  title: string;
  sub?: string;
  ico?: ReactNode;
  onClick: () => void;
  dim?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-[18px] border-2 border-border bg-raised px-3 py-2.5 text-left shadow-sm",
        dim && "opacity-80",
      )}
    >
      {ico}
      <span className="min-w-0 flex-1">
        <span className="block font-display text-xl leading-none">{title}</span>
        {sub ? <span className="mt-0.5 block text-[12px] text-muted-foreground">{sub}</span> : null}
      </span>
    </button>
  );
}

function PickPane({
  tile,
  here,
  near,
  loot,
  onPane,
}: {
  tile: Tile;
  here: boolean;
  near: boolean;
  loot: ReturnType<typeof lootOn>;
  onPane: (p: Pane) => void;
}) {
  const g = useGame();
  const [vName, setVName] = useState("Выселки");
  const wild = wildActs(tile, g.world);
  const open = canOpenPlace(tile);
  const tired = g.character.energy < 4;
  const riverBlock = (tile.biome === "river" || tile.building === "moat") && tile.road !== "bridge";
  const ownYard = hasOwnYard(g.world);
  const shod = canFoundVillage(g.world, g.character.pacts);
  const atOwn = tile.plot && (tile.owner === "you" || tile.owned);
  const atFriend = tile.plot && tile.owner && tile.owner !== "you" && g.character.pacts[tile.owner] === "friend";
  const emptyYard = atOwn && tile.building === "none" && !tile.caravan;
  const shackUp = atOwn && tile.building === "shack" && g.character.inventory.wood >= 10 && g.character.inventory.stone >= 4;
  const down = g.character.life === "down";
  const dummy = occupantAt(g.dummies ?? [], g.others ?? [], tile.x, tile.y);
  const locked =
    (g.character.jailedUntil ?? 0) > Date.now() ||
    g.character.life === "jailed" ||
    g.character.life === "dead" ||
    (g.character.stillUntil ?? 0) > Date.now();

  const takeLoot = (id: string) => {
    if (!here) {
      g.closeInspect();
      return;
    }
    if (id === "pile" || id === "gold") g.pickupPile();
    else g.doGather();
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      {!here && riverBlock && (
        <p className="text-[13px] text-danger">{tile.building === "moat" ? "Ров. Обходи или строй мост." : "Река. Обходи или строй мост."}</p>
      )}
      {!here && !riverBlock && isWalkable(tile, g.world) && !locked && (
        <Sticker
          title={down ? "Ползти" : open ? "Пойти внутрь" : "Пойти"}
          sub={down ? "к крыше — там поднимешься" : "путь и время"}
          ico={<Ico i={ICO.boots} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => g.goTo(tile.x, tile.y)}
        />
      )}
      {down && (
        <p className="text-[13px] text-danger">
          Упал. Ползи к шалашу — под крышей поднимешься. Без крыши погибнешь.
        </p>
      )}
      {tile.wagon && near && !(g.character.wagon || g.character.transport === "wagon") && (
        <Sticker
          title={tile.wagon === "you" ? "Зацепить телегу" : `Увести телегу · ${tile.wagon}`}
          sub={
            g.character.horses < 1
              ? "нужна лошадь. в карман не кладётся"
              : tile.wagon === "you"
                ? "к лошади · 180 кг"
                : "кража · нужна лошадь"
          }
          ico={<Ico i={ICO.road} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => (tile.wagon === "you" ? g.hitchWagon() : g.stealWagon())}
        />
      )}
      {(g.character.wagon || g.character.transport === "wagon") && here && (
        <Sticker
          title="Отцепить телегу"
          sub={atOwn ? "у двора — своя" : "останется на клетке, можно украсть"}
          ico={<Ico i={ICO.road} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => g.unhitchWagon()}
        />
      )}
      {locked && (
        <p className="text-[13px] text-danger">
          {g.character.life === "dead"
            ? "Погиб. Двор стоит."
            : (g.character.stillUntil ?? 0) > Date.now()
              ? "Отлёживаешься. Сутки без хода."
              : `Сидишь${g.character.jailWhy ? ` · ${g.character.jailWhy}` : ""}. Нет хода.`}
        </p>
      )}
      {emptyYard && near && (
        <Sticker
          title="Шалаш"
          sub="6 дерева · первая крыша"
          ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => {
            g.setBuildKind("shack");
            g.doBuild(tile.x, tile.y);
            g.closeInspect();
          }}
        />
      )}
      {shackUp && near && (
        <Sticker
          title="Дом"
          sub="14 дерева · 6 камня"
          ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => {
            g.setBuildKind("house");
            g.doBuild(tile.x, tile.y);
            g.closeInspect();
          }}
        />
      )}
      {tired && here && (
        <p className="text-[13px] text-danger">Сила на нуле. Жди или кружка сверху. Еда — сытость.</p>
      )}
      {open && here && (
        <Sticker
          title={tile.caravan ? "Открыть лавку" : `Открыть · ${placeTitle(tile)}`}
          sub={placeHint(tile)}
          ico={<Ico i={tile.caravan || tile.building === "shop" ? ICO.gold : ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPane("place")}
        />
      )}
      {loot.length === 1 && (
        <Sticker
          title={
            loot[0]!.id === "gold"
              ? "Поднять золото"
              : loot[0]!.kind === "pile"
                ? "Поднять"
                : loot[0]!.item === "herb"
                  ? "Сорвать траву"
                  : `Собрать ${ITEM_LABEL[loot[0]!.item]}`
          }
          sub={loot[0]!.label}
          ico={<Ico i={ICO.gather} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => takeLoot(loot[0]!.id)}
        />
      )}
      {loot.length > 1 && (
        <Sticker
          title="Собрать…"
          sub={loot.map((l) => l.label).join(" · ")}
          ico={<Ico i={ICO.gather} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPane("gather")}
        />
      )}
      {wild
        .filter((a) => !(a.id === "fish" && g.character.hand === "spear"))
        .map((a) => (
        <Sticker
          key={a.id}
          title={a.label}
          sub={a.sub}
          ico={
            tile.herd ? (
              <LifePic i={LIFE_INDEX[tile.herd.kind]} className="size-11 overflow-hidden rounded-[12px]" />
            ) : (
              <Ico i={ICO.gather} className="size-11 overflow-hidden rounded-[12px]" />
            )
          }
          onClick={() => {
            if (!here) return;
            if (a.id === "hunt") g.huntHere();
            if (a.id === "catch") g.catchHorse();
            if (a.id === "fish") g.fishHere();
          }}
        />
      ))}
      {dummy && (
        <Sticker
          title={dummy.life !== "alive" ? `${dummy.name} лежит` : `Встреча · ${dummy.name}`}
          sub={
            dummy.life !== "alive"
              ? "не добивать"
              : here
                ? dummy.dummy
                  ? "ударить, отойти, сдаться"
                  : "лист: отойти или говорить"
                : near
                  ? "встань на его клетку"
                  : "иди на его клетку"
          }
          ico={<Ico i={ICO.stake} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => g.startMeet(dummy.id)}
          dim={!here || dummy.life !== "alive" || down || locked}
        />
      )}
      {here && !tile.pit && canDigReason(g.world, tile, g.character.hand) == null && (
        <Sticker
          title="Копать"
          sub={tile.bank ? "2 глины · яма" : "1 глина · яма"}
          ico={<Ico i={ICO.gather} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => g.excavateHere()}
        />
      )}
      {here && !tile.pit && g.character.hand === "shovel" && canDigReason(g.world, tile, g.character.hand) && (
        <p className="text-[13px] text-muted-foreground">{canDigReason(g.world, tile, g.character.hand)}</p>
      )}
      {near && tile.pit && (
        <Sticker
          title="Засыпать"
          sub={fillPay(g.character.inventory) ? "глина" : "2 глины, или глина + дерево, или глина + камень"}
          onClick={() => g.fillPit()}
        />
      )}
      {here && (tile.biome === "river" || tile.biome === "ford" || tile.building === "well") && (
        <>
          <Sticker
            title="Напиться"
            sub="вода тела 100"
            ico={<GearPic i={1} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => g.drinkWater()}
          />
          <Sticker
            title="Набрать ведро"
            sub={(g.character.inventory.bucket ?? 0) > 0 ? "pail 3" : "нужно ведро"}
            ico={<GearPic i={1} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => g.fillBucket()}
          />
        </>
      )}
      {here && (g.character.pail ?? 0) > 0 && (
        <Sticker
          title="Глоток из ведра"
          sub={`${g.character.pail} · тело +25`}
          onClick={() => g.sipPail()}
        />
      )}
      {here && (g.character.pail ?? 0) > 0 && tile.biome !== "river" && (
        <Sticker title="Вылить воду" sub={`${g.character.pail} · на поле, не питьё`} onClick={() => g.pourWater()} />
      )}
      {tile.owner && tile.owner !== "you" && near && (
        <>
          {tile.gateLock && (
            <Sticker
              title="Взломать калитку"
              sub="засов. если поймают — яма, замок цел"
              ico={<Ico i={ICO.stake} className="size-11 overflow-hidden rounded-[12px]" />}
              onClick={() => g.pickLock("gate")}
            />
          )}
          {tile.chestLock && (
            <Sticker
              title="Взломать сундук"
              sub="если поймают — по законам"
              ico={<Ico i={ICO.stake} className="size-11 overflow-hidden rounded-[12px]" />}
              onClick={() => g.pickLock("chest")}
            />
          )}
          <Sticker
            title={`Украсть у ${hamletTitle(tile.owner)}`}
            sub="С соседней клетки. Поймают — яма, залог 20."
            onClick={() => g.stealHere()}
          />
          {g.character.pacts[tile.owner] !== "friend" && (
            <Sticker title="Дружить" sub={`${hamletTitle(tile.owner)} кивнёт`} onClick={() => g.offerFriend()} />
          )}
        </>
      )}
      {near && (atOwn || atFriend) && shod && !g.character.village && (
        <>
          <input
            value={vName}
            onChange={(e) => setVName(e.target.value)}
            className="h-11 w-full rounded-[12px] border border-border bg-raised px-3 text-base"
            placeholder="Выселки"
            aria-label="Имя деревни"
          />
          <Sticker title="Сход — деревня" sub="пять дворов, ты староста" onClick={() => g.formVillage(vName)} />
        </>
      )}
      {near && atOwn && g.character.village && (
        <Sticker title="Распустить" sub={g.character.village} dim onClick={() => g.dissolveVillage()} />
      )}
      {near && atOwn && !shod && !g.character.village && ownYard && (
        <p className="text-[12px] text-muted-foreground">{clusterHint(g.world, g.character.pacts)}</p>
      )}
      {near && atOwn && (
        <Sticker
          title="Двор"
          sub="тын, калитка, закон"
          ico={<Ico i={ICO.stake} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPane("yard")}
        />
      )}
      {near && !tile.caravan && !isForeignYard(tile) && (
        <Sticker
          title="Строить"
          sub="дорога и постройки"
          ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPane("build")}
          dim
        />
      )}
      {near &&
        ((tile.building !== "none" && !tile.burned) || !!burnableFence(tile, g.world) || stoneFence(tile, g.world)) && (
          <Sticker title="Поджечь" sub="хворост и дерево. камень нет" dim onClick={() => g.burnHere()} />
        )}
      {near && tile.burned && tile.building !== "none" && (
        <Sticker title="Разобрать уголь" onClick={() => g.scrapBurned()} />
      )}
      {near && !tile.commons && tile.biome !== "river" && !tile.caravan && !tile.plot && (
        <Sticker
          title={g.plotMark ? "Замкнуть двор" : "Угол двора"}
          ico={<Ico i={ICO.stake} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => g.doClaim(tile.x, tile.y)}
        />
      )}
    </div>
  );
}

function GatherPane({ tile, loot }: { tile: Tile; loot: ReturnType<typeof lootOn> }) {
  const g = useGame();
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">На клетке несколько куч. Выбери, что берёшь.</p>
      {loot.map((l) => (
        <Sticker
          key={l.id}
          title={l.label}
          ico={<ItemPic id={l.item} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => {
            if (g.character.x !== tile.x || g.character.y !== tile.y) return;
            if (l.kind === "pile" || l.id === "gold") g.pickupPile();
            else g.doGather();
          }}
        />
      ))}
    </div>
  );
}

function PlacePane({ tile, here }: { tile: Tile; here: boolean; near: boolean }) {
  if (!here) {
    return <p className="mt-4 text-sm text-muted-foreground">Зайди внутрь — встань на клетку.</p>;
  }
  const mine = isYours(tile);
  if (tile.caravan) return <LavkaBody tile={tile} />;
  if (tile.building === "shop" || tile.building === "stall") return <ShopBody tile={tile} />;
  if (!mine && isForeignYard(tile)) return <ForeignStation tile={tile} />;
  if (tile.building === "shack" || tile.building === "house" || tile.building === "shed") {
    return <HomeBody tile={tile} />;
  }
  if (
    tile.building === "workshop" ||
    tile.building === "bench" ||
    tile.building === "forge" ||
    tile.building === "oven" ||
    tile.building === "smoke" ||
    tile.building === "herbs" ||
    tile.building === "coalpit"
  ) {
    if (!mine) return <ForeignStation tile={tile} />;
    return <WorkshopBody tile={tile} />;
  }
  if (tile.building === "field") return <FieldBody tile={tile} />;
  if (tile.building === "pen" || tile.building === "stable") return <PenBody tile={tile} />;
  if (tile.building === "well") return <WellBody />;
  if (tile.building === "board") return <BoardBody />;
  if (tile.building === "mine" || tile.building === "adit") return <MineBody tile={tile} />;
  if (tile.building === "tower") return <TowerBody tile={tile} />;
  if (tile.building === "net") {
    return <p className="mt-4 text-sm text-muted-foreground">Сеть. Стой на клетке и лови. Удочка не нужна.</p>;
  }
  if (tile.building === "camp") {
    return <CampBody tile={tile} />;
  }
  if (tile.building === "jail") {
    return <p className="mt-4 text-sm text-muted-foreground">Яма. Сажают только по закону. Залог 20 золота.</p>;
  }
  return <p className="mt-4 text-sm text-muted-foreground">Пусто.</p>;
}

function ForeignStation({ tile }: { tile: Tile }) {
  return (
    <p className="mt-4 text-sm text-muted-foreground">
      чужой двор. {BUILDING_LABEL[tile.building]}. Меню хозяина закрыто.
    </p>
  );
}

function HomeBody({ tile }: { tile: Tile }) {
  const g = useGame();
  const crafts = CRAFTS.filter((c) => canDoCraft(c, g.character.profession, tile));
  const isHome = tile.building === "shack" || tile.building === "house";
  const roof = isHome && isRoof(tile);
  const resting = !!g.character.resting;
  const full = g.character.energy >= ENERGY_MAX;
  const wait = nextEnergyIn(g.character, Date.now(), roof);
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">{placeHint(tile)}</p>
      {roof && resting && (
        <p className="rounded-[14px] bg-raised px-3 py-2 text-sm leading-snug">
          Лежишь. Сила капает быстрее
          {full ? "." : ` · +1 через ${formatWait(wait)}.`} Можно убрать телефон.
        </p>
      )}
      {roof && !resting && full && (
        <p className="rounded-[14px] bg-raised px-3 py-2 text-sm leading-snug text-muted-foreground">
          Сила полная. Ты в шалаше — тепло капает само.
        </p>
      )}
      {roof &&
        (resting ? (
          <Button className="h-12 w-full text-base" onClick={() => g.restHere()}>
            Встать
          </Button>
        ) : (
          <>
            <Button className="h-12 w-full text-base" onClick={() => g.sleepHere()}>
              Спать · сила капает быстрее
            </Button>
            <Button className="h-12 w-full text-base" variant="secondary" onClick={() => g.restHere()}>
              Отдохнуть
            </Button>
          </>
        ))}
      {roof && (
        <Button className="h-12 w-full text-base" variant="outline" onClick={() => g.cookHere()}>
          Готовить · еда + полено · сытость
        </Button>
      )}
      {isHome && (g.character.carts ?? 0) < 1 && (
        <Button variant="outline" className="h-12 justify-between px-3" onClick={() => g.craftCart()}>
          <span>Тачка</span>
          <span className="text-[12px] text-muted-foreground">{CART_WOOD} дерева · груз, шаг как пешком</span>
        </Button>
      )}
      {(isHome || tile.building === "shed") &&
        (tile.chestLock ? (
          <Button variant="outline" className="h-12 justify-between px-3" onClick={() => g.takeLock("chest")}>
            <span>Снять замок</span>
            <span className="text-[12px] text-muted-foreground">сундук снова открыт чужим</span>
          </Button>
        ) : (
          <Button variant="outline" className="h-12 justify-between px-3" onClick={() => g.hangLock("chest")}>
            <span>Замок на сундук</span>
            <span className="text-[12px] text-muted-foreground">1 замок · чужой не возьмёт</span>
          </Button>
        ))}
      {isHome &&
        crafts.map((c) => (
          <Button key={c.id} variant="outline" className="h-12 justify-between px-3" onClick={() => g.doCraft(c.id)}>
            <span>{c.label}</span>
            <span className="text-[12px] text-muted-foreground">{c.hint}</span>
          </Button>
        ))}
      {tile.building === "house" && (tile.matter || "wood") !== "stone" && (
        <Button variant="outline" className="h-12" onClick={() => g.cladStone()}>
          Обложить камнем · {CLAD_STONE} камня
        </Button>
      )}
      <ChestGrid tile={tile} />
    </div>
  );
}

function WorkshopBody({ tile }: { tile: Tile }) {
  const g = useGame();
  const crafts = CRAFTS.filter((c) => canDoCraft(c, g.character.profession, tile));
  const isBench = tile.building === "bench" || tile.building === "workshop";
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">{placeHint(tile)}</p>
      {isBench && (g.character.carts ?? 0) < 1 && (
        <Button variant="outline" className="h-12 justify-between px-3" onClick={() => g.craftCart()}>
          <span>Тачка</span>
          <span className="text-[12px] text-muted-foreground">{CART_WOOD} дерева · груз, шаг как пешком</span>
        </Button>
      )}
      {isBench &&
        g.character.profession === "carpenter" &&
        !g.character.wagon &&
        g.character.transport !== "wagon" &&
        !g.world.tiles.some((t) => t.wagon === "you") && (
        <Button variant="outline" className="h-12 justify-between px-3" onClick={() => g.craftWagon()}>
          <span>Телега</span>
          <span className="text-[12px] text-muted-foreground">2 колеса · 4 дерева · слиток · плотник</span>
        </Button>
      )}
      {crafts.map((c) => (
        <Button key={c.id} variant="outline" className="h-12 justify-between px-3" onClick={() => g.doCraft(c.id)}>
          <span>{c.label}</span>
          <span className="text-[12px] text-muted-foreground">{c.hint}</span>
        </Button>
      ))}
      {crafts.length === 0 && (
        <p className="text-sm text-muted-foreground">Для твоего дела здесь нечего ковать.</p>
      )}
    </div>
  );
}

function LavkaBody({ tile }: { tile: Tile }) {
  const g = useGame();
  const haveWagon =
    g.character.wagon ||
    g.character.transport === "wagon" ||
    tile.wagon === "you" ||
    g.world.tiles.some((t) => t.wagon === "you");
  return (
    <div className="mt-3">
      <p className="text-[13px] text-muted-foreground">{g.trader.last}</p>
      <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Ход</p>
      <div className="mt-1.5 flex gap-1.5">
        {(g.character.carts ?? 0) < 1 ? (
          <Button size="sm" className="h-11 flex-1" onClick={() => g.buyCart()}>
            тачка {goldTxt(CART_GOLD)}
          </Button>
        ) : (
          <Button size="sm" className="h-11 flex-1" variant="outline" onClick={() => g.sellCart()}>
            продать тачку {goldTxt(Math.floor(CART_GOLD / 2))}
          </Button>
        )}
        {haveWagon ? (
          <Button size="sm" className="h-11 flex-1" variant="outline" onClick={() => g.sellWagon()}>
            продать телегу {goldTxt(Math.floor(WAGON_GOLD / 2))}
          </Button>
        ) : (
          <Button size="sm" className="h-11 flex-1" onClick={() => g.buyWagon()}>
            телега {goldTxt(WAGON_GOLD)}
          </Button>
        )}
      </div>
      <div className="mt-1.5">
        <Button size="sm" className="h-11 w-full" variant="outline" onClick={() => g.buyLock()}>
          замок {goldTxt(LOCK_GOLD)} · на калитку или сундук
        </Button>
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Живость</p>
      <div className="mt-1.5 flex gap-1.5">
        <Button size="sm" className="h-11 flex-1" onClick={() => g.buyLivestock("cow")}>
          корова {goldTxt(COW_PRICE)}
        </Button>
        <Button size="sm" className="h-11 flex-1" onClick={() => g.buyLivestock("horse")}>
          лошадь {goldTxt(HORSE_PRICE)}
        </Button>
      </div>
      <TradeLists
        demand={g.trader.demand}
        wares={g.trader.wares}
        onSell={(k, n) => g.sellToCaravan(k, n)}
        onBuy={(k) => g.buyFromTrader(k, 1)}
        traderBonus={g.character.profession === "trader"}
        season={g.season}
      />
      <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Биржа у лавки</p>
      <Jobs />
    </div>
  );
}

function ShopBody({ tile }: { tile: Tile }) {
  const g = useGame();
  const mine = isYours(tile);
  const chest = tile.chest;
  if (mine) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Твоя лавка. Клади товар в тайник — его видят гости. Выручка копится.</p>
        <Button className="h-12 w-full text-base" onClick={() => g.collectShop()}>
          Забрать выручку · {goldTxt(tile.takings)}
        </Button>
        <ChestGrid tile={tile} />
      </div>
    );
  }
  return (
    <div className="mt-3">
      <p className="text-[13px] text-muted-foreground">Лавка {tile.owner}. Смотри витрину. Своей сумкой не путать.</p>
      <TradeLists
        demand={{ wood: 8, food: 8, herb: 4, bread: 2, plank: 2, smoked: 2 }}
        wares={chest}
        onSell={(k, n) => g.sellToShop(k, n)}
        onBuy={(k) => g.buyFromShop(k, 1)}
        traderBonus={g.character.profession === "trader"}
        season={g.season}
      />
    </div>
  );
}

function FieldBody({ tile }: { tile: Tile }) {
  const g = useGame();
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">{waterHint(g.world, tile)}</p>
      {tile.amount > 0 && (
        <Button className="h-12" onClick={() => g.doGather()}>
          Собрать урожай · {tile.amount} {ITEM_LABEL[tile.resource ?? "food"]}
        </Button>
      )}
      {tile.amount <= 0 && (
        <Button className="h-12" variant="secondary" onClick={() => g.sowField()}>
          Засеять · 1 еда · крестьянин
        </Button>
      )}
    </div>
  );
}

function PenBody({ tile }: { tile: Tile }) {
  const g = useGame();
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">{waterHint(g.world, tile)}</p>
      {tile.herd && (
        <Button className="h-12" onClick={() => g.feedHere()}>
          Положить корм · {ANIMAL_LABEL[tile.herd.kind]} ×{tile.herd.count}
        </Button>
      )}
      {(g.character.pail ?? 0) > 0 && (
        <Button variant="secondary" className="h-12" onClick={() => g.pourWater()}>
          Вылить воду
        </Button>
      )}
    </div>
  );
}

function WellBody() {
  const g = useGame();
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Button className="h-12 w-full" onClick={() => g.drinkWater()}>
        Напиться
      </Button>
      <Button className="h-12 w-full" variant="secondary" onClick={() => g.fillBucket()}>
        Набрать ведро
      </Button>
      {(g.character.pail ?? 0) > 0 && (
        <Button className="h-12 w-full" variant="outline" onClick={() => g.sipPail()}>
          Глоток из ведра
        </Button>
      )}
    </div>
  );
}

function BoardBody() {
  return (
    <div className="mt-3">
      <p className="text-[13px] text-muted-foreground">Заказы недели. Сдают здесь, не из сумки.</p>
      <Jobs />
    </div>
  );
}

function MineBody({ tile }: { tile: Tile }) {
  const g = useGame();
  return (
    <div className="mt-4 flex flex-col gap-2">
      {tile.amount > 0 && (
        <Button className="h-12" onClick={() => g.doGather()}>
          Добыть · {tile.amount} {ITEM_LABEL[tile.resource ?? "ore"]}
        </Button>
      )}
      <Button variant="secondary" className="h-12" onClick={() => g.prospectHere()}>
        Искать кристалл · рудокоп
      </Button>
    </div>
  );
}

function TowerBody({ tile }: { tile: Tile }) {
  const g = useGame();
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">Пост. Не стреляет. Отдых как под крышей.</p>
      {isRoof(tile) || tile.building === "tower" ? (
        <Button className="h-12" onClick={() => g.restHere()}>
          {g.character.resting ? "Встать" : "Дозор · отдохнуть"}
        </Button>
      ) : null}
    </div>
  );
}

function Jobs() {
  const g = useGame();
  return (
    <ul className="mt-2 space-y-2">
      {g.jobs.map((j) => (
        <li key={j.id} className="flex items-center justify-between gap-2 text-sm">
          <span>
            <span className="font-display text-lg">{goldTxt(j.pay)}</span>
            <span className="text-muted-foreground">
              {" "}
              · {j.need} {ITEM_LABEL[j.item]}
            </span>
          </span>
          {j.status === "open" && (
            <Button size="sm" variant="outline" className="h-10" onClick={() => g.takeJob(j.id)}>
              сдать
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function TradeLists({
  demand,
  wares,
  onSell,
  onBuy,
  traderBonus,
  season,
}: {
  demand: Partial<Record<ItemId, number>>;
  wares: Partial<Record<ItemId, number>>;
  onSell: (k: ItemId, n: number) => void;
  onBuy: (k: ItemId) => void;
  traderBonus: boolean;
  season: "spring" | "summer" | "autumn" | "winter";
}) {
  const inv = useGame((s) => s.character.inventory);
  return (
    <>
      <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">У тебя / сдать</p>
      <ul className="mt-1 space-y-1">
        {ITEMS.filter((k) => (demand[k] ?? 0) > 0).map((k) => {
            const lot = sellLot(k);
            const pay = caravanBuy(k, season, traderBonus);
            return (
          <li key={k} className="flex items-center justify-between gap-2">
            <span className="text-sm">
              {ITEM_LABEL[k]} · у тебя {inv[k] ?? 0} ·{" "}
              {lot > 1 ? `пачка ${lot} · ${goldTxt(pay)}` : `сдать за ${goldTxt(pay)}`}
            </span>
            <Button
              size="sm"
              className="h-10"
              disabled={(inv[k] ?? 0) < lot}
              onClick={() => onSell(k, lot)}
            >
              сдать
            </Button>
          </li>
            );
        })}
        {ITEMS.every((k) => (demand[k] ?? 0) <= 0) && (
          <li className="text-sm text-muted-foreground">Сейчас ничего не берут.</li>
        )}
      </ul>
      <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Купить</p>
      <ul className="mt-1 space-y-1">
        {ITEMS.filter((k) => (wares[k] ?? 0) > 0).map((k) => (
          <li key={`w-${k}`} className="flex items-center justify-between gap-2">
            <span className="text-sm">
              {ITEM_LABEL[k]} · {wares[k]} · купить за {goldTxt(caravanSell(k, season))}
            </span>
            <Button size="sm" variant="outline" className="h-10" onClick={() => onBuy(k)}>
              купить
            </Button>
          </li>
        ))}
        {ITEMS.every((k) => (wares[k] ?? 0) <= 0) && (
          <li className="text-sm text-muted-foreground">Полки пусты.</li>
        )}
      </ul>
    </>
  );
}

function ChestGrid({ tile }: { tile: Tile }) {
  const g = useGame();
  const chest = tile.chest;
  const inv = g.character.inventory;
  const mine = isYours(tile);
  if (!mine) return null;
  const stock = ITEMS.filter((k) => (chest[k] ?? 0) > 0 || (inv[k] ?? 0) > 0).slice(0, 16);
  return (
    <div className="mt-2">
      <p className="font-display text-lg leading-none">Сундук</p>
      <p className="mt-1 text-[12px] text-muted-foreground">в ношу / из ноши</p>
      {stock.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Пусто.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {stock.map((k) => (
            <li key={k} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {ITEM_LABEL[k]} · сундук {chest[k] ?? 0} · ноша {inv[k] ?? 0}
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="outline" className="h-9" disabled={(chest[k] ?? 0) <= 0} onClick={() => g.takeChest(k, 1)}>
                  в ношу
                </Button>
                <Button size="sm" variant="outline" className="h-9" disabled={(inv[k] ?? 0) <= 0} onClick={() => g.storeItem(k, 1)}>
                  из ноши
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CampBody({ tile }: { tile: Tile }) {
  const g = useGame();
  const here = g.character.x === tile.x && g.character.y === tile.y;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">
        {tile.burned ? "Костёр погас." : "Костёр. Греет рядом. Готовь стоя на клетке. Крыши нет — спать нельзя."}
      </p>
      {here && !tile.burned && (
        <Button className="h-12 w-full text-base" variant="outline" onClick={() => g.cookHere()}>
          Готовить · еда + полено · сытость
        </Button>
      )}
    </div>
  );
}

function BuildPane({ tile }: { tile: Tile }) {
  const g = useGame();
  if (isForeignYard(tile)) {
    return <p className="mt-4 text-sm text-muted-foreground">чужой двор</p>;
  }
  return (
    <div className="mt-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Дорога</p>
      <div className="mt-1.5 flex gap-1.5">
        {(["dirt", "stone", "bridge"] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            variant="outline"
            className="h-11 flex-1"
            onClick={() => {
              g.doRoad(tile.x, tile.y, k);
              g.closeInspect();
            }}
          >
            {k === "dirt" ? "грунт" : k === "stone" ? "камень" : "мост"}
          </Button>
        ))}
      </div>
      {(tile.owned || tile.plot || tile.building === "none") && (
        <>
          {(tile.plot || tile.owned
            ? ([
                ["Жильё", ["shack", "house", "shed", "camp"]],
                ["Станки и столы", ["bench", "forge", "oven", "smoke", "herbs", "coalpit", "stall", "adit"]],
                ["Двор", ["field", "well", "pen", "stable", "tower", "jail"]],
              ] as const)
            : ([
                ["В поле", ["shack", "camp", "field", "pen", "well"]],
                ["Берег и край", ["net", "stakes", "moat"]],
              ] as const)
          ).map(([title, ids]) => (
            <div key={title}>
              <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">{title}</p>
              {!tile.plot && !tile.owned && title === "В поле" && (
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                  Станки и стол трав — во дворе. Сначала два угла тына.
                </p>
              )}
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {ids.map((b) => (
                  <Button
                    key={b}
                    size="sm"
                    variant="outline"
                    className="h-11"
                    onClick={() => {
                      g.setBuildKind(b);
                      g.doBuild(tile.x, tile.y);
                      g.closeInspect();
                    }}
                  >
                    {BUILDING_LABEL[b]}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {BUILD_COST[b].wood ? `${BUILD_COST[b].wood} дер.` : BUILD_COST[b].stone ? `${BUILD_COST[b].stone} кам.` : ""}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function YardPane({ tile }: { tile: Tile }) {
  const g = useGame();
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Button className="h-12" variant="secondary" onClick={() => g.upgradeFence("palisade")}>
        Частокол · дерево
      </Button>
      <Button className="h-12" variant="secondary" onClick={() => g.upgradeFence("wall")}>
        Стена · камень
      </Button>
      <Button className="h-12" variant="outline" onClick={() => g.makeGate()}>
        Калитка на этом крае
      </Button>
      {tile.gateLock ? (
        <Button className="h-12" variant="outline" onClick={() => g.takeLock("gate")}>
          Снять засов · калитка снова дыра
        </Button>
      ) : (
        <Button className="h-12" variant="outline" onClick={() => g.hangLock("gate")}>
          Засов на калитки · 1 замок
        </Button>
      )}
      <Button className="h-12" variant="outline" onClick={() => g.toggleLaw()}>
        {g.character.village && tile.village === g.character.village
          ? tile.law
            ? "Снять закон деревни"
            : "Закон деревни · вора сажают"
          : tile.law
            ? "Снять законы двора"
            : "Законы двора · вора сажают"}
      </Button>
      <Button className="h-12" variant="outline" onClick={() => g.dropYard()}>
        Снять забор двора
      </Button>
    </div>
  );
}
