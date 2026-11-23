import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { estimateRatings, predictBlueWin, validRatingMatch, type RatingConfig } from "./rating-model";
import { applyRoleRelativeAwards } from "./mvp";
import { rowToMatch, kstDate } from "./match-normalize";
import { buildPlayerStats, getBalancerPlayers } from "./stats";
import type { Group, Match } from "./types";

// 개인 DB 덤프는 저장소에 포함하지 않는다. 환경변수로 로컬 읽기 경로를 지정해 재현한다.
it.skipIf(!process.env.RATING_DATA)("시간순 경기일 분리 검증과 선수별 비교표", () => {
  const data = JSON.parse(readFileSync(process.env.RATING_DATA!, "utf8"));
  const matches: Match[] = data.matches.filter((m: { review_status?: string }) => !m.review_status)
    .map(rowToMatch).filter(validRatingMatch).sort((a: Match, b: Match) => a.createdAt.localeCompare(b.createdAt));
  const members = data.members.map((m: { nickname: string; tier?: string }) => ({ ...m, id: m.nickname, groupId: "컴학내전", joinedAt: "" }));
  const group: Group = { id: "컴학내전", name: "컴학내전", createdAt: "", inviteCode: "", members, matches: applyRoleRelativeAwards(matches) };
  const days = [...new Set(matches.map((m) => kstDate(m.createdAt)))];
  const configs: RatingConfig[] = [0.5, 1, 2].map((regularization) => ({ scale: 0.4, halfLifeDays: 120, regularization }));
  const rows = days.flatMap((day) => {
    const training = matches.filter((m) => kstDate(m.createdAt) < day);
    if (training.length < 10) return [];
    const test = matches.filter((m) => kstDate(m.createdAt) === day);
    const asOf = Date.parse(`${day}T00:00:00+09:00`);
    const before = { ...group, matches: applyRoleRelativeAwards(training), members: members.map((m: { tier?: string }) => ({ ...m, tier: undefined })) };
    const legacy = getBalancerPlayers(buildPlayerStats(before), {});
    return test.map((match) => {
      const oldDiff = match.players.reduce((sum, p) => sum + (p.team === "blue" ? 1 : -1) * (legacy.find((x) => x.nickname === p.nickname)?.score ?? 5), 0);
      return { day, y: Number(match.players.find((p) => p.team === "blue")!.win),
        predictions: [0.5, 1 / (1 + Math.exp(-0.4 * oldDiff)), ...configs.map((config) => predictBlueWin(match, estimateRatings(before, { asOf, allowManual: false, config })))] };
    });
  });
  const testStart = days[Math.floor(days.length * 0.8)];
  const metrics = (subset: typeof rows, index: number) => ({ games: subset.length,
    brier: subset.reduce((sum, r) => sum + (r.predictions[index] - r.y) ** 2, 0) / subset.length,
    logLoss: subset.reduce((sum, r) => sum - r.y * Math.log(r.predictions[index]) - (1 - r.y) * Math.log(1 - r.predictions[index]), 0) / subset.length });
  const development = rows.filter((r) => r.day < testStart);
  const holdout = rows.filter((r) => r.day >= testStart);
  const selected = configs.map((config, i) => ({ config, i, loss: metrics(development, i + 2).logLoss })).sort((a, b) => a.loss - b.loss)[0];
  const fitted = estimateRatings(group, { config: selected.config });
  const legacy = getBalancerPlayers(buildPlayerStats(group), {});
  const report = { version: "context-v1", config: selected.config, totalMatches: matches.length, testStart,
    development: configs.map((config, i) => ({ config, ...metrics(development, i + 2) })),
    holdout: { neutral: metrics(holdout, 0), legacy: metrics(holdout, 1), candidate: metrics(holdout, selected.i + 2) },
    players: fitted.map((r) => ({ ...r, previousScore: legacy.find((p) => p.nickname === r.nickname)?.score ?? null })) };
  writeFileSync(process.env.RATING_REPORT || "/tmp/knucse-rating-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ config: report.config, matches: matches.length, holdout: report.holdout }));
});
