// 이름 정보가 비어 수집기/서버가 "Player1"~"Player10" 폴백으로 기록한 참가자는
// 전부 같은 계정(예전 youuuuu, 현재 seed123 — 2026-11 아이디 통합)으로 간주
export function normalizeNickname(nickname: string): string {
  return /^Player(10|[1-9])$/.test(nickname) ? "seed123" : nickname;
}
