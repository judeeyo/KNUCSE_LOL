"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { updateMemberProfile, mergeAliases, renameMember, deleteMember } from "@/lib/store";
import { ChampionIcon } from "@/components/ui/champion-icon";
import { RadarChart } from "@/components/ui/radar-chart";
import { buildRadarStats, derivePreferredLanes } from "@/lib/stats";
import { Save, Edit3, User, X, Link, Trash2, Wand2 } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import type { Group, Member, Lane } from "@/lib/types";
import type { PlayerStats } from "@/lib/stats";

const LANES: { key: Lane; label: string; emoji: string }[] = [
  { key: "top", label: "탑", emoji: "🛡️" },
  { key: "jungle", label: "정글", emoji: "🌿" },
  { key: "mid", label: "미드", emoji: "🔥" },
  { key: "adc", label: "원딜", emoji: "🏹" },
  { key: "support", label: "서포터", emoji: "💚" },
];

const LANE_LABEL: Record<string, string> = {
  top: "탑", jungle: "정글", mid: "미드", adc: "원딜", support: "서포터",
};

const TIERS = [
  "실버 4", "실버 3", "실버 2", "실버 1",
  "골드 4", "골드 3", "골드 2", "골드 1",
  "플래티넘 4", "플래티넘 3", "플래티넘 2", "플래티넘 1",
  "에메랄드 4", "에메랄드 3", "에메랄드 2", "에메랄드 1",
  "다이아 4", "다이아 3", "다이아 2", "다이아 1",
  "마스터",
];

const TIER_COLORS: Record<string, string> = {
  "실버": "text-gray-300",
  "골드": "text-yellow-400",
  "플래티넘": "text-teal-300",
  "에메랄드": "text-emerald-400",
  "다이아": "text-blue-400",
  "마스터": "text-purple-400",
};

function getTierColor(tier?: string): string {
  if (!tier) return "text-ink-subtle";
  const base = tier.split(" ")[0];
  return TIER_COLORS[base] || "text-ink-subtle";
}

export function PlayerInfoTab({
  group,
  playerStats,
  onUpdate,
}: {
  group: Group;
  playerStats: PlayerStats[];
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editTier, setEditTier] = useState("");
  const [editLanes, setEditLanes] = useState<Lane[]>([]);
  const [editRealName, setEditRealName] = useState("");
  const [editNewNickname, setEditNewNickname] = useState("");
  const [showMerge, setShowMerge] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeAlias, setMergeAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoLanes, setAutoLanes] = useState(false);
  const [search, setSearch] = useState("");

  // 전적(라인별 판수) 기반으로 모든 멤버의 선호 포지션을 다시 설정 (기존 수동 설정 덮어쓰기)
  const handleAutoLanes = async () => {
    if (
      !confirm(
        "전적(라인별 판수) 기반으로 모든 선수의 선호 포지션을 다시 설정합니다.\n기존에 수동으로 설정한 포지션은 덮어쓰여집니다. 진행할까요?"
      )
    )
      return;
    setAutoLanes(true);
    const statByNick = new Map(playerStats.map((p) => [p.nickname, p]));
    let updated = 0;
    for (const m of group.members) {
      const st = statByNick.get(m.nickname);
      if (!st) continue;
      const lanes = derivePreferredLanes(st.laneStats);
      if (lanes.length === 0) continue;
      await updateMemberProfile(m.nickname, { preferredLanes: lanes });
      updated++;
    }
    setAutoLanes(false);
    onUpdate();
    alert(`${updated}명의 선호 포지션을 전적 기반으로 설정했습니다.`);
  };

  const openEdit = (member: Member) => {
    setEditing(member.nickname);
    setEditTier(member.tier || "");
    setEditLanes(member.preferredLanes || []);
    setEditRealName(member.realName || "");
    setEditNewNickname(member.nickname);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);

    // 닉네임 변경 시
    if (editNewNickname && editNewNickname !== editing) {
      await renameMember(editing, editNewNickname);
    }

    const targetNickname = editNewNickname || editing;
    await updateMemberProfile(targetNickname, {
      tier: editTier,
      preferredLanes: editLanes,
      realName: editRealName,
    });
    setEditing(null);
    setSaving(false);
    onUpdate();
  };

  const handleDelete = async (nickname: string) => {
    if (!confirm(`"${nickname}" 선수를 삭제하시겠습니까? 매치 기록에서 해당 닉네임이 [삭제]로 표시됩니다.`)) return;
    await deleteMember(nickname);
    onUpdate();
  };

  const toggleLane = (lane: Lane) => {
    setEditLanes((prev) => {
      if (prev.includes(lane)) {
        return prev.filter((l) => l !== lane);
      }
      return [...prev, lane];
    });
  };

  const handleMerge = async () => {
    if (!mergeTarget || !mergeAlias) return;
    const renamed = await mergeAliases(mergeTarget, mergeAlias);
    setShowMerge(false);
    setMergeTarget("");
    setMergeAlias("");
    onUpdate();
    alert(
      renamed > 0
        ? `${mergeAlias} → ${mergeTarget} 통합 완료 (${renamed}경기 기록 이동)`
        : `${mergeAlias} → ${mergeTarget} 통합했지만 이동된 경기 기록이 없습니다.\n부캐 닉네임이 매치 기록과 정확히 일치하는지 확인해주세요.`
    );
  };

  // 통합 대상 목록: 멤버 + 매치 기록에만 존재하는 닉네임(멤버 등록 누락, [삭제] 처리된 기록 등)까지 포함
  const mergeCandidates = Array.from(
    new Set([...group.members.map((m) => m.nickname), ...playerStats.map((p) => p.nickname)])
  ).sort((a, b) => a.localeCompare(b, "ko"));

  const radarStats = useMemo(() => buildRadarStats(group), [group]);

  const players = playerStats.map((ps) => {
    const member = group.members.find((m) => m.nickname === ps.nickname);
    return {
      ...ps,
      tier: member?.tier,
      preferredLanes: member?.preferredLanes,
      realName: member?.realName,
      aliases: member?.aliases,
      radar: radarStats.get(ps.nickname),
    };
  });

  // 닉네임·실명·부캐 닉네임으로 검색
  const query = search.trim().toLowerCase();
  const visiblePlayers = query
    ? players.filter(
        (p) =>
          p.nickname.toLowerCase().includes(query) ||
          (p.realName || "").toLowerCase().includes(query) ||
          (p.aliases || []).some((a) => a.toLowerCase().includes(query))
      )
    : players;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="text-sm text-ink-muted break-keep min-w-0">
          선수별 정보를 관리하세요. 티어와 선호 라인은 팀 밸런스에 반영됩니다.
        </p>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <SearchInput
            className="w-full sm:w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="선수 검색 (닉네임·실명·부캐)"
          />
          <Button variant="secondary" size="sm" onClick={handleAutoLanes} disabled={autoLanes}>
            <Wand2 size={14} />
            {autoLanes ? "설정 중..." : "전적 기반 포지션"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowMerge(true)}>
            <Link size={14} />
            아이디 통합
          </Button>
        </div>
      </div>

      {visiblePlayers.length === 0 && (
        <p className="text-center py-8 text-ink-subtle text-sm">&quot;{search}&quot; 검색 결과가 없습니다</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visiblePlayers.map((player) => (
          <Card key={player.nickname} className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                {player.champions.length > 0 ? (
                  <div title={`모스트: ${player.champions[0].champion}`}>
                    <ChampionIcon name={player.champions[0].champion} size={36} className="rounded-xl" />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-surface-1 flex items-center justify-center">
                    <User size={16} className="text-ink-subtle" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-ink text-sm">{player.nickname}</span>
                    {player.realName && (
                      <span className="text-xs text-ink-subtle">({player.realName})</span>
                    )}
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {player.gamesPlayed}판 · 승률 {player.winRate.toFixed(0)}%
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  const member = group.members.find((m) => m.nickname === player.nickname);
                  if (member) openEdit(member);
                }}
                className="p-1.5 rounded-lg text-ink-subtle hover:text-primary hover:bg-primary/10 transition-fast cursor-pointer"
              >
                <Edit3 size={14} />
              </button>
            </div>

            {/* Aliases */}
            {player.aliases && player.aliases.length > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-ink-subtle w-12">부캐</span>
                <div className="flex flex-wrap gap-1">
                  {player.aliases.map((alias) => (
                    <span key={alias} className="text-xs px-1.5 py-0.5 rounded bg-surface-1 text-ink-muted">
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Most Champions */}
            {player.champions.length > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-ink-subtle w-12">모스트</span>
                <div className="flex flex-wrap gap-2">
                  {player.champions.slice(0, 3).map((c) => (
                    <div
                      key={c.champion}
                      className="flex items-center gap-1"
                      title={`${c.champion} · ${c.games}판 · 승률 ${c.winRate.toFixed(0)}% · KDA ${c.avgKda.toFixed(2)}`}
                    >
                      <ChampionIcon name={c.champion} size={20} />
                      <span className="text-xs text-ink-muted">{c.games}판</span>
                      <span className={`text-xs ${c.winRate >= 50 ? "text-win" : "text-lose"}`}>
                        {c.winRate.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tier */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-ink-subtle w-12">티어</span>
              {player.tier ? (
                <span className={`text-sm font-bold ${getTierColor(player.tier)}`}>
                  {player.tier}
                </span>
              ) : (
                <span className="text-xs text-ink-subtle">미설정</span>
              )}
            </div>

            {/* Preferred Lanes (ordered) */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-ink-subtle w-12">포지션</span>
              {player.preferredLanes && player.preferredLanes.length > 0 ? (
                <div className="flex gap-1">
                  {player.preferredLanes.map((lane, i) => {
                    const l = LANES.find((la) => la.key === lane);
                    return (
                      <span
                        key={lane}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium"
                      >
                        <span className="text-[10px] text-primary/60">{i + 1}</span>
                        {l?.emoji} {l?.label}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs text-ink-subtle">미설정</span>
              )}
            </div>

            {/* 5각 스탯 */}
            {player.radar && player.gamesPlayed >= 2 && (
              <div className="border-t border-hairline pt-2 mb-1">
                <div className="text-xs text-ink-subtle mb-1">능력치 (그룹 내 백분위)</div>
                <div className="flex justify-center">
                  <RadarChart
                    size={210}
                    axes={[
                      { label: "골드차이", value: player.radar.goldDiff, hint: "같은 포지션 상대 대비 분당 골드 차이 (포지션 미상이면 상대팀 평균)" },
                      { label: "전투", value: player.radar.combat, hint: player.radar.damageMissing ? "딜량 미수집 — 킬관여만 반영" : "분당 딜량 + 킬관여" },
                      { label: "성장", value: player.radar.growth, hint: "분당 CS + 분당 골드" },
                      { label: "시야", value: player.radar.vision, hint: player.radar.visionMissing ? "시야점수 미수집 — 중립값(50)으로 표시" : "분당 시야점수" },
                      { label: "생존", value: player.radar.survival, hint: "분당 데스가 적을수록 높음" },
                    ]}
                  />
                </div>
              </div>
            )}

            {/* Lane Stats */}
            {player.laneStats.length > 0 && (
              <div className="border-t border-hairline pt-2">
                <div className="text-xs text-ink-subtle mb-1.5">라인별 전적</div>
                <div className="space-y-1">
                  {player.laneStats.map((ls) => (
                    <div key={ls.lane} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span>{LANES.find((l) => l.key === ls.lane)?.emoji}</span>
                        <span className="text-ink">{LANE_LABEL[ls.lane]}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-ink-subtle">{ls.games}판</span>
                        <span className={ls.winRate >= 50 ? "text-win font-medium" : "text-lose"}>
                          {ls.winRate.toFixed(0)}%
                        </span>
                        <span className="text-ink-subtle">KDA {ls.avgKda.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Edit Modal */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`${editing} 정보 수정`}
      >
        <div className="space-y-5">
          {/* Nickname */}
          <Input
            id="nickname"
            label="닉네임"
            placeholder="게임 닉네임"
            value={editNewNickname}
            onChange={(e) => setEditNewNickname(e.target.value)}
          />

          {/* Real Name */}
          <Input
            id="real-name"
            label="실명"
            placeholder="실명을 입력하세요"
            value={editRealName}
            onChange={(e) => setEditRealName(e.target.value)}
          />

          {/* Tier */}
          <div>
            <label className="text-sm text-ink-muted font-medium block mb-2">솔랭 티어</label>
            <select
              className="w-full bg-surface-1 border border-hairline rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-primary cursor-pointer"
              value={editTier}
              onChange={(e) => setEditTier(e.target.value)}
            >
              <option value="">미설정</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Preferred Lanes (ordered) */}
          <div>
            <label className="text-sm text-ink-muted font-medium block mb-1">선호 포지션</label>
            <p className="text-xs text-ink-subtle mb-2">클릭한 순서대로 1순위, 2순위... 가 됩니다</p>

            {/* Current order */}
            {editLanes.length > 0 && (
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {editLanes.map((lane, i) => {
                  const l = LANES.find((la) => la.key === lane);
                  return (
                    <div
                      key={lane}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/15 text-primary text-sm font-medium"
                    >
                      <span className="w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      {l?.emoji} {l?.label}
                      <button
                        type="button"
                        onClick={() => setEditLanes((prev) => prev.filter((_, j) => j !== i))}
                        className="ml-0.5 text-primary/50 hover:text-primary cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {LANES.map((lane) => {
                const idx = editLanes.indexOf(lane.key);
                const active = idx !== -1;
                return (
                  <button
                    key={lane.key}
                    type="button"
                    onClick={() => toggleLane(lane.key)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-fast cursor-pointer ${
                      active
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "bg-surface-1 text-ink-subtle border border-hairline hover:border-hairline-strong"
                    }`}
                  >
                    {active && (
                      <span className="w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                    )}
                    <span>{lane.emoji}</span>
                    {lane.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (editing) {
                  handleDelete(editing);
                  setEditing(null);
                }
              }}
            >
              <Trash2 size={14} />
              삭제
            </Button>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setEditing(null)}>취소</Button>
              <Button onClick={saveEdit} disabled={saving}>
                <Save size={16} />
                {saving ? "저장 중..." : "저장"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Merge Alias Modal */}
      <Modal
        open={showMerge}
        onClose={() => setShowMerge(false)}
        title="아이디 통합 (부캐 합치기)"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            부캐 아이디를 본캐에 통합합니다. 부캐의 모든 매치 기록이 본캐로 합산됩니다.
          </p>

          <div>
            <label className="text-sm text-ink-muted font-medium block mb-2">본캐 (메인 아이디)</label>
            <select
              className="w-full bg-surface-1 border border-hairline rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-primary cursor-pointer"
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
            >
              <option value="">선택하세요</option>
              {mergeCandidates.map((n) => {
                const member = group.members.find((m) => m.nickname === n);
                return (
                  <option key={n} value={n}>
                    {n}{member?.realName ? ` (${member.realName})` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="text-sm text-ink-muted font-medium block mb-2">부캐 (통합할 아이디)</label>
            <select
              className="w-full bg-surface-1 border border-hairline rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-primary cursor-pointer"
              value={mergeAlias}
              onChange={(e) => setMergeAlias(e.target.value)}
            >
              <option value="">선택하세요</option>
              {mergeCandidates
                .filter((n) => n !== mergeTarget)
                .map((n) => {
                  const member = group.members.find((m) => m.nickname === n);
                  return (
                    <option key={n} value={n}>
                      {n}{member?.realName ? ` (${member.realName})` : ""}
                    </option>
                  );
                })}
            </select>
          </div>

          {mergeTarget && mergeAlias && (
            <div className="bg-surface-1 border border-hairline rounded-xl p-3 text-sm">
              <span className="text-ink font-medium">{mergeAlias}</span>
              <span className="text-ink-subtle"> 의 모든 기록이 </span>
              <span className="text-primary font-medium">{mergeTarget}</span>
              <span className="text-ink-subtle"> 으로 합산됩니다.</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowMerge(false)}>취소</Button>
            <Button onClick={handleMerge} disabled={!mergeTarget || !mergeAlias}>
              <Link size={16} />
              통합하기
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
