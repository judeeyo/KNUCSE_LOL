import { expect, it } from "vitest";
import { parsePastedPairs } from "./pasted-pairs";
import type { Member } from "./types";

const members: Member[] = [{ id: "1", nickname: "내전 계정", realName: "이주영, 주디", aliases: ["부캐"], groupId: "main", joinedAt: "" }];
const names = ["내전 계정", ...Array.from({ length: 9 }, (_, i) => `P${i + 1}`)];
const rest = "\nP2 P3\nP4 P5\nP6 P7\nP8 P9";
it("등록된 이름과 별칭으로 같은 선수를 찾는다", () => {
  for (const token of ["주영", "이주영", "주디", "부캐", "내전 계정"]) {
    expect(parsePastedPairs(`${token}, p1${rest}`, names, members).pairs?.[0]).toEqual(["내전 계정", "P1"]);
  }
});
it("다른 이름으로 같은 선수를 두 번 넣거나 동명이인이 있으면 적용을 막는다", () => {
  expect(parsePastedPairs(`주영 부캐${rest}`, names, members).error).toContain("중복");
  const collision = [...members, { ...members[0], nickname: "P1", realName: "박주영" }];
  expect(parsePastedPairs(`주영 P1${rest}`, names, collision).error).toContain("후보 여러 명");
});
