#!/usr/bin/env node
// data/legacy/naejeon-lol-28-matches.json → supabase/02_restore_28_matches.sql
// (친구 저장소 초기 커밋 c951256 의 src/lib/imported-data.json 원본을 그대로 보관한 파일)
//
//   node scripts/build-legacy-sql.mjs          # SQL 재생성
//   node scripts/build-legacy-sql.mjs --check  # 커밋된 SQL 이 원본과 일치하는지 검사
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "data/legacy/naejeon-lol-28-matches.json");
const OUT = join(root, "supabase/02_restore_28_matches.sql");

/** 원본 JSON → matches 테이블 행. 테스트·목 서버에서도 같은 변환을 쓴다. */
export function buildLegacyRows(raw) {
  // 경기일 = played_at 의 날짜(한국 날짜). 시각은 원본에 없으므로 정오(KST)로 두고,
  // 같은 날 여러 경기는 원본 기록 순서(created_at)대로 1분 간격을 줘 순서를 보존한다.
  const byDay = new Map();
  for (const m of raw) {
    const day = m.played_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(m);
  }
  const rows = [];
  for (const [day, list] of [...byDay.entries()].sort()) {
    list.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    list.forEach((m, i) => {
      const team1Win = m.team1_data.result === "승리";
      const team2Win = m.team2_data.result === "승리";
      if (team1Win === team2Win) throw new Error(`승패 불명: ${m.id}`);
      const mk = (p, i2, team, win) => ({
        id: `${team === "blue" ? "t1" : "t2"}-${i2}`,
        matchId: m.id,
        nickname: p.name,
        champion: p.champion,
        lane: p.lane,
        team,
        win,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        cs: p.cs,
        gold: p.gold,
        level: p.level,
        // 원본에 없는 값 — 0 이 아니라 null(미수집)로 저장
        damageDealt: null,
        damageTaken: null,
        visionScore: null,
        wardsPlaced: null,
        wardsDestroyed: null,
        objectiveDamage: null,
        ccScore: null,
        healingDone: null,
        shieldingDone: null,
      });
      const players = [
        ...m.team1_data.players.map((p, i2) => mk(p, i2, "blue", team1Win)),
        ...m.team2_data.players.map((p, i2) => mk(p, i2, "red", team2Win)),
      ];
      if (players.length !== 10) throw new Error(`10명이 아님: ${m.id}`);
      const mm = String(i).padStart(2, "0");
      rows.push({
        id: m.id,
        group_name: "컴학내전",
        created_at: `${day}T12:${mm}:00+09:00`,
        game_duration: m.duration,
        game_mode: m.game_mode || "rift",
        game_id: null,
        bans: null,
        source: "legacy-import",
        time_unknown: true,
        review_status: null,
        duplicate_of: null,
        players,
      });
    });
  }
  return rows;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function buildSql(raw) {
  const rows = buildLegacyRows(raw);
  const nicknames = [...new Set(rows.flatMap((r) => r.players.map((p) => p.nickname)))].sort();
  const first = rows[0].created_at.slice(0, 10);
  const last = rows[rows.length - 1].created_at.slice(0, 10);
  const out = [];
  out.push(`-- ============================================================================
-- 컴학내전 — 과거 ${rows.length}경기 복원 (2번째로 실행, 01_schema.sql 다음)
-- 원본: naejeon.lol 에서 가져온 수기 기록 (${first} ~ ${last}, 전 경기 10명)
-- 이 파일은 scripts/build-legacy-sql.mjs 가 생성합니다. 직접 고치지 마세요.
--
-- · 여러 번 실행해도 중복이 생기지 않습니다 (id 충돌 시 건너뜀).
-- · 원본에 없는 딜량·받은 피해·시야점수 등은 null(미수집)로 넣습니다.
-- · 경기 시각은 원본에 없어 날짜만 신뢰합니다 (time_unknown = true).
-- ============================================================================
begin;
`);
  for (const r of rows) {
    const json = JSON.stringify(r.players);
    if (json.includes("$legacy$")) throw new Error("dollar-quote 충돌");
    out.push(
      `insert into public.matches (id, group_name, created_at, game_duration, game_mode, source, time_unknown, players)\n` +
        `values (${q(r.id)}, '컴학내전', ${q(r.created_at)}, ${q(r.game_duration)}, ${q(r.game_mode)}, 'legacy-import', true,\n` +
        `  $legacy$${json}$legacy$::jsonb)\n` +
        `on conflict (id) do nothing;\n`
    );
  }
  out.push(
    `-- 참가자를 선수 목록에 등록 (이미 있거나, 다른 선수의 부캐로 통합된 닉네임은 건너뜀)\n` +
      `insert into public.members (nickname)\n` +
      `select v.nickname from (values\n` +
      nicknames.map((n) => `  (${q(n)})`).join(",\n") +
      `\n) as v(nickname)\n` +
      `where not exists (\n` +
      `  select 1 from public.members m\n` +
      `  where m.nickname = v.nickname or coalesce(m.aliases, '[]'::jsonb) ? v.nickname\n` +
      `)\non conflict (nickname) do nothing;\n`
  );
  out.push(`commit;

-- 확인용: ${rows.length} 이 나와야 합니다.
select count(*) as legacy_matches from public.matches where source = 'legacy-import';
`);
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = buildSql(JSON.parse(readFileSync(SRC, "utf8")));
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "utf8") !== sql) {
      console.error("02_restore_28_matches.sql 이 원본과 다릅니다. 다시 생성하세요.");
      process.exit(1);
    }
    console.log("OK: SQL 이 원본 JSON 과 일치합니다.");
  } else {
    writeFileSync(OUT, sql);
    console.log(`wrote ${OUT}`);
  }
}
