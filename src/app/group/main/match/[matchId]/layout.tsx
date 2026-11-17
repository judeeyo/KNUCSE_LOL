import type { Metadata } from "next";
import { readMatch, koreanDate } from "@/lib/server/public-read";

// 경기 링크를 공유했을 때의 제목·설명 (카드 이미지는 같은 폴더의 opengraph-image.tsx)
export async function generateMetadata({ params }: { params: Promise<{ matchId: string }> }): Promise<Metadata> {
  const { matchId } = await params;
  const match = await readMatch(matchId);
  if (!match) return { title: "경기 기록 · 컴학내전" };

  const blue = match.players.filter((p) => p.team === "blue");
  const red = match.players.filter((p) => p.team === "red");
  const k = (t: typeof blue) => t.reduce((s, p) => s + p.kills, 0);
  const winner = blue[0]?.win ? "블루 승" : "레드 승";
  const mvp = match.players.find((p) => p.isMvp);
  const title = `${koreanDate(match.createdAt)} 내전 · 블루 ${k(blue)} : ${k(red)} 레드`;
  const description = [
    match.excludedReason ? `${match.excludedReason} (기록 제외 경기)` : winner,
    match.gameDuration && `${match.gameDuration}`,
    mvp && `MVP ${mvp.nickname} (${mvp.champion})`,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title: `${title} · 컴학내전`,
    description,
    openGraph: { title, description, type: "article" },
  };
}

export default function MatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
