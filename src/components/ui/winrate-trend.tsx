"use client";

import { useEffect, useRef, useState } from "react";
import type { TrendPoint } from "@/lib/profile";

const H = 160;
const PAD = { top: 12, right: 12, bottom: 22, left: 34 };

/** 누적 승률 추이 (선 하나 + 50% 기준선). 마우스를 올리면 해당 경기 정보 */
export function WinrateTrend({ points }: { points: TrendPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // 실제 너비로 그려 글자·선이 늘어나지 않게 한다
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 2) {
    return <p className="text-xs text-ink-tertiary">2경기 이상부터 추이를 보여 줍니다.</p>;
  }

  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (wr: number) => PAD.top + ih - (wr / 100) * ih;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.winRate).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  const onMove = (clientX: number) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W; // 화면 좌표 → viewBox 좌표
    const i = Math.round(((sx - PAD.left) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const hp = hover !== null ? points[hover] : null;
  const date = (iso: string) => {
    const d = new Date(Date.parse(iso) + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
  };

  return (
    <div>
      <div
        ref={wrap}
        className="relative select-none touch-none"
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => onMove(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img"
          aria-label={`누적 승률 추이: ${points.length}경기, 현재 ${last.winRate.toFixed(0)}%`}>
          {/* 축·격자 (흐리게) */}
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)}
                stroke="var(--hairline)" strokeWidth={1} strokeDasharray={v === 50 ? "4 4" : undefined} />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-tertiary)">{v}%</text>
            </g>
          ))}
          {/* 누적 승률 선 */}
          <path d={path} fill="none" stroke="var(--primary-hover)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* 마우스 위치 */}
          {hp && (
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={PAD.top + ih} stroke="var(--ink-tertiary)" strokeWidth={1} />
          )}
          <text x={PAD.left} y={H - 4} fontSize="11" fill="var(--ink-tertiary)">1경기</text>
          <text x={W - PAD.right} y={H - 4} fontSize="11" fill="var(--ink-tertiary)" textAnchor="end">{points.length}경기</text>
        </svg>
        {/* 점은 SVG 비율 왜곡 없이 HTML 로 */}
        {hp && (
          <>
            <span
              className={`pointer-events-none absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface-1 ${hp.win ? "bg-win" : "bg-lose"}`}
              style={{ left: `${(x(hover!) / W) * 100}%`, top: `${(y(hp.winRate) / H) * 100}%` }}
            />
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full -mt-3 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-[11px] text-ink-muted whitespace-nowrap shadow"
              style={{ left: `${Math.min(85, Math.max(15, (x(hover!) / W) * 100))}%`, top: `${(y(hp.winRate) / H) * 100}%` }}
            >
              {hp.index}번째 · {date(hp.date)} · <span className={hp.win ? "text-win" : "text-lose"}>{hp.win ? "승" : "패"}</span>
              <span className="text-ink"> · 누적 {hp.winRate.toFixed(0)}%</span>
            </div>
          </>
        )}
      </div>
      {/* 화면 낭독기·표 보기용 */}
      <table className="sr-only">
        <caption>누적 승률 추이</caption>
        <thead><tr><th>경기</th><th>날짜</th><th>결과</th><th>누적 승률</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.index}><td>{p.index}</td><td>{date(p.date)}</td><td>{p.win ? "승" : "패"}</td><td>{p.winRate.toFixed(0)}%</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
