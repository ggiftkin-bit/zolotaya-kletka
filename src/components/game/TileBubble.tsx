import { useEffect, useRef, useState, type ReactNode } from "react";
import { BIOME_LABEL, FIELD_CROP, ITEM_LABEL, ITEMS } from "@/game/constants";
import { CRAFTS, canDoCraft } from "@/game/craft";
import { BUILD_COST, BUILDING_LABEL, CART_GOLD, CART_WOOD, LOCK_GOLD, WAGON_GOLD, caravanBuy, caravanSell, goldTxt, sellLot } from "@/game/economy";
import { ANIMAL_LABEL, COW_PRICE, HORSE_PRICE, waterHint } from "@/game/life";
import { LIFE_INDEX } from "@/game/art";
import { canOpenPlace, lootOn, placeHint, placeTitle, wildActs } from "@/game/places";
import { FOG_DARK, FOG_LIVE, fogAt } from "@/game/book";
import { bagGoods, bringDestLine, bringDests, BRING_GOODS, BRING_N, canPostFromBoard, canReadBoard, canSeeService, craftsAtTile, firstOwnGate, firstOwnShed, isCraftStation, isGateTile, SERVICE_DO, SERVICE_GOLD, SERVICE_LABEL, serviceJobOf, serviceLine, stallLine, stallOrderOf, STALL_PRICES, streetNotices } from "@/game/market";
import { occupantAt } from "@/game/fight";
import { canFoundVillage, canPlaceBoard, canPutLiveName, clusterHint, hamletTitle, hasOwnYard, namesTouchingYard, villageOf } from "@/game/pact";
import { isForeignYard, isYours } from "@/game/crime";
import { canDigReason, fillPay } from "@/game/pit";
import { useGame, meetIsIgnored } from "@/game/store";
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

type Pane = "pick" | "place" | "gather" | "build" | "yard" | "service";

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
            : pane === "service"
              ? "Услуга"
              : tile.bank && tile.building === "none"
              ? "берег"
              : tile.pit
                ? "яма"
                : tile.caravan
                  ? "Лавка"
                  : tile.building !== "none"
                    ? BUILDING_LABEL[tile.building]
                    : tile.road !== "none"
                      ? `${
                          tile.road === "bridge" ? "мост" : tile.road === "stone" ? "камень" : "тракт"
                        } · ${
                          tile.biome === "forest"
                            ? "лес"
                            : tile.biome === "river" || tile.biome === "ford"
                              ? "река"
                              : tile.biome === "plains" || tile.biome === "fertile"
                                ? "поле"
                                : BIOME_LABEL[tile.biome]
                        }`
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
            commons={tile.commons && tile.road === "none"}
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
      {pane === "service" && <ServiceBody tile={tile} />}
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
  const liveName = canPutLiveName(g.world);
  const myVillage = villageOf(g.world, "you") || g.character.village;
  const joinNames = !myVillage ? namesTouchingYard(g.world, "you") : [];
  const joinHere =
    joinNames.length > 0 &&
    fogAt(g.world, tile.x, tile.y) === FOG_LIVE &&
    (tile.village && joinNames.includes(tile.village) ? tile.village : joinNames[0]!);
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
      {open && (here || (tile.building === "stall" && near)) && (
        <Sticker
          title={tile.caravan ? "Открыть лавку" : `Открыть · ${placeTitle(tile)}`}
          sub={placeHint(tile)}
          ico={<Ico i={tile.caravan || tile.building === "shop" || tile.building === "stall" ? ICO.gold : ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPane("place")}
        />
      )}
      {near && fogAt(g.world, tile.x, tile.y) === FOG_LIVE && canSeeService(tile, isYours(tile)) && (
        <Sticker
          title="Услуга"
          sub={serviceJobOf(tile) ? serviceLine(serviceJobOf(tile)!) : "постой, отвези, привези, сделай, построй"}
          ico={<Ico i={ICO.gold} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPane("service")}
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
                  ? "Нарвать траву"
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
      {dummy && dummy.life !== "alive" && (
        <p className="text-[13px] text-muted-foreground">{dummy.name} лежит. Не добивать.</p>
      )}
      {dummy && dummy.life === "alive" && here && !down && !locked && !meetIsIgnored(tile.x, tile.y, dummy.id) && (
        <>
          <Sticker
            title="Встретиться"
            sub={dummy.dummy ? `${dummy.name} · манекен хутора` : `${dummy.name} · человек`}
            ico={<Ico i={ICO.stake} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => g.startMeet(dummy.id)}
          />
          <Sticker
            title="Пройти мимо"
            sub="лист не откроется"
            ico={<Ico i={ICO.boots} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => g.meetPass(dummy.id)}
          />
        </>
      )}
      {dummy && dummy.life === "alive" && !here && (
        <p className="text-[13px] text-muted-foreground">
          {dummy.name} здесь. Встань на его клетку. С соседней бой не начать.
        </p>
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
      {near && (atOwn || atFriend || tile.commons || (!tile.plot && tile.village)) && (shod || liveName) && !myVillage && (
        <>
          <input
            value={vName}
            onChange={(e) => setVName(e.target.value)}
            className="h-11 w-full rounded-[12px] border border-border bg-raised px-3 text-base"
            placeholder="Выселки"
            aria-label="Имя деревни"
          />
          <Sticker
            title={shod ? "Сход — деревня" : "Поставить имя"}
            sub={shod ? "пять дворов, ты староста" : "вторая почта примет в пятне"}
            onClick={() => g.formVillage(vName)}
          />
        </>
      )}
      {near && joinHere && (
        <Sticker title={`Принять · ${joinHere}`} sub="двор касается имени" onClick={() => g.joinVillage(joinHere)} />
      )}
      {near && atOwn && myVillage && (
        <Sticker title="Уйти" sub={myVillage} dim onClick={() => g.dissolveVillage()} />
      )}
      {near && atOwn && !shod && !liveName && !myVillage && ownYard && (
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

function PlacePane({ tile, here, near }: { tile: Tile; here: boolean; near: boolean }) {
  if (tile.building === "stall") {
    if (!near) {
      return <p className="mt-4 text-sm text-muted-foreground">Подойди к прилавку.</p>;
    }
    return <StallBody tile={tile} />;
  }
  if (tile.building === "board") {
    if (!near) {
      return <p className="mt-4 text-sm text-muted-foreground">Подойди к доске.</p>;
    }
    return <BoardBody tile={tile} />;
  }
  if (!here) {
    return <p className="mt-4 text-sm text-muted-foreground">Зайди внутрь — встань на клетку.</p>;
  }
  const mine = isYours(tile);
  if (tile.caravan) return <LavkaBody tile={tile} />;
  if (tile.building === "shop") return <ShopBody tile={tile} />;
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
      {tile.building === "shed" && (
        <p className="text-[13px] text-muted-foreground">
          Куча на клетке — сырьё станку в двух клетках. Свой двор или то же имя. Сундук как был.
        </p>
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

function StallBody({ tile }: { tile: Tile }) {
  const g = useGame();
  const [pick, setPick] = useState<ItemId | null>(null);
  const live = fogAt(g.world, tile.x, tile.y) === FOG_LIVE;
  const mine = isYours(tile);
  const order = live ? stallOrderOf(tile) : null;
  const goods = bagGoods(g.character);

  if (!live) {
    return <p className="mt-4 text-sm text-muted-foreground">В тумане витрины нет. Подойди ближе.</p>;
  }

  if (order) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">
          {mine ? "Твой ордер. Вещь на прилавке, не в сумке." : `Чужой прилавок. ${stallLine(order)}.`}
        </p>
        <p className="font-display text-2xl leading-none">{stallLine(order)}</p>
        {mine ? (
          <Button className="h-12 w-full text-base" onClick={() => g.dropStall()}>
            Снять · обратно в сумку
          </Button>
        ) : (
          <Button className="h-12 w-full text-base" onClick={() => g.takeStall()}>
            Взять · {goldTxt(order.gold)}
          </Button>
        )}
      </div>
    );
  }

  if (!mine) {
    return <p className="mt-4 text-sm text-muted-foreground">Пусто. Чужой прилавок, ордера нет.</p>;
  }

  if (pick) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Цена словом. Вещь сразу на витрину.</p>
        <p className="font-display text-xl leading-none">{ITEM_LABEL[pick]}</p>
        {STALL_PRICES.map((n) => (
          <Sticker
            key={n}
            title={goldTxt(n)}
            ico={<Ico i={ICO.gold} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => {
              g.putStall(pick, n);
              setPick(null);
            }}
          />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setPick(null)}>
          Другая вещь
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">Положи вещь из сумки. Цена словом, не 3g.</p>
      {goods.length === 0 ? (
        <p className="text-sm text-muted-foreground">Сумка пуста.</p>
      ) : (
        goods.map((k) => (
          <Sticker
            key={k}
            title={ITEM_LABEL[k]}
            sub={`в сумке ×${g.character.inventory[k]}`}
            ico={<ItemPic id={k} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => setPick(k)}
          />
        ))
      )}
    </div>
  );
}

function ServiceBody({ tile }: { tile: Tile }) {
  const g = useGame();
  const live = fogAt(g.world, tile.x, tile.y) === FOG_LIVE;
  const mine = isYours(tile);
  const job = live ? serviceJobOf(tile) : null;
  const [kind, setKind] = useState<"watch" | "haul" | "craft" | "build" | "bring" | null>(null);
  const [haulItem, setHaulItem] = useState<ItemId | null>(null);
  const [bringItem, setBringItem] = useState<ItemId | null>(null);
  const [bringN, setBringN] = useState<number | null>(null);
  const [bringDest, setBringDest] = useState<{ x: number; y: number } | null>(null);
  const [craftId, setCraftId] = useState<string | null>(null);
  const [buildKind, setBuildKind] = useState<BuildingKind | null>(null);
  const goods = bagGoods(g.character);
  const crafts = craftsAtTile(tile);
  const canWatch = isGateTile(tile) || tile.building === "stall";
  const canHaul = canWatch;
  const canBring = canWatch;
  const canCraft = isCraftStation(tile);
  const canBuild = !!tile.plot && tile.building === "none";
  const dests = canBring ? bringDests(g.world, tile) : [];

  if (!live) {
    return <p className="mt-4 text-sm text-muted-foreground">В тумане услуги нет. Подойди ближе.</p>;
  }

  if (job) {
    const mineJob = job.by === "you";
    const mineTake = job.take === "you";
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">
          {mineJob
            ? job.take
              ? "Взяли. Ждут дело или срыв."
              : "Твоя услуга. Золото уже в книге."
            : mineTake
              ? "Твоё дело. Стой или довези."
              : job.take
                ? "Уже взяли."
                : "Чужая услуга. Возьми, если стоишь рядом."}
        </p>
        <p className="font-display text-2xl leading-none">{serviceLine(job)}</p>
        {mineJob && !job.take ? (
          <Button className="h-12 w-full text-base" onClick={() => g.dropService()}>
            Снять · золото обратно
          </Button>
        ) : !mineJob && !job.take ? (
          <Button className="h-12 w-full text-base" onClick={() => g.takeService()}>
            Взять · {goldTxt(job.gold)}
          </Button>
        ) : null}
      </div>
    );
  }

  if (!mine) {
    return <p className="mt-4 text-sm text-muted-foreground">Пусто. Чужую услугу кладут сами.</p>;
  }

  const goldPick = (onPick: (n: number) => void) => (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">Цена словом. Золото сразу в книгу.</p>
      {SERVICE_GOLD.map((n) => (
        <Sticker
          key={n}
          title={goldTxt(n)}
          ico={<Ico i={ICO.gold} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPick(n)}
        />
      ))}
      <Button variant="outline" className="h-12" onClick={() => { setKind(null); setHaulItem(null); setBringItem(null); setBringN(null); setBringDest(null); setCraftId(null); setBuildKind(null); }}>
        Назад
      </Button>
    </div>
  );

  if (kind === "watch") {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Постой у калитки. Срок на дело, не на вывеску.</p>
        {SERVICE_DO.map((sec) => (
          <div key={sec} className="flex flex-col gap-1">
            <p className="text-[12px] text-muted-foreground">{sec / 60} мин</p>
            {SERVICE_GOLD.map((n) => (
              <Sticker
                key={`${sec}-${n}`}
                title={`${sec / 60} мин · ${goldTxt(n)}`}
                ico={<Ico i={ICO.gold} className="size-11 overflow-hidden rounded-[12px]" />}
                onClick={() => g.postWatch(n, sec)}
              />
            ))}
          </div>
        ))}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>
          Назад
        </Button>
      </div>
    );
  }

  if (kind === "haul" && !haulItem) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Вещь из сумки. Отвезут сюда.</p>
        {goods.length === 0 ? (
          <p className="text-sm text-muted-foreground">Сумка пуста.</p>
        ) : (
          goods.map((k) => (
            <Sticker
              key={k}
              title={ITEM_LABEL[k]}
              sub={`в сумке ×${g.character.inventory[k]}`}
              ico={<ItemPic id={k} className="size-11 overflow-hidden rounded-[12px]" />}
              onClick={() => setHaulItem(k)}
            />
          ))
        )}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>
          Назад
        </Button>
      </div>
    );
  }

  if (kind === "haul" && haulItem) {
    return goldPick((n) => {
      g.postHaul(haulItem, n);
      setHaulItem(null);
      setKind(null);
    });
  }

  if (kind === "bring" && !bringItem) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Что привезти. У тебя в сумке не нужно — несёт исполнитель.</p>
        {BRING_GOODS.map((k) => (
          <Sticker
            key={k}
            title={ITEM_LABEL[k]}
            ico={<ItemPic id={k} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => setBringItem(k)}
          />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>
          Назад
        </Button>
      </div>
    );
  }

  if (kind === "bring" && bringItem && bringN == null) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">{ITEM_LABEL[bringItem]}. Сколько: 1–8.</p>
        {BRING_N.map((n) => (
          <Sticker
            key={n}
            title={`×${n}`}
            ico={<ItemPic id={bringItem} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => setBringN(n)}
          />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setBringItem(null)}>
          Назад
        </Button>
      </div>
    );
  }

  if (kind === "bring" && bringItem && bringN != null && !bringDest) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Куда. Не на доску и не сюда.</p>
        {dests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет другой клетки двора, склада или калитки.</p>
        ) : (
          dests.map((d) => (
            <Sticker
              key={`${d.x},${d.y}`}
              title={bringDestLine(d)}
              sub={`${d.x},${d.y}`}
              ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
              onClick={() => setBringDest({ x: d.x, y: d.y })}
            />
          ))
        )}
        <Button variant="outline" className="h-12" onClick={() => setBringN(null)}>
          Назад
        </Button>
      </div>
    );
  }

  if (kind === "bring" && bringItem && bringN != null && bringDest) {
    return goldPick((n) => {
      g.postBring(bringItem, bringN, bringDest.x, bringDest.y, n);
      setBringItem(null);
      setBringN(null);
      setBringDest(null);
      setKind(null);
    });
  }

  if (kind === "craft" && !craftId) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Рецепт станка. Сырьё сразу в книгу.</p>
        {crafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">На этом станке рецептов нет.</p>
        ) : (
          crafts.map((d) => (
            <Sticker
              key={d.id}
              title={d.label}
              sub={d.hint}
              ico={<ItemPic id={d.out} className="size-11 overflow-hidden rounded-[12px]" />}
              onClick={() => setCraftId(d.id)}
            />
          ))
        )}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>
          Назад
        </Button>
      </div>
    );
  }

  if (kind === "craft" && craftId) {
    return goldPick((n) => {
      g.postCraft(craftId as Parameters<typeof g.postCraft>[0], n);
      setCraftId(null);
      setKind(null);
    });
  }

  if (kind === "build" && !buildKind) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Построй на этой клетке. Материал в книгу.</p>
        {BUILDINGS.map((b) => (
          <Sticker
            key={b}
            title={BUILDING_LABEL[b]}
            sub={`${BUILD_COST[b].wood ? `${BUILD_COST[b].wood} дер.` : ""}${BUILD_COST[b].wood && BUILD_COST[b].stone ? " · " : ""}${BUILD_COST[b].stone ? `${BUILD_COST[b].stone} кам.` : ""}`}
            ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => setBuildKind(b)}
          />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>
          Назад
        </Button>
      </div>
    );
  }

  if (kind === "build" && buildKind) {
    return goldPick((n) => {
      g.postBuild(buildKind, n);
      setBuildKind(null);
      setKind(null);
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">Контракт двух почт. Не витрина ордера.</p>
      {canWatch && (
        <Sticker
          title={SERVICE_LABEL.watch}
          sub="стоит на клетке до срока"
          ico={<Ico i={ICO.boots} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => setKind("watch")}
        />
      )}
      {canHaul && (
        <Sticker
          title={SERVICE_LABEL.haul}
          sub="вещь из сумки сюда"
          ico={<Ico i={ICO.wood} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => setKind("haul")}
        />
      )}
      {canBring && (
        <Sticker
          title={SERVICE_LABEL.bring}
          sub="своё на двор, склад или калитку"
          ico={<Ico i={ICO.wood} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => setKind("bring")}
        />
      )}
      {canCraft && (
        <Sticker
          title={SERVICE_LABEL.craft}
          sub="рецепт этого станка"
          ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => setKind("craft")}
        />
      )}
      {canBuild && (
        <Sticker
          title={SERVICE_LABEL.build}
          sub="на пустой клетке двора"
          ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => setKind("build")}
        />
      )}
      {!canWatch && !canHaul && !canBring && !canCraft && !canBuild && (
        <p className="text-sm text-muted-foreground">Здесь услугу не кладут. Калитка, прилавок, станок или пустой двор.</p>
      )}
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
          Засеять · 1 {ITEM_LABEL[FIELD_CROP]} · крестьянин
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

function BoardBody({ tile }: { tile: Tile }) {
  const g = useGame();
  useEffect(() => {
    g.lookBoard(tile.x, tile.y);
  }, [tile.x, tile.y]);
  const live = fogAt(g.world, tile.x, tile.y) === FOG_LIVE;
  const near = Math.max(Math.abs(g.character.x - tile.x), Math.abs(g.character.y - tile.y)) <= 1;
  const readable = canReadBoard(tile, g.character.x, g.character.y, fogAt(g.world, tile.x, tile.y));
  const name = tile.village;
  const rows = readable && name ? streetNotices(g.world, name) : [];
  const mine = isYours(tile);
  const canHang = mine && canPostFromBoard(tile, mine, g.character.x, g.character.y);
  const [tab, setTab] = useState<"list" | "hang">("list");

  if (!live) {
    return <p className="mt-4 text-sm text-muted-foreground">В тумане доски нет. Подойди ближе.</p>;
  }
  if (!near) {
    return <p className="mt-4 text-sm text-muted-foreground">Подойди к доске.</p>;
  }

  const tabs = canHang ? (
    <div className="mt-3 flex gap-1">
      <Button variant={tab === "list" ? "default" : "outline"} className="h-10 flex-1" onClick={() => setTab("list")}>
        Висят
      </Button>
      <Button variant={tab === "hang" ? "default" : "outline"} className="h-10 flex-1" onClick={() => setTab("hang")}>
        Повесить
      </Button>
    </div>
  ) : null;

  if (tab === "hang" && canHang) {
    return (
      <div>
        {tabs}
        <HangFromBoard tile={tile} />
      </div>
    );
  }

  if (!name) {
    return (
      <div>
        {tabs}
        <p className="mt-4 text-sm text-muted-foreground">Доска без имени. Лист пуст — саму доску ставят. Повесить можно на свою клетку.</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div>
        {tabs}
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-[13px] text-muted-foreground">
            «{name}». Ордера и услуги этой улицы.
          </p>
          <p className="text-sm text-muted-foreground">Пусто.</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      {tabs}
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">
          «{name}». Берут здесь или у цели.
        </p>
        {rows.map((row) => {
          const jobTile = row.kind === "service" ? tileAt(g.world, row.x, row.y) : null;
          const job = jobTile ? serviceJobOf(jobTile) : null;
          const takeHere = !!(job && job.by !== "you" && !job.take);
          return (
            <Sticker
              key={`${row.kind}-${row.x}-${row.y}`}
              title={row.line}
              sub={row.kind === "order" ? "прилавок · пойти" : takeHere ? "услуга · взять" : "услуга · пойти"}
              ico={<Ico i={row.kind === "order" ? ICO.gold : ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
              onClick={() => {
                if (takeHere) g.takeServiceAt(row.x, row.y);
                else g.goTo(row.x, row.y);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function HangFromBoard({ tile }: { tile: Tile }) {
  const g = useGame();
  const [kind, setKind] = useState<"watch" | "haul" | "craft" | "build" | "bring" | null>(null);
  const [haulItem, setHaulItem] = useState<ItemId | null>(null);
  const [bringItem, setBringItem] = useState<ItemId | null>(null);
  const [bringN, setBringN] = useState<number | null>(null);
  const [dest, setDest] = useState<Tile | null>(null);
  const [craftId, setCraftId] = useState<string | null>(null);
  const [buildKind, setBuildKind] = useState<BuildingKind | null>(null);
  const gate = firstOwnGate(g.world);
  const shed = firstOwnShed(g.world);
  const goods = bagGoods(g.character);
  const dests = bringDests(g.world, tile);
  const stations = g.world.tiles.filter((t) => isYours(t) && craftsAtTile(t).length > 0).slice(0, 8);
  const plots = g.world.tiles.filter((t) => isYours(t) && t.plot && t.building === "none").slice(0, 8);

  const goldPick = (onPick: (n: number) => void) => (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">Цена словом. Золото сразу в книгу.</p>
      {SERVICE_GOLD.map((n) => (
        <Sticker
          key={n}
          title={goldTxt(n)}
          ico={<Ico i={ICO.gold} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPick(n)}
        />
      ))}
      <Button variant="outline" className="h-12" onClick={() => setDest(null)}>
        Назад
      </Button>
    </div>
  );

  const destBtns = (need: Tile[], onPick: (t: Tile) => void) => (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">Куда. Тык клетки или к калитке / на склад.</p>
      {gate && (
        <Sticker title="к калитке" sub={bringDestLine(gate)} ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => onPick(gate)} />
      )}
      {shed && (
        <Sticker title="на склад" sub={bringDestLine(shed)} ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => onPick(shed)} />
      )}
      {need.map((d) => (
        <Sticker
          key={`${d.x},${d.y}`}
          title={bringDestLine(d)}
          sub={`${d.x},${d.y}`}
          ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
          onClick={() => onPick(d)}
        />
      ))}
      <Button variant="outline" className="h-12" onClick={() => { setKind(null); setHaulItem(null); setBringItem(null); setBringN(null); setCraftId(null); setBuildKind(null); }}>
        Назад
      </Button>
    </div>
  );

  if (kind === "watch" && dest) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Постой. Срок на дело, не на вывеску.</p>
        {SERVICE_DO.map((sec) => (
          <div key={sec} className="flex flex-col gap-1">
            {SERVICE_GOLD.map((n) => (
              <Sticker
                key={`${sec}-${n}`}
                title={`${sec / 60} мин · ${goldTxt(n)}`}
                ico={<Ico i={ICO.gold} className="size-11 overflow-hidden rounded-[12px]" />}
                onClick={() => g.postWatch(n, sec, dest.x, dest.y)}
              />
            ))}
          </div>
        ))}
        <Button variant="outline" className="h-12" onClick={() => setDest(null)}>Назад</Button>
      </div>
    );
  }
  if (kind === "watch") return destBtns(gate ? [gate] : dests.filter(isGateTile), setDest);

  if (kind === "haul" && haulItem && dest) {
    return goldPick((n) => {
      g.postHaul(haulItem, n, dest.x, dest.y);
      setHaulItem(null);
      setDest(null);
      setKind(null);
    });
  }
  if (kind === "haul" && haulItem) return destBtns(dests.filter((d) => isGateTile(d) || d.building === "stall"), setDest);
  if (kind === "haul") {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Вещь из сумки. Отвезут на цель.</p>
        {goods.length === 0 ? <p className="text-sm text-muted-foreground">Сумка пуста.</p> : goods.map((k) => (
          <Sticker key={k} title={ITEM_LABEL[k]} sub={`в сумке ×${g.character.inventory[k]}`} ico={<ItemPic id={k} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setHaulItem(k)} />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>Назад</Button>
      </div>
    );
  }

  if (kind === "bring" && bringItem && bringN != null && dest) {
    return goldPick((n) => {
      g.postBring(bringItem, bringN, dest.x, dest.y, n, true);
      setBringItem(null);
      setBringN(null);
      setDest(null);
      setKind(null);
    });
  }
  if (kind === "bring" && bringItem && bringN != null) return destBtns(dests, setDest);
  if (kind === "bring" && bringItem) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">{ITEM_LABEL[bringItem]}. Сколько: 1–8.</p>
        {BRING_N.map((n) => (
          <Sticker key={n} title={`×${n}`} ico={<ItemPic id={bringItem} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setBringN(n)} />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setBringItem(null)}>Назад</Button>
      </div>
    );
  }
  if (kind === "bring") {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Что привезти. Несёт исполнитель.</p>
        {BRING_GOODS.map((k) => (
          <Sticker key={k} title={ITEM_LABEL[k]} ico={<ItemPic id={k} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setBringItem(k)} />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>Назад</Button>
      </div>
    );
  }

  if (kind === "craft" && craftId && dest) {
    return goldPick((n) => {
      g.postCraft(craftId as Parameters<typeof g.postCraft>[0], n, dest.x, dest.y);
      setCraftId(null);
      setDest(null);
      setKind(null);
    });
  }
  if (kind === "craft" && craftId) return destBtns(stations, setDest);
  if (kind === "craft") {
    const all = stations.flatMap((st) => craftsAtTile(st).map((d) => ({ d, st })));
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Рецепт своего станка.</p>
        {all.length === 0 ? <p className="text-sm text-muted-foreground">Нет станка.</p> : all.map(({ d }) => (
          <Sticker key={d.id} title={d.label} sub={d.hint} ico={<ItemPic id={d.out} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setCraftId(d.id)} />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>Назад</Button>
      </div>
    );
  }

  if (kind === "build" && buildKind && dest) {
    return goldPick((n) => {
      g.postBuild(buildKind, n, dest.x, dest.y);
      setBuildKind(null);
      setDest(null);
      setKind(null);
    });
  }
  if (kind === "build" && buildKind) return destBtns(plots, setDest);
  if (kind === "build") {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">Построй на пустой клетке двора.</p>
        {BUILDINGS.map((b) => (
          <Sticker
            key={b}
            title={BUILDING_LABEL[b]}
            sub={`${BUILD_COST[b].wood ? `${BUILD_COST[b].wood} дер.` : ""}${BUILD_COST[b].wood && BUILD_COST[b].stone ? " · " : ""}${BUILD_COST[b].stone ? `${BUILD_COST[b].stone} кам.` : ""}`}
            ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />}
            onClick={() => setBuildKind(b)}
          />
        ))}
        <Button variant="outline" className="h-12" onClick={() => setKind(null)}>Назад</Button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">Род → что → сколько → куда → золото. Заказ на цель.</p>
      <Sticker title={SERVICE_LABEL.watch} sub="у калитки" ico={<Ico i={ICO.boots} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setKind("watch")} />
      <Sticker title={SERVICE_LABEL.haul} sub="из сумки на цель" ico={<Ico i={ICO.wood} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setKind("haul")} />
      <Sticker title={SERVICE_LABEL.bring} sub="своё на склад или калитку" ico={<Ico i={ICO.wood} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setKind("bring")} />
      <Sticker title={SERVICE_LABEL.craft} sub="рецепт станка" ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setKind("craft")} />
      <Sticker title={SERVICE_LABEL.build} sub="пустой плот" ico={<Ico i={ICO.house} className="size-11 overflow-hidden rounded-[12px]" />} onClick={() => setKind("build")} />
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
                ["Станки и столы", ["bench", "forge", "oven", "smoke", "herbs", "coalpit", "stall", "board", "adit"]],
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
          {canPlaceBoard(g.world, tile, isYours(tile)) && !tile.plot && (
            <div>
              <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Имя</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 h-11"
                onClick={() => {
                  g.setBuildKind("board");
                  g.doBuild(tile.x, tile.y);
                  g.closeInspect();
                }}
              >
                {BUILDING_LABEL.board}
                <span className="ml-1 text-[10px] text-muted-foreground">{BUILD_COST.board.wood} дер.</span>
              </Button>
            </div>
          )}
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
