import { cn } from "@/lib/utils";
import type { Biome, ItemId, Profession, Weather } from "@/game/types";

export function Sprite({
  src,
  index,
  cols,
  rows,
  className,
  alt = "",
}: {
  src: string;
  index: number;
  cols: number;
  rows: number;
  className?: string;
  alt?: string;
}) {
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x = cols <= 1 ? 0 : (col / (cols - 1)) * 100;
  const y = rows <= 1 ? 0 : (row / (rows - 1)) * 100;
  return (
    <span
      role="img"
      aria-label={alt}
      className={cn("inline-block shrink-0 bg-no-repeat", className)}
      style={{
        backgroundImage: `url(${src})`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${x}% ${y}%`,
      }}
    />
  );
}

export const ICO = {
  gold: 0,
  wood: 1,
  stone: 2,
  food: 3,
  fish: 4,
  ore: 5,
  axe: 6,
  bag: 7,
  gather: 8,
  stake: 9,
  road: 10,
  house: 11,
  help: 12,
  dice: 13,
  boots: 14,
  eat: 15,
} as const;

export const ITEM_ICO: Record<ItemId, number> = {
  wood: ICO.wood,
  stone: ICO.stone,
  ore: ICO.ore,
  food: ICO.food,
  fish: ICO.fish,
  axe: ICO.axe,
  pick: ICO.axe,
  herb: 0,
  clay: 1,
  crystal: 2,
  rope: 0,
  bucket: 1,
  spear: 2,
  shovel: 3,
  rod: ICO.fish,
  bread: ICO.food,
  plank: ICO.wood,
  bar: ICO.ore,
  tonic: 0,
  smoked: ICO.fish,
  coal: ICO.stone,
  wheel: ICO.road,
  lock: ICO.stake,
};

export function ExtraIco({ i, className, alt }: { i: number; className?: string; alt?: string }) {
  return <Sprite src="/game/extras.png" index={i} cols={2} rows={2} className={className} alt={alt} />;
}

export const GEAR_ICO = {
  rope: 0,
  bucket: 1,
  spear: 2,
  water: 3,
} as const;

export function GearPic({ i, className, alt }: { i: number; className?: string; alt?: string }) {
  return <Sprite src="/game/gear.png" index={i} cols={2} rows={2} className={className} alt={alt} />;
}

export function LifePic({ i, className, alt }: { i: number; className?: string; alt?: string }) {
  return <Sprite src="/game/life.png" index={i} cols={3} rows={3} className={className} alt={alt} />;
}

export function ItemPic({ id, className }: { id: ItemId; className?: string }) {
  if (id === "herb" || id === "clay" || id === "crystal" || id === "tonic") {
    return <ExtraIco i={id === "tonic" ? 0 : ITEM_ICO[id]} className={className} alt="" />;
  }
  if (id === "rope" || id === "bucket" || id === "spear") {
    return <GearPic i={GEAR_ICO[id]} className={className} alt="" />;
  }
  if (id === "shovel") return <ExtraIco i={3} className={className} alt="" />;
  if (id === "pick") return <Ico i={ICO.axe} className={className} alt="" />;
  if (id === "rod") {
    return (
      <span
        role="img"
        aria-label=""
        className={cn("inline-block shrink-0 bg-cover bg-center", className)}
        style={{ backgroundImage: "url(/game/rod.png)" }}
      />
    );
  }
  if (id === "coal") return <Ico i={ICO.stone} className={className} alt="" />;
  if (id === "plank") return <Ico i={ICO.wood} className={className} alt="" />;
  if (id === "bar") return <Ico i={ICO.ore} className={className} alt="" />;
  if (id === "bread") return <Ico i={ICO.food} className={className} alt="" />;
  if (id === "smoked") return <Ico i={ICO.fish} className={className} alt="" />;
  if (id === "wheel") return <Ico i={ICO.road} className={className} alt="" />;
  if (id === "lock") return <Ico i={ICO.stake} className={className} alt="" />;
  return <Ico i={ITEM_ICO[id]} className={className} alt="" />;
}

export const BIOME_ICO: Record<Biome, number> = {
  plains: 0,
  fertile: 1,
  forest: 2,
  mountain: 3,
  ore: 4,
  swamp: 5,
  river: 6,
  ford: 7,
};

export const JOB_ICO: Record<Profession, number> = {
  wanderer: 0,
  lumberjack: 1,
  miner: 2,
  fisher: 3,
  farmer: 4,
  baker: 5,
  carpenter: 6,
  smith: 7,
  trader: 8,
  healer: 9,
  hireling: 10,
};

export const WEATHER_ICO: Record<Weather | "night", number> = {
  clear: 0,
  rain: 1,
  snow: 2,
  night: 3,
};

export function Ico({ i, className, alt }: { i: number; className?: string; alt?: string }) {
  return <Sprite src="/game/icons.png" index={i} cols={4} rows={4} className={className} alt={alt} />;
}

export function BiomePic({ biome, commons, className }: { biome: Biome; commons?: boolean; className?: string }) {
  return (
    <Sprite
      src="/game/biomes.png"
      index={commons ? 8 : BIOME_ICO[biome]}
      cols={3}
      rows={3}
      className={className}
      alt=""
    />
  );
}

export function JobPic({ job, className }: { job: Profession; className?: string }) {
  return <Sprite src="/game/jobs.png" index={JOB_ICO[job]} cols={4} rows={3} className={className} alt="" />;
}

export function WeatherPic({
  weather,
  night,
  className,
}: {
  weather: Weather;
  night?: boolean;
  className?: string;
}) {
  const i = night ? 3 : WEATHER_ICO[weather];
  return <Sprite src="/game/weather.png" index={i} cols={2} rows={2} className={className} alt="" />;
}
