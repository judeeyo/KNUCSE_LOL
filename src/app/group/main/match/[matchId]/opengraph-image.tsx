import { ImageResponse } from "next/og";
import { readMatch, koreanDate } from "@/lib/server/public-read";
import { C, championIconData, Icon, OG_SIZE, ogFont } from "@/lib/server/og";
import type { PlayerStat } from "@/lib/types";

// 경기 링크를 카톡 등에 공유했을 때 보이는 카드 이미지: 날짜·시간, 스코어, 양 팀 챔피언·닉네임·KDA, MVP/ACE
export const alt = "컴학내전 경기 결과";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 600; // 경기를 고치면 10분 안에 반영

export default async function Image({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const [match, font] = await Promise.all([readMatch(matchId), ogFont()]);
  const fonts = [{ name: "Pretendard", data: font, weight: 700 as const, style: "normal" as const }];

  if (!match) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", background: C.bg, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontFamily: "Pretendard" }}>
          컴학내전
        </div>
      ),
      { ...size, fonts }
    );
  }

  const blue = match.players.filter((p) => p.team === "blue");
  const red = match.players.filter((p) => p.team === "red");
  const blueWin = blue[0]?.win ?? false;
  const icons = new Map(await Promise.all(match.players.map(async (p) => [p.champion, await championIconData(p.champion)] as const)));
  const mvp = match.players.find((p) => p.isMvp);
  const ace = match.players.find((p) => p.isAce);
  const kills = (t: PlayerStat[]) => t.reduce((s, p) => s + p.kills, 0);
  const excluded = match.excludedReason;

  const Team = ({ team, color, win, align }: { team: PlayerStat[]; color: string; win: boolean; align: "left" | "right" }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 410 }}>
      {team.map((p) => (
        <div
          key={p.id}
          style={{ display: "flex", alignItems: "center", gap: 14, flexDirection: align === "left" ? "row" : "row-reverse" }}
        >
          <Icon name={p.champion} data={icons.get(p.champion) ?? null} size={52} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: align === "left" ? "flex-start" : "flex-end", width: 340 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 28, color: p.isMvp ? C.mvp : p.isAce ? C.ace : C.ink }}>
              {p.nickname.length > 12 ? p.nickname.slice(0, 11) + "…" : p.nickname}
            </div>
            <div style={{ display: "flex", fontSize: 20, color: C.muted }}>
              {p.champion} · {p.kills}/{p.deaths}/{p.assists}
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: align === "left" ? "flex-start" : "flex-end", fontSize: 22, color: win ? C.win : C.lose }}>
        {win ? "승리" : "패배"} <span style={{ color, marginLeft: 8 }}>{align === "left" ? "블루팀" : "레드팀"}</span>
      </div>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", background: C.bg, color: C.ink, fontFamily: "Pretendard",
          display: "flex", flexDirection: "column", padding: "36px 48px", position: "relative",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 26, color: C.muted }}>
          <span style={{ color: C.primary }}>컴학내전</span>
          <span>{koreanDate(match.createdAt)}{match.gameDuration ? ` · ${match.gameDuration}` : ""}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexGrow: 1 }}>
          <Team team={blue} color={C.blue} win={blueWin} align="left" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 80 }}>
              <span style={{ color: blueWin ? C.blue : C.subtle }}>{kills(blue)}</span>
              <span style={{ fontSize: 40, color: C.subtle }}>:</span>
              <span style={{ color: blueWin ? C.subtle : C.red }}>{kills(red)}</span>
            </div>
          </div>
          <Team team={red} color={C.red} win={!blueWin} align="right" />
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 28, fontSize: 28 }}>
          {mvp && <span style={{ color: C.mvp }}>MVP {mvp.nickname} {mvp.mvpScore.toFixed(1)}</span>}
          {ace && <span style={{ color: C.ace }}>ACE {ace.nickname} {ace.mvpScore.toFixed(1)}</span>}
        </div>

        {excluded && (
          <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)" }}>
            <span style={{ fontSize: 110, color: "#ffffff", transform: "rotate(-6deg)" }}>{excluded}</span>
          </div>
        )}
      </div>
    ),
    { ...size, fonts }
  );
}
