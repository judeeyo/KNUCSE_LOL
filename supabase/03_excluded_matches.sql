-- ============================================================================
-- 컴학내전 — "없던 경기" 표시 (3번째로 실행, 01·02 다음)
-- 여러 번 실행해도 안전합니다.
--
-- excluded_reason 에 문구가 있는 경기는 매치 기록에 흑백으로 그 문구와 함께 보이지만
-- 선수·챔피언·포지션·진영·듀오 통계, 어워즈, 팀 밸런스, 경기 수 어디에도 반영되지 않습니다.
-- 해제하려면 관리자 로그인 후 경기 상세 화면에서 "제외 해제"를 누르거나 문구를 null 로 바꾸세요.
-- ============================================================================

alter table public.matches add column if not exists excluded_reason text;
comment on column public.matches.excluded_reason is
  'NULL = 정상 경기 / 문구가 있으면 기록에서 제외(없던 경기로 취급)하고 매치 기록에 그 문구를 표시';

-- 2026-10-26 23:58 (KST) 잠실아펠가모 아지르 경기 — Zeus's Law
update public.matches
set excluded_reason = 'Zeus''s Law'
where game_id = '8434538642';

-- 확인용: 1 이 나와야 합니다.
select count(*) as excluded_matches from public.matches where excluded_reason is not null;
