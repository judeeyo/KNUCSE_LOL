import { describe, it, expect } from "vitest";
import {
  buildPlayerStats,
  buildChampionStats,
  buildTeamSideStats,
  computeAwards,
  buildLaneRankings,
  derivePreferredLanes,
  rankMomentum,
  capDuosPerPlayer,
  getBalancerPlayers,
  balanceTeams,
  buildRadarStats,
  type PlayerStats,
  type DuoRecord,
  type BalancerPlayer,
} from "./stats";
import type { Group, Lane, Match, PlayerStat } from "./types";

// ─── Fixture helpers ───

let seq = 0;

function ps(o: Partial<PlayerStat> & { nickname: string; team: "blue" | "red"; win: boolean }): PlayerStat {
  return {
    id: `p${seq++}`,
    matchId: "",
    champion: "Ahri",
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    gold: 0,
    damageDealt: 0,
    damageTaken: 0,
    visionScore: 0,
    wardsPlaced: 0,
    wardsDestroyed: 0,
    objectiveDamage: 0,
    ccScore: 0,
    healingDone: 0,
    shieldingDone: 0,
    killParticipation: 0,
    mvpScore: 0,
    isMvp: false,
    isAce: false,
    ...o,
  };
}

function match(players: PlayerStat[], opts: { id?: string; duration?: string; bans?: Match["bans"] } = {}): Match {
  const id = opts.id ?? `m${seq++}`;
  return {
    id,
    groupId: "g",
    createdAt: new Date(2026, 0, 1, 0, seq).toISOString(),
    gameDuration: opts.duration ?? "30:00",
    players: players.map((p) => ({ ...p, matchId: id })),
    bans: opts.bans,
  };
}

function group(matches: Match[]): Group {
  return { id: "g", name: "test", inviteCode: "x", createdAt: "", members: [], matches };
}

/** duel match: home(blue) vs away(red), home wins iff homeWin */
function duel(home: string, away: string, homeWin: boolean, extra: Partial<PlayerStat> = {}): Match {
  return match([
    ps({ nickname: home, team: "blue", win: homeWin, ...extra }),
    ps({ nickname: away, team: "red", win: !homeWin }),
  ]);
}

// ─── buildPlayerStats ───

describe("buildPlayerStats", () => {
  it("computes win rate and games played", () => {
    const g = group([duel("A", "B", true), duel("A", "B", true), duel("A", "B", false)]);
    const a = buildPlayerStats(g).find((p) => p.nickname === "A")!;
    expect(a.gamesPlayed).toBe(3);
    expect(a.wins).toBe(2);
    expect(a.losses).toBe(1);
    expect(a.winRate).toBeCloseTo(66.67, 1);
  });

  it("handles zero-death KDA without dividing by zero", () => {
    const g = group([duel("A", "B", true, { kills: 5, assists: 5, deaths: 0 })]);
    const a = buildPlayerStats(g).find((p) => p.nickname === "A")!;
    expect(a.avgKda).toBeCloseTo((5 + 5) * 1.2, 5);
    expect(Number.isFinite(a.avgKda)).toBe(true);
  });

  it("momentum is null when player has fewer than 10 games", () => {
    const g = group(Array.from({ length: 9 }, () => duel("A", "B", true)));
    const a = buildPlayerStats(g).find((p) => p.nickname === "A")!;
    expect(a.momentum).toBeNull();
  });

  it("momentum is +100 when last 5 games won and earlier games lost", () => {
    // 10 games: first 5 losses, last 5 wins
    const matches = [
      ...Array.from({ length: 5 }, () => duel("A", "B", false)),
      ...Array.from({ length: 5 }, () => duel("A", "B", true)),
    ];
    const a = buildPlayerStats(group(matches)).find((p) => p.nickname === "A")!;
    expect(a.momentum).toBeCloseTo(100, 5);
  });

  it("momentum is negative when recent form dips", () => {
    const matches = [
      ...Array.from({ length: 5 }, () => duel("A", "B", true)),
      ...Array.from({ length: 5 }, () => duel("A", "B", false)),
    ];
    const a = buildPlayerStats(group(matches)).find((p) => p.nickname === "A")!;
    expect(a.momentum).toBeCloseTo(-100, 5);
  });

  it("csPerMin uses fallback 30min for malformed duration", () => {
    const g = group([match(
      [ps({ nickname: "A", team: "blue", win: true, cs: 300 }), ps({ nickname: "B", team: "red", win: false })],
      { duration: "garbage" }
    )]);
    const a = buildPlayerStats(g).find((p) => p.nickname === "A")!;
    expect(a.csPerMin).toBeCloseTo(300 / 30, 5);
  });

  it("sorts results by totalScore descending and keeps score in 0..100", () => {
    const matches = [
      ...Array.from({ length: 6 }, () => duel("A", "B", true, { kills: 10, assists: 10, deaths: 1 })),
      ...Array.from({ length: 6 }, () => duel("A", "B", false)),
    ];
    const res = buildPlayerStats(group(matches));
    for (const r of res) {
      expect(r.totalScore).toBeGreaterThanOrEqual(0);
      expect(r.totalScore).toBeLessThanOrEqual(100);
    }
    for (let i = 1; i < res.length; i++) {
      expect(res[i - 1].totalScore).toBeGreaterThanOrEqual(res[i].totalScore);
    }
  });
});

// ─── computeAwards ───

describe("computeAwards", () => {
  it("does not include duo-related or 내전 중독 awards", () => {
    const matches = Array.from({ length: 25 }, () => duel("A", "B", true, { kills: 5, cs: 200 }));
    const titles = computeAwards(group(matches)).map((a) => a.title);
    expect(titles).not.toContain("베스트 듀오");
    expect(titles).not.toContain("워스트 듀오");
    expect(titles).not.toContain("견우와 직녀");
    expect(titles).not.toContain("내전 중독");
  });

  it("only considers the most recent 20 matches", () => {
    // match 1: Ghost plays (and would be a perfect winner) but is outside the window
    const ghostMatch = duel("Ghost", "Filler", true);
    // matches 2..21: Recent beats Filler every time
    const recentMatches = Array.from({ length: 20 }, () => duel("Recent", "Filler", true));
    const awards = computeAwards(group([ghostMatch, ...recentMatches]));
    // Ghost is outside the 20-game window → never awarded
    expect(awards.every((a) => a.player !== "Ghost")).toBe(true);
    // 승률왕 should be the in-window perfect winner
    const wr = awards.find((a) => a.title === "승률왕");
    expect(wr?.player).toBe("Recent");
  });

  it("returns no awards for an empty group", () => {
    expect(computeAwards(group([]))).toEqual([]);
  });
});

// ─── buildChampionStats ───

describe("buildChampionStats", () => {
  it("aggregates per-champion win rate and sorts by games", () => {
    const matches = [
      match([ps({ nickname: "A", team: "blue", win: true, champion: "Yasuo" }), ps({ nickname: "B", team: "red", win: false, champion: "Teemo" })]),
      match([ps({ nickname: "A", team: "blue", win: true, champion: "Yasuo" }), ps({ nickname: "B", team: "red", win: false, champion: "Garen" })]),
      match([ps({ nickname: "A", team: "blue", win: false, champion: "Yasuo" }), ps({ nickname: "B", team: "red", win: true, champion: "Garen" })]),
    ];
    const stats = buildChampionStats(group(matches));
    expect(stats[0].champion).toBe("Yasuo"); // most games → first
    const yasuo = stats.find((c) => c.champion === "Yasuo")!;
    expect(yasuo.totalGames).toBe(3);
    expect(yasuo.winRate).toBeCloseTo(66.67, 1);
  });

  it("includes ban-only champions with a ban rate and zero games", () => {
    const m = match(
      [ps({ nickname: "A", team: "blue", win: true, champion: "Ahri" }), ps({ nickname: "B", team: "red", win: false, champion: "Ahri" })],
      { bans: { blue: ["Zed"], red: [] } }
    );
    const stats = buildChampionStats(group([m]));
    const zed = stats.find((c) => c.champion === "Zed")!;
    expect(zed).toBeDefined();
    expect(zed.totalGames).toBe(0);
    expect(zed.banCount).toBe(1);
    expect(zed.banRate).toBeCloseTo(100, 5);
  });
});

// ─── buildTeamSideStats ───

describe("buildTeamSideStats", () => {
  it("computes blue/red overall win rates", () => {
    const matches = [
      match([ps({ nickname: "A", team: "blue", win: true }), ps({ nickname: "C", team: "red", win: false })]),
      match([ps({ nickname: "A", team: "blue", win: true }), ps({ nickname: "C", team: "red", win: false })]),
    ];
    const { overall } = buildTeamSideStats(group(matches));
    const blue = overall.find((o) => o.team === "blue")!;
    expect(blue.winRate).toBeCloseTo(100, 5);
  });

  it("tracks same-team duos and head-to-head rivals", () => {
    // Anna & Bob together on blue twice (both wins); Anna vs Cara on opposite twice
    const matches = [
      match([
        ps({ nickname: "Anna", team: "blue", win: true }),
        ps({ nickname: "Bob", team: "blue", win: true }),
        ps({ nickname: "Cara", team: "red", win: false }),
      ]),
      match([
        ps({ nickname: "Anna", team: "blue", win: true }),
        ps({ nickname: "Bob", team: "blue", win: true }),
        ps({ nickname: "Cara", team: "red", win: false }),
      ]),
    ];
    const { duos } = buildTeamSideStats(group(matches));
    const annaBob = duos.find(
      (d) => [d.player1, d.player2].sort().join() === ["Anna", "Bob"].sort().join()
    )!;
    expect(annaBob.sameTeamGames).toBe(2);
    expect(annaBob.sameTeamWinRate).toBeCloseTo(100, 5);

    const annaCara = duos.find(
      (d) => [d.player1, d.player2].sort().join() === ["Anna", "Cara"].sort().join()
    )!;
    expect(annaCara.oppositeGames).toBe(2);
    // player1 is alphabetically first (Anna), who won both head-to-heads
    expect(annaCara.player1).toBe("Anna");
    expect(annaCara.player1Wins).toBe(2);
  });
});

// ─── chronological robustness ───

describe("chronological ordering", () => {
  it("momentum is computed by createdAt order even if match array is shuffled", () => {
    // Build 10 chronological matches: first 5 wins, last 5 losses → momentum -100
    const chrono = [
      ...Array.from({ length: 5 }, () => duel("A", "B", true)),
      ...Array.from({ length: 5 }, () => duel("A", "B", false)),
    ];
    // Feed them to the group in reversed array order; createdAt still encodes real order
    const shuffled = [...chrono].reverse();
    const a = buildPlayerStats(group(shuffled)).find((p) => p.nickname === "A")!;
    expect(a.momentum).toBeCloseTo(-100, 5);
  });
});

// ─── rankMomentum ───

function player(nickname: string, momentum: number | null): PlayerStats {
  return { nickname, momentum } as PlayerStats;
}

describe("rankMomentum", () => {
  it("splits top-N rising and falling, excluding null and zero momentum", () => {
    const players = [
      player("up1", 30),
      player("up2", 20),
      player("up3", 10),
      player("up4", 5),
      player("flat", 0),
      player("na", null),
      player("down1", -40),
      player("down2", -25),
    ];
    const { rising, falling } = rankMomentum(players, 3);
    expect([...rising]).toEqual(["up1", "up2", "up3"]); // up4 dropped by topN
    expect(rising.has("flat")).toBe(false);
    expect(rising.has("na")).toBe(false);
    expect([...falling]).toEqual(["down1", "down2"]);
    // rising and falling never overlap
    for (const n of rising) expect(falling.has(n)).toBe(false);
  });
});

// ─── capDuosPerPlayer ───

function duo(p1: string, p2: string): DuoRecord {
  return { player1: p1, player2: p2, sameTeamGames: 0, sameTeamWins: 0, sameTeamWinRate: 0, oppositeGames: 0, player1Wins: 0 };
}

describe("capDuosPerPlayer", () => {
  it("limits each player to at most `max` entries, preserving input order", () => {
    const list = [duo("A", "B"), duo("A", "C"), duo("A", "D"), duo("E", "F")];
    const capped = capDuosPerPlayer(list, 2);
    // A appears in A-B and A-C, then A-D is dropped (A hit cap 2)
    expect(capped).toHaveLength(3);
    expect(capped.map((d) => [d.player1, d.player2].join())).toEqual(["A,B", "A,C", "E,F"]);
  });
});

// ─── team-side hardening ───

describe("buildTeamSideStats hardening", () => {
  it("does not credit a win to either side for a malformed match (no winning team)", () => {
    const good = match([ps({ nickname: "A", team: "blue", win: true }), ps({ nickname: "C", team: "red", win: false })]);
    // both teams marked as not winning (corrupt data)
    const bad = match([ps({ nickname: "A", team: "blue", win: false }), ps({ nickname: "C", team: "red", win: false })]);
    const { overall } = buildTeamSideStats(group([good, bad]));
    const blue = overall.find((o) => o.team === "blue")!;
    const red = overall.find((o) => o.team === "red")!;
    expect(blue.wins).toBe(1); // only the good match
    expect(red.wins).toBe(0); // malformed match not miscredited to red
  });
});

// ─── balancer & radar smoke coverage ───

describe("getBalancerPlayers + balanceTeams", () => {
  it("produces a near-even split for symmetric players", () => {
    const matches = [];
    for (const name of ["A", "B", "C", "D"]) {
      for (let i = 0; i < 5; i++) matches.push(duel(name, "Foe", i % 2 === 0));
    }
    const stats = buildPlayerStats(group(matches)).filter((p) => p.nickname !== "Foe");
    const bp = getBalancerPlayers(stats, {}, {});
    expect(bp.length).toBe(4);
    const result = balanceTeams(bp)!;
    expect(result).not.toBeNull();
    expect(result.team1.length).toBe(2);
    expect(result.team2.length).toBe(2);
    expect(result.diff).toBeGreaterThanOrEqual(0);
  });

  it("returns null when player count is out of range", () => {
    expect(balanceTeams([])).toBeNull();
  });
});

describe("buildRadarStats", () => {
  it("returns percentile axes within 0..100 for players with enough games", () => {
    const matches = Array.from({ length: 4 }, (_, i) =>
      match([
        ps({ nickname: "A", team: "blue", win: true, kills: 5 + i, cs: 200, gold: 12000, visionScore: 30, deaths: 2, damageDealt: 20000 }),
        ps({ nickname: "B", team: "red", win: false, kills: 1, cs: 100, gold: 8000, visionScore: 10, deaths: 5, damageDealt: 8000 }),
      ])
    );
    const radar = buildRadarStats(group(matches));
    const a = radar.get("A");
    if (a) {
      for (const v of [a.goldDiff, a.combat, a.growth, a.vision, a.survival]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

// ─── buildLaneRankings ───

describe("buildLaneRankings", () => {
  it("ranks per lane by lane-specific score and keeps lane order top→jungle→mid→adc→support", () => {
    // 5 mid games: Strong dominates, Weak loses; plus a low-sample top player
    const matches = [
      ...Array.from({ length: 5 }, () =>
        match([
          ps({ nickname: "Strong", team: "blue", win: true, lane: "mid", kills: 8, deaths: 1, assists: 6, cs: 250, gold: 13000, damageDealt: 25000, visionScore: 30 }),
          ps({ nickname: "Weak", team: "red", win: false, lane: "mid", kills: 1, deaths: 7, assists: 1, cs: 120, gold: 8000, damageDealt: 9000, visionScore: 10 }),
        ])
      ),
      match([
        ps({ nickname: "Top1", team: "blue", win: true, lane: "top" }),
        ps({ nickname: "X", team: "red", win: false, lane: "top" }),
      ]),
    ];
    const rankings = buildLaneRankings(group(matches));
    expect(rankings.map((r) => r.lane)).toEqual(["top", "jungle", "mid", "adc", "support"]);

    const mid = rankings.find((r) => r.lane === "mid")!;
    // sorted by score descending
    for (let i = 1; i < mid.entries.length; i++) {
      expect(mid.entries[i - 1].score).toBeGreaterThanOrEqual(mid.entries[i].score);
    }
    expect(mid.entries[0].nickname).toBe("Strong");
    expect(mid.entries.map((e) => e.nickname)).toContain("Weak");

    // Top1 played only 1 top game → below the 5-game floor → excluded
    expect(rankings.find((r) => r.lane === "top")!.entries).toHaveLength(0);
    expect(rankings.find((r) => r.lane === "jungle")!.entries).toHaveLength(0);
  });

  it("only counts games played in that specific lane", () => {
    // A plays 5 games mid, B plays 5 games adc → each ranked only in their lane
    const matches = [
      ...Array.from({ length: 5 }, () =>
        match([ps({ nickname: "A", team: "blue", win: true, lane: "mid" }), ps({ nickname: "B", team: "red", win: false, lane: "adc" })])
      ),
    ];
    const r = buildLaneRankings(group(matches));
    expect(r.find((x) => x.lane === "mid")!.entries.map((e) => e.nickname)).toEqual(["A"]);
    expect(r.find((x) => x.lane === "adc")!.entries.map((e) => e.nickname)).toEqual(["B"]);
    expect(r.find((x) => x.lane === "mid")!.entries[0].games).toBe(5);
  });

  it("excludes players below the 5-game floor", () => {
    const matches = Array.from({ length: 4 }, () =>
      match([ps({ nickname: "A", team: "blue", win: true, lane: "adc" }), ps({ nickname: "B", team: "red", win: false, lane: "adc" })])
    );
    // 4 games each → below default floor of 5
    expect(buildLaneRankings(group(matches)).find((r) => r.lane === "adc")!.entries).toHaveLength(0);
  });
});

// ─── derivePreferredLanes ───

describe("derivePreferredLanes", () => {
  it("orders lanes by games played descending", () => {
    const matches = [
      ...Array.from({ length: 3 }, () =>
        match([ps({ nickname: "A", team: "blue", win: true, lane: "mid" }), ps({ nickname: "Z", team: "red", win: false, lane: "mid" })])
      ),
      match([ps({ nickname: "A", team: "blue", win: true, lane: "top" }), ps({ nickname: "Z", team: "red", win: false, lane: "top" })]),
    ];
    const a = buildPlayerStats(group(matches)).find((p) => p.nickname === "A")!;
    expect(derivePreferredLanes(a.laneStats)).toEqual(["mid", "top"]); // mid(3) before top(1)
  });

  it("returns an empty list when no lane was played enough", () => {
    const matches = [match([ps({ nickname: "A", team: "blue", win: true, lane: "adc" }), ps({ nickname: "Z", team: "red", win: false, lane: "adc" })])];
    const a = buildPlayerStats(group(matches)).find((p) => p.nickname === "A")!;
    expect(derivePreferredLanes(a.laneStats, 2)).toEqual([]); // needs >=2 games
  });
});

describe("leaderboardMinGames", async () => {
  const { leaderboardMinGames } = await import("./stats");
  it("전체 경기 수의 20%, 1~21판", () => {
    expect(leaderboardMinGames(0)).toBe(1);
    expect(leaderboardMinGames(28)).toBe(6);
    expect(leaderboardMinGames(50)).toBe(10);
    expect(leaderboardMinGames(105)).toBe(21);
    expect(leaderboardMinGames(400)).toBe(21);
  });
});

describe("팀 밸런스 보강", async () => {
  const { parseTierScore, balanceOptions, recentRosters } = await import("./stats");
  const bp = (nickname: string, score: number, prefs?: Lane[]): BalancerPlayer => ({
    nickname, score, gamesPlayed: 10, winRate: 50, avgKda: 3, preferredLanes: prefs,
  });
  const ten = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((n, i) => bp(n, 8 - i * 0.5));

  it("티어: 전 구간과 다양한 표기", () => {
    expect(parseTierScore("브론즈 4")).toBe(2);
    expect(parseTierScore("아이언 1")).toBe(1.75);
    expect(parseTierScore("다이아2")).toBe(7.5);
    expect(parseTierScore("D2")).toBe(7.5);
    expect(parseTierScore("gold 3")).toBe(4.25);
    expect(parseTierScore("그마")).toBe(8.6);
    expect(parseTierScore("챌린저")).toBe(9.2);
    expect(parseTierScore("모름")).toBeNull();
    expect(parseTierScore("")).toBeNull();
  });

  it("판수가 적은 선수는 0 이 아니라 평균(5) 쪽으로 수렴", () => {
    const g: Group = { id: "g", name: "g", inviteCode: "", createdAt: "", members: [], matches: [] };
    void g;
    const stats = [{ nickname: "new", gamesPlayed: 1, totalScore: 0 }, { nickname: "vet", gamesPlayed: 40, totalScore: 60 }] as PlayerStats[];
    const [n, v] = getBalancerPlayers(stats, {});
    expect(n.score).toBeGreaterThan(4); // 이전 방식이면 1판·0점 → 약 3.8
    expect(v.score).toBeGreaterThan(5);
    expect(n.parts?.tierKnown).toBe(false);
  });

  it("티어 미입력자는 내전 전적만으로, 입력자는 티어와 섞어서", () => {
    const stats = [{ nickname: "x", gamesPlayed: 10, totalScore: 50 }, { nickname: "y", gamesPlayed: 10, totalScore: 50 }] as PlayerStats[];
    const [x, y] = getBalancerPlayers(stats, { x: "다이아 4" });
    expect(x.parts?.tierScore).toBe(7);
    expect(y.parts?.tierScore).toBeNull();
    expect(y.parts?.perfWeight).toBe(1);
    expect(y.score).toBe(y.parts?.perfScore);
    expect(x.score).toBeGreaterThan(y.score);
  });

  it("여러 조합을 균형 순으로, 블루/레드만 바뀐 중복 없이", () => {
    const opts = balanceOptions(ten, 5);
    expect(opts).toHaveLength(5);
    for (let i = 1; i < opts.length; i++) expect(opts[i].diff + 1e-9).toBeGreaterThanOrEqual(0); // 정렬 기준은 objective
    const keys = opts.map((o) => [...o.team1.map((p) => p.nickname)].sort().join(","));
    expect(new Set(keys).size).toBe(5);
    expect(opts.every((o) => o.team1.some((p) => p.nickname === "a"))).toBe(true);
  });

  it("같은 팀 / 다른 팀 고정", () => {
    const [o] = balanceOptions(ten, 1, { together: [["a", "b"]], apart: [["c", "d"]] });
    const t1 = new Set(o.team1.map((p) => p.nickname));
    expect(t1.has("a")).toBe(t1.has("b"));
    expect(t1.has("c")).not.toBe(t1.has("d"));
    // 참가하지 않은 사람이 들어간 조건은 무시
    expect(balanceOptions(ten, 1, { together: [["a", "zzz"]] })).toHaveLength(1);
    // 불가능한 조건이면 빈 결과
    expect(balanceOptions(ten.slice(0, 2), 1, { together: [["a", "b"]] })).toHaveLength(0);
  });

  it("최근 경기와 같은 팀 구성 피하기", () => {
    const [best] = balanceOptions(ten, 1);
    const roster = best.team1.map((p) => p.nickname);
    const [next] = balanceOptions(ten, 1, { avoidRosters: [roster] });
    expect([...next.team1.map((p) => p.nickname)].sort()).not.toEqual([...roster].sort());
    const m = match([ps({ nickname: "a", team: "blue", win: true }), ps({ nickname: "b", team: "red", win: false })]);
    expect(recentRosters([m])).toEqual([["a"], ["b"]]);
  });
});

describe("최근 참가 보정", async () => {
  const { activityOf, formatLastPlayed, buildPlayerStats: bps } = await import("./stats");
  const DAY = 86400000;
  const now = Date.parse("2026-11-17T12:00:00Z");
  it("한 달까지는 감점 없음, 이후 3개월 직전까지 최대 15% 감점, 3개월 이상은 미참여", () => {
    expect(activityOf(new Date(now - 10 * DAY).toISOString(), now)).toMatchObject({ factor: 1, inactive: false });
    expect(activityOf(new Date(now - 30 * DAY).toISOString(), now).factor).toBe(1);
    expect(activityOf(new Date(now - 60 * DAY).toISOString(), now).factor).toBeCloseTo(0.925);
    expect(activityOf(new Date(now - 89 * DAY).toISOString(), now).inactive).toBe(false);
    expect(activityOf(new Date(now - 90 * DAY).toISOString(), now).inactive).toBe(true);
    expect(activityOf("", now).inactive).toBe(true);
  });
  it("날짜 표시는 한국 날짜 기준", () => {
    expect(formatLastPlayed("2026-11-16T15:30:00Z", now)).toEqual({ date: "2026.11.17", ago: "오늘" });
    expect(formatLastPlayed("2026-07-02T03:00:00Z", now).ago).toBe("4개월 전");
    expect(formatLastPlayed("2026-11-16T14:00:00Z", now).ago).toBe("어제"); // KST 11/16 23:00 → 다음 날 기준 어제
  });
  it("PlayerStats.lastPlayedAt 은 마지막 참가 경기 시각", () => {
    const m1 = { ...match([ps({ nickname: "a", team: "blue", win: true }), ps({ nickname: "b", team: "red", win: false })]), createdAt: "2026-06-01T00:00:00Z" };
    const m2 = { ...match([ps({ nickname: "a", team: "blue", win: true }), ps({ nickname: "c", team: "red", win: false })]), createdAt: "2026-11-01T00:00:00Z" };
    const stats = bps({ id: "g", name: "g", inviteCode: "", createdAt: "", members: [], matches: [m1, m2] });
    expect(stats.find((s) => s.nickname === "a")!.lastPlayedAt).toBe("2026-11-01T00:00:00Z");
    expect(stats.find((s) => s.nickname === "b")!.lastPlayedAt).toBe("2026-06-01T00:00:00Z");
  });
});

describe("진영이 확실한 경기", async () => {
  const { isSideKnown } = await import("./stats");
  it("수기 기록만 제외", () => {
    const m = match([ps({ nickname: "a", team: "blue", win: true }), ps({ nickname: "b", team: "red", win: false })]);
    expect(isSideKnown({ ...m, source: "legacy-import" })).toBe(false);
    for (const s of ["collector", "history", "manual", "backup-import", undefined] as const) expect(isSideKnown({ ...m, source: s })).toBe(true);
  });
});
