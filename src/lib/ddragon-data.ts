"use client";

import { getLatestDdragonVersion } from "./champions";

// 경기 상세의 아이템·소환사 주문·룬 이미지와 한글 이름 (Riot Data Dragon). 처음 필요할 때 한 번만 받는다.
const CDN = "https://ddragon.leagueoflegends.com/cdn";
const FALLBACK_VERSION = "16.13.1";

export interface LoadoutData {
  version: string;
  items: Map<number, string>; // id → 이름
  spells: Map<number, { name: string; image: string }>;
  runes: Map<number, { name: string; icon: string }>; // 핵심 룬·룬 계열
}

let cache: Promise<LoadoutData | null> | null = null;

export function loadLoadoutData(): Promise<LoadoutData | null> {
  cache ??= (async () => {
    const version = (await getLatestDdragonVersion()) || FALLBACK_VERSION;
    const get = async (file: string) => {
      const res = await fetch(`${CDN}/${version}/data/ko_KR/${file}`);
      if (!res.ok) throw new Error(file);
      return res.json();
    };
    try {
      const [items, spells, runes] = await Promise.all([get("item.json"), get("summoner.json"), get("runesReforged.json")]);
      const itemMap = new Map<number, string>();
      for (const [id, v] of Object.entries(items.data as Record<string, { name: string }>)) itemMap.set(Number(id), v.name);
      const spellMap = new Map<number, { name: string; image: string }>();
      for (const v of Object.values(spells.data as Record<string, { key: string; name: string; image: { full: string } }>)) {
        spellMap.set(Number(v.key), { name: v.name, image: `${CDN}/${version}/img/spell/${v.image.full}` });
      }
      const runeMap = new Map<number, { name: string; icon: string }>();
      for (const style of runes as Array<{ id: number; name: string; icon: string; slots: Array<{ runes: Array<{ id: number; name: string; icon: string }> }> }>) {
        runeMap.set(style.id, { name: style.name, icon: `${CDN}/img/${style.icon}` });
        for (const r of style.slots[0]?.runes || []) runeMap.set(r.id, { name: r.name, icon: `${CDN}/img/${r.icon}` });
      }
      return { version, items: itemMap, spells: spellMap, runes: runeMap };
    } catch {
      cache = null; // 다음에 다시 시도
      return null;
    }
  })();
  return cache;
}

export function itemImage(data: LoadoutData, id: number): string {
  return `${CDN}/${data.version}/img/item/${id}.png`;
}
