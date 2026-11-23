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
  avg: { kills: number; deaths: number; assists: number; csPerMin: number | null; goldPerMin: number | null };
  usualDeaths: number; // 평소(모든 경기) 평균 데스
  tips: string[]; // 이 선수가 상대를 만날 때 참고할 점 (기록 기반, 최대 3개)
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
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}${withFinal}(${withoutFinal})`;
  const final = code % 28;
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

function perMin(games: RivalGame[], side: "a" | "b", field: "cs" | "gold"): number | null {
  const timed = games.filter((g) => g.minutes > 0);
  if (!timed.length) return null;
  return avg(timed.map((g) => g[side][field] / g.minutes));
}

/** 기록에서 뽑은 참고 문장. 기준을 넘는 것만, 영향 큰 순서로 최대 3개 */
function buildTips(games: RivalGame[], me: "a" | "b", usualDeaths: number): string[] {
  const opp = me === "a" ? "b" : "a";
  const oppName = games[0][opp].nickname;
  const tips: { weight: number; text: string }[] = [];
  if (games.length < RIVALRY_MIN_GAMES) return [];

  // 1. 데스 (평소 대비)
  const deaths = avg(games.map((g) => g[me].deaths));
  const dd = deaths - usualDeaths;
  if (dd >= 1) tips.push({ weight: dd, text: `${josa(oppName, "을", "를")} 만나면 데스가 평소보다 ${dd.toFixed(1)} 많음 (평균 ${deaths.toFixed(1)}) → 무리한 교전 주의` });
  else if (dd <= -1) tips.push({ weight: -dd * 0.6, text: `${oppName} 상대로는 데스가 평소보다 ${(-dd).toFixed(1)} 적음 → 지금처럼 안정적으로` });

  // 2. 분당 CS·골드 (맞상대와 직접 비교)
  const timed = games.filter((g) => g.minutes > 0);
  if (timed.length >= RIVALRY_MIN_GAMES) {
    const csDiff = avg(timed.map((g) => (g[me].cs - g[opp].cs) / g.minutes));
    const goldDiff = avg(timed.map((g) => (g[me].gold - g[opp].gold) / g.minutes));
    if (csDiff <= -0.7) tips.push({ weight: -csDiff, text: `분당 CS ${(-csDiff).toFixed(1)}개 밀림 → 라인 손해 줄이고 합류 위주로` });
    else if (csDiff >= 0.7) tips.push({ weight: csDiff * 0.8, text: `분당 CS ${csDiff.toFixed(1)}개 앞섬 → 라인 우위를 살릴 것` });
    else if (Math.abs(goldDiff) >= 40) {
      tips.push({ weight: Math.abs(goldDiff) / 60, text: goldDiff < 0
        ? `분당 골드 ${Math.round(-goldDiff)} 뒤짐 → 킬 내주지 않기`
        : `분당 골드 ${Math.round(goldDiff)} 앞섬` });
    }
  }

  // 3. 상대 챔피언 중 유독 약한 것 / 내 챔피언 중 잘 통한 것
  const oppChamps = champUses(games, opp);
  const bad = oppChamps.find((c) => c.games >= 2 && c.wins === c.games); // 상대가 그 챔피언으로 전승 = 내가 전패
  if (bad) tips.push({ weight: 1.2 + bad.games * 0.2, text: `${josa(oppName, "이", "가")} ${josa(bad.champion, "을", "를")} 잡으면 ${bad.games}전 전패 → ${bad.games >= 3 ? "밴 고려" : "조심"}` });
  const good = champUses(games, me).find((c) => c.games >= 2 && c.wins === c.games);
  if (good) tips.push({ weight: 1 + good.games * 0.2, text: `${josa(good.champion, "으로", "로")}는 ${good.games}전 전승` });

  // 4. 퍼스트 블러드 (기록된 경기만)
  const fbGames = games.filter((g) => g[me].firstBlood !== undefined && g.detailed);
  if (fbGames.length >= RIVALRY_MIN_GAMES) {
    const oppFb = fbGames.filter((g) => g[opp].firstBlood).length;
    if (oppFb >= 2 && oppFb / fbGames.length >= 0.4) tips.push({ weight: 0.9, text: `${josa(oppName, "이", "가")} 퍼스트 블러드 ${fbGames.length}판 중 ${oppFb}번 → 초반 정글 동선 조심` });
  }

  return tips.sort((p, q) => q.weight - p.weight).slice(0, 3).map((t) => t.text);
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

function buildTitles(r: Omit<Rivalry, "titles" | "memorable" | "rank">): RivalryTitle[] {
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
export function buildRivalries(group: Group, now: number = Date.now(), minGames = RIVALRY_MIN_GAMES): Rivalry[] {
  const usual = new Map<string, number[]>();
  for (const m of group.matches) for (const p of m.players) {
    const l = usual.get(p.nickname) || [];
    l.push(p.deaths);
    usual.set(p.nickname, l);
  }
  const out: Rivalry[] = [];
  for (const [key, games] of collect(group.matches)) {
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
      const usualDeaths = avg(usual.get(nickname) || []);
      return {
        nickname,
        wins: s === "a" ? aWins : n - aWins,
        mainChampion: champs[0]?.champion ?? null,
        champs,
        avg: {
          kills: round1(avg(games.map((g) => g[s].kills))),
          deaths: round1(avg(games.map((g) => g[s].deaths))),
          assists: round1(avg(games.map((g) => g[s].assists))),
          csPerMin: perMin(games, s, "cs"),
          goldPerMin: perMin(games, s, "gold"),
        },
        usualDeaths,
        tips: buildTips(games, s, usualDeaths),
      };
    };

    const base = {
      key,
      a: side("a"),
      b: side("b"),
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
    out.push({ ...base, titles: buildTitles(base), memorable: pickMemorable(games), rank });
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
  const all = buildRivalries(group, now, 1);
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
