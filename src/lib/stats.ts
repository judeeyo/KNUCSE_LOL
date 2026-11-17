import type { Group, Match, PlayerStat, Lane } from "./types";

// createdAt(ISO 문자열) 오름차순 비교 — 시간순에 의존하는 로직의 안정성 확보용
function byCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

// ─── Player Stats ───

/**
 * 리더보드에 올리는 최소 경기 수. 전체 경기 수의 20% (최소 1판, 최대 21판).
 * 기록이 쌓이면 원래 기준(21판)까지 올라가고, 경기가 적을 때는 몇 명만 남지 않도록 낮아진다.
 *   28경기 → 6판, 50경기 → 10판, 105경기 이상 → 21판
 */
export function leaderboardMinGames(totalMatches: number): number {
  return Math.max(1, Math.min(21, Math.ceil(totalMatches * 0.2)));
}

export interface PlayerStats {
  nickname: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKda: number;
  avgCs: number;
  avgGold: number;
  avgDamage: number;
  avgDamageTaken: number;
  avgVision: number;
  /** 딜량이 수집된 경기 수 (0이면 avgDamage·damagePerGold 는 "미수집") */
  damageGames: number;
  /** 시야점수가 수집된 경기 수 (0이면 avgVision 은 "미수집") */
  visionGames: number;
  csPerMin: number;
  avgKillParticipation: number; // 0~100
  goldPerMin: number;
  damagePerGold: number; // 골드당 챔피언 딜량 (총딜 ÷ 총골드)
  avgTurretDamage: number;
  avgCcScore: number;
  firstBloodCount: number;
  bestMultiKill: number;
  mvpCount: number;
  aceCount: number;
  totalScore: number;
  champions: ChampionUsage[];
  laneStats: LaneUsage[];
  recentMatches: { win: boolean; date: string }[];
  momentum: number | null; // 최근 5경기 승률 − 그 이전 승률 (10경기 미만이면 null)
}

export interface LaneUsage {
  lane: Lane;
  games: number;
  wins: number;
  winRate: number;
  avgKda: number;
}

export interface ChampionUsage {
  champion: string;
  games: number;
  wins: number;
  winRate: number;
  avgKda: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
}

export function buildPlayerStats(group: Group): PlayerStats[] {
  const map = new Map<string, PlayerStat[]>();
  const minutesMap = new Map<string, number>(); // nickname → 총 플레이 시간(분)
  const kpMap = new Map<string, number[]>(); // nickname → 경기별 킬관여율

  // 최근 폼(momentum)·최근 전적이 시간순에 의존하므로 createdAt 기준으로 정렬해서 집계
  const orderedMatches = [...group.matches].sort(byCreatedAt);
  for (const match of orderedMatches) {
    const minutes = parseDurationMinutes(match.gameDuration);
    const teamKills = { blue: 0, red: 0 };
    for (const p of match.players) teamKills[p.team] += p.kills;

    for (const p of match.players) {
      const arr = map.get(p.nickname) || [];
      arr.push(p);
      map.set(p.nickname, arr);
      minutesMap.set(p.nickname, (minutesMap.get(p.nickname) || 0) + minutes);

      const tk = teamKills[p.team];
      const kps = kpMap.get(p.nickname) || [];
      kps.push(tk > 0 ? ((p.kills + p.assists) / tk) * 100 : 0);
      kpMap.set(p.nickname, kps);
    }
  }

  const results = Array.from(map.entries())
    .map(([nickname, stats]) => {
      const wins = stats.filter((s) => s.win).length;
      const losses = stats.length - wins;

      // 최근 폼 추세: 최근 5경기 승률 − 그 이전 경기 승률
      // (표본 10경기 이상일 때만 산정 → 비교군(prior)도 최소 5경기 확보해 노이즈 완화)
      let momentum: number | null = null;
      if (stats.length >= 10) {
        const recent = stats.slice(-5);
        const prior = stats.slice(0, -5);
        const recentWR = (recent.filter((s) => s.win).length / recent.length) * 100;
        const priorWR = (prior.filter((s) => s.win).length / prior.length) * 100;
        momentum = recentWR - priorWR;
      }

      const totalKills = stats.reduce((s, p) => s + p.kills, 0);
      const totalDeaths = stats.reduce((s, p) => s + p.deaths, 0);
      const totalAssists = stats.reduce((s, p) => s + p.assists, 0);
      const avgKda =
        totalDeaths === 0
          ? (totalKills + totalAssists) * 1.2
          : (totalKills + totalAssists) / totalDeaths;

      // Champion breakdown
      const champMap = new Map<string, PlayerStat[]>();
      for (const s of stats) {
        if (!s.champion) continue;
        const arr = champMap.get(s.champion) || [];
        arr.push(s);
        champMap.set(s.champion, arr);
      }
      const champions: ChampionUsage[] = Array.from(champMap.entries())
        .map(([champion, cs]) => {
          const cWins = cs.filter((c) => c.win).length;
          const cDeaths = cs.reduce((s, c) => s + c.deaths, 0);
          const cKills = cs.reduce((s, c) => s + c.kills, 0);
          const cAssists = cs.reduce((s, c) => s + c.assists, 0);
          return {
            champion,
            games: cs.length,
            wins: cWins,
            winRate: (cWins / cs.length) * 100,
            avgKda: cDeaths === 0 ? (cKills + cAssists) * 1.2 : (cKills + cAssists) / cDeaths,
            avgKills: cKills / cs.length,
            avgDeaths: cDeaths / cs.length,
            avgAssists: cAssists / cs.length,
          };
        })
        .sort((a, b) => b.games - a.games);

      // Lane breakdown
      const laneMap = new Map<Lane, PlayerStat[]>();
      for (const s of stats) {
        if (!s.lane) continue;
        const arr = laneMap.get(s.lane) || [];
        arr.push(s);
        laneMap.set(s.lane, arr);
      }
      const laneStats: LaneUsage[] = (["top", "jungle", "mid", "adc", "support"] as Lane[])
        .filter((lane) => laneMap.has(lane))
        .map((lane) => {
          const ls = laneMap.get(lane)!;
          const lWins = ls.filter((l) => l.win).length;
          const lDeaths = ls.reduce((s, l) => s + l.deaths, 0);
          const lKills = ls.reduce((s, l) => s + l.kills, 0);
          const lAssists = ls.reduce((s, l) => s + l.assists, 0);
          return {
            lane,
            games: ls.length,
            wins: lWins,
            winRate: (lWins / ls.length) * 100,
            avgKda: lDeaths === 0 ? (lKills + lAssists) * 1.2 : (lKills + lAssists) / lDeaths,
          };
        })
        .sort((a, b) => b.games - a.games);

      // Recent matches (last 10)
      const matchDates = new Map<string, string>();
      for (const m of group.matches) {
        for (const p of m.players) {
          if (p.nickname === nickname) {
            matchDates.set(m.id, m.createdAt);
          }
        }
      }
      const recentMatches = stats
        .map((s) => ({
          win: s.win,
          date: matchDates.get(s.matchId) || "",
        }))
        .slice(-10);

      const winRate = stats.length > 0 ? (wins / stats.length) * 100 : 0;
      const mvpCount = stats.filter((s) => s.isMvp).length;
      const aceCount = stats.filter((s) => s.isAce).length;
      const totalScore = 0; // 아래에서 그룹 내 백분위 기반으로 재계산

      return {
        nickname,
        gamesPlayed: stats.length,
        wins,
        losses,
        winRate,
        totalKills,
        totalDeaths,
        totalAssists,
        avgKills: totalKills / stats.length,
        avgDeaths: totalDeaths / stats.length,
        avgAssists: totalAssists / stats.length,
        avgKda,
        avgCs: stats.reduce((s, p) => s + p.cs, 0) / stats.length,
        avgGold: stats.reduce((s, p) => s + p.gold, 0) / stats.length,
        // 딜량·받은 피해·시야는 "수집된 경기"만 모수로 평균 (수기 기록의 미수집 값이 0으로 섞이지 않게)
        avgDamage: avgOver(stats.filter((p) => !p.noDamage), (p) => p.damageDealt || 0),
        avgDamageTaken: avgOver(stats.filter((p) => !p.noDamageTaken), (p) => p.damageTaken || 0),
        avgVision: avgOver(stats.filter((p) => !p.noVision), (p) => p.visionScore || 0),
        damageGames: stats.filter((p) => !p.noDamage).length,
        visionGames: stats.filter((p) => !p.noVision).length,
        csPerMin: (() => {
          const totalMinutes = minutesMap.get(nickname) || 0;
          const totalCs = stats.reduce((s, p) => s + p.cs, 0);
          return totalMinutes > 0 ? totalCs / totalMinutes : 0;
        })(),
        avgKillParticipation: (() => {
          const kps = kpMap.get(nickname) || [];
          return kps.length > 0 ? kps.reduce((s, v) => s + v, 0) / kps.length : 0;
        })(),
        goldPerMin: (() => {
          const totalMinutes = minutesMap.get(nickname) || 0;
          const totalGold = stats.reduce((s, p) => s + p.gold, 0);
          return totalMinutes > 0 ? totalGold / totalMinutes : 0;
        })(),
        damagePerGold: (() => {
          const withDamage = stats.filter((p) => !p.noDamage);
          const totalGold = withDamage.reduce((s, p) => s + p.gold, 0);
          const totalDamage = withDamage.reduce((s, p) => s + (p.damageDealt || 0), 0);
          return totalGold > 0 ? totalDamage / totalGold : 0;
        })(),
        avgTurretDamage: avgOver(stats.filter((p) => !p.noDamage), (p) => p.turretDamage || 0),
        avgCcScore: avgOver(stats.filter((p) => !p.noDamage), (p) => p.ccScore || 0),
        firstBloodCount: stats.filter((p) => p.firstBlood).length,
        bestMultiKill: Math.max(0, ...stats.map((p) => p.largestMultiKill || 0)),
        mvpCount,
        aceCount,
        totalScore,
        champions,
        laneStats,
        recentMatches,
        momentum,
      };
    });

  // ── 종합 점수: 성적 테이블 컬럼 기반, 그룹 내 백분위 가중합 (0~100) ──
  // 승률(판수 보정) 30% + MVP/ACE 15% + KDA 10% + 킬관여 10% + 분당CS 10%
  // + 시야 10% + 골드당 딜 10% + 판수 5%, 마지막에 표본 신뢰도 계수 적용
  const metrics = results.map((r) => ({
    adjWinRate: ((r.wins + 5) / (r.gamesPlayed + 10)) * 100, // 라플라스 보정 (판수 적으면 50%로 수렴)
    kda: r.avgKda,
    kp: r.avgKillParticipation,
    cs: r.csPerMin,
    vision: r.visionGames > 0 ? r.avgVision : null,
    dpg: r.damageGames > 0 ? r.damagePerGold : null,
    mvpAce: (r.mvpCount + r.aceCount * 0.5) / r.gamesPlayed,
    games: r.gamesPlayed,
  }));
  const pools = {
    adjWinRate: metrics.map((m) => m.adjWinRate),
    kda: metrics.map((m) => m.kda),
    kp: metrics.map((m) => m.kp),
    cs: metrics.map((m) => m.cs),
    vision: collected(metrics.map((m) => m.vision)),
    dpg: collected(metrics.map((m) => m.dpg)),
    mvpAce: metrics.map((m) => m.mvpAce),
    games: metrics.map((m) => m.games),
  };
  results.forEach((r, i) => {
    const m = metrics[i];
    const base =
      percentileOf(pools.adjWinRate, m.adjWinRate) * 0.3 +
      percentileOf(pools.mvpAce, m.mvpAce) * 0.15 +
      percentileOf(pools.kda, m.kda) * 0.1 +
      percentileOf(pools.kp, m.kp) * 0.1 +
      percentileOf(pools.cs, m.cs) * 0.1 +
      percentileOrNeutral(pools.vision, m.vision) * 0.1 +
      percentileOrNeutral(pools.dpg, m.dpg) * 0.1 +
      percentileOf(pools.games, m.games) * 0.05;
    // 표본 신뢰도 계수: 판수가 적을수록 점수를 깎음 (3판 ≈ ×0.71, 10판 ≈ ×0.88, 30판 ≈ ×0.95)
    const confidence = Math.sqrt(m.games / (m.games + 3));
    r.totalScore = base * confidence;
  });

  return results.sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * 최근 폼(momentum) 기준 상승세/하락세 상위 topN 명을 분류.
 * momentum이 null(표본 부족)이거나 0인 선수는 어느 쪽에도 포함되지 않는다.
 */
export function rankMomentum(
  players: PlayerStats[],
  topN = 3
): { rising: Set<string>; falling: Set<string> } {
  const withMomentum = players.filter((p) => p.momentum != null);
  const rising = new Set(
    withMomentum
      .filter((p) => (p.momentum as number) > 0)
      .sort((a, b) => (b.momentum as number) - (a.momentum as number))
      .slice(0, topN)
      .map((p) => p.nickname)
  );
  const falling = new Set(
    withMomentum
      .filter((p) => (p.momentum as number) < 0)
      .sort((a, b) => (a.momentum as number) - (b.momentum as number))
      .slice(0, topN)
      .map((p) => p.nickname)
  );
  return { rising, falling };
}

// ─── Lane Rankings (포지션별 순위) ───

export interface LaneRankEntry {
  nickname: string;
  games: number; // 해당 라인 경기 수
  wins: number;
  winRate: number; // 해당 라인 승률
  avgKda: number; // 해당 라인 KDA
  score: number; // 선수별 성적의 종합 점수(totalScore, 그룹 내 백분위 가중합 0~100)
}

export interface LaneRanking {
  lane: Lane;
  entries: LaneRankEntry[];
}

// 라인별 순위에 오르기 위한 최소 경기 수
export const LANE_RANK_MIN_GAMES = 5;

const LANE_ORDER: Lane[] = ["top", "jungle", "mid", "adc", "support"];

interface LaneAgg {
  nickname: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damage: number;
  vision: number;
  minutes: number;
  kpSum: number; // 경기별 킬관여율 합
  mvp: number;
  ace: number;
  damageGold: number; // 딜량이 수집된 경기의 골드 합 (골드당 딜의 분모)
  damageGames: number;
  visionGames: number;
}

/**
 * 포지션(라인)별 선수 순위. 각 라인에서 minGames 이상 플레이한 선수만 대상으로,
 * "그 라인에서의 성적"만 반영한 점수로 정렬한다. 점수 공식은 선수별 성적의
 * 종합 점수와 동일하되(승률 30% + MVP/ACE 15% + KDA 10% + 킬관여 10% + 분당CS 10%
 * + 시야 10% + 골드당 딜 10% + 판수 5%, 신뢰도 계수 적용), 지표와 백분위를 모두
 * 해당 라인 안에서 계산한다. 라인 순서는 탑→정글→미드→원딜→서폿 고정.
 */
export function buildLaneRankings(
  group: Group,
  minGames = LANE_RANK_MIN_GAMES
): LaneRanking[] {
  const perLane: Record<Lane, Map<string, LaneAgg>> = {
    top: new Map(),
    jungle: new Map(),
    mid: new Map(),
    adc: new Map(),
    support: new Map(),
  };

  for (const m of group.matches) {
    const minutes = parseDurationMinutes(m.gameDuration);
    const teamKills = { blue: 0, red: 0 };
    for (const p of m.players) teamKills[p.team] += p.kills;

    for (const p of m.players) {
      if (!p.lane) continue;
      const map = perLane[p.lane];
      const a =
        map.get(p.nickname) ||
        {
          nickname: p.nickname, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
          cs: 0, gold: 0, damage: 0, vision: 0, minutes: 0, kpSum: 0, mvp: 0, ace: 0,
          damageGold: 0, damageGames: 0, visionGames: 0,
        };
      a.games++;
      if (p.win) a.wins++;
      a.kills += p.kills;
      a.deaths += p.deaths;
      a.assists += p.assists;
      a.cs += p.cs;
      a.gold += p.gold;
      if (!p.noDamage) {
        a.damage += p.damageDealt || 0;
        a.damageGold += p.gold;
        a.damageGames++;
      }
      if (!p.noVision) {
        a.vision += p.visionScore || 0;
        a.visionGames++;
      }
      a.minutes += minutes;
      const tk = teamKills[p.team];
      a.kpSum += tk > 0 ? ((p.kills + p.assists) / tk) * 100 : 0;
      if (p.isMvp) a.mvp++;
      if (p.isAce) a.ace++;
      map.set(p.nickname, a);
    }
  }

  return LANE_ORDER.map((lane) => {
    const aggs = Array.from(perLane[lane].values()).filter((a) => a.games >= minGames);
    if (aggs.length === 0) return { lane, entries: [] };

    // 라인 내 지표 (백분위 계산의 모수는 이 라인의 자격 선수들)
    const metrics = aggs.map((a) => {
      const kda = a.deaths === 0 ? (a.kills + a.assists) * 1.2 : (a.kills + a.assists) / a.deaths;
      return {
        nickname: a.nickname,
        games: a.games,
        wins: a.wins,
        winRate: (a.wins / a.games) * 100,
        avgKda: kda,
        adjWinRate: ((a.wins + 5) / (a.games + 10)) * 100,
        mvpAce: (a.mvp + a.ace * 0.5) / a.games,
        kp: a.kpSum / a.games,
        cs: a.minutes > 0 ? a.cs / a.minutes : 0,
        vision: a.visionGames > 0 ? a.vision / a.visionGames : null,
        dpg: a.damageGames > 0 && a.damageGold > 0 ? a.damage / a.damageGold : null,
      };
    });

    const col = (sel: (m: (typeof metrics)[number]) => number) => metrics.map(sel);
    const pools = {
      adjWinRate: col((m) => m.adjWinRate),
      mvpAce: col((m) => m.mvpAce),
      kda: col((m) => m.avgKda),
      kp: col((m) => m.kp),
      cs: col((m) => m.cs),
      vision: collected(metrics.map((m) => m.vision)),
      dpg: collected(metrics.map((m) => m.dpg)),
      games: col((m) => m.games),
    };

    const entries: LaneRankEntry[] = metrics.map((m) => {
      const base =
        percentileOf(pools.adjWinRate, m.adjWinRate) * 0.3 +
        percentileOf(pools.mvpAce, m.mvpAce) * 0.15 +
        percentileOf(pools.kda, m.avgKda) * 0.1 +
        percentileOf(pools.kp, m.kp) * 0.1 +
        percentileOf(pools.cs, m.cs) * 0.1 +
        percentileOrNeutral(pools.vision, m.vision) * 0.1 +
        percentileOrNeutral(pools.dpg, m.dpg) * 0.1 +
        percentileOf(pools.games, m.games) * 0.05;
      const confidence = Math.sqrt(m.games / (m.games + 3));
      return {
        nickname: m.nickname,
        games: m.games,
        wins: m.wins,
        winRate: m.winRate,
        avgKda: m.avgKda,
        score: base * confidence,
      };
    });

    entries.sort((a, b) => b.score - a.score || b.winRate - a.winRate || b.games - a.games);
    return { lane, entries };
  });
}

/**
 * 전적 기반 선호 포지션: 라인별 판수 내림차순(동점 시 승률)으로 정렬한 라인 목록.
 * 실제로 minGames 이상 플레이한 라인만 포함한다. (라인은 로비 순서 기준으로 배정된 값)
 */
export function derivePreferredLanes(laneStats: LaneUsage[], minGames = 1): Lane[] {
  return [...laneStats]
    .filter((l) => l.games >= minGames)
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate)
    .map((l) => l.lane);
}

// ─── Radar Stats (5각 스탯) ───
// 각 축은 그룹 내 백분위(0~100). 골드차이는 같은 포지션 상대와의
// 분당 골드 차이 (포지션 정보가 없으면 상대팀 평균 대비로 폴백).

export interface RadarStats {
  nickname: string;
  goldDiff: number; // 골드차이
  combat: number; // 전투 (분당 딜량 + 킬관여)
  growth: number; // 성장 (분당 CS + 분당 골드)
  vision: number; // 시야 (분당 시야점수)
  survival: number; // 생존 (분당 데스 억제)
  visionMissing?: boolean; // 시야점수가 한 경기도 수집되지 않음 (시야 축은 중립값 50)
  damageMissing?: boolean; // 딜량이 한 경기도 수집되지 않음 (전투 축은 킬관여만 반영)
}

function parseDurationMinutes(duration: string): number {
  const parts = duration.split(":").map((n) => parseInt(n, 10));
  if (parts.some(isNaN) || parts.length < 2) return 30;
  const seconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
  return seconds > 0 ? seconds / 60 : 30;
}

function percentileOf(pool: number[], v: number): number {
  if (pool.length <= 1) return 50;
  let less = 0;
  let equal = 0;
  for (const x of pool) {
    if (x < v) less++;
    else if (x === v) equal++;
  }
  return ((less + equal / 2) / pool.length) * 100;
}

/** 수집된 값만 남긴 모수 (null = 미수집) */
function collected(values: Array<number | null>): number[] {
  return values.filter((v): v is number => v !== null);
}

/** 미수집(null)이면 유불리 없이 중립(50) 처리 */
function percentileOrNeutral(pool: number[], v: number | null): number {
  return v === null ? 50 : percentileOf(pool, v);
}

function avgOver<T>(items: T[], sel: (item: T) => number): number {
  return items.length > 0 ? items.reduce((s, x) => s + sel(x), 0) / items.length : 0;
}

export function buildRadarStats(group: Group): Map<string, RadarStats> {
  interface Raw { dpm: number[]; kp: number[]; cspm: number[]; gpm: number[]; vspm: number[]; deathsPm: number[]; goldDiffPm: number[] }
  const rawMap = new Map<string, Raw>();

  for (const match of group.matches) {
    const minutes = parseDurationMinutes(match.gameDuration);
    for (const p of match.players) {
      const teammates = match.players.filter((q) => q.team === p.team);
      const enemies = match.players.filter((q) => q.team !== p.team);
      const teamKills = teammates.reduce((s, q) => s + q.kills, 0);
      // 맞라인 상대 우선, 없으면 상대팀 평균
      const laneOpponents = p.lane ? enemies.filter((q) => q.lane === p.lane) : [];
      const refPool = laneOpponents.length > 0 ? laneOpponents : enemies;
      const enemyAvgGold = refPool.length > 0
        ? refPool.reduce((s, q) => s + q.gold, 0) / refPool.length
        : p.gold;

      const raw = rawMap.get(p.nickname) || { dpm: [], kp: [], cspm: [], gpm: [], vspm: [], deathsPm: [], goldDiffPm: [] };
      if (!p.noDamage) raw.dpm.push((p.damageDealt || 0) / minutes);
      raw.kp.push(teamKills > 0 ? (p.kills + p.assists) / teamKills : 0);
      raw.cspm.push(p.cs / minutes);
      raw.gpm.push(p.gold / minutes);
      if (!p.noVision) raw.vspm.push((p.visionScore || 0) / minutes);
      raw.deathsPm.push(p.deaths / minutes);
      raw.goldDiffPm.push((p.gold - enemyAvgGold) / minutes);
      rawMap.set(p.nickname, raw);
    }
  }

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const players = Array.from(rawMap.entries()).map(([nickname, raw]) => ({
    nickname,
    dpm: raw.dpm.length > 0 ? avg(raw.dpm) : null,
    kp: avg(raw.kp),
    cspm: avg(raw.cspm),
    gpm: avg(raw.gpm),
    vspm: raw.vspm.length > 0 ? avg(raw.vspm) : null,
    deathsPm: avg(raw.deathsPm),
    goldDiffPm: avg(raw.goldDiffPm),
  }));

  const pools = {
    dpm: collected(players.map((p) => p.dpm)),
    kp: players.map((p) => p.kp),
    cspm: players.map((p) => p.cspm),
    gpm: players.map((p) => p.gpm),
    vspm: collected(players.map((p) => p.vspm)),
    deathsPm: players.map((p) => p.deathsPm),
    goldDiffPm: players.map((p) => p.goldDiffPm),
  };

  const result = new Map<string, RadarStats>();
  for (const p of players) {
    result.set(p.nickname, {
      nickname: p.nickname,
      goldDiff: percentileOf(pools.goldDiffPm, p.goldDiffPm),
      combat: percentileOrNeutral(pools.dpm, p.dpm) * 0.5 + percentileOf(pools.kp, p.kp) * 0.5,
      growth: percentileOf(pools.cspm, p.cspm) * 0.5 + percentileOf(pools.gpm, p.gpm) * 0.5,
      vision: percentileOrNeutral(pools.vspm, p.vspm),
      visionMissing: p.vspm === null,
      damageMissing: p.dpm === null,
      survival: 100 - percentileOf(pools.deathsPm, p.deathsPm),
    });
  }
  return result;
}

// ─── Champion Stats ───

export interface ChampionStats {
  champion: string;
  totalGames: number;
  wins: number;
  winRate: number;
  avgKda: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgCs: number;
  avgGold: number;
  avgDamage: number;
  damageGames: number; // 딜량이 수집된 경기 수 (0이면 avgDamage 는 "미수집")
  banCount: number;
  banRate: number; // 밴 정보가 있는 경기 대비 %
  players: { nickname: string; games: number; wins: number; winRate: number }[];
}

// lane을 넘기면 해당 라인에서 플레이된 기록만 집계 (라인 정보 없는 기록은 제외)
export function buildChampionStats(group: Group, lane?: Lane): ChampionStats[] {
  const map = new Map<string, PlayerStat[]>();

  for (const match of group.matches) {
    for (const p of match.players) {
      if (!p.champion) continue;
      if (lane && p.lane !== lane) continue;
      const arr = map.get(p.champion) || [];
      arr.push(p);
      map.set(p.champion, arr);
    }
  }

  // 밴 집계 (밴 정보가 있는 경기만 모수로 사용)
  const banCountMap = new Map<string, number>();
  let matchesWithBans = 0;
  for (const match of group.matches) {
    if (!match.bans) continue;
    matchesWithBans++;
    for (const side of ["blue", "red"] as const) {
      for (const champ of match.bans[side] || []) {
        banCountMap.set(champ, (banCountMap.get(champ) || 0) + 1);
      }
    }
  }
  const banRateOf = (champion: string) => {
    const count = banCountMap.get(champion) || 0;
    return {
      banCount: count,
      banRate: matchesWithBans > 0 ? (count / matchesWithBans) * 100 : 0,
    };
  };

  // 밴만 당하고 픽된 적 없는 챔피언도 목록에 포함 (밴은 라인 정보가 없으므로 전체 뷰에서만)
  const banOnly: ChampionStats[] = (lane ? [] : Array.from(banCountMap.keys()))
    .filter((champ) => !map.has(champ))
    .map((champ) => ({
      champion: champ,
      totalGames: 0,
      wins: 0,
      winRate: 0,
      avgKda: 0,
      avgKills: 0,
      avgDeaths: 0,
      avgAssists: 0,
      avgCs: 0,
      avgGold: 0,
      damageGames: 0,
      avgDamage: 0,
      ...banRateOf(champ),
      players: [],
    }));

  return Array.from(map.entries())
    .map(([champion, stats]) => {
      const wins = stats.filter((s) => s.win).length;
      const totalKills = stats.reduce((s, p) => s + p.kills, 0);
      const totalDeaths = stats.reduce((s, p) => s + p.deaths, 0);
      const totalAssists = stats.reduce((s, p) => s + p.assists, 0);

      // Per-player breakdown
      const playerMap = new Map<string, PlayerStat[]>();
      for (const s of stats) {
        const arr = playerMap.get(s.nickname) || [];
        arr.push(s);
        playerMap.set(s.nickname, arr);
      }
      const players = Array.from(playerMap.entries())
        .map(([nickname, ps]) => ({
          nickname,
          games: ps.length,
          wins: ps.filter((p) => p.win).length,
          winRate: (ps.filter((p) => p.win).length / ps.length) * 100,
        }))
        .sort((a, b) => b.games - a.games);

      return {
        champion,
        totalGames: stats.length,
        wins,
        winRate: (wins / stats.length) * 100,
        avgKda:
          totalDeaths === 0
            ? (totalKills + totalAssists) * 1.2
            : (totalKills + totalAssists) / totalDeaths,
        avgKills: totalKills / stats.length,
        avgDeaths: totalDeaths / stats.length,
        avgAssists: totalAssists / stats.length,
        avgCs: stats.reduce((s, p) => s + p.cs, 0) / stats.length,
        avgGold: stats.reduce((s, p) => s + p.gold, 0) / stats.length,
        avgDamage: avgOver(stats.filter((p) => !p.noDamage), (p) => p.damageDealt || 0),
        damageGames: stats.filter((p) => !p.noDamage).length,
        ...banRateOf(champion),
        players,
      };
    })
    .concat(banOnly)
    .sort((a, b) => b.totalGames - a.totalGames);
}

// ─── Awards ───

export interface Award {
  title: string;
  emoji: string;
  player: string;
  value: string;
}

// 개인 타이틀 최소 경기 수 & 어워즈 산정 윈도(최근 N경기)
const AWARD_MIN_GAMES = 15;
const AWARD_RECENT_WINDOW = 20;

export function computeAwards(group: Group): Award[] {
  const awards: Award[] = [];
  if (group.matches.length === 0) return awards;

  // 최근 20경기만 기준으로 어워즈 산정 (경기가 쌓일수록 계속 갱신됨)
  const recentMatches = [...group.matches].sort(byCreatedAt).slice(-AWARD_RECENT_WINDOW);
  const windowGroup: Group = { ...group, matches: recentMatches };
  const playerStats = buildPlayerStats(windowGroup);
  if (playerStats.length === 0) return awards;

  // 윈도 크기에 맞춰 최소 경기 수 조정 (최근 경기의 절반 이상, 최대 15판)
  const minGames = Math.max(3, Math.min(AWARD_MIN_GAMES, Math.ceil(recentMatches.length / 2)));
  const qualified = playerStats.filter((e) => e.gamesPlayed >= minGames);

  const mostMvp = [...qualified].sort((a, b) => b.mvpCount - a.mvpCount)[0];
  if (mostMvp && mostMvp.mvpCount > 0)
    awards.push({ title: "MVP 헌터", emoji: "🏆", player: mostMvp.nickname, value: `${mostMvp.mvpCount}회` });

  const bestWr = [...qualified].sort((a, b) => b.winRate - a.winRate)[0];
  if (bestWr)
    awards.push({ title: "승률왕", emoji: "✨", player: bestWr.nickname, value: `${bestWr.winRate.toFixed(0)}%` });

  const farmKing = [...qualified].sort((a, b) => b.avgCs - a.avgCs)[0];
  if (farmKing)
    awards.push({ title: "농사왕", emoji: "🌾", player: farmKing.nickname, value: `평균 ${Math.round(farmKing.avgCs)} CS` });

  const ccKing = [...qualified].sort((a, b) => b.avgCcScore - a.avgCcScore)[0];
  if (ccKing && ccKing.avgCcScore > 0)
    awards.push({ title: "CC왕", emoji: "⛓️", player: ccKing.nickname, value: `평균 ${ccKing.avgCcScore.toFixed(1)}` });

  const bestTank = [...qualified].sort((a, b) => b.avgDamageTaken - a.avgDamageTaken)[0];
  if (bestTank && bestTank.avgDamageTaken > 0)
    awards.push({ title: "최강 탱커", emoji: "🛡️", player: bestTank.nickname, value: `평균 ${Math.round(bestTank.avgDamageTaken).toLocaleString()} 받은 피해` });

  // 시야점수 꼴등
  const worstVision = [...qualified].filter((e) => e.visionGames > 0).sort((a, b) => a.avgVision - b.avgVision)[0];
  if (worstVision)
    awards.push({ title: "리신상", emoji: "🙈", player: worstVision.nickname, value: `시야점수 평균 ${worstVision.avgVision.toFixed(1)}` });

  // 킬관여율 꼴등
  const worstKp = [...qualified].sort((a, b) => a.avgKillParticipation - b.avgKillParticipation)[0];
  if (worstKp)
    awards.push({ title: "방관상", emoji: "🍿", player: worstKp.nickname, value: `킬관여율 ${worstKp.avgKillParticipation.toFixed(0)}%` });

  // 최다 ACE
  const mostAce = [...qualified].sort((a, b) => b.aceCount - a.aceCount)[0];
  if (mostAce && mostAce.aceCount > 0)
    awards.push({ title: "최다 ACE", emoji: "🌟", player: mostAce.nickname, value: `${mostAce.aceCount}회` });

  // 듀오/라이벌 관련 어워즈는 별도 '듀오 상성' 탭에서 다루므로 여기서는 제외

  return awards;
}

// ─── Team Balancer ───

export interface BalancerPlayer {
  nickname: string;
  score: number; // Internal rating for balancing
  tier?: string;
  gamesPlayed: number;
  winRate: number;
  avgKda: number;
  preferredLanes?: Lane[];
  assignedLane?: Lane; // 밸런스 결과에서 배정된 포지션 (10인일 때)
  parts?: BalancerScoreParts;
}

// 솔랭 티어 → 점수 (티어당 1점, 디비전 4→1 마다 0.25점). 마스터 이상은 디비전 없음
const TIER_BASE: Record<string, number> = {
  "아이언": 1, "브론즈": 2, "실버": 3, "골드": 4, "플래티넘": 5, "에메랄드": 6, "다이아": 7,
  "마스터": 8, "그랜드마스터": 8.6, "챌린저": 9.2,
};
// 흔히 쓰는 줄임말·영문 표기
const TIER_ALIASES: Record<string, string> = {
  "i": "아이언", "iron": "아이언", "아": "아이언",
  "b": "브론즈", "bronze": "브론즈", "브": "브론즈",
  "s": "실버", "silver": "실버", "실": "실버",
  "g": "골드", "gold": "골드", "골": "골드",
  "p": "플래티넘", "plat": "플래티넘", "platinum": "플래티넘", "플": "플래티넘", "플레": "플래티넘", "플래": "플래티넘",
  "e": "에메랄드", "emerald": "에메랄드", "에": "에메랄드", "에메": "에메랄드",
  "d": "다이아", "dia": "다이아", "diamond": "다이아", "다": "다이아", "다이아몬드": "다이아",
  "m": "마스터", "master": "마스터", "마": "마스터",
  "gm": "그랜드마스터", "grandmaster": "그랜드마스터", "그마": "그랜드마스터",
  "c": "챌린저", "challenger": "챌린저", "챌": "챌린저", "챌린": "챌린저",
};

/** "다이아 2", "다이아2", "D2", "gold 3", "그마" 등 → 점수. 읽을 수 없으면 null */
export function parseTierScore(tier: string | undefined | null): number | null {
  if (!tier) return null;
  const m = tier.trim().toLowerCase().replace(/\s+/g, "").match(/^([^\d]+)(\d)?/);
  if (!m) return null;
  const name = TIER_BASE[m[1]] !== undefined ? m[1] : TIER_ALIASES[m[1]];
  const base = name ? TIER_BASE[name] : undefined;
  if (base === undefined) return null;
  if (base >= 8 || !m[2]) return base; // 마스터 이상 · 디비전 미기재
  const division = Math.min(4, Math.max(1, parseInt(m[2], 10)));
  return base + (4 - division) * 0.25;
}

/** 밸런서 점수 구성 (화면에 근거를 보여 주기 위해 함께 반환) */
export interface BalancerScoreParts {
  tierScore: number | null; // 0~10, 티어 미입력이면 null (점수에 쓰지 않음)
  tierKnown: boolean;
  perfScore: number; // 0~10, 판수가 적으면 평균(5)으로 수렴
  perfWeight: number; // 0~0.65, 판수가 많을수록 전적 비중↑
}

export function getBalancerPlayers(
  playerStats: PlayerStats[],
  tierOverrides: Record<string, string>,
  lanePrefs: Record<string, Lane[]> = {}
): BalancerPlayer[] {
  return playerStats.map((p) => {
    const tier = tierOverrides[p.nickname] || "";
    const parsed = parseTierScore(tier);
    // 내전 성적: 종합점수(0~100 백분위)에서 표본 신뢰도 계수를 걷어낸 값을 쓰고,
    // 판수가 적을수록 0 이 아니라 평균(5)으로 수렴시킨다 — 처음 온 사람을 "약한 사람"으로 취급하지 않도록.
    const confidence = p.gamesPlayed > 0 ? Math.sqrt(p.gamesPlayed / (p.gamesPlayed + 3)) : 0;
    const base = confidence > 0 ? p.totalScore / confidence / 10 : 5;
    const shrink = p.gamesPlayed / (p.gamesPlayed + 5);
    const perfScore = 5 + (base - 5) * shrink;
    // 티어가 있으면: 판수가 쌓일수록 티어보다 실제 전적을 더 신뢰 (최대 65%).
    // 티어가 없으면: 아는 정보가 내전 전적뿐이므로 전적만 쓴다 (판수가 적으면 위에서 평균으로 수렴).
    // (솔랭을 거의 안 하는 그룹이라 가짜 평균 티어를 섞으면 점수 차이만 뭉개진다)
    const wPerf = parsed === null ? 1 : 0.65 * Math.sqrt(p.gamesPlayed / (p.gamesPlayed + 5));
    const score = parsed === null ? perfScore : parsed * (1 - wPerf) + perfScore * wPerf;

    return {
      nickname: p.nickname,
      score: Math.round(score * 100) / 100,
      tier: tier || undefined,
      gamesPlayed: p.gamesPlayed,
      winRate: p.winRate,
      avgKda: p.avgKda,
      preferredLanes: lanePrefs[p.nickname],
      parts: {
        tierScore: parsed === null ? null : Math.round(parsed * 100) / 100,
        tierKnown: parsed !== null,
        perfScore: Math.round(perfScore * 100) / 100,
        perfWeight: Math.round(wPerf * 100) / 100,
      },
    };
  });
}

const BALANCE_LANES: Lane[] = ["top", "jungle", "mid", "adc", "support"];

// 선호 포지션 적합도: 1순위 1.0, 2순위 0.8 … / 미선호 라인 0.1 / 선호 미설정자는 어디든 0.5
function lanePrefScore(p: BalancerPlayer, lane: Lane): number {
  const prefs = p.preferredLanes;
  if (!prefs || prefs.length === 0) return 0.5;
  const idx = prefs.indexOf(lane);
  return idx === -1 ? 0.1 : 1 - idx * 0.2;
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) out.push([arr[i], ...perm]);
  }
  return out;
}

const LANE_PERMS = permutations(BALANCE_LANES);

// 5명에게 5개 라인을 배정하는 최적 조합 (선호 적합도 합 최대)
function bestLaneAssignment(team: BalancerPlayer[]): { fit: number; lanes: Lane[] } {
  let best: { fit: number; lanes: Lane[] } = { fit: -1, lanes: BALANCE_LANES };
  for (const perm of LANE_PERMS) {
    let fit = 0;
    for (let i = 0; i < team.length; i++) fit += lanePrefScore(team[i], perm[i]);
    if (fit > best.fit) best = { fit, lanes: perm };
  }
  return best;
}

export interface BalanceResult {
  team1: BalancerPlayer[];
  team2: BalancerPlayer[];
  diff: number; // 팀 점수 합 차이
  laneFit: number; // 포지션 적합도 (0~100%, 10인일 때)
}

/**
 * 팀 나누기. 점수 균형 + (10인이면) 선호 포지션 적합도를 함께 최적화하고,
 * 가장 좋은 조합부터 서로 다른 조합을 최대 `maxOptions` 개 돌려준다 (다시 섞기용).
 * 블루/레드만 바뀐 같은 편성은 하나로 친다.
 */
export interface BalanceConstraints {
  /** 같은 팀이어야 하는 두 사람 */
  together?: Array<[string, string]>;
  /** 다른 팀이어야 하는 두 사람 */
  apart?: Array<[string, string]>;
  /** 피할 팀 구성 (최근 경기의 한쪽 팀 명단). 한 팀이라도 이 명단과 똑같으면 제외 */
  avoidRosters?: string[][];
}

/** 최근 경기들의 팀 명단 (같은 사람들로 또 할 때 같은 팀이 반복되지 않게 하려는 용도) */
export function recentRosters(matches: Match[], count = 3): string[][] {
  return [...matches]
    .sort(byCreatedAt)
    .slice(-count)
    .flatMap((m) => (["blue", "red"] as const).map((t) => m.players.filter((p) => p.team === t).map((p) => p.nickname)));
}

export function balanceOptions(
  players: BalancerPlayer[],
  maxOptions = 5,
  constraints: BalanceConstraints = {}
): BalanceResult[] {
  if (players.length < 2 || players.length > 10 || players.length % 2 !== 0) return [];
  const sameSet = (a: string[], b: Set<string>) => a.length === b.size && a.every((x) => b.has(x));
  const avoid = (constraints.avoidRosters || []).filter((r) => r.length === players.length / 2);

  const n = players.length;
  const teamSize = n / 2;
  const sorted = [...players].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
  const withLanes = n === 10; // 10인일 때만 포지션 배정 고려
  const anchor = sorted[0].nickname; // 거울상(팀 바꾸기만 한 조합) 제거용: 1등은 항상 team1

  const candidates: Array<BalanceResult & { objective: number }> = [];
  for (const team1 of getCombinations(sorted, teamSize)) {
    if (team1[0].nickname !== anchor) continue;
    const team1Set = new Set(team1.map((p) => p.nickname));
    const team2 = sorted.filter((p) => !team1Set.has(p.nickname));
    const team2Set = new Set(team2.map((p) => p.nickname));
    // 고정 조건: 둘 중 한 명이라도 이번 참가자가 아니면 그 조건은 무시
    const inGame = (n: string) => team1Set.has(n) || team2Set.has(n);
    if ((constraints.together || []).some(([a, b]) => inGame(a) && inGame(b) && team1Set.has(a) !== team1Set.has(b))) continue;
    if ((constraints.apart || []).some(([a, b]) => inGame(a) && inGame(b) && team1Set.has(a) === team1Set.has(b))) continue;
    if (avoid.some((r) => sameSet(r, team1Set) || sameSet(r, team2Set))) continue;
    const score1 = team1.reduce((s, p) => s + p.score, 0);
    const score2 = team2.reduce((s, p) => s + p.score, 0);
    const diff = Math.abs(score1 - score2);

    // 점수 균형 + 포지션 적합도(팀당 최대 5.0)를 함께 최적화:
    // 선호 한 단계(0.2)를 어기는 것 = 점수 차이 0.2와 동일한 비용
    let objective = diff;
    let t1 = team1;
    let t2 = team2;
    let laneFit = 1;
    if (withLanes) {
      const a1 = bestLaneAssignment(team1);
      const a2 = bestLaneAssignment(team2);
      objective = diff + (10 - a1.fit - a2.fit);
      laneFit = (a1.fit + a2.fit) / 10;
      t1 = team1.map((p, i) => ({ ...p, assignedLane: a1.lanes[i] }));
      t2 = team2.map((p, i) => ({ ...p, assignedLane: a2.lanes[i] }));
    }
    candidates.push({ team1: t1, team2: t2, diff, laneFit, objective });
  }

  candidates.sort((a, b) => a.objective - b.objective);
  const laneOrder = (p: BalancerPlayer) => (p.assignedLane ? BALANCE_LANES.indexOf(p.assignedLane) : 0);
  const byLane = (team: BalancerPlayer[]) => (withLanes ? [...team].sort((a, b) => laneOrder(a) - laneOrder(b)) : team);
  return candidates.slice(0, maxOptions).map((c) => ({
    team1: byLane(c.team1),
    team2: byLane(c.team2),
    diff: Math.round(c.diff * 100) / 100,
    laneFit: Math.round(c.laneFit * 100),
  }));
}

/** 가장 좋은 조합 하나 (이전 API 호환) */
export function balanceTeams(players: BalancerPlayer[], constraints: BalanceConstraints = {}): BalanceResult | null {
  return balanceOptions(players, 1, constraints)[0] ?? null;
}

function getCombinations<T>(arr: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, size - 1).map((c) => [first, ...c]);
  const withoutFirst = getCombinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

// ─── Team Side Stats (진영별 통계) ───

export interface TeamSideOverall {
  team: "blue" | "red";
  totalGames: number;
  wins: number;
  winRate: number;
  avgKills: number;
  avgDeaths: number;
  avgGold: number;
}

export interface PlayerTeamSide {
  nickname: string;
  blue: { games: number; wins: number; winRate: number; avgKda: number; avgKills: number; avgDeaths: number; avgAssists: number };
  red: { games: number; wins: number; winRate: number; avgKda: number; avgKills: number; avgDeaths: number; avgAssists: number };
  total: { games: number; wins: number; winRate: number };
  blueWinDiff: number; // blue승률 - red승률
}

export interface ChampionTeamSide {
  champion: string;
  blue: { games: number; wins: number; winRate: number };
  red: { games: number; wins: number; winRate: number };
  total: { games: number; wins: number; winRate: number };
}

export interface DuoRecord {
  player1: string;
  player2: string;
  sameTeamGames: number;
  sameTeamWins: number;
  sameTeamWinRate: number;
  oppositeGames: number;
  player1Wins: number; // player1이 이긴 횟수 (상대 기록)
}

export function buildTeamSideStats(group: Group) {
  // Overall blue vs red
  let blueWins = 0;
  let redWins = 0;
  const totalGames = group.matches.length;
  let blueKillsTotal = 0;
  let redKillsTotal = 0;
  let blueDeathsTotal = 0;
  let redDeathsTotal = 0;
  let blueGoldTotal = 0;
  let redGoldTotal = 0;

  for (const m of group.matches) {
    const blue = m.players.filter((p) => p.team === "blue");
    const red = m.players.filter((p) => p.team === "red");
    // 승리 팀을 각 팀 기준으로 명시적으로 판정 (데이터 이상 경기는 어느 쪽으로도 집계하지 않음)
    if (blue.length > 0 && blue[0].win) blueWins++;
    else if (red.length > 0 && red[0].win) redWins++;
    blueKillsTotal += blue.reduce((s, p) => s + p.kills, 0);
    redKillsTotal += red.reduce((s, p) => s + p.kills, 0);
    blueDeathsTotal += blue.reduce((s, p) => s + p.deaths, 0);
    redDeathsTotal += red.reduce((s, p) => s + p.deaths, 0);
    blueGoldTotal += blue.reduce((s, p) => s + p.gold, 0);
    redGoldTotal += red.reduce((s, p) => s + p.gold, 0);
  }

  const overall: TeamSideOverall[] = [
    {
      team: "blue",
      totalGames,
      wins: blueWins,
      winRate: totalGames > 0 ? (blueWins / totalGames) * 100 : 0,
      avgKills: totalGames > 0 ? blueKillsTotal / totalGames : 0,
      avgDeaths: totalGames > 0 ? blueDeathsTotal / totalGames : 0,
      avgGold: totalGames > 0 ? blueGoldTotal / totalGames : 0,
    },
    {
      team: "red",
      totalGames,
      wins: redWins,
      winRate: totalGames > 0 ? (redWins / totalGames) * 100 : 0,
      avgKills: totalGames > 0 ? redKillsTotal / totalGames : 0,
      avgDeaths: totalGames > 0 ? redDeathsTotal / totalGames : 0,
      avgGold: totalGames > 0 ? redGoldTotal / totalGames : 0,
    },
  ];

  // Per player
  const playerMap = new Map<string, { blue: PlayerStat[]; red: PlayerStat[] }>();
  for (const m of group.matches) {
    for (const p of m.players) {
      const entry = playerMap.get(p.nickname) || { blue: [], red: [] };
      entry[p.team].push(p);
      playerMap.set(p.nickname, entry);
    }
  }

  const buildSide = (stats: PlayerStat[]) => {
    if (stats.length === 0) return { games: 0, wins: 0, winRate: 0, avgKda: 0, avgKills: 0, avgDeaths: 0, avgAssists: 0 };
    const wins = stats.filter((s) => s.win).length;
    const k = stats.reduce((s, p) => s + p.kills, 0);
    const d = stats.reduce((s, p) => s + p.deaths, 0);
    const a = stats.reduce((s, p) => s + p.assists, 0);
    return {
      games: stats.length,
      wins,
      winRate: (wins / stats.length) * 100,
      avgKda: d === 0 ? (k + a) * 1.2 : (k + a) / d,
      avgKills: k / stats.length,
      avgDeaths: d / stats.length,
      avgAssists: a / stats.length,
    };
  };

  const players: PlayerTeamSide[] = Array.from(playerMap.entries())
    .map(([nickname, { blue, red }]) => {
      const bSide = buildSide(blue);
      const rSide = buildSide(red);
      const totalGames = blue.length + red.length;
      const totalWins = bSide.wins + rSide.wins;
      return {
        nickname,
        blue: bSide,
        red: rSide,
        total: { games: totalGames, wins: totalWins, winRate: totalGames > 0 ? (totalWins / totalGames) * 100 : 0 },
        blueWinDiff: bSide.winRate - rSide.winRate,
      };
    })
    .sort((a, b) => b.total.games - a.total.games);

  // Per champion
  const champMap = new Map<string, { blue: PlayerStat[]; red: PlayerStat[] }>();
  for (const m of group.matches) {
    for (const p of m.players) {
      if (!p.champion) continue;
      const entry = champMap.get(p.champion) || { blue: [], red: [] };
      entry[p.team].push(p);
      champMap.set(p.champion, entry);
    }
  }

  const champions: ChampionTeamSide[] = Array.from(champMap.entries())
    .map(([champion, { blue, red }]) => {
      const bWins = blue.filter((s) => s.win).length;
      const rWins = red.filter((s) => s.win).length;
      const total = blue.length + red.length;
      return {
        champion,
        blue: { games: blue.length, wins: bWins, winRate: blue.length > 0 ? (bWins / blue.length) * 100 : 0 },
        red: { games: red.length, wins: rWins, winRate: red.length > 0 ? (rWins / red.length) * 100 : 0 },
        total: { games: total, wins: bWins + rWins, winRate: total > 0 ? ((bWins + rWins) / total) * 100 : 0 },
      };
    })
    .sort((a, b) => b.total.games - a.total.games);

  // Duo records
  const duoMap = new Map<string, { same: { wins: number; total: number }; opp: { p1Wins: number; total: number } }>();
  for (const m of group.matches) {
    const blue = m.players.filter((p) => p.team === "blue");
    const red = m.players.filter((p) => p.team === "red");
    const blueWin = blue.length > 0 && blue[0].win;

    // Same team pairs
    for (const team of [blue, red]) {
      const win = team.length > 0 && team[0].win;
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const key = [team[i].nickname, team[j].nickname].sort().join("|||");
          const entry = duoMap.get(key) || { same: { wins: 0, total: 0 }, opp: { p1Wins: 0, total: 0 } };
          entry.same.total++;
          if (win) entry.same.wins++;
          duoMap.set(key, entry);
        }
      }
    }

    // Opposite team pairs
    for (const bp of blue) {
      for (const rp of red) {
        const sorted = [bp.nickname, rp.nickname].sort();
        const key = sorted.join("|||");
        const entry = duoMap.get(key) || { same: { wins: 0, total: 0 }, opp: { p1Wins: 0, total: 0 } };
        entry.opp.total++;
        if (blueWin && sorted[0] === bp.nickname) entry.opp.p1Wins++;
        if (!blueWin && sorted[0] === rp.nickname) entry.opp.p1Wins++;
        duoMap.set(key, entry);
      }
    }
  }

  const duos: DuoRecord[] = Array.from(duoMap.entries())
    .map(([key, { same, opp }]) => {
      const [p1, p2] = key.split("|||");
      return {
        player1: p1,
        player2: p2,
        sameTeamGames: same.total,
        sameTeamWins: same.wins,
        sameTeamWinRate: same.total > 0 ? (same.wins / same.total) * 100 : 0,
        oppositeGames: opp.total,
        player1Wins: opp.p1Wins,
      };
    })
    .sort((a, b) => b.sameTeamGames - a.sameTeamGames);

  return { overall, players, champions, duos };
}

/**
 * 한 사람이 한 목록에 최대 max번만 등장하도록 제한한다.
 * (게임 수 많은 선수가 순위표를 독점하지 않도록)
 * 입력 list는 이미 원하는 순서로 정렬되어 있다고 가정한다.
 */
export function capDuosPerPlayer(list: DuoRecord[], max: number): DuoRecord[] {
  const count = new Map<string, number>();
  const out: DuoRecord[] = [];
  for (const d of list) {
    const c1 = count.get(d.player1) || 0;
    const c2 = count.get(d.player2) || 0;
    if (c1 >= max || c2 >= max) continue;
    count.set(d.player1, c1 + 1);
    count.set(d.player2, c2 + 1);
    out.push(d);
  }
  return out;
}
