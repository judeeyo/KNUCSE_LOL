-- ============================================================================
-- 컴학내전 — Supabase 스키마 (1번째로 실행)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전합니다(이미 있는 테이블·컬럼·정책은 건너뛰거나 다시 맞춥니다).
--
-- 권한 모델
--   · anon / authenticated (브라우저에 노출되는 anon key) : SELECT 만 가능
--   · service_role (서버 환경변수 SUPABASE_SERVICE_ROLE_KEY) : 쓰기 가능 (RLS 우회)
--   → 기록 추가/수정/삭제는 전부 사이트 서버(/api/admin, /api/upload)를 거칩니다.
-- ============================================================================

create table if not exists public.matches (
  id            text primary key,
  group_name    text        not null default '컴학내전',
  created_at    timestamptz not null default now(),   -- 실제 경기 시각
  game_duration text,
  game_mode     text        default 'rift',
  game_id       text unique,                          -- Riot gameId (수기·과거 기록은 NULL)
  bans          jsonb,                                -- {"blue":[...],"red":[...]}
  players       jsonb       not null                  -- 참가자 10명 스탯 배열
);

-- 구버전(친구 사이트) DB에서 넘어온 경우를 포함해 새 컬럼을 보강
alter table public.matches add column if not exists game_id       text;
alter table public.matches add column if not exists bans          jsonb;
alter table public.matches add column if not exists source        text not null default 'collector';
alter table public.matches add column if not exists time_unknown  boolean not null default false;
alter table public.matches add column if not exists review_status text;
alter table public.matches add column if not exists duplicate_of  text;
alter table public.matches add column if not exists uploaded_at   timestamptz not null default now();

comment on column public.matches.source is
  'collector(실시간 수집) | history(클라이언트 과거 전적 추출) | manual(수동 등록) | legacy-import(naejeon.lol 수기 28경기) | backup-import(백업·내보내기 파일)';
comment on column public.matches.time_unknown is
  'true 면 created_at 의 날짜만 신뢰 (시각 미상 — 수기 기록)';
comment on column public.matches.review_status is
  'NULL = 통계에 반영 / duplicate_candidate = 중복 후보로 보류(관리 화면에서 검토)';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass and contype = 'u'
      and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.matches'::regclass and attname = 'game_id')]
  ) then
    alter table public.matches add constraint matches_game_id_key unique (game_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'matches_review_status_check') then
    alter table public.matches add constraint matches_review_status_check
      check (review_status is null or review_status in ('duplicate_candidate'));
  end if;
end $$;

create table if not exists public.members (
  nickname        text primary key,
  real_name       text,
  tier            text,
  preferred_lanes jsonb default '[]',
  aliases         jsonb default '[]',
  created_at      timestamptz not null default now()
);

create index if not exists idx_matches_created_at on public.matches (created_at desc);
create index if not exists idx_matches_group      on public.matches (group_name);
create index if not exists idx_matches_review     on public.matches (review_status);

-- ── Row Level Security: 공개 읽기 전용 ──
alter table public.matches enable row level security;
alter table public.members enable row level security;

-- 기존 사이트의 "누구나 쓰기" 정책이 남아 있으면 제거
drop policy if exists "Allow all on matches" on public.matches;
drop policy if exists "Allow all on members" on public.members;
drop policy if exists "public read matches"  on public.matches;
drop policy if exists "public read members"  on public.members;

create policy "public read matches" on public.matches
  for select to anon, authenticated using (true);
create policy "public read members" on public.members
  for select to anon, authenticated using (true);

-- INSERT/UPDATE/DELETE 정책은 만들지 않습니다 → anon key 로는 쓰기 불가.
-- (정책이 없어도 막히지만, 테이블 권한 자체도 회수해 이중으로 차단)
revoke insert, update, delete, truncate on public.matches from anon, authenticated;
revoke insert, update, delete, truncate on public.members from anon, authenticated;
grant  select on public.matches to anon, authenticated;
grant  select on public.members to anon, authenticated;
grant  all    on public.matches to service_role;
grant  all    on public.members to service_role;
