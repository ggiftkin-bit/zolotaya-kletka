import { ITEM_LABEL, BAG_CELLS } from "@/game/constants";
import { CRAFTS, PROF_BLURB } from "@/game/craft";
import { BUILD_COST, BUILDING_LABEL, PROFESSION_LABEL, SELL_GOLD, goldTxt } from "@/game/economy";
import { BUILD_HINT } from "@/game/goal";
import { hamletTitle, friendNames } from "@/game/pact";
import { useGame } from "@/game/store";
import type { BuildingKind, Profession } from "@/game/types";
import { ICO, Ico, ItemPic, JobPic } from "./Sprite";
import { cn } from "@/lib/utils";

export const HOWTO = [
  { k: "Золото", v: "Большая цифра слева сверху. Сдаёшь добро в лавку на тракте — цифра растёт. Нигде нет буквы g: только «N золота».", i: ICO.gold },
  { k: "Сила", v: "Бак 18. Капает сама (~28 с). В шалаше нажми Спать — быстрее, ответ в окне шалаша. Кружка за 6 золота — сразу. Сила 0 не ест дерево: сидишь и ждёшь.", i: ICO.boots },
  { k: "Ход", v: "Тап — наклейки. «Пойти» — шаг. Ход идёт по часам: убери телефон — дойдёт сам. Ускорить — 8 золота.", i: ICO.boots },
  { k: "Ноша", v: "Пешком 22 кг. Тачка — 8 золота или 8 дерева: 72 кг, шаг как пешком. Лошадь ×2½, ноша 28 кг. Телега — 24 золота в лавке или плотник: 2 колеса + 4 дерева + слиток. Цепляется к лошади, 180 кг, быстрее тачки, медленнее пустой лошади. В карман не кладётся: отцепил — стоит на клетке, её можно украсть.", i: ICO.bag },
  { k: "Сумка", v: "Док «Сумка» — сетка 4×4. Тап по ячейке: на землю, в сундук (свой шалаш/дом/склад), в руку (снасть).", i: ICO.bag },
  { k: "Куча", v: "Выложил, упал, погиб — куча на клетке. «Поднять». Ход и яма ношу не едят.", i: ICO.gather },
  { k: "Яма", v: "Сажают только по закону. Сидишь на яме: нет хода, нет «идёшь», нет сбора. Залог 12 золота.", i: ICO.stake },
  { k: "Гибель", v: "Здоровье 0 — упал, куча на клетке. Ползи к шалашу: под крышей поднимешься. 90 с в поле — погиб. Первый раз даром, потом 10, 20 золота. Выйдешь дома через 2 мин, сутки без хода. Партию не стираем.", i: ICO.house },
  { k: "Двор", v: "Нижний ряд «Двор». Два тапа — два угла. По краю тын. Пустой двор: первая наклейка — Шалаш. На шалаше при сырье — Дом. Калитка без замка — дыра.", i: ICO.stake },
  { k: "Замок", v: "Кузнец льёт из слитка, или 12 золота в лавке. Повесь на калитку (чужой не войдёт) или на сундук (чужой не возьмёт). Ключей нет: свой открывается сам. Чужой — наклейка «Взломать». Поймают — яма, замок цел.", i: ICO.stake },
  { k: "Деревня", v: "Четыре хутора кустом у поляны. Сход только если ≥5 дворов Чебышёв ≤2 и дружба. Ратушу не строим.", i: ICO.house },
  { k: "Оповещения", v: "Разреши в книге — придёт «пришёл», «охота готова», «сила полная». Без разрешения дело всё равно дойдёт, просто тихо.", i: ICO.help },
] as const;

const TABLE: Exclude<BuildingKind, "none" | "workshop" | "shop" | "board" | "mine" | "stable">[] = [
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

const JOBS: Profession[] = [
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

export type BookTab = "table" | "craft" | "who" | "abc";

export function Book({ tab, onTab }: { tab: BookTab; onTab: (t: BookTab) => void }) {
  return (
    <div>
      <div className="flex gap-1 rounded-[14px] bg-raised p-1">
        {(
          [
            ["table", "Стол"],
            ["craft", "Из чего"],
            ["who", "Кем быть"],
            ["abc", "Букварь"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onTab(id)}
            className={cn(
              "h-11 flex-1 rounded-[10px] text-sm",
              tab === id ? "bg-accent text-accent-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "table" && <TableTab />}
        {tab === "craft" && <CraftTab />}
        {tab === "who" && <WhoTab />}
        {tab === "abc" && <AbcTab />}
      </div>
    </div>
  );
}

function TableTab() {
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-snug text-muted-foreground">
        Пустой двор: первая наклейка — Шалаш (4 дерева). На шалаше, когда хватает дерева и камня — Дом.
        Станки ставят во дворе. Колья и ров — только снаружи тына. Ров как река.
      </p>
      <ul className="space-y-2">
        {TABLE.map((k) => (
          <li key={k} className="flex items-start justify-between gap-2">
            <span>
              <span className="font-display text-lg leading-none">{BUILDING_LABEL[k]}</span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">{BUILD_HINT[k]}</span>
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {BUILD_COST[k].wood ? `${BUILD_COST[k].wood} дер.` : ""}
              {BUILD_COST[k].wood && BUILD_COST[k].stone ? " · " : ""}
              {BUILD_COST[k].stone ? `${BUILD_COST[k].stone} кам.` : ""}
              {!BUILD_COST[k].wood && !BUILD_COST[k].stone ? "даром" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CraftTab() {
  return (
    <ul className="space-y-3">
      {CRAFTS.map((c) => (
        <li key={c.id} className="flex gap-3">
          <ItemPic id={c.out} className="size-12 overflow-hidden rounded-[12px] shadow-sm" />
          <div className="min-w-0">
            <p className="font-display text-lg leading-none">{c.label}</p>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{c.hint}</p>
          </div>
        </li>
      ))}
      <li className="flex gap-3">
        <Ico i={ICO.road} className="size-12 overflow-hidden rounded-[12px] shadow-sm" alt="" />
        <div className="min-w-0">
          <p className="font-display text-lg leading-none">телега</p>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            2 колеса + 4 дерева + слиток · плотник · верстак. Или 24 золота в лавке. Цепляется к лошади, в карман не кладётся.
          </p>
        </div>
      </li>
    </ul>
  );
}

function WhoTab() {
  return (
    <ul className="space-y-3">
      {JOBS.map((p) => (
        <li key={p} className="flex gap-3">
          <JobPic job={p} className="size-12 overflow-hidden rounded-[12px] shadow-sm" />
          <div className="min-w-0">
            <p className="font-display text-lg leading-none">{PROFESSION_LABEL[p]}</p>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{PROF_BLURB[p]}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AbcTab() {
  const pacts = useGame((s) => s.character.pacts);
  const village = useGame((s) => s.character.village);
  const friends = friendNames(pacts);
  const extra = (["clay", "crystal", "wheel", "lock"] as const).filter((k) => !BAG_CELLS.includes(k));
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {HOWTO.map((row) => (
          <li key={row.k} className="flex gap-3">
            <Ico i={row.i} className="size-12 overflow-hidden rounded-[12px] shadow-sm" alt="" />
            <div className="min-w-0">
              <p className="font-display text-lg leading-none">{row.k}</p>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{row.v}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="font-display text-lg leading-none">Сдать / купить</p>
      <p className="text-[12px] text-muted-foreground">Курс ×2. Кружка 6, ускорить 8, залог 12. Старт 20.</p>
      <ul className="space-y-1">
        {[...BAG_CELLS, ...extra].map((k) => (
          <li key={k} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <ItemPic id={k} className="size-7 overflow-hidden rounded-md" />
              {ITEM_LABEL[k]}
            </span>
            <span className="text-muted-foreground">
              {goldTxt(SELL_GOLD[k])} / {goldTxt(SELL_GOLD[k] * 2)}
            </span>
          </li>
        ))}
      </ul>
      <div className="rounded-[16px] bg-raised px-3 py-2">
        <p className="font-display text-lg leading-none">Друзья</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {friends.length
            ? friends.map(hamletTitle).join(" · ")
            : "Пока никого. Четыре хутора кустом к югу от поляны — наклейка «Дружить» у калитки."}
        </p>
        {village ? <p className="mt-1 text-[13px]">Деревня «{village}». Ты староста.</p> : null}
      </div>
    </div>
  );
}

export function HowToList() {
  return <AbcTab />;
}
