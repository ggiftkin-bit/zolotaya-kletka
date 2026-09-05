import { ITEM_LABEL, BAG_CELLS } from "@/game/constants";
import { CRAFTS, PROF_BLURB } from "@/game/craft";
import { BUILD_COST, BUILDING_LABEL, PROFESSION_LABEL, SELL_GOLD, goldTxt } from "@/game/economy";
import { BUILD_HINT } from "@/game/goal";
import { hamletTitle, friendNames } from "@/game/pact";
import { useGame } from "@/game/store";
import type { BuildingKind, Profession } from "@/game/types";
import { Button } from "@/components/ui/button";
import { ICO, Ico, ItemPic, JobPic } from "./Sprite";
import { cn } from "@/lib/utils";
import { useState } from "react";

export const HOWTO = [
  { k: "Золото", v: "Большая цифра слева сверху. Сдаёшь добро в лавку на тракте — цифра растёт. Нигде нет буквы g: только «N золота».", i: ICO.gold },
  { k: "Сила", v: "Бак 18. Капает сама (~28 с). В шалаше нажми Спать — быстрее, ответ в окне шалаша. Кружка за 6 золота — сразу. Сила 0 не ест дерево: сидишь и ждёшь.", i: ICO.boots },
  { k: "Ход", v: "Тап — только лист клетки. Дело — второй тык по наклейке. «Ко мне» двигает взгляд, не ходит. Ход идёт по часам.", i: ICO.boots },
  { k: "Ноша", v: "Пешком 22 кг. Тачка — 8 золота или 8 дерева: 72 кг, шаг как пешком. Лошадь ×2½, ноша 28 кг. Телега — 24 золота в лавке или плотник: 2 колеса + 4 дерева + слиток. Цепляется к лошади, 180 кг, быстрее тачки, медленнее пустой лошади. В карман не кладётся: отцепил — стоит на клетке, её можно украсть.", i: ICO.bag },
  { k: "Сумка", v: "Док «Сумка» — две вкладки: ноша и снасть. Квадраты по пять в ряд, только то что есть. Тап выбирает, ест и надевает плашка снизу. Сундук — полоска дома, в поле его нет. Профессия — в книге «Кем быть», не в ноше.", i: ICO.bag },
  { k: "Куча", v: "Выложил, упал, погиб — куча на клетке. «Поднять». Ход и яма ношу не едят.", i: ICO.gather },
  { k: "Удочка", v: "Сколотить дома: 1 дерево и 1 верёвка. Рыбу ловят только ею. Копьё — охота, верёвка — лошадь.", i: ICO.fish },
  { k: "Трава", v: "На равнине, не на поляне. Сорвал — отрастает. Быстрее дерева: первая былинка через две недели, потом ещё. Зимой стоит.", i: ICO.gather },
  { k: "Туман", v: "Видно одну-две клетки вокруг. За рекой — нет, вдоль реки — да. Гора и башня смотрят дальше. Тьма — «неизвестная клетка», не жила и не лес.", i: ICO.help },
  { k: "Снасть", v: "Топор, кирка, копьё, лопата, дубина, нож ломаются. Топор ~160, кирка ~120, копьё ~60, лопата ~80, дубина ~80, нож ~50. Щит и броня в этом слое целы. Сломалась — новой нет, кузнец или дом.", i: ICO.axe },
  { k: "Сеть", v: "На берегу. Ловят без удочки, стоя на сети. 4 дерева.", i: ICO.fish },
  { k: "Костёр", v: "2 дерева, в поле без двора. Греет рядом. Готовить — еда и полено. Спать нельзя: крыши нет.", i: ICO.house },
  { k: "Яма", v: "Сажают только чужого по закону двора. Свой костёр свою яму не кормит. На яме видно: чей двор, за что, залог 12 золота.", i: ICO.stake },
  { k: "Гибель", v: "Здоровье 0 — упал, куча на клетке. Ползи к шалашу: под крышей поднимешься. 90 с в поле — погиб. Первый раз даром, потом 10, 20 золота. Выйдешь дома через 2 мин, сутки без хода. Партию не стираем.", i: ICO.house },
  { k: "Встреча", v: "Встань на клетку чужой фишки — лист, не автобой. С соседней листа нет, кража с соседней как была. Ударить, отойти, кинуть ношу, сдаться. Говорить — красноречие ≥3 или друг. Упал, не погиб. Закон после удара. Пока манекен у хутора.", i: ICO.stake },
  { k: "Двор", v: "Нижний ряд «Двор». Два тапа — два угла. По краю тын. Пустой двор: первая наклейка — Шалаш. На шалаше при сырье — Дом. Калитка без замка — дыра.", i: ICO.stake },
  { k: "Замок", v: "Кузнец льёт из слитка, или 12 золота в лавке. Повесь на калитку (чужой не войдёт) или на сундук (чужой не возьмёт). Ключей нет: свой открывается сам. Чужой — наклейка «Взломать». Поймают — яма, замок цел.", i: ICO.stake },
  { k: "Деревня", v: "Четыре хутора кустом у поляны. Сход только если ≥5 дворов Чебышёв ≤2 и дружба. Ратушу не строим.", i: ICO.house },
  { k: "Оповещения", v: "Разреши в книге — придёт «пришёл», «охота готова», «сила полная». Без разрешения дело всё равно дойдёт, просто тихо.", i: ICO.help },
] as const;

const TABLE: Exclude<BuildingKind, "none" | "workshop" | "shop" | "board" | "mine">[] = [
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
        Станки и стол трав ставят во дворе. Костёр — в поле, без двора. Колья и ров — только снаружи тына. Ров как река.
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
  const g = useGame();
  const [ask, setAsk] = useState<Profession | null>(null);
  const job = g.character.profession;
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-snug text-muted-foreground">
        Профессия — один раз. Бродяга смотрит всех, «стать» закрывает смену. Не из сумки.
      </p>
      {job !== "wanderer" && (
        <p className="text-[13px] text-muted-foreground">Уже {PROFESSION_LABEL[job]}. Пока так.</p>
      )}
      {ask && job === "wanderer" && (
        <div className="rounded-[14px] bg-raised p-3">
          <p className="text-sm leading-snug">Стать {PROFESSION_LABEL[ask]}? Обратно сам не сменишь.</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Button className="h-11" variant="secondary" onClick={() => setAsk(null)}>
              нет
            </Button>
            <Button
              className="h-11"
              onClick={() => {
                g.setProfession(ask);
                setAsk(null);
              }}
            >
              стать
            </Button>
          </div>
        </div>
      )}
      <ul className="space-y-2">
        {JOBS.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => {
                if (job !== "wanderer") {
                  g.setProfession(p);
                  return;
                }
                if (p === "wanderer") return;
                setAsk(p);
              }}
              className={cn(
                "flex w-full gap-3 rounded-[14px] p-2 text-left",
                job === p ? "bg-accent text-accent-foreground" : "bg-raised",
              )}
            >
              <JobPic job={p} className="size-12 shrink-0 overflow-hidden rounded-[12px] shadow-sm" />
              <div className="min-w-0">
                <p className="font-display text-lg leading-none">{PROFESSION_LABEL[p]}</p>
                <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{PROF_BLURB[p]}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AbcTab() {
  const pacts = useGame((s) => s.character.pacts);
  const village = useGame((s) => s.character.village);
  const friends = friendNames(pacts);
  const extra = (["crystal", "wheel", "lock"] as const).filter((k) => !BAG_CELLS.includes(k));
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
