# Карта текстур · public/game

Брать только эти пути. Не путать v2 и v3, не путать fill-* с v3.

## Заливки пола (v3)

| файл | куда |
|---|---|
| `/game/v3-ravnina.jpg` | равнина, commons, луг |
| `/game/v3-trakt.jpg` | грунтовый тракт, только лента ~0.32 TILE |
| `/game/v3-bruschatka.jpg` | двор plot и каменный тракт, масштаб 0.10 |
| `/game/v3-boloto.jpg` | болото |
| `/game/v3-melkovode.jpg` | только брод, не вся река |
| `/game/v3-gory.jpg` | гора |
| `/game/v3-ruda.jpg` | руда |
| `/game/v3-rov-suh.jpg` | сухой ров |
| `/game/v3-rov-mok.jpg` | ров с водой |

## Спрайты

| файл | куда |
|---|---|
| `/game/v2-derevya-mult.png` | ели, пни, камыш, камни брода |
| `/game/v2-tyn-vertikal.png` | **не рисовать** — тын линией в `paintFence` |
| `/game/v3-yama.png` | яма сверху клетки |

## Пол леса / пашня (v2)

| файл | куда |
|---|---|
| `/game/v2-les-pol.jpg` | пол под елями |
| `/game/v2-lug.jpg` | запас луга, если нет v3-ravnina |
| `/game/v2-pashnya.jpg` | пашня и огород, масштаб **0.14** |

## Старые fill-* не трогать для новых слоёв

`fill-cobble.jpg`, `fill-dirt.jpg`, `fill-meadow.jpg`, `fill-swamp.jpg` — прошлая пачка.
Река-форма — `paintRiverGround`, не открытка.
