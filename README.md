# 컴학내전 (KNUCSE LoL)

경북대학교 컴퓨터학부 롤 내전 기록·통계 사이트.
[im-in-J/naejeon](https://github.com/im-in-J/naejeon)(기존 사이트 `naejeon-nine.vercel.app`)을 기반으로
권한 분리, 조회 오류 처리, 과거 기록 복원, 백업·재전송, 모바일 레이아웃을 고친 버전입니다.

- 매치 기록, 선수·챔피언·포지션·진영·듀오 통계, 팀 밸런스, 수동 등록, 수집기 다운로드
- Next.js 16 (App Router) + Supabase(Postgres) + Vercel

**운영 주소:** https://knucse-lol.vercel.app/group/main · 상태 점검 https://knucse-lol.vercel.app/api/health · 관리 https://knucse-lol.vercel.app/group/main/admin

> 이 저장소의 이전 프로젝트(`MakeupTeam/` 노트북)는 작업 트리에서만 제거했습니다.
> 커밋 이력은 그대로이므로 `git checkout 8b37a47 -- MakeupTeam README.md` 로 언제든 되살릴 수 있습니다.

---

## 1. 배포 순서 (처음 한 번)

### ① Supabase 프로젝트 만들기
[supabase.com](https://supabase.com) → New project. 리전은 Seoul(ap-northeast-2) 권장.

### ② SQL 실행 — 순서대로 두 개
Supabase 대시보드 → **SQL Editor** → 파일 내용을 통째로 붙여넣고 Run.

| 순서 | 파일 | 하는 일 |
|---|---|---|
| 1 | [`supabase/01_schema.sql`](supabase/01_schema.sql) | 테이블·인덱스 생성, **읽기 전용 RLS** 설정 |
| 2 | [`supabase/02_restore_28_matches.sql`](supabase/02_restore_28_matches.sql) | 2026-06-04 ~ 07-02 의 **28경기 복원** (마지막 줄 결과가 `28`) |
| 3 | [`supabase/03_excluded_matches.sql`](supabase/03_excluded_matches.sql) | "없던 경기" 표시 기능 추가 + 10/26 아지르 경기를 **Zeus's Law** 로 지정 (결과 `1`) |

두 파일 모두 여러 번 실행해도 안전합니다(중복이 생기지 않음).

### ③ Vercel 프로젝트 연결
Vercel → Add New → Project → `judeeyo/KNUCSE_LOL` 가져오기 (Framework: Next.js, 설정 변경 없음).
**Settings → Environment Variables** 에 아래 5개를 넣습니다. 형식은 [`.env.example`](.env.example) 참고.

| 이름 | 어디서 얻나 | 공개 여부 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | 공개 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 같은 화면의 `anon` `public` 키 | 공개 (읽기만 가능) |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 화면의 `service_role` 키 | **비밀** — Sensitive 로 저장 |
| `ADMIN_PASSWORD` | 직접 정함 (8자 이상) | **비밀** — 기록 수정용 |
| `UPLOAD_SECRET` | 직접 정함 (8자 이상, 예: `openssl rand -hex 24`) | **비밀** — 수집기 업로드용 |

비밀값은 Vercel 과 Supabase 화면에만 입력하세요. 채팅·이슈·커밋에 붙여넣지 않습니다.
환경변수를 바꾼 뒤에는 **Redeploy** 해야 반영됩니다.

### ④ 배포 확인

| 주소 | 정상일 때 |
|---|---|
| `https://<배포주소>/api/health` | `"ok": true`, `"legacy28": 28`, `"anonWriteBlocked": true` |
| `https://<배포주소>/group/main` | 상단에 **22명 · 28경기** |
| `https://<배포주소>/group/main` → **매치 기록** 탭 | 2026년 6월 4일 ~ 7월 2일, 28경기 카드 |
| `https://<배포주소>/group/main/admin` | 관리자 로그인 → 백업·가져오기·중복 검토 |

`/api/health` 는 비밀값을 보여 주지 않고 "설정됐는지"만 알려 줍니다. `anonWriteBlocked` 가 `false` 면
`01_schema.sql` 이 실행되지 않은 것입니다.

---

## 2. 권한 모델 (기존 사이트에서 바꾼 점)

기존 코드에서 확인한 문제:

1. **누구나 DB를 고칠 수 있었음** — RLS 정책이 `FOR ALL USING (true)` 이고 브라우저가 anon key 로 직접 insert/update/delete.
   anon key 는 페이지 소스에 그대로 있으므로 사이트를 열 수 있는 사람은 누구나 전 기록을 지울 수 있었습니다.
2. **업로드 비밀값이 공개됨** — `/api/collector` 가 내려주는 ZIP 에 `UPLOAD_SECRET` 을 심어 넣었고,
   환경변수가 없으면 공개 저장소에 적힌 기본값 `naejeon-upload-2024` 가 그대로 쓰였습니다.
3. `/api/debug` 가 키 앞부분과 전체 선수 목록을 인증 없이 노출.
4. DB 조회가 실패해도 빈 배열을 돌려줘 화면에 `0명 · 0경기` 로 표시 (기록이 지워진 것처럼 보임).

새 구조:

| 하는 일 | 필요한 것 | 경로 |
|---|---|---|
| 통계·기록 **조회** | 없음 (누구나) | 브라우저 → Supabase (anon key, RLS 로 SELECT 만) |
| 경기 등록·수정·삭제, 선수 정보 수정, 백업·가져오기 | `ADMIN_PASSWORD` | 브라우저 → `/api/admin` → Supabase (service_role) |
| 수집기 업로드 (경기 **추가**만) | `UPLOAD_SECRET` | 수집기 → `/api/upload` → Supabase (service_role) |

- 수집기 ZIP 에는 서버 주소만 들어가고 **비밀값은 들어가지 않습니다.** 토큰은 수집기 첫 실행 때 각자 입력합니다.
- 비밀값이 설정되지 않으면 "누구나 통과"가 아니라 **아무도 쓸 수 없습니다** (503).
- 조회 실패는 빈 기록과 구분해 **오류 화면 + 다시 시도 버튼**으로 보여 줍니다.

---

## 3. 과거 기록 복구

### 지금 복원되는 것: 28경기
`data/legacy/naejeon-lol-28-matches.json` 은 친구 저장소 초기 커밋(`c951256`)의 `src/lib/imported-data.json` 원본입니다
(naejeon.lol 에서 가져온 수기 기록). `02_restore_28_matches.sql` 은 이 파일에서 생성합니다 (`npm run sql:build`).

- 들어가는 값: 경기일, 승패, 닉네임, 챔피언, 라인, KDA, CS, 골드, 게임 시간
- 원본에 **없는** 값: 딜량, 받은 피해, 시야점수, 와드, 밴 → DB에 `null` 로 저장하고 화면에는 **미수집**으로 표시.
  통계 평균은 "수집된 경기"만으로 계산하고, 종합 점수에서는 유불리 없이 중립 처리합니다.
- 경기 **시각**은 원본에 없어 날짜만 신뢰합니다 (카드에 "시각 미상").
- 닉네임은 원본 표기 그대로입니다. `뽕뽕태`(3경기)와 `뿅뿅태`(14경기)는 같은 사람으로 보이지만 임의로 합치지 않았습니다.
  **선수 정보 → 아이디 통합**에서 합칠 수 있습니다.

### 추가로 복구할 수 있는 자료
모두 **관리(`/group/main/admin`) → 경기 자료 가져오기**에 파일을 넣으면 됩니다. 먼저 미리보기를 보여 주고, 확인 후 반영합니다.

| 자료 | 어디에 있나 | 비고 |
|---|---|---|
| `match_backup_*.json` | 기존 수집기를 돌린 PC의 수집기 폴더 | 업로드에 **실패했던** 경기만 남아 있음. 경기 시각이 없으면 파일 수정 시각으로 추정 |
| 기존 DB 내보내기 | 친구의 Supabase 프로젝트 | 아래 "기존 DB" 참고. JSON·CSV 모두 가능 |
| `history_export_*.json` | 롤 접속이 가능해지면 수집기로 생성 | 아래 "롤 클라이언트" 참고 |
| 단톡·디스코드 결과표, 스크린샷 | 대화방 검색 | **수동 등록**(`/group/main/new`)에서 경기 날짜를 지정해 옮겨 적기. 모르는 딜량·시야는 비워 두면 미수집 |

#### 기존 DB (삭제 여부 미확인)
기존 사이트가 `0경기`로 보이는 것은 **조회 실패**일 수도 있습니다(그 코드는 실패와 빈 결과를 구분하지 못합니다).
Supabase 무료 프로젝트는 일정 기간 접속이 없으면 **일시 중지(paused)** 되고, 이때 사이트는 0경기로 보입니다.
기존 DB 에 접근할 수 있는 사람(친구)에게 다음을 부탁하세요.

1. Supabase 대시보드에서 프로젝트 상태 확인 — paused 면 **Restore project**
2. Table Editor → `matches` → **Export to CSV** (그리고 `members` 도), 또는 SQL Editor 에서
   `select json_agg(m) from matches m;` 결과를 `.json` 으로 저장
3. 그 파일을 받아 관리 화면에서 가져오기

같은 `id` / `gameId` / 내용의 경기는 건너뛰므로 28경기와 겹쳐도 중복되지 않습니다.

#### 롤 클라이언트 (나중에 접속 가능해지면)
수집기 → **과거 경기 가져오기** → **경기 불러오기** → **선택한 경기 JSON 저장**
(또는 `python naejeon-collector.py --export-history`).

- 클라이언트는 **로그인한 계정이 참가한** 경기만, 클라이언트가 보관하는 범위까지만 돌려줍니다.
  한 사람이 모든 내전에 참가하지 않았으므로 **여러 참가자가 각자 추출**해 파일을 모아야 합니다.
- 여러 파일을 한꺼번에 넣으면 같은 경기는 Riot `gameId` 로 한 번만 들어갑니다.
- 수집기는 **사람 10명이 5대5로 한 소환사의 협곡 사용자 설정 게임**만 내전으로 인정합니다. 혼자 한 커스텀(봇전, 1대1 등)은 목록·저장·업로드에서 빠지고, 서버도 수집기 자료 중 5대5 10명이 아닌 경기는 거부합니다.
- 수기 28경기와 겹치는 경기는 충돌 없이 처리합니다.
  - **10명의 챔피언·KDA 가 모두 같으면 자동으로 합칩니다.** 새 행을 만들지 않고 기존 기록에 딜량·시야·밴·gameId·정확한 시각을 채웁니다. 닉네임은 기존 표기를 유지하고, 다른 Riot 닉네임은 그 사람의 **부캐로 자동 등록**해 이후 경기도 같은 사람으로 집계합니다. 그 Riot 닉네임이 이미 별도 선수로 있으면 자동으로 합치지 않고 미리보기에 알려 줍니다.
  - **비슷하지만 확실하지 않으면**(날짜 ±1일, 챔피언 8개 이상 겹침, KDA 일부 다름) **중복 후보**로 보류합니다. 관리 화면에서 *합치기 / 따로 등록 / 버리기* 를 고르며, 보류 중인 경기는 통계에 포함되지 않습니다.
  - 같은 `gameId` 는 몇 번을 넣어도 한 경기로 유지되고 닉네임도 바뀌지 않습니다.

전체 복구가 가능한지는 **확보한 자료에 달려 있습니다.** 7월 3일 이후 경기는 기존 DB 내보내기가 가장 확실하고,
그게 없으면 참가자들의 클라이언트 전적 + 단톡 결과표로 메워야 합니다.

---

## 4. 없던 경기 (예: Zeus's Law)

특정 경기를 기록에서 빼고 싶을 때 지우지 않고 "없던 경기"로 표시할 수 있습니다.

- 매치 기록에는 **흑백 + 흰 글씨 문구**로 남지만, 경기 수·선수/챔피언/포지션/진영/듀오 통계·어워즈·팀 밸런스 어디에도 반영되지 않습니다.
- 지정/해제: 경기 상세 → **기록 제외** / **제외 해제** (관리자 비밀번호 필요). 문구는 자유롭게 입력.
- 같은 경기가 다시 업로드돼도 표시는 유지되고, 백업·복원에도 포함됩니다.

## 5. 팀 밸런스

- 점수는 **내전 전적**으로 매깁니다. 솔랭 티어를 입력한 사람만 티어 × (100−w)% + 내전 성적 × w% 로 섞습니다 (w 는 판수가 많을수록 커지며 최대 65%). 점수에 마우스를 올리면 근거가 보입니다.
- 티어는 아이언~챌린저 전부, `다이아 2`·`다이아2`·`D2`·`gold 3` 같은 표기를 인식합니다. (이 그룹은 솔랭을 거의 하지 않아 기본은 미입력)
- 수집기는 업로드할 때 참가자의 계정 ID(puuid)·태그·**그 시점 솔랭 티어**를 함께 기록합니다. 티어는 기록만 하고 점수에는 자동으로 쓰지 않습니다. 계정 ID 덕분에 닉네임을 바꾼 사람도 예전 닉네임으로 이어 집계됩니다(새 닉네임은 부캐로 자동 등록). 예전 수집기로 올린 경기에는 이 정보가 없습니다.
- 판수가 적은 선수는 평균 쪽으로 수렴합니다(처음 온 사람을 약한 사람으로 취급하지 않음).
- 가능한 편성(10명 기준 126가지)을 모두 비교해 점수 차이와 선호 포지션을 함께 최적화하고, **다른 조합** 버튼으로 차선책 5개까지 볼 수 있습니다.
- 옵션: **최근 3경기와 같은 팀 구성 피하기**, **두 사람 같은 팀 / 다른 팀 고정**.
- 51경기 기준 백테스트(각 경기 직전까지의 기록으로 승리 팀 예측)는 41판 중 22판(54%)으로, 아직 표본이 적어 점수의 예측력은 검증되지 않았습니다. **솔랭 티어 입력**이 정확도에 가장 큰 영향을 줍니다.

## 6. 백업과 자동 수집

### 수집기 (Windows)
사용법은 [`collector/README.md`](collector/README.md). 요약:

- 경기가 끝나면 **로컬 백업 → 전송 대기열 → 업로드** 순으로 처리합니다. 업로드가 실패해도 원본은 PC에 남습니다.
- 실패분은 5분마다, 그리고 다음 실행 때 **자동 재전송**합니다.
- **Windows 로그인 시 자동 실행**을 켜면 백그라운드(최소화)로 떠서 바로 수집을 시작합니다.
  내전할 때마다 버튼을 누를 필요가 없습니다.

직접 해야 하는 일(한 번): Python 설치 → ZIP 풀기 → 업로드 토큰 입력 → 자동 실행 체크.

### DB 백업·복원
- **내보내기**: 관리 화면 → **백업 파일 내려받기** → `naejeon-backup-YYYY-MM-DD.json` (경기 + 참가자 스탯 + 선수 정보)
- **복원**: 새 DB 에 `01_schema.sql` 실행 → 관리 화면 → 가져오기에 백업 파일 넣기
- 내전한 날이나 한 달에 한 번 내려받아 두기를 권합니다. Supabase 무료 플랜은 자동 백업을 제공하지 않습니다.

### PC 수집기 없이 자동 반영할 수 있나 (공식 API 검토)

| 방법 | 일반 사용자 설정 게임(현재 내전 방식) | 비고 |
|---|---|---|
| Riot **Match-V5** (서버에서 주기적 조회) | **불가** | 토너먼트 코드 없이 만든 사용자 설정 게임은 공개 전적 API 로 제공되지 않습니다 |
| Riot **Tournament-V5** (토너먼트 코드로 방 생성) | 방을 **코드로 만든 경기만** 가능 | 경기 종료 시 서버로 콜백 → Match-V5 로 조회. 다만 프로덕션 키 + Tournament API 승인이 필요하고, 대회 운영용 정책이 적용됩니다 |
| **LCU**(롤 클라이언트 로컬 API) — 이 수집기 | **가능** | 참가자 중 한 명의 PC 에서 실행돼야 함 |

결론: 지금처럼 로비에서 직접 방을 만드는 내전은 **서버만으로는 자동 수집할 수 없습니다.**
그래서 참가자 PC 의 수집기를 "로그인 시 자동 실행"으로 두는 방식을 구현했습니다.
수집기를 켠 참가자가 한 명이라도 있으면 그 경기는 올라가고, 여러 명이 켜도 `gameId` 로 한 번만 기록됩니다.

Tournament API 로 옮기려면 Riot 개발자 포털에서 제품 등록·승인을 받아야 하고 방 생성 방식도 바뀝니다.
승인 조건은 바뀔 수 있으니 신청 전에 [developer.riotgames.com](https://developer.riotgames.com) 의 최신 정책을 확인하세요.
(이 문서를 쓸 때 작업 환경에서 Riot 개발자 문서에 접속할 수 없어 위 표는 공식 문서 원문 대조 없이 정리했습니다.)

### 롤 아이디·비밀번호로 서버가 대신 긁어 올 수는 없나
권하지 않으며 구현하지 않았습니다.

- Riot 은 계정 비밀번호로 전적을 조회하는 공식 API 를 제공하지 않습니다. 사용자 설정 게임 전적은 로그인된 **롤 클라이언트 안에서만** 조회됩니다.
- 계정 정보를 제3자(사람·서버·AI)에게 넘기는 것은 Riot 이용약관 위반이고, 계정 제재·도용 위험이 있습니다.
- 클라이언트는 Windows + Vanguard 가 있어야 실행되므로 서버에서 대신 로그인할 수도 없습니다.

비밀번호 없이 가능한 대안은 위 3장의 자료들입니다(기존 DB 내보내기, 참가자 각자의 클라이언트 추출, 단톡 결과표).
본인 전적 원본이 필요하면 Riot 고객지원의 **개인정보 열람(데이터) 요청**도 있습니다. 어떤 항목이 포함되는지는 요청 결과로 확인해야 합니다.

---

## 7. 개발·검증

```bash
npm ci
cp .env.example .env.local   # 값 채우기
npm run dev
```

| 명령 | 내용 |
|---|---|
| `npm test` | 단위 테스트 (통계, 28경기 원본 대조, 가져오기 형식, 중복 판정) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run build` | Next.js 프로덕션 빌드 |
| `npm run test:collector` | 수집기 테스트 (가짜 서버·가짜 LCU: 백업, 대기열, 재전송, 과거 경기 추출) |
| `npm run sql:check` | 커밋된 복원 SQL 이 원본 JSON 과 일치하는지 |
| `scripts/verify-sql.sh` | 로컬 PostgreSQL 에서 SQL 을 실제 실행 — 재실행 중복 0, anon 쓰기 차단 확인 |
| `npm run mock:db` | 28경기가 든 가짜 Supabase (로컬 화면 확인용) |
| `npm run verify:api` | 업로드 → 중복 보류 → 합치기 → 백업 → 복원 흐름 |
| `npm run verify:responsive` | 320 / 390 / 768 / 1280 폭에서 전 화면 레이아웃 자동 점검 (Playwright) |

Supabase 없이 화면을 보려면:

```bash
npm run mock:db
```

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-test SUPABASE_SERVICE_ROLE_KEY=service-test ADMIN_PASSWORD=local-admin-pass UPLOAD_SECRET=local-upload-token npm run dev
```

### 구조

```
src/app/group/main/        메인(탭) · 매치 상세 · 수동 등록 · 관리
src/app/api/               admin(수정) · upload(수집기) · collector(ZIP) · health(점검)
src/lib/                   stats(통계) · mvp · store(읽기 + 관리자 호출) · import-parse · ingest-plan
src/lib/server/            서버 전용: 인증 · service_role 클라이언트 · 가져오기 · 관리 작업
supabase/                  01_schema.sql · 02_restore_28_matches.sql
data/legacy/               28경기 원본 JSON
collector/                 Windows 수집기 (Python)
scripts/                   SQL 생성·검증, 로컬 검증 도구
```
