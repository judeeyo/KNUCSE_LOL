#!/usr/bin/env bash
# Supabase·Vercel 없이 28경기가 든 사이트를 한 번에 띄운다 (가짜 DB + 프로덕션 빌드).
# 데이터는 메모리에만 있어 끄면 28경기 상태로 돌아간다. 운영용이 아니라 미리보기·연습용.
#   npm run preview            → http://localhost:3100
#   관리자 비밀번호: preview-admin   /   업로드 토큰: preview-upload-token
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-3100}"
export PREVIEW_DB_PROXY=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_URL=/_db
export NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-test
export SUPABASE_SERVICE_ROLE_KEY=service-test
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-preview-admin}"
export UPLOAD_SECRET="${UPLOAD_SECRET:-preview-upload-token}"

node scripts/dev/mock-supabase.mjs &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT
npx next build
npx next start -p "$PORT"
