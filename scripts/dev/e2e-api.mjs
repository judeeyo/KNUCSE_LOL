#!/usr/bin/env node
// 사이트 서버(next start) + mock-supabase 를 띄운 상태에서 업로드·가져오기·중복 검토·백업 복원 흐름을 검증한다.
//   BASE=http://localhost:3100 MOCK=http://127.0.0.1:54321 ADMIN_PASSWORD=... UPLOAD_SECRET=... node scripts/dev/e2e-api.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLegacyRows } from "../build-legacy-sql.mjs";

const BASE = process.env.BASE || "http://localhost:3100";
const MOCK = process.env.MOCK || "http://127.0.0.1:54321";
const ADMIN = process.env.ADMIN_PASSWORD;
const TOKEN = process.env.UPLOAD_SECRET;
const legacyText = readFileSync(new URL("../../data/legacy/naejeon-lol-28-matches.json", import.meta.url), "utf8");
const legacy = buildLegacyRows(JSON.parse(legacyText));

const post = async (path, body, headers = {}) => {
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const admin = (action, payload = {}) => post("/api/admin", { action, ...payload }, { "x-admin-password": ADMIN });
const upload = (match, source = "collector") => post("/api/upload", { match, source }, { authorization: `Bearer ${TOKEN}` });
const state = async () => (await fetch(MOCK + "/__mock/state")).json();
const live = (s) => s.matches.filter((m) => !m.review_status);
const step = (name) => console.log("  ✓", name);

/** 수기 기록 한 경기를 수집기가 본 것처럼 (gameId·상세 지표 포함, Riot 닉네임은 수기 표기와 다름) */
const detailed = (row, gameId) => ({
  gameId,
  gameCreation: Date.parse(row.created_at) + 9 * 3600 * 1000,
  gameDuration: row.game_duration,
  gameMode: "CLASSIC",
  bans: { blue: ["Ahri"], red: ["Zed"] },
  players: row.players.map((p, i) => ({ ...p, nickname: i === 0 ? "RiotName#KR1" : p.nickname, damageDealt: 15000 + i * 100, damageTaken: 12000, visionScore: 20 + i })),
});

await fetch(MOCK + "/__mock/reset", { method: "POST" });
assert.equal(live(await state()).length, 28);

// 1. 수기 기록과 같은 경기(10명 챔피언·KDA 동일)를 과거 전적으로 올리면 자동으로 합쳐진다 — 닉네임은 기존 표기 유지
const target = legacy[10];
let r = await upload(detailed(target, 7000010), "history");
assert.equal(r.status, 200);
assert.equal(r.body.merged, true);
let s = await state();
assert.equal(s.matches.length, 28, "새 행이 생기지 않아야 한다");
let merged = s.matches.find((m) => m.id === target.id);
assert.equal(merged.game_id, "7000010");
assert.equal(merged.time_unknown, false);
assert.equal(merged.players[1].damageDealt, 15100);
assert.deepEqual(merged.players.map((p) => p.nickname), target.players.map((p) => p.nickname));
assert.deepEqual(merged.bans, { blue: ["아리"], red: ["제드"] });
const owner = target.players[0].nickname;
assert.ok(s.members.find((m) => m.nickname === owner).aliases.includes("RiotName#KR1"), "Riot 닉네임이 부캐로 등록돼야 한다");
assert.equal(s.members.some((m) => m.nickname === "RiotName#KR1"), false, "Riot 닉네임이 별도 선수로 생기면 안 된다");
step("수기 기록과 같은 경기 → 자동 합침 (28경기 유지, 닉네임 유지, Riot 닉네임은 부캐 등록)");

// 같은 gameId 를 다른 참가자가 또 올려도 갱신만 되고 닉네임은 그대로
r = await upload(detailed(target, 7000010), "history");
assert.equal(r.body.updated, true);
s = await state();
assert.equal(s.matches.length, 28);
assert.deepEqual(s.matches.find((m) => m.id === target.id).players.map((p) => p.nickname), target.players.map((p) => p.nickname));
step("같은 gameId 재업로드 → 갱신, 닉네임 유지");

// 2. 확실하지 않은 경우(KDA 일부 다름)는 보류 → 관리자가 합치기
const near = detailed(legacy[12], 7000012);
near.players = near.players.map((p, i) => (i === 3 ? { ...p, kills: p.kills + 1 } : p));
r = await upload(near, "history");
assert.equal(r.body.pendingReview, true);
assert.equal(live(await state()).length, 28, "보류 경기는 통계에 포함되지 않는다");
r = await admin("listPending");
assert.equal(r.body.pending.length, 1);
r = await admin("resolvePending", { id: r.body.pending[0].id, decision: "merge" });
assert.equal(r.status, 200);
s = await state();
assert.equal(s.matches.length, 28);
merged = s.matches.find((m) => m.id === legacy[12].id);
assert.equal(merged.game_id, "7000012");
// KDA 가 같은 9명은 짝을 찾아 기존 닉네임 유지, KDA 가 다른 1명은 들어온 이름 그대로(여기서는 원래 표기와 같음)
assert.equal(merged.players.filter((p, i) => p.nickname === legacy[12].players[i].nickname).length, 10);
assert.equal(merged.players[3].kills, legacy[12].players[3].kills + 1, "스탯은 새 자료 기준");
step("애매한 중복(KDA 1개 다름) → 보류 → 관리자 합치기, 닉네임 유지");

// 3. 새 내전 업로드 → 추가, 같은 gameId 재업로드 → 갱신
const fresh = detailed(legacy[0], 8000001);
fresh.gameCreation = Date.parse("2026-11-10T12:00:00Z");
fresh.players = fresh.players.map((p, i) => ({ ...p, champion: ["Garen", "Lux", "Sona", "Vayne", "Jax"][i % 5], kills: i + 1 }));
r = await upload(fresh);
assert.equal(r.body.status, "inserted");
r = await upload(fresh);
assert.equal(r.body.updated, true);
s = await state();
assert.equal(live(s).length, 29);
const freshRow = s.matches.find((m) => m.game_id === "8000001");
assert.equal(freshRow.players[0].champion, "가렌");
assert.equal(freshRow.players[0].nickname, owner, "부캐(RiotName#KR1)는 본캐 닉네임으로 저장돼야 한다");
assert.equal(s.members.some((m) => m.nickname === "RiotName#KR1"), false);
step("새 경기 업로드 → 29경기, 재업로드해도 29경기, 부캐 닉네임은 본캐로 집계");

// 4. 잘못된 자료는 400
r = await upload({ gameId: 1, players: [{ nickname: "a", team: "blue", win: true }] });
assert.equal(r.status, 400);
step("불완전한 경기 → 400 (수집기는 rejected 로 분류)");

// 5. 백업 → 같은 DB 에 다시 넣기(전부 건너뜀) → 빈 DB 에 복원(전부 추가)
const backup = (await admin("export")).body;
assert.equal(backup.counts.matches, 29);
const file = [{ name: "naejeon-backup.json", text: JSON.stringify(backup), lastModified: Date.now() }];
r = await admin("import", { files: file, dryRun: false });
assert.deepEqual([r.body.inserted, r.body.updated, r.body.skipped, r.body.candidates], [0, 0, 29, 0]);
step("백업을 같은 DB 에 다시 가져오기 → 29건 모두 건너뜀 (중복 0)");

// 빈 DB 흉내: 전부 지우고 복원
for (const m of backup.matches) await admin("deleteMatch", { matchId: m.id });
for (const m of backup.members) await admin("deleteMember", { nickname: m.nickname });
assert.equal((await state()).matches.length, 0);
r = await admin("import", { files: file, dryRun: true });
assert.equal(r.body.inserted, 29);
assert.equal((await state()).matches.length, 0, "미리보기는 아무것도 쓰지 않는다");
r = await admin("import", { files: file, dryRun: false });
assert.deepEqual([r.body.inserted, r.body.skipped, r.body.invalid], [29, 0, 0]);
s = await state();
assert.equal(s.matches.length, 29);
assert.equal(s.members.length, backup.members.length);
assert.equal(s.matches.find((m) => m.id === target.id).game_id, "7000010");
assert.equal(s.matches.filter((m) => m.source === "legacy-import").length, 26);
step("빈 DB 에 백업 복원 → 경기 29건·선수 정보 그대로");

// 6. naejeon.lol 원본 JSON 을 그대로 가져와도 중복이 생기지 않는다 (27건 same-id, 합쳐진 1건도 same-id)
r = await admin("import", { files: [{ name: "legacy.json", text: legacyText, lastModified: 0 }], dryRun: false });
assert.deepEqual([r.body.inserted, r.body.skipped], [0, 28]);
step("원본 28경기 JSON 재가져오기 → 28건 모두 건너뜀");

// 7. 수동 등록(과거 날짜) · 수정 · 삭제
const manualPlayers = legacy[1].players.map((p, i) => ({ ...p, champion: "티모", kills: i, damageDealt: 0, damageTaken: 0, visionScore: 0 }));
r = await admin("addMatch", { players: manualPlayers, gameDuration: "25:00", playedAt: "2026-05-20T12:00:00+09:00", timeUnknown: true });
assert.equal(r.status, 200);
s = await state();
const manual = s.matches.find((m) => m.id === r.body.id);
assert.equal(manual.source, "manual");
assert.equal(manual.created_at, "2026-05-20T03:00:00.000Z");
assert.equal(manual.players[0].damageDealt, null, "비워 둔 딜량은 null(미수집)로 저장");
await admin("deleteMatch", { matchId: manual.id });
step("수동 등록(과거 날짜, 딜량 미입력→미수집) · 삭제");

// 8. 부캐 통합 → 이후 업로드에도 적용
r = await admin("mergeAliases", { mainNickname: "뿅뿅태", aliasNickname: "뽕뽕태" });
assert.equal(r.status, 200);
assert.equal(r.body.renamed, 3);
s = await state();
assert.equal(s.matches.flatMap((m) => m.players).filter((p) => p.nickname === "뽕뽕태").length, 0);
assert.equal(s.members.some((m) => m.nickname === "뽕뽕태"), false);
step("닉네임 통합(뽕뽕태→뿅뿅태): 3경기 반영");

await fetch(MOCK + "/__mock/reset", { method: "POST" });
console.log("OK: API 흐름 검증 완료");
