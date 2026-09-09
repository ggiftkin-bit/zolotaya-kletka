import { ITEM_LABEL, BAG_CELLS } from "@/game/constants";
import { CRAFTS, PROF_BLURB } from "@/game/craft";
import { BUILDING_LABEL, BUY_GOLD, PROFESSION_LABEL, SELL_GOLD, SELL_PACK, buildCostLine, goldTxt } from "@/game/economy";
import { BUILD_HINT } from "@/game/goal";
import { hamletTitle, friendNames } from "@/game/pact";
import { useGame } from "@/game/store";
import type { BuildingKind, Profession } from "@/game/types";
import { Button } from "@/components/ui/button";
import { ICO, Ico, ItemPic, JobPic } from "./Sprite";
import { cn } from "@/lib/utils";
import { useState } from "react";

export const HOWTO = [
  { k: "Золото", v: "Большая цифра слева сверху — счёт книги, не кармана. Сдаёшь добро в лавку на тракте — цифра растёт. С одной почты за сутки книги — 12 сдач; 13-я — «на сегодня хватит», золото не капает. Купить у тракта потолок не режет. Кружка, ускорить, руки, залог, тачка — стол шлёт род дела, книга снимает цену. Подмена цифры в запросе не капает. Склад тракта 0…100: полон — не берут, пусто — не продают. Нигде нет буквы g: только «N золота».", i: ICO.gold },
  { k: "Сила", v: "Бак 18. Счёт книги, как золото: поле 90 с, шалаш 45, сон 20. В шалаше нажми Спать. Кружка 8 золота — сразу +4. Подмена силы в записи фишки не капает.", i: ICO.boots },
  { k: "Тело", v: "Сытость, тепло и вода тела — счёт книги, как сила. Съел хлеб — сытость пишет книга. Напился у реки — вода 100. Ведро: набрал / глоток +25 / вылил. Подмена цифры в записи фишки не капает. Без еды и без глотка сами не растут.", i: ICO.food },
  { k: "Ход", v: "Тап — только лист клетки. Дело — второй тык по наклейке. «Ко мне» двигает взгляд, не ходит. Ход идёт по часам: закрыл стол — фишка всё равно идёт, рубка и постой доделываются. Откроешь — уже на месте или дело готово.", i: ICO.boots },
  { k: "Ноша", v: "Пешком 22 кг. Тачка — 20 золота или 8 дерева: 72 кг, шаг как пешком. Стоит на клетке, не в сумке: взял / оставил. Лошадь ×2½, ноша 28 кг — тоже на клетке. Телега — 48 золота в лавке или плотник: 2 колеса + 4 дерева + слиток. Цепляется к лошади, 180 кг. Упал / яма — тачка и лошадь остаются здесь. Чужую стоящую уводят делом.", i: ICO.bag },
  { k: "Сумка", v: "Док «Сумка» — две вкладки: ноша и снасть. Счёт книги, не кармана: срубил — дерево пишет книга, закрыл стол — то же число. Двое на одном дереве — взял один, второй «уже нет». Подмена мешка в записи фишки не проходит. Квадраты по пять в ряд, только то что есть. Тап выбирает, ест и надевает плашка снизу. Сундук — полоска дома, в поле его нет. Профессия — в книге «Кем быть», не в ноше.", i: ICO.bag },
  { k: "Куча", v: "Выложил, упал, погиб — куча на клетке. «Поднять». Ход и яма ношу не едят. Куча в книге мира: другая почта видит ту же кучу.", i: ICO.gather },
  { k: "Удочка", v: "Сколотить дома: 1 дерево и 1 верёвка. Рыбу ловят только ею. Копьё — охота, верёвка — лошадь.", i: ICO.fish },
  { k: "Трава", v: "На равнине, не на поляне. Сорвал — отрастает. Быстрее дерева: первая былинка через две недели, потом ещё. Зимой стоит.", i: ICO.gather },
  { k: "Зерно", v: "Своё поле даёт зерно. Дикая пашня — еда, как была. 2 зерна → 1 мука дома или у печи. Мельница: 2 зерна → 2 муки. Пекарь: 2 муки → хлеб. Сырым зерно не едят.", i: ICO.food },
  { k: "Туман", v: "Видно одну-две клетки вокруг. За рекой — нет, вдоль реки — да. Дальше только стоя на горе, жиле или в своей башне. У подножия — как в поле. Тьма — «неизвестная клетка», не жила и не лес.", i: ICO.help },
  { k: "Снасть", v: "Топор, кирка, копьё, лопата, дубина, нож ломаются. Топор ~160, кирка ~120, копьё ~60, лопата ~80, дубина ~80, нож ~50. Кованый топор / кирка / лопата — кузнец у горна, слиток + обычный. В руке +1 к съёму. Износ тот же. Лавка набор не берёт. Щит и броня в этом слое целы. Сломалась — новой нет, кузнец или дом.", i: ICO.axe },
  { k: "Копка", v: "Лопата в руке, дело «копать». Равнина, лес, поле — песок, клетка становится ямой. Болото и берег реки — глина. Горы и жилу лопатой не берут. Яма — грунт, не вода: из неё не пьют, ведром не наполняют. Соседние ямы сливаются. За неделю мира сухая яма зарастает равниной, лес на яме не всходит. Двое на одной — второй «уже нет». Лавка берёт песок пачкой, как глину.", i: ICO.gather },
  { k: "Сеть", v: "На берегу. Ловят без удочки, стоя на сети. 4 дерева.", i: ICO.fish },
  { k: "Костёр", v: "2 дерева, в поле без двора. Греет рядом. Готовить — еда и полено. Спать нельзя: крыши нет.", i: ICO.house },
  { k: "Мельница", v: "Два станка во дворе, как печь. Мельница: дерево и камень. 2 зерна → 2 муки. Дом и печь как были: 2 → 1. Пилорама: дерево и доска. 3 дерева → 2 доски. Верстак плотника: 3 → 1. Склад через клетку кормит. Готовое в сумку или кучей на клетке станка.", i: ICO.house },
  { k: "Яма", v: "Сажают только чужого по закону двора. Свой костёр свою яму не кормит. На яме видно: чей двор, за что, залог 20 золота.", i: ICO.stake },
  { k: "Гибель", v: "Здоровье 0 — упал, куча на клетке. Ползи к шалашу: под крышей поднимешься. Под крышей голод, жажда и холод не валят — «Голоден. Съешь», но стоишь. Вышел в поле с нулями — упасть можно. 90 с в поле — погиб. Первый раз даром, потом 10, 20 золота. Выйдешь дома через 2 мин, сутки без хода. Партию не стираем.", i: ICO.house },
  { k: "Встреча", v: "Встань на клетку чужой фишки — лист, не автобой. С соседней листа нет. Бой фишка-на-фишку на одной клетке есть: живой пишет удар в книгу, у кого напали лист сам («Напали»). Армии и стрельбы башни нет. Ударить, отойти, кинуть ношу, сдаться. Упал, не погиб.", i: ICO.stake },
  { k: "Двор", v: "На листе клетки: «Угол двора», второй тап — «Замкнуть двор». Не кнопка дока. Док: Стоп · Ко мне · Съесть · Сумка. По краю тын. Без калитки тын не замкнёт — «Нужна калитка». Снял забор — дом на месте, серой заплаты нет. Пустой двор: первая наклейка — Шалаш. На шалаше при сырье — Дом. Калитка без замка — дыра. Тын не забирает чужой дом.", i: ICO.stake },
  { k: "Замок", v: "Кузнец льёт из слитка, или 16 золота в лавке. Повесь на калитку (чужой не войдёт) или на сундук (чужой не возьмёт). Ключей нет: свой открывается сам. Чужой — наклейка «Взломать». Поймают — яма, замок цел.", i: ICO.stake },
  { k: "Увод", v: "Чужую стоящую тачку, лошадь или телегу не берут тыком. Дело «увести», как куча и засов. Своё — сразу, без дела и следа. Без закона на клетке — довёл дело, стала твоя. Двор с законом: сорвался — след, как кража кучи; довёл — увёл. В сумку не кладётся. Хозяин может быть оффлайн.", i: ICO.stake },
  { k: "Услуга", v: "Вешают у калитки, прилавка, станка или с доски на цель. Срок только на дело: постой 15/30/60 мин стоять. Привези — исполнитель несёт своё на склад или калитку. Ушёл раньше — золото заказчику.", i: ICO.gold },
  { k: "Доска", v: "Знак у тракта, не мебель двора. Открой → Повесить: выбери род и куда (калитка / склад). Заказ пишется туда, столб только показывает. Вторая почта видит строку, берёт, идёт к цели. На клетку доски услугу не вешают. Обгорела — листа нет.", i: ICO.house },
  { k: "Контора", v: "У лавки тракта дверь «Контора». Три приза словом: значок 200, кружка 500, подарок нфт 1000. Купил — золото сгорело, «заказан — выдаст админ». В сумку не кладётся. Тот же приз этой почте повторно нельзя. «Поддержать стол» — +50 золота на эту почту, без карты.", i: ICO.gold },
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
  "mill",
  "sawmill",
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
        Пустой двор: первая наклейка — Шалаш (6 дерева). На шалаше, когда хватает дерева и камня — Дом.
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
              {buildCostLine(k)}
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
            2 колеса + 4 дерева + слиток · плотник · верстак. Или 48 золота в лавке. Цепляется к лошади, в карман не кладётся.
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
      <p className="text-[12px] text-muted-foreground">Сырьё пачкой. Готовое по штуке. Покупка в 3–4 раза дороже сдачи. Кружка 8 золота, ускорить 12, руки 16, залог 20. Старт 20.</p>
      <ul className="space-y-1">
        {[...BAG_CELLS, ...extra].map((k) => {
          const pack = SELL_PACK[k];
          const buy = BUY_GOLD[k];
          return (
          <li key={k} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <ItemPic id={k} className="size-7 overflow-hidden rounded-md" />
              {ITEM_LABEL[k]}
            </span>
            <span className="text-muted-foreground">
              {pack ? `${pack.n} шт → ${goldTxt(pack.gold)}` : goldTxt(SELL_GOLD[k])} / {goldTxt(buy)}
            </span>
          </li>
          );
        })}
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
