// 선수 개인 페이지(op.gg 전적 페이지 같은 화면)에 쓰는 집계. 순수 함수 — 화면·테스트 공용.
import type { Group, Lane, Match, PlayerStat } from "./types";

export interface ProfileGame {
  match: Match;
  me: PlayerStat;
  teammates: PlayerStat[];
  opponents: PlayerStat[];
  laneOpponent?: PlayerStat; // 같은 라인 상대
  damageShare: number | null; // 팀 내 딜 비중 % (딜량 미수집이면 null)
}

export interface TrendPoint {
  index: number; // 1부터
  date: string;
  win: boolean;
  winRate: number; // 그때까지의 누적 승률 %
}

export interface RelationRecord {
  nickname: string;
  games: number;
  wins: number; // "내가" 이긴 판수
  winRate: number;
}

export interface PlayerProfile {
  nickname: string;
  games: ProfileGame[]; // 최신 경기부터
  trend: TrendPoint[]; // 오래된 경기부터 누적 승률
  teammates: RelationRecord[]; // 같은 팀으로 함께한 사람 (판수 많은 순)
  opponents: RelationRecord[]; // 상대 팀으로 만난 사람
  laneOpponents: RelationRecord[]; // 같은 라인 맞상대
}

const byDate = (a: Match, b: Match) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

function tally(map: Map<string, { games: number; wins: number }>, nickname: string, win: boolean) {
  const r = map.get(nickname) || { games: 0, wins: 0 };
  r.games++;
  if (win) r.wins++;
  map.set(nickname, r);
}

function toRecords(map: Map<string, { games: number; wins: number }>): RelationRecord[] {
  return [...map.entries()]
    .map(([nickname, r]) => ({ nickname, games: r.games, wins: r.wins, winRate: (r.wins / r.games) * 100 }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.nickname.localeCompare(b.nickname, "ko"));
}

/** 통계에 반영되는 경기(group.matches)만으로 한 선수의 프로필을 만든다. 경기가 없으면 null */
export function buildPlayerProfile(group: Group, nickname: string): PlayerProfile | null {
  const ordered = [...group.matches].sort(byDate);
  const games: ProfileGame[] = [];
  const mates = new Map<string, { games: number; wins: number }>();
  const opps = new Map<string, { games: number; wins: number }>();
  const laneOpps = new Map<string, { games: number; wins: number }>();
  const trend: TrendPoint[] = [];
  let wins = 0;

  for (const match of ordered) {
    const me = match.players.find((p) => p.nickname === nickname);
    if (!me) continue;
    const teammates = match.players.filter((p) => p.team === me.team && p !== me);
    const opponents = match.players.filter((p) => p.team !== me.team);
    const laneOpponent = me.lane ? opponents.find((p) => p.lane === me.lane) : undefined;
    const teamDamage = [me, ...teammates].reduce((s, p) => s + (p.damageDealt || 0), 0);
    const damageShare = me.noDamage || teamDamage <= 0 ? null : ((me.damageDealt || 0) / teamDamage) * 100;

    games.push({ match, me, teammates, opponents, laneOpponent, damageShare });
    for (const t of teammates) tally(mates, t.nickname, me.win);
    for (const o of opponents) tally(opps, o.nickname, me.win);
    if (laneOpponent) tally(laneOpps, laneOpponent.nickname, me.win);

    if (me.win) wins++;
    trend.push({ index: trend.length + 1, date: match.createdAt, win: me.win, winRate: (wins / (trend.length + 1)) * 100 });
  }

  if (games.length === 0) return null;
  return {
    nickname,
    games: games.reverse(),
    trend,
    teammates: toRecords(mates),
    opponents: toRecords(opps),
    laneOpponents: toRecords(laneOpps),
  };
}

/** 표본이 너무 적은 관계는 빼고 승률 순으로 위·아래 n개 (같이 하면 잘 이기는 / 잘 지는) */
export function bestAndWorst(records: RelationRecord[], minGames: number, n = 3) {
  const pool = records.filter((r) => r.games >= minGames);
  const best = [...pool].sort((a, b) => b.winRate - a.winRate || b.games - a.games).slice(0, n);
  const worst = [...pool]
    .sort((a, b) => a.winRate - b.winRate || b.games - a.games)
    .filter((r) => !best.includes(r))
    .slice(0, n);
  return { best, worst };
}

/** 부캐 닉네임으로 들어와도 본캐 페이지를 보여 주기 위한 이름 해석 */
export function resolveNickname(group: Group, name: string): string {
  if (group.matches.some((m) => m.players.some((p) => p.nickname === name))) return name;
  const owner = group.members.find((m) => (m.aliases || []).includes(name));
  return owner ? owner.nickname : name;
}

export const LANE_LABEL: Record<Lane, string> = { top: "탑", jungle: "정글", mid: "미드", adc: "원딜", support: "서폿" };

/** 선수 페이지 주소 */
export function playerHref(nickname: string): string {
  return `/group/main/player/${encodeURIComponent(nickname)}`;
}
