"use client";

import { parsePastedPairs } from "@/lib/pasted-pairs";
import { estimateRatings, RATING_VERSION } from "@/lib/rating-model";
import { useState, useMemo, useRef, useEffect } from "react";
import { analyzeTeams, buildHistoryIndex, type TeamAnalysis } from "@/lib/team-analysis";
import { BalancePairEditor, type BalancePair } from "./balance-pair-editor";
import { draftHref } from "@/lib/draft";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shuffle, Check, Users, Zap, RefreshCw, AlertTriangle, X, Link2, Unlink, Brain, Swords } from "lucide-react";
import type { PlayerStats } from "@/lib/stats";
import type { Group, Lane } from "@/lib/types";
import {
  getBalancerPlayers,
  balanceOptions,
  balancePairedTeams,
  derivePreferredLanes,
  recentRosters,
  type BalancerPlayer,
  type BalanceResult,
} from "@/lib/stats";

const LANE_EMOJI: Record<string, string> = {
  top: "🛡️", jungle: "🌿", mid: "🔥", adc: "🏹", support: "💚",
};
const LANE_LABEL: Record<string, string> = {
  top: "탑", jungle: "정글", mid: "미드", adc: "원딜", support: "서포터",
};

const TIER_COLORS: Record<string, string> = {
  "아이언": "text-stone-400",
  "브론즈": "text-orange-400",
  "실버": "text-gray-300",
  "골드": "text-yellow-400",
  "플래티넘": "text-teal-300",
  "에메랄드": "text-emerald-400",
  "다이아": "text-blue-400",
  "마스터": "text-purple-400",
  "그랜드마스터": "text-rose-400",
  "챌린저": "text-amber-300",
};

function getTierColor(tier?: string): string {
  if (!tier) return "text-ink-subtle";
  const base = tier.split(" ")[0];
  return TIER_COLORS[base] || "text-ink-subtle";
}

/** 점수 근거 (마우스를 올리면 표시) */
function scoreTitle(p: BalancerPlayer): string {
  const parts = p.parts;
  if (!parts) return "";
  if (!parts.tierKnown) return `내전 성적 ${parts.perfScore} (${p.gamesPlayed}판, 판수가 적을수록 평균 5점 쪽으로 보정)`;
  return `티어 ${parts.tierScore} × ${Math.round((1 - parts.perfWeight) * 100)}% + 내전 성적 ${parts.perfScore} × ${Math.round(parts.perfWeight * 100)}%`;
}

type Pair = { a: string; b: string; kind: "together" | "apart" };

/** 보여 줄 추천 편성 수 (많으면 고르기 어렵다는 의견으로 3개) */
const MAX_OPTIONS = 3;
/** 버튼을 누른 뒤 "계산 중" 표시를 보여 주는 최소 시간. 계산은 즉시 끝나지만 눌렸다는 느낌을 주기 위함 */
const RUN_FEEDBACK_MS = 450;

export function BalanceTab({ playerStats, group, initialMode = "auto" }: { playerStats: PlayerStats[]; group: Group; initialMode?: "auto" | "paired" }) {
  const [ratingMethod, setRatingMethod] = useState<"legacy" | "context">("legacy");
  const [mode, setMode] = useState<"auto" | "paired">(initialMode);
  const [pairText, setPairText] = useState("");
  const [pasteStatus, setPasteStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [balancePairs, setBalancePairs] = useState<BalancePair[]>(Array.from({ length: 5 }, () => ["", ""]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState<BalanceResult[]>([]);
  const [optionIdx, setOptionIdx] = useState(0);
  const [ran, setRan] = useState(false);
  const [avoidRecent, setAvoidRecent] = useState(false);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [pairA, setPairA] = useState("");
  const [pairB, setPairB] = useState("");
  const [pairKind, setPairKind] = useState<Pair["kind"]>("together");
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const result = options[optionIdx] ?? null;
  const history = useMemo(() => buildHistoryIndex(group.matches), [group]);
  const analyses = useMemo(() => options.map((o) => analyzeTeams(o.team1, o.team2, history)), [options, history]);
  const analysis = analyses[optionIdx] ?? null;

  const clearResult = () => {
    if (runTimer.current) clearTimeout(runTimer.current);
    setRunning(false);
    setOptions([]);
    setOptionIdx(0);
    setRan(false);
  };

  useEffect(() => () => { if (runTimer.current) clearTimeout(runTimer.current); }, []);

  // 결과가 나오면 결과 위치로 부드럽게 이동하고 제목에 포커스 (키보드·화면낭독기 사용자도 결과로 바로 이동)
  useEffect(() => {
    if (!runId || !resultRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    resultRef.current.focus({ preventScroll: true });
  }, [runId]);

  // Build tier overrides from member data
  const tierOverrides = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of group.members) {
      if (m.tier) map[m.nickname] = m.tier;
    }
    return map;
  }, [group]);

  // 선호 포지션: 선수 정보 탭에 설정된 값이 있으면 그걸 쓰고,
  // 없으면 전적(라인별 판수)에서 자동 도출해 모든 선수에게 한번에 적용
  const lanePrefs = useMemo(() => {
    const map: Record<string, Lane[]> = {};
    const memberByNick = new Map(group.members.map((m) => [m.nickname, m]));
    for (const p of playerStats) {
      const stored = memberByNick.get(p.nickname)?.preferredLanes;
      if (stored && stored.length > 0) {
        map[p.nickname] = stored;
      } else {
        const derived = derivePreferredLanes(p.laneStats);
        if (derived.length > 0) map[p.nickname] = derived;
      }
    }
    return map;
  }, [group, playerStats]);

  const estimates = useMemo(() => estimateRatings(group), [group]);
  const allPlayers = useMemo(() => {
    const players = getBalancerPlayers(playerStats, tierOverrides, lanePrefs);
    if (ratingMethod === "legacy") return players;
    return players.map((p) => {
      const estimate = estimates.find((r) => r.nickname === p.nickname);
      return estimate ? { ...p, score: estimate.score, tier: estimate.tier } : p;
    });
  }, [playerStats, tierOverrides, lanePrefs, estimates, ratingMethod]);

  const displayTiers = ratingMethod === "legacy" ? tierOverrides : Object.fromEntries(estimates.filter((r) => r.tier).map((r) => [r.nickname, r.tier!]));
  const selectedPlayers = allPlayers.filter((p) => selected.has(p.nickname));
  // 티어를 일부만 입력한 경우에만 안내 (아무도 입력하지 않았으면 전원 내전 전적만으로 공평하게 계산)
  const someTier = selectedPlayers.some((p) => p.parts?.tierKnown);
  const missingTier = someTier ? selectedPlayers.filter((p) => !p.parts?.tierKnown) : [];
  const activePairs = pairs.filter((p) => selected.has(p.a) && selected.has(p.b));

  const labels = Object.fromEntries(allPlayers.map((p) => {
    const realName = group.members.find((m) => m.nickname === p.nickname)?.realName;
    return [p.nickname, realName ? `${realName} (${p.nickname})` : p.nickname];
  }));
  const pairsComplete = selected.size === 10 && new Set(balancePairs.flat().filter(Boolean)).size === 10 &&
    balancePairs.flat().every((name) => selected.has(name));

  const togglePlayer = (nickname: string) => {
    setBalancePairs((prev) => prev.map((pair) => pair.map((name) => name === nickname ? "" : name) as BalancePair));
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nickname)) next.delete(nickname);
      else if (next.size < 10) next.add(nickname);
      return next;
    });
    clearResult();
  };

  const handleBalance = () => {
    const constraints = {
      together: activePairs.filter((p) => p.kind === "together").map((p) => [p.a, p.b] as [string, string]),
      apart: activePairs.filter((p) => p.kind === "apart").map((p) => [p.a, p.b] as [string, string]),
      avoidRosters: avoidRecent ? recentRosters(group.matches, 3) : [],
    };
    const next = mode === "paired"
      ? balancePairedTeams(selectedPlayers, balancePairs, constraints.avoidRosters).slice(0, MAX_OPTIONS)
      : balanceOptions(selectedPlayers, MAX_OPTIONS, constraints);
    if (runTimer.current) clearTimeout(runTimer.current);
    setOptions([]);
    setRan(false);
    setRunning(true);
    runTimer.current = setTimeout(() => {
      setOptions(next);
      setOptionIdx(0);
      setRan(true);
      setRunning(false);
      setRunId((n) => n + 1);
    }, RUN_FEEDBACK_MS);
  };

  const selectAll = () => {
    setBalancePairs(Array.from({ length: 5 }, () => ["", ""]));
    if (selected.size === Math.min(allPlayers.length, 10)) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allPlayers.slice(0, 10).map((p) => p.nickname)));
    }
    clearResult();
  };

  const addPair = () => {
    if (!pairA || !pairB || pairA === pairB) return;
    setPairs((prev) => [
      // 같은 두 사람의 기존 조건은 새 조건으로 바꾼다
      ...prev.filter((p) => !((p.a === pairA && p.b === pairB) || (p.a === pairB && p.b === pairA))),
      { a: pairA, b: pairB, kind: pairKind },
    ]);
    setPairA("");
    setPairB("");
    clearResult();
  };

  const selectedNames = selectedPlayers.map((p) => p.nickname);

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <label className="block text-sm font-semibold" htmlFor="rating-method">점수 모델</label>
        <select id="rating-method" value={ratingMethod} className="w-full rounded-lg border border-hairline bg-surface-1 p-3 text-sm"
          onChange={(e) => { setRatingMethod(e.target.value as "legacy" | "context"); clearResult(); }}>
          <option value="legacy">기존 종합 성적</option>
          <option value="context">상대 전력 모델 · 시험 운영</option>
        </select>
        {ratingMethod === "context" && <>
          <p className="text-xs text-ink-subtle break-keep">{RATING_VERSION} · 현재 솔랭을 기준으로 상대 전력과 승패를 추정합니다. 과거 솔랭과 자유랭은 낮은 신뢰도로 반영합니다. 표본이 적어 시험 운영 중입니다.</p>
          <details className="text-xs">
            <summary className="cursor-pointer py-2">선수별 새 점수와 기존 점수 비교</summary>
            <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left">
              <thead><tr><th className="p-2">선수</th><th>기존</th><th>새 점수</th><th>기준</th><th>지표 보정</th><th>승패 보정</th></tr></thead>
              <tbody>{getBalancerPlayers(playerStats, tierOverrides, lanePrefs).map((p) => {
                const r = estimates.find((entry) => entry.nickname === p.nickname);
                return r && <tr key={p.nickname} className="border-t border-hairline"><td className="p-2">{p.nickname}</td><td>{p.score.toFixed(2)}</td><td>{r.score.toFixed(2)}</td><td>{r.tier || "미확인"} · {r.tierSource}</td><td>{r.performanceAdjustment.toFixed(2)}</td><td>{r.outcomeAdjustment.toFixed(2)}</td></tr>;
              })}</tbody>
            </table></div>
          </details>
        </>}
      </Card>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="팀 편성 방식">
        {([["auto", "자동 팀 편성"], ["paired", "밸런스 짝으로 편성"]] as const).map(([value, label]) => (
          <Button key={value} variant={mode === value ? "primary" : "secondary"}
            className="min-w-0 whitespace-normal px-2" aria-pressed={mode === value} onClick={() => { setMode(value); clearResult(); }}>
            {label}
          </Button>
        ))}
      </div>
      {/* Instructions */}
      <Card className="flex items-start gap-3 py-3 px-4">
        <Users size={18} className="text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-ink-muted break-keep">
          {ratingMethod === "context" ? "시험 모델은 티어 기준값에 같은 포지션 대비 종료 지표와 상대 팀 전력을 고려한 승패를 반영합니다. 아래에서 10명과 밸런스 짝을 선택하세요." : <>참여할 플레이어를 고르면 내전 전적(솔랭 티어를 입력한 사람은 티어도 함께)으로 매긴 점수로 가능한 편성을 모두 비교해 가장 균형 잡힌 팀을 추천하고,
          10명일 때는 선호 포지션까지 고려해 라인을 배정합니다. 선호 포지션은 설정값이 없으면{" "}
          <span className="text-primary">전적(라인별 판수)</span>에서 자동으로 가져옵니다. 점수에 마우스를 올리면 계산 근거가 보입니다.</>}
        </p>
      </Card>

      {mode === "paired" && (
        <Card className="space-y-2">
          <label htmlFor="paste-pairs" className="block text-sm font-semibold">밸런스 짝 붙여넣기</label>
          <p className="text-xs text-ink-muted">한 줄에 두 명씩 5줄을 붙여넣으세요. 이름이나 게임 닉네임을 쓸 수 있어요.</p>
          <textarea id="paste-pairs" rows={5} value={pairText} placeholder={"주영 용태\n문주 보규\n효원 기수\n윤호 찬웅\n재경 동희"}
            className="w-full rounded-lg border border-hairline bg-surface-1 p-3 text-base"
            onChange={(e) => { setPairText(e.target.value); setPasteStatus(null); }} />
          <Button type="button" variant="secondary" disabled={!pairText.trim()} onClick={() => {
            const parsed = parsePastedPairs(pairText, allPlayers.map((p) => p.nickname), group.members);
            if (!parsed.pairs) { setPasteStatus({ text: parsed.error, error: true }); return; }
            setSelected(new Set(parsed.pairs.flat()));
            setBalancePairs(parsed.pairs);
            clearResult();
            setPasteStatus({ text: "10명을 선택하고 밸런스 짝 5개를 적용했어요." });
          }}>참가자와 짝 적용</Button>
          {pasteStatus && <p role={pasteStatus.error ? "alert" : "status"}
            className={`whitespace-pre-line text-sm ${pasteStatus.error ? "text-lose" : "text-ink-muted"}`}>{pasteStatus.text}</p>}
        </Card>
      )}

      {/* Player Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-ink-muted">
            참여자 선택 <span className="text-primary font-bold">{selected.size}</span>/10
          </div>
          <button
            onClick={selectAll}
            className="text-xs text-ink-subtle hover:text-primary cursor-pointer transition-fast"
          >
            {selected.size === Math.min(allPlayers.length, 10) ? "전체 해제" : "전체 선택"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {allPlayers.map((player) => {
            const isSelected = selected.has(player.nickname);
            const memberTier = displayTiers[player.nickname];

            return (
              <button
                type="button"
                aria-pressed={isSelected}
                disabled={!isSelected && selected.size === 10}
                key={player.nickname}
                className={`text-left flex items-center gap-3 p-3 rounded-xl border transition-fast cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isSelected
                    ? "bg-primary/5 border-primary/30"
                    : "bg-surface-1 border-hairline hover:border-hairline-strong"
                }`}
                onClick={() => togglePlayer(player.nickname)}
              >
                <div
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-fast ${
                    isSelected ? "bg-primary border-primary" : "border-hairline"
                  }`}
                >
                  {isSelected && <Check size={12} className="text-white" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium text-ink text-sm break-all">{labels[player.nickname]}</span>
                    {memberTier && (
                      <span className={`text-xs font-bold ${getTierColor(memberTier)}`}>
                        {memberTier}
                      </span>
                    )}
                  </div>
                  {player.gamesPlayed > 0 && (
                    <span className="text-xs text-ink-subtle break-keep">
                      {player.gamesPlayed}판 · {player.winRate.toFixed(0)}% · KDA {player.avgKda.toFixed(2)}
                    </span>
                  )}
                </div>

                <span className="text-xs text-ink-subtle font-mono w-10 text-right shrink-0" title={ratingMethod === "context" ? (() => { const r = estimates.find((x) => x.nickname === player.nickname); return r ? `${r.tierSource} 기준 ${r.baseline.toFixed(2)} + 지표 ${r.performanceAdjustment.toFixed(2)} + 상대 전력·승패 ${r.outcomeAdjustment.toFixed(2)} · 근거 ${r.evidence}` : ""; })() : scoreTitle(player)}>
                  {player.score.toFixed(1)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {mode === "paired" && (
        <Card>
          {selected.size === 10 ? (
            <BalancePairEditor players={selectedPlayers} pairs={balancePairs} labels={labels}
              onChange={(next) => { setBalancePairs(next); clearResult(); }} />
          ) : <p className="text-sm text-ink-subtle">참가자 10명을 선택하면 밸런스 짝을 지정할 수 있습니다. ({selected.size}/10)</p>}
        </Card>
      )}

      {/* Options */}
      <Card className="space-y-3">
        <div className="text-sm font-semibold text-ink">편성 옵션</div>
        <label className="flex items-start gap-2 text-sm text-ink-muted cursor-pointer break-keep">
          <input
            type="checkbox"
            checked={avoidRecent}
            onChange={(e) => {
              setAvoidRecent(e.target.checked);
              clearResult();
            }}
            className="mt-1 accent-[var(--primary)]"
          />
          <span>최근 3경기와 똑같은 팀 구성은 피하기 (같은 멤버로 연달아 할 때 매번 같은 팀이 나오지 않게)</span>
        </label>

        {mode === "auto" && <div className="space-y-2">
          <div className="text-xs text-ink-subtle">두 사람 고정</div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <select
              value={pairA}
              onChange={(e) => setPairA(e.target.value)}
              aria-label="첫 번째 선수"
              className="min-w-0 w-full sm:w-40 bg-surface-1 border border-hairline rounded-lg px-2 py-1.5 text-sm text-ink"
            >
              <option value="">선수 선택</option>
              {selectedNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select
              value={pairB}
              onChange={(e) => setPairB(e.target.value)}
              aria-label="두 번째 선수"
              className="min-w-0 w-full sm:w-40 bg-surface-1 border border-hairline rounded-lg px-2 py-1.5 text-sm text-ink"
            >
              <option value="">선수 선택</option>
              {selectedNames.filter((n) => n !== pairA).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="flex rounded-lg border border-hairline overflow-hidden text-xs justify-self-start">
              {(["together", "apart"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setPairKind(k)}
                  className={`px-3 py-1.5 cursor-pointer whitespace-nowrap ${pairKind === k ? "bg-primary/15 text-primary" : "text-ink-subtle hover:text-ink"}`}
                >
                  {k === "together" ? "같은 팀" : "다른 팀"}
                </button>
              ))}
            </div>
            <Button size="sm" variant="secondary" className="justify-self-end sm:justify-self-auto" onClick={addPair} disabled={!pairA || !pairB || pairA === pairB}>
              추가
            </Button>
          </div>
          {selectedNames.length < 2 && <p className="text-xs text-ink-tertiary">참여자를 먼저 선택하세요.</p>}
          {pairs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pairs.map((p) => {
                const active = selected.has(p.a) && selected.has(p.b);
                return (
                  <span
                    key={`${p.a}|${p.b}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs max-w-full ${
                      active ? "border-primary/30 bg-primary/10 text-ink" : "border-hairline text-ink-tertiary line-through"
                    }`}
                    title={active ? undefined : "둘 중 한 명이 참여자가 아니라 적용되지 않음"}
                  >
                    {p.kind === "together" ? <Link2 size={12} className="shrink-0" /> : <Unlink size={12} className="shrink-0" />}
                    <span className="truncate">{p.a} · {p.b} {p.kind === "together" ? "같은 팀" : "다른 팀"}</span>
                    <button
                      aria-label="조건 삭제"
                      onClick={() => {
                        setPairs((prev) => prev.filter((x) => x !== p));
                        clearResult();
                      }}
                      className="text-ink-tertiary hover:text-ink cursor-pointer shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>}
      </Card>

      {missingTier.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-mvp/30 bg-mvp/5 px-3 py-2.5 text-xs text-ink-muted break-keep">
          <AlertTriangle size={14} className="text-mvp shrink-0 mt-0.5" />
          <span>
            선택한 {selected.size}명 중 {missingTier.length}명만 솔랭 티어가 없어 내전 전적만으로 계산합니다
            ({missingTier.slice(0, 5).map((p) => p.nickname).join(", ")}{missingTier.length > 5 ? " 외" : ""}).
            티어를 쓸 거면 참가자 모두 입력하는 게 공평합니다.
          </span>
        </div>
      )}

      {/* Balance Button */}
      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={handleBalance}
          aria-busy={running}
          disabled={running || (mode === "paired" ? !pairsComplete : selected.size < 2 || selected.size % 2 !== 0)}
        >
          {running ? <RefreshCw size={18} className="animate-spin" /> : <Shuffle size={18} />}
          {running ? "팀 짜는 중…" : mode === "paired" ? "짝으로 팀 짜기" : `팀 짜기 (${selected.size}명)`}
        </Button>
      </div>

      {mode === "paired" && selected.size === 10 && !pairsComplete && (
        <p className="text-xs text-center text-ink-subtle">짝을 5개 모두 지정해 주세요. (현재 {balancePairs.filter(([a, b]) => a && b).length}/5)</p>
      )}
      {selected.size > 0 && selected.size % 2 !== 0 && (
        <p className="text-xs text-center text-ink-subtle">짝수 인원만 밸런스를 맞출 수 있습니다</p>
      )}

      {ran && options.length === 0 && (
        <p className="text-sm text-center text-lose break-keep">
          {mode === "paired" ? "최근 경기 제외 조건 때문에 가능한 편성이 없습니다. 최근 3경기와 같은 팀 피하기를 해제해 주세요." : "조건을 모두 만족하는 편성이 없습니다. 고정 조건이나 최근 경기와 같은 팀 피하기를 줄여 보세요."}
        </p>
      )}

      {mode === "paired" && pairsComplete && (
        <p className="text-xs text-center text-ink-subtle break-keep">
          각 짝을 블루/레드로 나누는 모든 경우를 비교해 점수 차이가 작은 상위 {MAX_OPTIONS}개를 추천합니다
          (동점이면 포지션 만족도가 높은 순).
        </p>
      )}

      {/* 계산 중 자리 표시 (결과가 나올 자리에 미리 보여 버튼이 동작한다는 걸 알 수 있게) */}
      {running && (
        <div className="space-y-3" aria-live="polite">
          <p className="flex items-center justify-center gap-2 text-sm text-ink-muted">
            <RefreshCw size={14} className="animate-spin text-primary" /> 가능한 편성을 비교하는 중…
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl border border-hairline bg-surface-1" />)}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div key={runId} ref={resultRef} tabIndex={-1} className="result-reveal space-y-4 scroll-mt-28 outline-none" aria-label="팀 편성 결과">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Zap size={16} className="text-primary shrink-0" />
              {options.length > 1 ? `추천 편성 ${options.length}개` : "팀 편성 완료"}
            </span>
            <span className="text-xs text-ink-subtle whitespace-nowrap">
              점수 차이 <span className="text-primary font-bold">{result.diff.toFixed(2)}</span>
            </span>
            {result.team1.some((p) => p.assignedLane) && (
              <span className="text-xs text-ink-subtle whitespace-nowrap" title="모두 1순위 포지션이면 100%">
                포지션 만족도 <span className="text-primary font-bold">{result.laneFit}%</span>
              </span>
            )}
          </div>

          {options.length > 1 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="group" aria-label="추천 편성 선택">
              {options.map((option, index) => {
                const a = analyses[index];
                return (
                  <button key={index} type="button" aria-pressed={optionIdx === index} onClick={() => setOptionIdx(index)}
                    className={`min-w-0 rounded-lg border px-2 py-2 text-left text-xs transition-fast cursor-pointer ${
                      optionIdx === index ? "border-primary bg-primary/10 text-ink" : "border-hairline bg-surface-1 text-ink-subtle hover:border-hairline-strong"
                    }`}>
                    <div className="font-semibold">{index + 1}안{index === 0 && <span className="ml-1 text-primary-hover">추천</span>}</div>
                    <div className="truncate">차이 {option.diff.toFixed(2)}<span className="hidden sm:inline"> · </span><br className="sm:hidden" />포지션 {option.laneFit}%</div>
                    {a && <div className={`truncate ${verdictColor(a)}`}>{a.label}</div>}
                  </button>
                );
              })}
            </div>
          )}

          {hasDraft(result) && (
            <a href={resultDraftHref(result)} target="_blank" rel="noopener"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover">
              <Swords size={16} /> 이 팀으로 밴픽 에이전트 열기
            </a>
          )}
          <CopyLineup key={optionIdx} result={result} optionNumber={optionIdx + 1} />
          {analysis && <VerdictCard analysis={analysis} />}

          {mode === "paired" && (
            <div className="flex flex-wrap justify-center gap-1.5 text-xs" aria-label="짝별 배치">
              {balancePairs.filter(([a, b]) => a && b).map(([a, b], index) => {
                const blue = result.team1.some((p) => p.nickname === a) ? a : b;
                const red = blue === a ? b : a;
                return <span key={index} className="inline-flex max-w-full items-center gap-1 rounded-md border border-hairline bg-surface-1 px-2 py-1">
                  <span className="truncate text-blue-400">{blue}</span>
                  <span className="text-ink-tertiary">⇄</span>
                  <span className="truncate text-red-400">{red}</span>
                </span>;
              })}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TeamCard team={result.team1} label="블루팀" color="blue" tiers={displayTiers} experimental={ratingMethod === "context"} />
            <TeamCard team={result.team2} label="레드팀" color="red" tiers={displayTiers} experimental={ratingMethod === "context"} />
          </div>
        </div>
      )}
    </div>
  );
}

/** 10명 모두 라인이 정해진 편성인지 (밴픽 에이전트는 라인별 5:5 가 필요) */
function hasDraft(result: BalanceResult): boolean {
  return result.team1.length === 5 && result.team2.length === 5 && [...result.team1, ...result.team2].every((p) => p.assignedLane);
}

function resultDraftHref(result: BalanceResult): string {
  const slots = (t: BalancerPlayer[]) => t.map((p) => ({ nickname: p.nickname, lane: p.assignedLane! }));
  return draftHref(slots(result.team1), slots(result.team2));
}

function CopyLineup({ result, optionNumber }: { result: BalanceResult; optionNumber: number }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [fullMessage, setFullMessage] = useState("");
  const formatTeam = (label: string, players: BalancerPlayer[]) => [
    label,
    ...players.map((p) => p.assignedLane ? `${LANE_LABEL[p.assignedLane]} · ${p.nickname}` : p.nickname),
  ].join("\n");
  const message = [
    `컴학내전 팀 편성 · ${optionNumber}안`,
    formatTeam("🔵 블루팀", result.team1),
    formatTeam("🔴 레드팀", result.team2),
  ].join("\n\n");

  async function copy() {
    const text = hasDraft(result) ? `${message}\n\n⚔️ 밴픽 에이전트\n${window.location.origin}${resultDraftHref(result)}` : message;
    setFullMessage(text);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("manual");
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" className="w-full" onClick={copy}>
        카톡용 결과 복사
      </Button>
      <p role="status" className="text-sm text-ink-muted">
        {status === "copied" && "복사했어요. 카톡 채팅창에 붙여넣으세요."}
        {status === "manual" && "아래 내용을 길게 눌러 복사한 뒤 카톡에 붙여넣으세요."}
      </p>
      {status === "manual" && <textarea aria-label="카톡용 팀 편성 결과" readOnly value={fullMessage || message}
        onFocus={(e) => e.currentTarget.select()} rows={8}
        className="w-full rounded-lg border border-hairline bg-surface-1 p-3 text-sm" />}
    </div>
  );
}

function TeamCard({
  team,
  label,
  color,
  tiers,
  experimental = false,
}: {
  team: BalancerPlayer[];
  label: string;
  color: "blue" | "red";
  tiers: Record<string, string>;
  experimental?: boolean;
}) {
  const total = team.reduce((s, p) => s + p.score, 0);
  const borderColor = color === "blue" ? "border-blue-500/30" : "border-red-500/30";
  const labelBg = color === "blue" ? "bg-blue-500/10 text-blue-400" : "bg-red-500/10 text-red-400";

  return (
    <Card className={`border-l-4 ${borderColor} min-w-0`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${labelBg}`}>{label}</span>
        <span className="text-xs text-ink-subtle font-mono">총 {total.toFixed(1)}점</span>
      </div>
      <div className="space-y-2">
        {team.map((p) => (
          <div key={p.nickname} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {p.assignedLane && (
                <span
                  className="text-xs w-14 shrink-0 text-ink-muted"
                  title={p.preferredLanes?.length ? `선호: ${p.preferredLanes.map((l) => LANE_LABEL[l]).join(" > ")}` : "선호 포지션 미설정"}
                >
                  {LANE_EMOJI[p.assignedLane]} {LANE_LABEL[p.assignedLane]}
                </span>
              )}
              <span className="font-medium text-ink break-all">{p.nickname}</span>
              {tiers[p.nickname] && (
                <span className={`text-xs font-bold ${getTierColor(tiers[p.nickname])}`}>
                  {tiers[p.nickname]}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-subtle ml-auto whitespace-nowrap">
              {p.gamesPlayed > 0 && (
                <>
                  <span>{p.winRate.toFixed(0)}%</span>
                  <span>KDA {p.avgKda.toFixed(2)}</span>
                </>
              )}
              <span className="font-mono" title={experimental ? "상대 전력 시험 모델 · 선수별 비교표에서 계산 근거 확인" : scoreTitle(p)}>{p.score.toFixed(1)}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function verdictColor(a: TeamAnalysis): string {
  if (a.favored === "blue") return "text-blue-400";
  if (a.favored === "red") return "text-red-400";
  return "text-ink-muted";
}

/** 우세/열세 판정 카드: 예상 승률 막대 + 영향이 큰 이유 최대 3개 */
function VerdictCard({ analysis }: { analysis: TeamAnalysis }) {
  const blue = Math.round(analysis.blueWinProb * 100);
  const red = 100 - blue;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Brain size={15} className="text-primary shrink-0" /> AI 판정
          <span className={`ml-1 ${verdictColor(analysis)}`}>{analysis.label}</span>
        </span>
        <span className="text-xs text-ink-subtle font-mono">블루 {blue}% : {red}% 레드</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`예상 승률 블루 ${blue}%, 레드 ${red}%`}>
        <div className="bg-blue-500/80 transition-all duration-500" style={{ width: `${blue}%` }} />
        <div className="bg-red-500/80 transition-all duration-500" style={{ width: `${red}%` }} />
      </div>
      {analysis.reasons.length > 0 ? (
        <ul className="space-y-1 text-xs text-ink-muted">
          {analysis.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 break-keep">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${r.favors === "blue" ? "bg-blue-400" : "bg-red-400"}`} aria-hidden="true" />
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-subtle">눈에 띄는 차이가 없습니다.</p>
      )}
      <p className="text-[11px] text-ink-tertiary break-keep">
        내전 기록(팀 점수 합·비선호 라인·팀원 궁합·맞라인 상대 전적)으로 계산한 예상치입니다.
        {analysis.sparseHistory && " 이번 편성의 판정에 쓰인 조합 기록이 적습니다."}
        {analysis.lowSample.length > 0 && ` 판수가 적은 선수(${analysis.lowSample.slice(0, 4).join(", ")}${analysis.lowSample.length > 4 ? " 외" : ""})가 있어 신뢰도가 낮습니다.`}
      </p>
    </Card>
  );
}
