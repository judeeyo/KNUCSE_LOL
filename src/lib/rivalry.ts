// 라이벌(같은 라인 맞대결) 집계. 순수 함수 — 화면·카톡 카드·테스트 공용.
//
// 원칙 (사용자 요청 2026-11-23)
// - 라이벌은 "같은 라인에서 맞붙은" 경우만 센다. 상대 팀이었어도 라인이 다르면 넣지 않는다.
// - 승패는 10명이 함께 낸 결과이므로 "A 팀이 이김"의 의미로만 쓴다. 사람을 평가하는 말은 쓰지 않는다.
// - 칭호·팁은 기준을 넘을 때만, 근거 숫자와 함께 보여 준다.
// - 수기 기록(legacy-import)은 딜량·킬관여가 없으므로 그런 지표에서는 빼고 "상세 지표 n경기 기준"으로 표시한다.
import type { Group, Lane, Match, PlayerStat } from "./types";
import { LANE_LABEL } from "./profile";

/** 라이벌 목록에 올리는 최소 맞대결 수 */
export const RIVALRY_MIN_GAMES = 3;
/** 이 이상이면 "신뢰" */
const TRUSTED_GAMES = 10;
/** 최근 흐름에 보여 주는 맞대결 수 */
export const MOMENTUM_GAMES = 10;
/** 최근성 반감기 (정렬용) */
const HALF_LIFE_DAYS = 60;
const DAY = 86_400_000;

/**
 * 특집 라이벌 묶음. 사용자가 "제일 재밌다"고 고른 세 명(모두 탑).
 * 이름이 바뀌면(아이디 통합) 여기도 본캐 이름으로 바꿀 것. 없는 이름은 화면에서 자동으로 빠진다.
 */
export const FEATURED_GROUPS: { title: string; subtitle: string; lane: Lane; players: string[] }[] = [
  { title: "탑 삼국지", subtitle: "탑 라인을 두고 벌이는 세 사람의 싸움", lane: "top", players: ["뽀스탈게요", "DoYouKnowIMO", "우효원"] },
];

export interface RivalGame {
  match: Match;
  lane: Lane;
  a: PlayerStat; // 라이벌의 a 쪽 선수 기록
  b: PlayerStat;
  aWin: boolean;
  minutes: number; // 0 = 시간 미상
  detailed: boolean; // 딜량·킬관여가 있는 경기 (수기 기록 제외)
}

export interface ChampUse {
  champion: string;
  games: number;
  wins: number; // 그 선수가 이긴 판
}

export interface SideSummary {
  nickname: string;
  wins: number;
  mainChampion: string | null; // 이 맞대결에서 가장 많이 쓴 챔피언 (헤더 그림용)
  champs: ChampUse[]; // 이 맞대결에서 쓴 챔피언 (판수 순)
  avg: { kills: number; deaths: number; assists: number };
  metrics: Record<MetricKey, MetricValue>; // 맞대결 평균과 평소 평균
  tips: Tip[]; // 이 선수가 상대를 만날 때 참고할 점 (기록 기반, 최대 5개)
}

/** 지표별 비교에 쓰는 항목 */
export type MetricKey = "kda" | "deaths" | "csPerMin" | "goldPerMin" | "kp" | "damageShare" | "visionPerMin";
export interface MetricValue {
  value: number | null; // 맞대결 평균 (자료가 없으면 null)
  usual: number | null; // 평소 평균: 같은 라인 경기(3판 이상이면), 아니면 모든 경기
  n: number; // 맞대결 중 이 지표가 있는 판수
}
export const METRICS: { key: MetricKey; label: string; higherBetter: boolean; even: number; digits: number; unit?: string }[] = [
  { key: "kda", label: "KDA", higherBetter: true, even: 0.3, digits: 2 },
  { key: "deaths", label: "데스", higherBetter: false, even: 0.4, digits: 1 },
  { key: "csPerMin", label: "분당 CS", higherBetter: true, even: 0.3, digits: 1 },
  { key: "goldPerMin", label: "분당 골드", higherBetter: true, even: 15, digits: 0 },
  { key: "kp", label: "킬관여", higherBetter: true, even: 3, digits: 0, unit: "%" },
  { key: "damageShare", label: "팀 내 딜 비중", higherBetter: true, even: 2, digits: 0, unit: "%" },
  { key: "visionPerMin", label: "분당 시야", higherBetter: true, even: 0.1, digits: 2 },
];

export type TipKind = "matchup" | "oppChamp" | "myChamp" | "pick" | "early";
export const TIP_LABEL: Record<TipKind, string> = {
  matchup: "맞대결", oppChamp: "상대 챔피언", myChamp: "내 챔피언", pick: "픽", early: "초반",
};
export interface Tip { kind: TipKind; text: string }

/** 지표별 우세/열세 */
export interface MetricCompare {
  key: MetricKey;
  label: string;
  a: MetricValue;
  b: MetricValue;
  better: "a" | "b" | null; // null = 비슷하거나 자료 없음
  diff: number | null; // 좋은 쪽 기준 차이 (절댓값)
}

export type RivalryTitle =
  | { kind: "destined"; text: string } // 숙명의 라이벌
  | { kind: "nemesis"; text: string; side: "a" | "b" } // 천적 (side 가 우세한 쪽)
  | { kind: "streak"; text: string; side: "a" | "b" }
  | { kind: "revenge"; text: string; side: "a" | "b" }; // 다음 판이 복수전인 쪽

export interface Rivalry {
  key: string; // 주소용 (a|b)
  a: SideSummary;
  b: SideSummary;
  games: RivalGame[]; // 오래된 경기부터
  lanes: { lane: Lane; games: number; aWins: number }[]; // 라인별 (판수 순)
  mainLane: Lane;
  streak: { side: "a" | "b"; count: number } | null; // 마지막 맞대결부터 이어진 연승
  lastPlayedAt: string;
  confidence: "참고" | "보통" | "신뢰";
  detailedGames: number;
  titles: RivalryTitle[];
  memorable: { game: RivalGame; reason: string }[];
  comparison: MetricCompare[];
  edge: { a: number; b: number }; // 우세 지표 수
  rank: number; // 정렬 점수 (높을수록 위)
}

const minutesOf = (m: Match) => {
  const [mm, ss] = (m.gameDuration || "").split(":").map(Number);
  return mm > 0 ? mm + (ss || 0) / 60 : 0;
};
const byDate = (a: Match, b: Match) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
const pairKey = (x: string, y: string) => [x, y].sort((p, q) => p.localeCompare(q, "ko")).join("|");
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** 받침에 맞춘 조사: josa("우효원", "이", "가") → "우효원이". 한글로 안 끝나면 "이(가)" */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.charAt(word.length - 1);
  const code = last.charCodeAt(0) - 0xac00;
  let final: number;
  if (code >= 0 && code <= 11171) final = code % 28;
  else if (/[A-Za-z0-9]/.test(last)) {
    // 영문·숫자는 읽는 소리로: L(엘)·R(알)은 ㄹ, M(엠)·N(엔)·0(영)·1(일)·3(삼)·6(육)·7(칠)·8(팔)은 받침 있음
    const u = last.toUpperCase();
    final = "LR178".includes(u) ? 8 : "MN036".includes(u) ? 1 : 0;
  } else return `${word}${withFinal}(${withoutFinal})`;
  // "(으)로"는 ㄹ 받침이면 "로"
  if (withFinal === "으로" && final === 8) return `${word}로`;
  return word + (final ? withFinal : withoutFinal);
}

/** 라이벌 페이지 주소. 두 이름 순서를 정해 주소를 하나로 통일한다 */
export function rivalryHref(x: string, y: string): string {
  const [a, b] = pairKey(x, y).split("|");
  return `/group/main/rivalry/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
}

/** 같은 라인 맞대결을 쌍별로 모은다 */
function collect(matches: Match[]): Map<string, RivalGame[]> {
  const out = new Map<string, RivalGame[]>();
  for (const match of [...matches].sort(byDate)) {
    const blue = match.players.filter((p) => p.team === "blue");
    for (const x of blue) {
      if (!x.lane) continue;
      const y = match.players.find((p) => p.team === "red" && p.lane === x.lane);
      if (!y || x.nickname === y.nickname) continue;
      const key = pairKey(x.nickname, y.nickname);
      const [aName] = key.split("|");
      const a = x.nickname === aName ? x : y;
      const b = a === x ? y : x;
      const list = out.get(key) || [];
      list.push({
        match, lane: x.lane, a, b, aWin: a.win, minutes: minutesOf(match),
        detailed: match.source !== "legacy-import" && !a.noDamage && !b.noDamage,
      });
      out.set(key, list);
    }
  }
  return out;
}

function champUses(games: RivalGame[], side: "a" | "b"): ChampUse[] {
  const map = new Map<string, ChampUse>();
  for (const g of games) {
    const me = g[side];
    const r = map.get(me.champion) || { champion: me.champion, games: 0, wins: 0 };
    r.games++;
    if (me.win) r.wins++;
    map.set(me.champion, r);
  }
  return [...map.values()].sort((p, q) => q.games - p.games || q.wins - p.wins || p.champion.localeCompare(q.champion, "ko"));
}

/** 한 경기 한 선수의 비교 지표 (없는 값은 null) */
function gameMetrics(match: Match, p: PlayerStat): Record<MetricKey, number | null> {
  const minutes = minutesOf(match);
  const team = match.players.filter((x) => x.team === p.team);
  const teamKills = team.reduce((sum, x) => sum + x.kills, 0);
  const detailed = match.source !== "legacy-import";
  const teamDamage = team.reduce((sum, x) => sum + (x.damageDealt || 0), 0);
  return {
    kda: (p.kills + p.assists) / Math.max(1, p.deaths),
    deaths: p.deaths,
    csPerMin: minutes > 0 ? p.cs / minutes : null,
    goldPerMin: minutes > 0 ? p.gold / minutes : null,
    kp: teamKills > 0 ? ((p.kills + p.assists) / teamKills) * 100 : null,
    damageShare: detailed && !p.noDamage && teamDamage > 0 ? ((p.damageDealt || 0) / teamDamage) * 100 : null,
    visionPerMin: detailed && !p.noVision && minutes > 0 ? p.visionScore / minutes : null,
  };
}

type MetricRows = Record<MetricKey, number | null>[];
const KEYS = METRICS.map((m) => m.key);
function meanOf(rows: MetricRows, key: MetricKey): { value: number | null; n: number } {
  const xs = rows.map((r) => r[key]).filter((v): v is number => v !== null);
  return { value: xs.length ? avg(xs) : null, n: xs.length };
}

/** 선수별 평소 지표: 같은 라인 경기가 3판 이상이면 그 라인, 아니면 전체 */
function buildUsual(matches: Match[]) {
  const byLane = new Map<string, MetricRows>();
  const all = new Map<string, MetricRows>();
  for (const m of matches) for (const p of m.players) {
    const row = gameMetrics(m, p);
    (all.get(p.nickname) || all.set(p.nickname, []).get(p.nickname)!).push(row);
    if (p.lane) {
      const k = `${p.nickname}|${p.lane}`;
      (byLane.get(k) || byLane.set(k, []).get(k)!).push(row);
    }
  }
  return (nickname: string, lane: Lane): MetricRows => {
    const laneRows = byLane.get(`${nickname}|${lane}`) || [];
    return laneRows.length >= 3 ? laneRows : all.get(nickname) || [];
  };
}

const fmtSigned = (v: number, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

/**
 * 기록에서 뽑은 참고 문장. 기준을 넘는 것만, 영향이 큰 순으로 최대 5개 (한 종류 최대 2개).
 * - 맞대결: 이 상대를 만날 때 평소와 달라지는 지표
 * - 상대 챔피언: 상대가 그 챔피언일 때 내 지표가 평소와 달라지는 것 (2판 이상)
 * - 내 챔피언: 내가 그 챔피언일 때 평소와 달라지는 것 → 무엇에 집중할지 (2판 이상)
 * - 픽: 상대 챔피언/내 챔피언 전승·전패
 * - 초반: 퍼스트 블러드
 */
function buildTips(games: RivalGame[], me: "a" | "b", usualRows: MetricRows): Tip[] {
  const opp = me === "a" ? "b" : "a";
  const oppName = games[0][opp].nickname;
  const tips: (Tip & { weight: number })[] = [];
  if (games.length < RIVALRY_MIN_GAMES) return [];
  const usual = Object.fromEntries(KEYS.map((k) => [k, meanOf(usualRows, k).value])) as Record<MetricKey, number | null>;
  const rowsOf = (gs: RivalGame[]) => gs.map((g) => gameMetrics(g.match, g[me]));
  const delta = (rows: MetricRows, key: MetricKey) => {
    const m = meanOf(rows, key);
    const u = usual[key];
    return m.value === null || u === null || m.n < 2 ? null : m.value - u;
  };
  const push = (kind: TipKind, weight: number, text: string) => tips.push({ kind, weight, text });

  // 1. 맞대결 전체 vs 평소
  const all = rowsOf(games);
  const dDeaths = delta(all, "deaths");
  if (dDeaths !== null && dDeaths >= 1) push("matchup", dDeaths, `${josa(oppName, "을", "를")} 만나면 데스 평소보다 ${fmtSigned(dDeaths)} → 무리한 교전 주의`);
  else if (dDeaths !== null && dDeaths <= -1) push("matchup", -dDeaths * 0.6, `${oppName} 상대로는 데스 평소보다 ${fmtSigned(dDeaths)} → 지금처럼 안정적으로`);
  const dCs = delta(all, "csPerMin");
  if (dCs !== null && dCs <= -0.6) push("matchup", -dCs * 1.2, `${josa(oppName, "을", "를")} 만나면 분당 CS 평소보다 ${fmtSigned(dCs)} → 라인 손해 줄이고 웨이브 관리`);
  const dKp = delta(all, "kp");
  if (dKp !== null && Math.abs(dKp) >= 8) push("matchup", Math.abs(dKp) / 8, dKp > 0
    ? `${oppName} 상대로는 킬관여 평소보다 ${fmtSigned(dKp, 0)}%p → 합류 위주 운영이 잘 통함`
    : `${oppName} 상대로는 킬관여 평소보다 ${fmtSigned(dKp, 0)}%p → 라인에 묶이지 말고 합류 타이밍 챙기기`);
  const dDmg = delta(all, "damageShare");
  if (dDmg !== null && dDmg <= -4) push("matchup", -dDmg / 4, `${oppName} 상대로는 팀 내 딜 비중 평소보다 ${fmtSigned(dDmg, 0)}%p → 한타에서 딜 넣을 자리 찾기`);

  // 2. 상대 챔피언별 (그 챔피언을 상대로 2판 이상)
  for (const c of champUses(games, opp).filter((x) => x.games >= 2)) {
    const rows = rowsOf(games.filter((g) => g[opp].champion === c.champion));
    const vs = `상대가 ${c.champion}일 때`;
    const cs = delta(rows, "csPerMin");
    const de = delta(rows, "deaths");
    // 같은 챔피언 문장은 하나로 합친다 (예: "데스 +2.1 · 분당 CS -1.2")
    const csLow = cs !== null && cs <= -0.7, deathHigh = de !== null && de >= 1.5;
    if (csLow || deathHigh) {
      const parts = [deathHigh && `데스 ${fmtSigned(de!)}`, csLow && `분당 CS ${fmtSigned(cs!)}`].filter(Boolean).join(" · ");
      const advice = deathHigh ? "초반 교전 피하고 사거리·쿨타임 확인" : "무리한 파밍 경쟁보다 웨이브 관리";
      push("oppChamp", (deathHigh ? de! * 0.9 : 0) + (csLow ? -cs! * 1.3 : 0), `${vs} 평소보다 ${parts} (${c.games}판) → ${advice}`);
    } else if (cs !== null && cs >= 0.7 && (de === null || de < 1)) push("oppChamp", cs * 0.8, `${vs}는 분당 CS 평소보다 ${fmtSigned(cs)} (${c.games}판) → 라인 우위 살리기 좋음`);
  }

  // 3. 내 챔피언별 (이 맞대결에서 2판 이상)
  for (const c of champUses(games, me).filter((x) => x.games >= 2)) {
    const rows = rowsOf(games.filter((g) => g[me].champion === c.champion));
    const with_ = `${josa(c.champion, "으로", "로")} 할 때`;
    const de = delta(rows, "deaths");
    const cs = delta(rows, "csPerMin");
    const kda = delta(rows, "kda");
    const kp = delta(rows, "kp");
    if (de !== null && de >= 1.5) push("myChamp", de * 0.9, `${with_} 데스 평소보다 ${fmtSigned(de)} (${c.games}판) → 무리한 진입 자제, 합류 타이밍에 집중`);
    if (cs !== null && cs <= -0.7) push("myChamp", -cs, `${with_} 분당 CS 평소보다 ${fmtSigned(cs)} (${c.games}판) → 라인전 파밍에 더 신경`);
    if (kp !== null && kp >= 10) push("myChamp", kp / 10, `${with_} 킬관여 평소보다 ${fmtSigned(kp, 0)}%p → 텔·합류로 팀을 돕는 플레이가 맞음`);
    if (kda !== null && kda >= 1) push("myChamp", kda * 0.7, `${with_} KDA 평소보다 ${fmtSigned(kda)} (${c.games}판 ${c.wins}승) → ${c.wins * 2 > c.games ? "믿을 만한 픽" : "성적은 좋지만 승리로 잘 안 이어짐"}`);
  }

  // 4. 픽 (전승·전패)
  const bad = champUses(games, opp).find((c) => c.games >= 2 && c.wins === c.games);
  if (bad) push("pick", 0.9 + bad.games * 0.2, `${josa(oppName, "이", "가")} ${josa(bad.champion, "을", "를")} 잡으면 ${bad.games}전 전패 → ${bad.games >= 3 ? "밴 고려" : "조심"}`);
  const good = champUses(games, me).find((c) => c.games >= 2 && c.wins === c.games);
  if (good && !tips.some((t) => t.kind === "myChamp" && t.text.startsWith(`${josa(good.champion, "으로", "로")} 할 때 KDA`))) push("pick", 0.8 + good.games * 0.2, `${josa(good.champion, "으로", "로")}는 ${good.games}전 전승`);

  // 5. 초반 (퍼스트 블러드, 수기 기록 제외)
  const fbGames = games.filter((g) => g.detailed && g[me].firstBlood !== undefined);
  if (fbGames.length >= RIVALRY_MIN_GAMES) {
    const oppFb = fbGames.filter((g) => g[opp].firstBlood).length;
    const myFb = fbGames.filter((g) => g[me].firstBlood).length;
    if (oppFb >= 2 && oppFb / fbGames.length >= 0.4) push("early", 0.9, `${josa(oppName, "이", "가")} 퍼스트 블러드 ${fbGames.length}판 중 ${oppFb}번 → 초반 정글 동선 조심`);
    else if (myFb >= 2 && myFb / fbGames.length >= 0.4) push("early", 0.7, `퍼스트 블러드 ${fbGames.length}판 중 ${myFb}번 → 초반 주도권을 잘 잡음`);
  }

  // 영향 큰 순, 한 종류 최대 2개, 전체 5개
  const out: Tip[] = [];
  const perKind = new Map<TipKind, number>();
  for (const t of tips.sort((p, q) => q.weight - p.weight)) {
    if ((perKind.get(t.kind) || 0) >= 2) continue;
    perKind.set(t.kind, (perKind.get(t.kind) || 0) + 1);
    out.push({ kind: t.kind, text: t.text });
    if (out.length === 5) break;
  }
  return out;
}

function compareMetrics(a: SideSummary, b: SideSummary): MetricCompare[] {
  return METRICS.map((m) => {
    const va = a.metrics[m.key], vb = b.metrics[m.key];
    let better: "a" | "b" | null = null;
    let diff: number | null = null;
    if (va.value !== null && vb.value !== null && Math.min(va.n, vb.n) >= 2) {
      const d = va.value - vb.value;
      diff = Math.abs(d);
      if (diff >= m.even) better = (d > 0) === m.higherBetter ? "a" : "b";
    }
    return { key: m.key, label: m.label, a: va, b: vb, better, diff };
  });
}

function pickMemorable(games: RivalGame[]): { game: RivalGame; reason: string }[] {
  const out: { game: RivalGame; reason: string }[] = [];
  const add = (g: RivalGame | undefined, reason: string) => {
    if (g && !out.some((o) => o.game === g)) out.push({ game: g, reason });
  };
  const killGap = (g: RivalGame) => Math.abs(g.a.kills - g.b.kills);
  add([...games].sort((p, q) => killGap(q) - killGap(p))[0], "킬 차이가 가장 컸던 판");
  const timed = games.filter((g) => g.minutes > 0);
  add([...timed].sort((p, q) => q.minutes - p.minutes)[0], "가장 길었던 판");
  add([...timed].sort((p, q) => p.minutes - q.minutes)[0], "가장 빨리 끝난 판");
  add(games[0], "첫 맞대결");
  return out.slice(0, 4).sort((p, q) => byDate(q.game.match, p.game.match));
}

function buildTitles(r: Omit<Rivalry, "titles" | "memorable" | "rank" | "comparison" | "edge">): RivalryTitle[] {
  const n = r.games.length;
  const titles: RivalryTitle[] = [];
  const aRate = r.a.wins / n;
  if (n >= 8 && aRate >= 0.4 && aRate <= 0.6) titles.push({ kind: "destined", text: `숙명의 라이벌 (${n}판 ${r.a.wins}:${r.b.wins})` });
  if (n >= 6 && (aRate >= 0.7 || aRate <= 0.3)) {
    const side = aRate >= 0.7 ? "a" : "b";
    const w = side === "a" ? r.a : r.b;
    titles.push({ kind: "nemesis", side, text: `${w.nickname} 우세 (${n}판 ${w.wins}승)` });
  }
  if (r.streak && r.streak.count >= 3) {
    const w = r.streak.side === "a" ? r.a : r.b;
    titles.push({ kind: "streak", side: r.streak.side, text: `${w.nickname} ${r.streak.count}연승 중` });
  }
  const last = r.games[n - 1];
  const loser = last.aWin ? "b" : "a";
  titles.push({ kind: "revenge", side: loser, text: `다음 판은 ${(loser === "a" ? r.a : r.b).nickname}의 복수전` });
  return titles;
}

/** 쌍별로 집계한 라이벌 목록 (맞대결 RIVALRY_MIN_GAMES 판 이상, 정렬 점수 순) */
export function buildRivalries(group: Group, now: number = Date.now(), minGames = RIVALRY_MIN_GAMES, onlyLane?: Lane): Rivalry[] {
  const usualOf = buildUsual(group.matches);
  const out: Rivalry[] = [];
  for (const [key, allGames] of collect(group.matches)) {
    const games = onlyLane ? allGames.filter((g) => g.lane === onlyLane) : allGames;
    if (games.length < minGames) continue;
    const n = games.length;
    const aWins = games.filter((g) => g.aWin).length;

    const laneMap = new Map<Lane, { games: number; aWins: number }>();
    for (const g of games) {
      const l = laneMap.get(g.lane) || { games: 0, aWins: 0 };
      l.games++;
      if (g.aWin) l.aWins++;
      laneMap.set(g.lane, l);
    }
    const lanes = [...laneMap.entries()].map(([lane, v]) => ({ lane, ...v })).sort((p, q) => q.games - p.games);

    let streak: Rivalry["streak"] = null;
    for (let i = n - 1; i >= 0; i--) {
      const side = games[i].aWin ? "a" : "b";
      if (!streak) streak = { side, count: 1 };
      else if (streak.side === side) streak.count++;
      else break;
    }

    const side = (s: "a" | "b"): SideSummary => {
      const nickname = games[0][s].nickname;
      const champs = champUses(games, s);
      const usualRows = usualOf(nickname, lanes[0].lane);
      const laneGames = games.filter((g) => g.lane === lanes[0].lane);
      const mine = laneGames.map((g) => gameMetrics(g.match, g[s]));
      const metrics = Object.fromEntries(KEYS.map((k) => {
        const m = meanOf(mine, k);
        return [k, { value: m.value, n: m.n, usual: meanOf(usualRows, k).value }];
      })) as Record<MetricKey, MetricValue>;
      return {
        nickname,
        wins: s === "a" ? aWins : n - aWins,
        mainChampion: champs[0]?.champion ?? null,
        champs,
        avg: {
          kills: round1(avg(games.map((g) => g[s].kills))),
          deaths: round1(avg(games.map((g) => g[s].deaths))),
          assists: round1(avg(games.map((g) => g[s].assists))),
        },
        metrics,
        tips: buildTips(laneGames, s, usualRows),
      };
    };

    const sideA = side("a");
    const sideB = side("b");
    const comparison = compareMetrics(sideA, sideB);
    const base = {
      key,
      a: sideA,
      b: sideB,
      games,
      lanes,
      mainLane: lanes[0].lane,
      streak,
      lastPlayedAt: games[n - 1].match.createdAt,
      confidence: (n >= TRUSTED_GAMES ? "신뢰" : n >= 5 ? "보통" : "참고") as Rivalry["confidence"],
      detailedGames: games.filter((g) => g.detailed).length,
    };
    // 정렬: 최근일수록 무겁게 센 판수 × 접전도 (판수가 적으면 50% 쪽으로 당김)
    const recency = games.reduce((s, g) => s + Math.pow(0.5, Math.max(0, now - Date.parse(g.match.createdAt)) / DAY / HALF_LIFE_DAYS), 0);
    const p = (aWins + 2) / (n + 4);
    const closeness = 1 - Math.abs(p - 0.5) * 2;
    const rank = (recency + n * 0.15) * (0.5 + closeness);
    const edge = { a: comparison.filter((c) => c.better === "a").length, b: comparison.filter((c) => c.better === "b").length };
    out.push({ ...base, titles: buildTitles(base), memorable: pickMemorable(games), comparison, edge, rank });
  }
  return out.sort((p, q) => q.rank - p.rank || q.games.length - p.games.length);
}

/** 두 사람의 라이벌 기록 (맞대결이 한 번도 없으면 null). 순서는 주소와 상관없이 a/b 로 정렬된다 */
export function findRivalry(group: Group, x: string, y: string, now: number = Date.now()): Rivalry | null {
  const key = pairKey(x, y);
  return buildRivalries(group, now, 1).find((r) => r.key === key) ?? null;
}

/** 특집 묶음(예: 탑 삼국지)의 쌍별 기록과 사람별 합계 */
export function buildFeatured(group: Group, featured: (typeof FEATURED_GROUPS)[number], now: number = Date.now()) {
  const all = buildRivalries(group, now, 1, featured.lane);
  const present = featured.players.filter((n) => group.matches.some((m) => m.players.some((p) => p.nickname === n)));
  const pairs: Rivalry[] = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const r = all.find((x) => x.key === pairKey(present[i], present[j]));
      if (r) pairs.push(r);
    }
  }
  const standings = present.map((nickname) => {
    let wins = 0, games = 0;
    for (const r of pairs) {
      const me = r.a.nickname === nickname ? r.a : r.b.nickname === nickname ? r.b : null;
      if (!me) continue;
      wins += me.wins;
      games += r.games.length;
    }
    const champ = pairs.flatMap((r) => (r.a.nickname === nickname ? r.a.champs : r.b.nickname === nickname ? r.b.champs : []))
      .reduce((m, c) => m.set(c.champion, (m.get(c.champion) || 0) + c.games), new Map<string, number>());
    const mainChampion = [...champ.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
    return { nickname, wins, games, winRate: games ? (wins / games) * 100 : 0, mainChampion };
  }).sort((p, q) => q.winRate - p.winRate || q.games - p.games);
  return { ...featured, pairs, standings };
}

export const laneLabel = (lane: Lane) => LANE_LABEL[lane];
