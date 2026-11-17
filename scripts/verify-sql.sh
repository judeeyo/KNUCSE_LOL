#!/usr/bin/env bash
# supabase/*.sql 을 로컬 PostgreSQL 에서 실제로 실행해 검증한다.
#  - 스키마/복원 SQL 을 각각 두 번 실행해도 28경기·중복 0건인지
#  - anon 역할은 읽기만 되고 쓰기는 거부되는지 (RLS/권한)
#  - 친구 사이트의 구버전 스키마 위에 실행해도 마이그레이션되는지
# 사용: PGUSER=postgres scripts/verify-sql.sh   (psql 로 접속 가능한 로컬 서버 필요)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=naejeon_verify_$$
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -d postgres -c "create database $DB"
trap '"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null' EXIT

# Supabase 에 기본으로 있는 역할을 로컬에 흉내
"${PSQL[@]}" -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase 기본값처럼 새 테이블 권한을 전부 열어 둔 상태에서 시작 (스키마 SQL 이 회수해야 함)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
SQL

if [[ "${1:-}" == "--legacy-schema" ]]; then
  echo "· 구버전(친구 사이트) 스키마를 먼저 만든 뒤 마이그레이션 검증"
  "${PSQL[@]}" -d "$DB" <<'SQL'
CREATE TABLE matches (id TEXT PRIMARY KEY, group_name TEXT NOT NULL DEFAULT '컴학내전',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), game_duration TEXT, game_mode TEXT DEFAULT 'rift', players JSONB NOT NULL);
CREATE TABLE members (nickname TEXT PRIMARY KEY, real_name TEXT, tier TEXT,
  preferred_lanes JSONB DEFAULT '[]', aliases JSONB DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE matches ENABLE ROW LEVEL SECURITY; ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on matches" ON matches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on members" ON members FOR ALL USING (true) WITH CHECK (true);
INSERT INTO matches (id, players) VALUES ('old-1', '[]');
SQL
fi

for i in 1 2; do
  "${PSQL[@]}" -d "$DB" -f supabase/01_schema.sql
  "${PSQL[@]}" -d "$DB" -f supabase/02_restore_28_matches.sql >/dev/null
done

q() { "${PSQL[@]}" -d "$DB" -At -c "$1"; }
fail() { echo "FAIL: $*"; exit 1; }

n=$(q "select count(*) from matches where source='legacy-import'")
[[ "$n" == 28 ]] || fail "legacy 경기 수 $n (기대 28)"
[[ "$(q "select count(*) from (select id from matches group by id having count(*)>1) d")" == 0 ]] || fail "중복 id"
[[ "$(q "select count(*) from matches where source='legacy-import' and jsonb_array_length(players)<>10")" == 0 ]] || fail "10명이 아닌 경기"
[[ "$(q "select count(distinct p->>'nickname') from matches, jsonb_array_elements(players) p where source='legacy-import'")" == 22 ]] || fail "참가자 수"
[[ "$(q "select count(*) from members")" == 22 ]] || fail "members 수 $(q 'select count(*) from members')"
[[ "$(q "select min((created_at at time zone 'Asia/Seoul')::date)||'~'||max((created_at at time zone 'Asia/Seoul')::date) from matches where source='legacy-import'")" == "2026-06-04~2026-07-02" ]] || fail "날짜 범위"
[[ "$(q "select count(*) from matches, jsonb_array_elements(players) p where source='legacy-import' and (p->'damageDealt' <> 'null'::jsonb or p->'visionScore' <> 'null'::jsonb)")" == 0 ]] || fail "미수집 값이 null 이 아님"
[[ "$(q "select count(*) from matches, jsonb_array_elements(players) p where source='legacy-import' and (p->>'win')::bool")" == 140 ]] || fail "승리 참가자 수(28×5)"

# anon: 읽기 OK, 쓰기 거부
[[ "$(q "set role anon; select count(*) from matches where source='legacy-import'")" == 28 ]] || fail "anon 읽기 실패"
for stmt in \
  "insert into matches (id, players) values ('x','[]')" \
  "update matches set game_duration='0:00'" \
  "delete from matches" \
  "insert into members (nickname) values ('x')" \
  "delete from members"; do
  if "${PSQL[@]}" -d "$DB" -c "set role anon; $stmt" >/dev/null 2>&1; then
    # 권한 오류 없이 통과했다면 영향 행이 0 이어야 함(RLS)
    [[ "$(q "select count(*) from matches where source='legacy-import'")" == 28 && "$(q "select count(*) from matches where id='x'")" == 0 ]] || fail "anon 쓰기가 반영됨: $stmt"
    fail "anon 쓰기가 오류 없이 실행됨: $stmt"
  fi
done
# service_role: 쓰기 OK
"${PSQL[@]}" -d "$DB" -c "set role service_role; insert into matches (id, players, game_id) values ('svc','[]','123'); delete from matches where id='svc'"
# game_id 유니크
if "${PSQL[@]}" -d "$DB" -c "insert into matches (id, players, game_id) values ('a','[]','9'),('b','[]','9')" >/dev/null 2>&1; then fail "game_id 중복 허용됨"; fi

echo "OK: 28경기 · 22명 · 2026-06-04~2026-07-02 · 재실행 중복 0 · anon 쓰기 차단 · service_role 쓰기 가능"
