import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseImportPayload, parseImportText, parseCsv, validateIncoming, type IncomingMatch } from "./import-parse";
import { decideIngest, keepExistingNicknames, type ExistingMatch } from "./ingest-plan";
import { detectMissing, matchFingerprint, normalizePlayers, rowToMatch, kstDate } from "./match-normalize";
import { buildPlayerStats, buildChampionStats, buildRadarStats, computeAwards } from "./stats";
import type { Group } from "./types";
import { buildLegacyRows, buildSql } from "../../scripts/build-legacy-sql.mjs";

const root = join(__dirname, "../..");
const legacyRaw = JSON.parse(readFileSync(join(root, "data/legacy/naejeon-lol-28-matches.json"), "utf8"));
const legacyRows = buildLegacyRows(legacyRaw) as Array<Record<string, unknown> & { id: string; created_at: string; players: Array<Record<string, unknown>> }>;

/** 수기 기록 한 경기를 "수집기가 올린 것처럼" 바꾼다 (gameId·상세 지표 포함, 닉네임은 Riot 표기로 다름) */
function asCollector(row: (typeof legacyRows)[number], gameId: number) {
  return {
    gameId,
    gameCreation: Date.parse(row.created_at) + 8 * 3600 * 1000,
    gameDuration: "30:00",
    players: row.players.map((p, i): Record<string, unknown> => ({
      ...p,
      nickname: `riot-${i}`,
      damageDealt: 10000 + i,
      damageTaken: 9000 + i,
      visionScore: 20 + i,
    })),
  };
}
const existingOf = (rows: typeof legacyRows): ExistingMatch[] =>
  rows.map((r) => ({ id: r.id, game_id: null, created_at: r.created_at, review_status: null, players: r.players }));

describe("28경기 복원 자료", () => {
  it("28경기 · 전 경기 10명 · 2026-06-04 ~ 2026-07-02", () => {
    expect(legacyRows).toHaveLength(28);
    expect(legacyRows.every((r) => r.players.length === 10)).toBe(true);
    const days = legacyRows.map((r) => kstDate(r.created_at)).sort();
    expect(days[0]).toBe("2026-06-04");
    expect(days[27]).toBe("2026-07-02");
    expect(new Set(legacyRows.map((r) => r.id)).size).toBe(28);
  });

  it("원본의 승패·닉네임·챔피언·KDA·CS·골드가 그대로 들어간다", () => {
    for (const raw of legacyRaw) {
      const row = legacyRows.find((r) => r.id === raw.id)!;
      expect(kstDate(row.created_at)).toBe(raw.played_at.slice(0, 10));
      const src = [...raw.team1_data.players, ...raw.team2_data.players];
      src.forEach((p: Record<string, unknown>, i: number) => {
        const q = row.players[i];
        expect([q.nickname, q.champion, q.kills, q.deaths, q.assists, q.cs, q.gold]).toEqual(
          [p.name, p.champion, p.kills, p.deaths, p.assists, p.cs, p.gold]
        );
        expect(q.win).toBe((i < 5 ? raw.team1_data.result : raw.team2_data.result) === "승리");
        expect(q.team).toBe(i < 5 ? "blue" : "red");
      });
      // 각 경기는 한 팀만 승리
      expect(row.players.filter((p) => p.win).length).toBe(5);
    }
  });

  it("원본에 없는 딜량·시야는 0이 아니라 null(미수집)", () => {
    for (const r of legacyRows) {
      for (const p of r.players) {
        expect(p.damageDealt).toBeNull();
        expect(p.visionScore).toBeNull();
      }
    }
  });

  it("커밋된 SQL 은 원본 JSON 에서 생성한 것과 같고, 재실행해도 안전한 구문을 쓴다", () => {
    const sql = readFileSync(join(root, "supabase/02_restore_28_matches.sql"), "utf8");
    expect(sql).toBe(buildSql(legacyRaw));
    expect(sql.match(/on conflict \(id\) do nothing/g)).toHaveLength(28);
    expect(sql).toContain("on conflict (nickname) do nothing");
  });
});

describe("미수집 지표 처리", () => {
  const legacyMatches = legacyRows.map((r) => rowToMatch(r as never));
  const group: Group = { id: "g", name: "g", inviteCode: "", createdAt: "", members: [], matches: legacyMatches };

  it("경기 단위로 미수집을 판정한다", () => {
    expect(detectMissing(legacyRows[0].players)).toEqual({ damage: true, damageTaken: true, vision: true });
    expect(detectMissing([{ damageDealt: 1, damageTaken: 0, visionScore: 5 }])).toEqual({ damage: false, damageTaken: true, vision: false });
    const { players } = normalizePlayers(legacyRows[0].players);
    expect(players.every((p) => p.noDamage && p.noVision && p.damageDealt === 0)).toBe(true);
    expect(legacyMatches[0].timeUnknown).toBe(true);
    expect(legacyMatches[0].source).toBe("legacy-import");
  });

  it("수기 기록만 있으면 딜량·시야 통계는 '수집 0경기'로 표시된다", () => {
    const stats = buildPlayerStats(group);
    expect(stats).toHaveLength(22);
    expect(stats.reduce((s, p) => s + p.gamesPlayed, 0)).toBe(280);
    for (const s of stats) {
      expect(s.visionGames).toBe(0);
      expect(s.damageGames).toBe(0);
      expect(Number.isFinite(s.totalScore)).toBe(true);
    }
    expect(buildChampionStats(group).every((c) => c.damageGames === 0)).toBe(true);
    for (const r of buildRadarStats(group).values()) {
      expect(r.visionMissing).toBe(true);
      expect(r.vision).toBe(50);
    }
    // 시야점수가 없는데 "시야 꼴등" 상을 주면 안 된다
    expect(computeAwards(group).some((a) => a.title === "리신상" || a.title === "최강 탱커")).toBe(false);
  });

  it("상세가 수집된 경기가 섞이면 그 경기만으로 평균을 낸다", () => {
    const detailed = rowToMatch({
      id: "d1", created_at: "2026-08-01T12:00:00Z", game_duration: "30:00",
      players: legacyRows[0].players.map((p) => ({ ...p, damageDealt: 20000, damageTaken: 10000, visionScore: 30 })),
    } as never);
    const mixed = buildPlayerStats({ ...group, matches: [...legacyMatches, detailed] });
    const eddie = mixed.find((p) => p.nickname === "Eddie")!;
    expect(eddie.gamesPlayed).toBe(29);
    expect(eddie.visionGames).toBe(1);
    expect(eddie.avgVision).toBe(30); // 29경기로 나눈 1.03 이 아니라 수집된 1경기 평균
    expect(eddie.avgDamage).toBe(20000);
  });
});

describe("가져오기 형식 판별", () => {
  it("naejeon.lol 수기 형식", () => {
    const r = parseImportPayload(legacyRaw);
    expect(r.errors).toEqual([]);
    expect(r.matches).toHaveLength(28);
    expect(r.matches[0].source).toBe("legacy-import");
    expect(r.matches[0].timeUnknown).toBe(true);
    expect(r.matches[0].players[0].damageDealt).toBeNull();
    expect(r.matches.every((m) => validateIncoming(m) === null)).toBe(true);
  });

  it("수집기 낱개 파일 / 과거 전적 묶음 / 업로드 본문", () => {
    const one = asCollector(legacyRows[0], 111);
    const a = parseImportText(JSON.stringify({ ...one, _backup: { savedAt: "x" }, _raw: { big: 1 } }), "match_111.json");
    expect(a.matches).toHaveLength(1);
    expect(a.matches[0]).toMatchObject({ gameId: "111", source: "collector", restore: false, timeUnknown: false });
    expect(a.matches[0].players[0].damageDealt).toBe(10000);

    const b = parseImportPayload({ format: "naejeon-history-export", matches: [one, asCollector(legacyRows[1], 222)] });
    expect(b.matches.map((m) => m.source)).toEqual(["history", "history"]);

    expect(parseImportPayload({ match: one }, "collector").matches[0].gameId).toBe("111");
  });

  it("경기 시각이 없는 예전 백업 파일은 파일 수정 시각으로 추정한다", () => {
    const one = asCollector(legacyRows[0], 111) as Record<string, unknown>;
    delete one.gameCreation;
    const r = parseImportText(JSON.stringify(one), "match_backup_111.json", "2026-07-10T03:00:00.000Z");
    expect(r.matches[0].createdAt).toBe("2026-07-10T03:00:00.000Z");
  });

  it("사이트 백업(JSON)과 Supabase CSV 내보내기", () => {
    const backup = { format: "naejeon-backup", matches: legacyRows.slice(0, 2), members: [{ nickname: "Eddie", aliases: ["에디"] }] };
    const r = parseImportPayload(backup);
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0]).toMatchObject({ id: legacyRows[0].id, restore: true, source: "legacy-import", timeUnknown: true });
    expect(r.members).toEqual([{ nickname: "Eddie", aliases: ["에디"] }]);

    const cell = (v: unknown) => `"${String(typeof v === "string" ? v : JSON.stringify(v)).replace(/"/g, '""')}"`;
    const row = legacyRows[0];
    const csv = `id,group_name,created_at,game_duration,game_id,players\n${[row.id, "컴학내전", row.created_at, row.game_duration, "", row.players].map(cell).join(",")}\n`;
    const c = parseImportText(csv, "matches_rows.csv");
    expect(c.errors).toEqual([]);
    expect(c.matches).toHaveLength(1);
    expect(c.matches[0].players).toHaveLength(10);
    expect(c.matches[0].gameId).toBeNull();
    expect(matchFingerprint(c.matches[0].players)).toBe(matchFingerprint(row.players));
  });

  it("CSV 파서는 따옴표 안의 쉼표·줄바꿈·이스케이프를 처리한다", () => {
    expect(parseCsv('a,b\n"x,1","he said ""hi""\nline2"\n')).toEqual([["a", "b"], ["x,1", 'he said "hi"\nline2']]);
  });

  it("읽을 수 없는 자료는 오류로 알린다", () => {
    expect(parseImportText("hello", "x.txt").errors).toHaveLength(1);
    expect(parseImportText("{bad json", "x.json").errors[0]).toContain("JSON");
    const bad: IncomingMatch = { ...parseImportPayload(legacyRaw).matches[0], players: [] };
    expect(validateIncoming(bad)).toBeTruthy();
  });
});

describe("중복 판정", () => {
  const existing = existingOf(legacyRows);
  const inc = (payload: unknown, src: "collector" | "history" = "history") => parseImportPayload(payload, src).matches[0];

  it("같은 id 의 행 복원은 건너뛴다 (백업을 여러 번 넣어도 중복 없음)", () => {
    expect(decideIngest(existing, inc([legacyRows[3]]))).toMatchObject({ action: "skip", reason: "same-id" });
  });

  it("같은 gameId: 수집기 업로드는 갱신, 복원은 건너뜀", () => {
    const withId: ExistingMatch[] = [{ ...existing[0], id: "e1", game_id: "777" }];
    expect(decideIngest(withId, inc(asCollector(legacyRows[0], 777)))).toEqual({ action: "update", existingId: "e1" });
    const restore = inc([{ ...legacyRows[0], id: "other", game_id: "777" }]);
    expect(decideIngest(withId, restore)).toMatchObject({ action: "skip", reason: "same-game-id" });
  });

  it("여러 참가자가 추출한 같은 경기는 gameId 로 한 번만 들어간다", () => {
    const db: ExistingMatch[] = [];
    const results = [1, 2, 3].map(() => {
      const m = inc(asCollector(legacyRows[5], 9001));
      const d = decideIngest(db, m);
      if (d.action === "insert") db.push({ id: "new", game_id: m.gameId, created_at: m.createdAt!, review_status: null, players: m.players as never });
      return d.action;
    });
    expect(results).toEqual(["insert", "update", "update"]);
    expect(db).toHaveLength(1);
  });

  it("gameId 없는 수기 기록과 10명의 챔피언·KDA 가 같으면 자동으로 합친다", () => {
    const d = decideIngest(existing, inc(asCollector(legacyRows[7], 5555)));
    expect(d).toEqual({ action: "merge", existingId: legacyRows[7].id });
  });

  it("이미 다른 gameId 가 붙은 기록과는 내용이 같아도 합치지 않는다", () => {
    const withId: ExistingMatch[] = [{ ...existing[7], game_id: "1111" }];
    expect(decideIngest(withId, inc(asCollector(legacyRows[7], 2222))).action).not.toBe("merge");
  });

  it("합칠 때 닉네임은 기존 기록 표기를 유지하고, 바뀐 이름 쌍을 알려 준다", () => {
    const riot = asCollector(legacyRows[7], 5555).players; // riot-0 ~ riot-9
    const shuffled = [...riot].reverse(); // 순서가 달라도 챔피언·KDA 로 짝을 찾는다
    const { players, renames } = keepExistingNicknames(legacyRows[7].players, shuffled);
    expect(players.map((p) => p.nickname)).toEqual([...legacyRows[7].players].reverse().map((p) => p.nickname));
    expect(renames).toHaveLength(10);
    expect(renames[0]).toEqual({ from: "riot-9", to: legacyRows[7].players[9].nickname });
    expect(players[0].damageDealt).toBe(10009); // 상세 지표는 새 자료 것
  });

  it("블루/레드가 뒤바뀌어 기록돼도 같은 경기로 본다", () => {
    const flipped = asCollector(legacyRows[7], 5556);
    flipped.players = flipped.players.map((p) => ({ ...p, team: p.team === "blue" ? "red" : "blue" }));
    expect(decideIngest(existing, inc(flipped))).toMatchObject({ action: "merge", existingId: legacyRows[7].id });
  });

  it("KDA 가 조금 다르지만 날짜가 가깝고 챔피언이 거의 같으면 '유사' 후보", () => {
    const near = asCollector(legacyRows[7], 5557);
    near.players = near.players.map((p, i) => (i === 0 ? { ...p, kills: Number(p.kills) + 1 } : p));
    expect(decideIngest(existing, inc(near))).toMatchObject({ action: "candidate", reason: "similar", existingId: legacyRows[7].id });
  });

  it("gameId 없는 같은 내용의 자료는 그냥 중복으로 건너뛴다", () => {
    const again = inc([{ ...legacyRaw[0], id: "different-id" }]);
    expect(decideIngest(existing, again)).toMatchObject({ action: "skip", reason: "same-content" });
  });

  it("전혀 다른 경기는 새로 추가된다", () => {
    const fresh = asCollector(legacyRows[0], 4242);
    fresh.gameCreation = Date.parse("2026-09-01T12:00:00Z");
    fresh.players = fresh.players.map((p, i) => ({ ...p, champion: ["가렌", "럭스", "소나", "베인", "잭스"][i % 5], kills: i }));
    expect(decideIngest(existing, inc(fresh))).toEqual({ action: "insert" });
  });

  it("보류 중인 경기는 다른 자료의 중복 기준이 되지 않는다", () => {
    const pendingOnly: ExistingMatch[] = [{ ...existing[7], review_status: "duplicate_candidate" }];
    expect(decideIngest(pendingOnly, inc(asCollector(legacyRows[7], 5558)))).toEqual({ action: "insert" });
  });
});

describe("Supabase 주소 정규화", async () => {
  const { normalizeSupabaseUrl } = await import("./supabase");
  it.each([
    ["https://abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co"],
    ["https://abcdefghijklmnopqrst.supabase.co/", "https://abcdefghijklmnopqrst.supabase.co"],
    ["https://abcdefghijklmnopqrst.supabase.co/rest/v1/", "https://abcdefghijklmnopqrst.supabase.co"],
    [" 'https://abcdefghijklmnopqrst.supabase.co/rest/v1' ", "https://abcdefghijklmnopqrst.supabase.co"],
    ["abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co"],
    ["https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api", "https://abcdefghijklmnopqrst.supabase.co"],
    ["abcdefghijklmnopqrst", "https://abcdefghijklmnopqrst.supabase.co"],
    ["http://127.0.0.1:54321", "http://127.0.0.1:54321"],
    ["http://127.0.0.1:54321/rest/v1/", "http://127.0.0.1:54321"],
    ["/_db", "/_db"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSupabaseUrl(input)).toBe(expected);
  });
});

describe("내전 판별 (수집기 자료)", async () => {
  const { naejeonViolation } = await import("./import-parse");
  const base = parseImportPayload(asCollector(legacyRows[0], 1), "history").matches[0];
  it("5대5 10명은 통과", () => expect(naejeonViolation(base)).toBeNull());
  it("1대1 커스텀은 거부", () => {
    const solo = { ...base, players: [base.players[0], base.players[5]] };
    expect(naejeonViolation(solo)).toContain("2명");
  });
  it("10명이어도 6대4 는 거부", () => {
    const uneven = { ...base, players: base.players.map((p, i) => (i === 5 ? { ...p, team: "blue" as const } : p)) };
    expect(naejeonViolation(uneven)).toContain("6대4");
  });
  it("수동 등록·백업 복원에는 적용하지 않음", () => {
    expect(naejeonViolation({ ...base, source: "manual", players: base.players.slice(0, 4) })).toBeNull();
    expect(naejeonViolation({ ...base, source: "backup-import", players: base.players.slice(0, 4) })).toBeNull();
  });
});
