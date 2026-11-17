import { ImageResponse } from "next/og";
import { C, OG_SIZE, ogFont } from "@/lib/server/og";

// 사이트 기본 공유 카드 (경기·선수 페이지는 각자의 카드가 우선)
export const alt = "컴학내전 — 경북대 컴퓨터학부 롤 내전 기록";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const font = await ogFont();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: C.bg, fontFamily: "Pretendard", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 120, color: C.ink }}>컴학내전</div>
        <div style={{ display: "flex", fontSize: 40, color: C.muted }}>경북대 컴퓨터학부 롤 내전 기록 · 통계 · 팀 짜기</div>
      </div>
    ),
    { ...size, fonts: [{ name: "Pretendard", data: font, weight: 700, style: "normal" }] }
  );
}
