import { describe, expect, it } from "vitest";
import { adviseDraft, buildDraftIndex, evaluateComp, playerCandidates, type DraftState } from "./draft";
import { resolveChampionInput } from "./champions";
import type { Lane, Match } from "./types";

const LANES: Lane[] = ["top", "jungle", "mid", "adc", "support"];

/** blue/red: [닉네임, 챔피언] 5개씩 (탑→서폿 순) */
function match(id: string, blue: [string, string][], red: [string, string][], blueWin: boolean): Match {
  return {
    id, groupId: "main", createdAt: "2026-11-01T00:00:00Z", gameDuration: "30:00",
    players: [
      ...blue.map(([n, c], i) => ({ nickname: n, champion: c, team: "blue", win: blueWin, lane: LANES[i] })),
      ...red.map(([n, c], i) => ({ nickname: n, champion: c, team: "red", win: !blueWin, lane: LANES[i] })),
    ] as unknown as Match["players"],
  };
}

const A: [string, string][] = [["탑돌이", "다리우스"], ["정글러", "자르반 4세"], ["미드장인", "아리"], ["원딜러", "징크스"], ["서폿러", "레오나"]];
const B: [string, string][] = [["상대탑", "가렌"], ["상대정글", "리 신"], ["상대미드", "제드"], ["상대원딜", "이즈리얼"], ["상대서폿", "쓰레쉬"]];

const matches = [
  match("1", A, B, true),
  match("2", A, B, true),
  match("3", A.map(([n, c], i) => [n, i === 0 ? "가렌" : c]), B, false),
  match("4", B, A, false),
];
const index = buildDraftIndex(matches);
const ours = A.map(([nickname], i) => ({ nickname, lane: LANES[i] }));
const theirs = B.map(([nickname], i) => ({ nickname, lane: LANES[i] }));
const base: DraftState = { ours, theirs, ourBans: [], theirBans: [], ourPicks: {}, theirPicks: {} };

describe("밴픽 도우미", () => {
  it("선수가 그 라인에서 많이 하고 이긴 챔피언을 먼저 추천", () => {
    const c = playerCandidates(index, ours[0], new Set());
    expect(c[0].champion).toBe("다리우스");
    expect(c[0].games).toBe(3);
  });

  it("밴된 챔피언은 후보에서 빠지고, 해 본 챔피언이 없으면 내전 기록으로 대안", () => {
    const c = playerCandidates(index, ours[2], new Set(["아리"]));
    expect(c.some((x) => x.champion === "아리")).toBe(false);
    expect(c[0].isNew).toBe(true);
    expect(c[0].champion).toBe("제드");
  });

  it("다른 라인 전용 챔피언은 해 본 적 없으면 추천하지 않음", () => {
    const c = playerCandidates(index, { nickname: "원딜러", lane: "top" }, new Set());
    expect(c.some((x) => x.champion === "징크스")).toBe(false);
  });

  it("추천 조합은 밴·상대 픽을 피하고 확정 픽은 유지", () => {
    const adv = adviseDraft(index, { ...base, ourBans: ["리 신"], theirBans: ["다리우스"], ourPicks: { 서폿러: "레오나" }, theirPicks: { 상대미드: "아리" } });
    const best = adv.options[0];
    expect(best).toBeDefined();
    const champs = best.picks.map((p) => p.champion);
    expect(champs).not.toContain("다리우스");
    expect(champs).not.toContain("아리");
    expect(best.picks.find((p) => p.nickname === "서폿러")?.champion).toBe("레오나");
    expect(new Set(champs).size).toBe(5);
  });

  it("밴 추천은 상대 선수 주력 챔피언", () => {
    const adv = adviseDraft(index, base);
    expect(adv.banSuggestions.length).toBeGreaterThan(0);
    expect(adv.banSuggestions.every((b) => theirs.some((t) => t.nickname === b.target))).toBe(true);
    const banned = adviseDraft(index, { ...base, theirPicks: Object.fromEntries(B.map(([n, c]) => [n, c])) });
    expect(banned.banSuggestions).toHaveLength(0); // 다 뽑았으면 밴할 이유 없음
  });

  it("조합 평가: AD 몰빵·앞라인 부족을 지적", () => {
    const allAd = evaluateComp(["제드", "카직스", "탈론", "징크스", "파이크"]);
    expect(allAd.notes.some((n) => !n.good && n.text.includes("AD"))).toBe(true);
    expect(allAd.notes.some((n) => !n.good && n.text.includes("앞라인"))).toBe(true);
    const good = evaluateComp(["오른", "자르반 4세", "아리", "징크스", "레오나"]);
    expect(good.score).toBe(0);
  });

  it("챔피언 입력: 띄어쓰기·영문 허용", () => {
    expect(resolveChampionInput("리신")).toBe("리 신");
    expect(resolveChampionInput("leesin")).toBe("리 신");
    expect(resolveChampionInput("누누")).toBe("누누와 윌럼프");
    expect(resolveChampionInput("없는챔")).toBeNull();
  });
});

describe("순서대로 밴픽", () => {
  it("드래프트 순서는 밴 10·픽 10", async () => {
    const { DRAFT_SEQUENCE } = await import("./draft");
    expect(DRAFT_SEQUENCE).toHaveLength(20);
    expect(DRAFT_SEQUENCE.filter((s) => s.kind === "pick" && s.side === "blue")).toHaveLength(5);
    expect(DRAFT_SEQUENCE[6]).toEqual({ side: "blue", kind: "pick" });
    expect(DRAFT_SEQUENCE[12]).toEqual({ side: "red", kind: "ban" });
  });

  it("다음 픽 추천은 남은 챔피언만, 상대 픽 주인은 그 라인에서 해 본 선수", async () => {
    const { suggestNextPicks, guessPickOwner } = await import("./draft");
    const state = { ...base, theirPicks: { 상대미드: "아리" } };
    const s = suggestNextPicks(index, state, adviseDraft(index, state));
    expect(s.length).toBeGreaterThan(0);
    expect(s.some((x) => x.champion === "아리")).toBe(false);
    expect(guessPickOwner(index, "쓰레쉬", theirs)?.nickname).toBe("상대서폿");
    expect(guessPickOwner(index, "다리우스", theirs.slice(1))?.lane).toBe("jungle"); // 탑이 없으면 남은 자리로
  });
});

describe("밴픽 주소", () => {
  it("만든 주소를 다시 읽으면 같은 팀·라인", async () => {
    const { draftHref, parseDraftQuery } = await import("./draft");
    const href = draftHref([...ours].reverse(), theirs);
    const parsed = parseDraftQuery(href.split("?")[1]);
    expect(parsed?.blue).toEqual(ours);
    expect(parsed?.red).toEqual(theirs);
    expect(parseDraftQuery("b=a&r=b")).toBeNull();
  });
});
