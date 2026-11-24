import type { Member } from "./types";

export function parsePastedPairs(input: string, nicknames: string[], members: Member[]) {
  const normalize = (name: string) => name.normalize("NFKC").trim().toLowerCase();
  const names = new Map<string, Set<string>>();
  const add = (name: string, nickname: string) => {
    const key = normalize(name);
    if (!key) return;
    const matches = names.get(key) ?? new Set<string>();
    matches.add(nickname);
    names.set(key, matches);
  };
  const roster = new Map(members.map((m) => [m.nickname, m]));
  for (const nickname of nicknames) {
    add(nickname, nickname);
    const member = roster.get(nickname);
    for (const alias of member?.aliases ?? []) add(alias, nickname);
    for (const name of (member?.realName ?? "").split(",")) {
      const trimmed = name.trim();
      add(trimmed, nickname);
      if (/^[가-힣]{3}$/.test(trimmed)) add(trimmed.slice(1), nickname);
    }
  }

  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 5) return { error: "한 줄에 두 명씩, 총 5줄을 입력해 주세요." };

  const issues = new Set<string>();
  const used = new Set<string>();
  const pairs: [string, string][] = [];
  const resolve = (name: string) => {
    const matches = names.get(normalize(name));
    if (!matches?.size) { issues.add(`‘${name}’ 이름 미등록`); return; }
    if (matches.size > 1) { issues.add(`‘${name}’ 후보 여러 명 · 게임 닉네임을 입력해 주세요`); return; }
    const nickname = [...matches][0];
    if (used.has(nickname)) { issues.add(`‘${name}’ 중복 참가`); return; }
    used.add(nickname);
    return nickname;
  };
  for (const [i, line] of lines.entries()) {
    const parts = line.includes(",") ? line.split(",") : line.split(/\s+/);
    if (parts.length !== 2 || parts.some((part) => !part.trim())) {
      issues.add(`${i + 1}번째 줄에 두 명을 입력해 주세요. 띄어쓰기가 있는 닉네임은 쉼표로 구분하세요.`);
      continue;
    }
    const a = resolve(parts[0].trim());
    const b = resolve(parts[1].trim());
    if (a && b) pairs.push([a, b]);
  }
  return issues.size ? { error: [...issues].join("\n") } : { pairs };
}
