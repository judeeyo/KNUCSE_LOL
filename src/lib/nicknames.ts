// 이름 정보가 비어 수집기/서버가 "Player1"~"Player10" 폴백으로 기록한 참가자는
// 전부 youuuuu 계정으로 간주
export function normalizeNickname(nickname: string): string {
  return /^Player(10|[1-9])$/.test(nickname) ? "youuuuu" : nickname;
}
