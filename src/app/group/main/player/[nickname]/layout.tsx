import type { Metadata } from "next";
import { readCountedMatches } from "@/lib/server/public-read";

// 선수 페이지 링크를 공유했을 때의 제목·설명
export async function generateMetadata({ params }: { params: Promise<{ nickname: string }> }): Promise<Metadata> {
  const { nickname: raw } = await params;
  const nickname = decodeURIComponent(raw);
  const matches = await readCountedMatches();
  const mine = (matches || []).flatMap((m) => m.players.filter((p) => p.nickname === nickname));
  if (mine.length === 0) return { title: `${nickname} · 컴학내전` };
  const wins = mine.filter((p) => p.win).length;
  const k = mine.reduce((s, p) => s + p.kills, 0), d = mine.reduce((s, p) => s + p.deaths, 0), a = mine.reduce((s, p) => s + p.assists, 0);
  const title = `${nickname} 내전 전적`;
  const description = `${mine.length}전 ${wins}승 ${mine.length - wins}패 · 승률 ${Math.round((wins / mine.length) * 100)}% · KDA ${d === 0 ? "Perfect" : ((k + a) / d).toFixed(2)}`;
  return { title: `${title} · 컴학내전`, description, openGraph: { title, description } };
}

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
