"use client";

import { useEffect, useState } from "react";
import { itemImage, loadLoadoutData, type LoadoutData } from "@/lib/ddragon-data";
import type { PlayerStat } from "@/lib/types";

function Box({ src, title, size = 22, round }: { src?: string | null; title?: string; size?: number; round?: boolean }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={title || ""} title={title} width={size} height={size} className={`shrink-0 bg-surface-2 ${round ? "rounded-full" : "rounded"}`} style={{ width: size, height: size }} />
  ) : (
    <span className="shrink-0 rounded bg-surface-2 inline-block" title={title} style={{ width: size, height: size }} />
  );
}

/** 소환사 주문·룬·아이템 한 줄 (op.gg 경기 상세처럼). 정보가 없는 예전 경기는 아무것도 그리지 않음 */
export function Loadout({ player }: { player: PlayerStat }) {
  const [data, setData] = useState<LoadoutData | null>(null);
  const has = Boolean(player.items?.length || player.spell1Id || player.perkKeystone);
  useEffect(() => {
    if (!has) return;
    let alive = true;
    loadLoadoutData().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [has]);
  if (!has) return null;

  const spells = [player.spell1Id, player.spell2Id].map((id) => (id && data?.spells.get(id)) || null);
  const keystone = player.perkKeystone ? data?.runes.get(player.perkKeystone) : undefined;
  const sub = player.perkSubStyle ? data?.runes.get(player.perkSubStyle) : undefined;
  const items = player.items || [];

  return (
    <div className="flex items-center gap-1.5 flex-wrap" aria-label="주문·룬·아이템">
      <div className="flex flex-col gap-0.5">
        {spells.map((s, i) => <Box key={i} src={s?.image} title={s?.name} size={18} />)}
      </div>
      {(keystone || sub) && (
        <div className="flex flex-col items-center gap-0.5">
          <Box src={keystone?.icon} title={keystone?.name} size={20} round />
          <Box src={sub?.icon} title={sub?.name} size={14} round />
        </div>
      )}
      <div className="flex items-center gap-0.5 ml-1">
        {Array.from({ length: 7 }, (_, i) => items[i] || 0).map((id, i) => (
          <Box
            key={i}
            src={id && data ? itemImage(data, id) : null}
            title={id ? data?.items.get(id) || `아이템 ${id}` : undefined}
            size={i === 6 ? 20 : 24}
            round={i === 6}
          />
        ))}
      </div>
    </div>
  );
}
