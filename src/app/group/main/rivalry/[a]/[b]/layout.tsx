import type { Metadata } from "next";
import { readCountedMatches } from "@/lib/server/public-read";
import { findRivalry } from "@/lib/rivalry";
import { LANE_LABEL } from "@/lib/profile";
import type { Group } from "@/lib/types";

// 라이벌 링크를 카톡 등에 공유했을 때의 제목·설명
export async function generateMetadata({ params }: { params: Promise<{ a: string; b: string }> }): Promise<Metadata> {
  const { a, b } = await params;
  const [x, y] = [decodeURIComponent(a), decodeURIComponent(b)];
  const matches = await readCountedMatches();
  const r = matches ? findRivalry({ id: "main", name: "main", members: [], matches } as unknown as Group, x, y) : null;
  if (!r) return { title: `${x} vs ${y} · 컴학내전` };
  const title = `${r.a.nickname} ⚔ ${r.b.nickname} 라이벌전`;
  const headline = r.titles.find((t) => t.kind !== "revenge");
  const description = `${LANE_LABEL[r.mainLane]} 맞대결 ${r.games.length}판 ${r.a.wins} : ${r.b.wins}${headline ? ` · ${headline.text}` : ""}`;
  return { title: `${title} · 컴학내전`, description, openGraph: { title, description } };
}

export default function RivalryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
