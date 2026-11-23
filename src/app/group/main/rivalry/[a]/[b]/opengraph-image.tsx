import { ImageResponse } from "next/og";
import { readCountedMatches } from "@/lib/server/public-read";
import { C, championIconData, championSplashData, Icon, OG_SIZE, ogFont } from "@/lib/server/og";
import { findRivalry, type SideSummary } from "@/lib/rivalry";
import type { Group } from "@/lib/types";

// 라이벌 링크 카톡 미리보기: 두 사람 주 챔피언 일러스트, 전적, 칭호, 최근 흐름
export const alt = "컴학내전 라이벌전";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 600;

const short = (s: string, n = 11) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default async function Image({ params }: { params: Promise<{ a: string; b: string }> }) {
  const { a, b } = await params;
  const [matches, font] = await Promise.all([readCountedMatches(), ogFont()]);
  const fonts = [{ name: "Pretendard", data: font, weight: 700 as const, style: "normal" as const }];
  const r = matches
    ? findRivalry({ id: "main", name: "main", members: [], matches } as unknown as Group, decodeURIComponent(a), decodeURIComponent(b))
    : null;

  if (!r) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", background: C.bg, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontFamily: "Pretendard" }}>
        컴학내전 라이벌전
      </div>,
      { ...size, fonts }
    );
  }

  const [splashA, splashB, ...icons] = await Promise.all([
    championSplashData(r.a.mainChampion),
    championSplashData(r.b.mainChampion),
    ...[...r.a.champs.slice(0, 3), ...r.b.champs.slice(0, 3)].map((c) => championIconData(c.champion)),
  ]);
  const iconsA = icons.slice(0, Math.min(3, r.a.champs.length));
  const iconsB = icons.slice(iconsA.length);
  const recent = r.games.slice(-10);
  const headline = r.titles.filter((t) => t.kind !== "revenge").map((t) => t.text).join(" · ");

  const Side = ({ s, color, align, data }: { s: SideSummary; color: string; align: "left" | "right"; data: (string | null)[] }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "left" ? "flex-start" : "flex-end", width: 400, gap: 10 }}>
      <div style={{ display: "flex", fontSize: 50, color }}>{short(s.nickname)}</div>
      <div style={{ display: "flex", fontSize: 22, color: C.muted }}>{s.mainChampion ? `주로 ${s.mainChampion}` : "고정 픽 없음"}</div>
      <div style={{ display: "flex", gap: 8, flexDirection: align === "left" ? "row" : "row-reverse" }}>
        {s.champs.slice(0, 3).map((c, i) => <Icon key={c.champion} name={c.champion} data={data[i] ?? null} size={56} />)}
      </div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: C.bg, color: C.ink, fontFamily: "Pretendard", display: "flex", position: "relative" }}>
        {splashA && (
          <img src={splashA} alt="" width={600} height={630} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover", opacity: 0.32 }} />
        )}
        {splashB && (
          <img src={splashB} alt="" width={600} height={630} style={{ position: "absolute", top: 0, left: 600, objectFit: "cover", opacity: 0.32 }} />
        )}
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", flexDirection: "column", padding: "36px 52px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: C.muted }}>
            <span style={{ color: C.primary }}>컴학내전 · 라이벌전</span>
            <span>전체 맞대결 {r.games.length}판</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexGrow: 1 }}>
            <Side s={r.a} color={C.blue} align="left" data={iconsA} />
            <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 110 }}>
              <span style={{ color: C.blue }}>{r.a.wins}</span>
              <span style={{ fontSize: 40, color: C.subtle }}>VS</span>
              <span style={{ color: C.red }}>{r.b.wins}</span>
            </div>
            <Side s={r.b} color={C.red} align="right" data={iconsB} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            {headline && <div style={{ display: "flex", fontSize: 30, color: C.mvp }}>{headline}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              {recent.map((g) => (
                <div key={g.match.id} style={{ width: 30, height: 30, borderRadius: 6, background: g.aWin ? C.blue : C.red, opacity: 0.85 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
