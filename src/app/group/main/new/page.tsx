"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMatch } from "@/lib/store";
import { AdminCancelledError } from "@/lib/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Save } from "lucide-react";
import type { PlayerStat, Lane } from "@/lib/types";

const EMPTY_PLAYER = (team: "blue" | "red"): Partial<PlayerStat> => ({
  nickname: "", champion: "", team, win: false, lane: undefined,
  kills: 0, deaths: 0, assists: 0, cs: 0, gold: 0,
  damageDealt: 0, damageTaken: 0, visionScore: 0,
  wardsPlaced: 0, wardsDestroyed: 0, objectiveDamage: 0,
  ccScore: 0, healingDone: 0, shieldingDone: 0,
});

const LANES: { key: Lane; label: string }[] = [
  { key: "top", label: "탑" }, { key: "jungle", label: "정글" },
  { key: "mid", label: "미드" }, { key: "adc", label: "원딜" },
  { key: "support", label: "서폿" },
];

export default function NewMatchPage() {
  const router = useRouter();
  const [gameDuration, setGameDuration] = useState("");
  // 과거 경기(단톡 결과표·스크린샷)를 옮겨 적을 수 있도록 경기 날짜/시각을 받는다. 비우면 지금 시각.
  const [playedDate, setPlayedDate] = useState("");
  const [playedTime, setPlayedTime] = useState("");
  const [blueWin, setBlueWin] = useState(true);
  const [players, setPlayers] = useState<Partial<PlayerStat>[]>([
    ...Array.from({ length: 5 }, () => EMPTY_PLAYER("blue")),
    ...Array.from({ length: 5 }, () => EMPTY_PLAYER("red")),
  ]);
  const [saving, setSaving] = useState(false);

  const update = (index: number, field: string, value: unknown) => {
    setPlayers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSave = async () => {
    const filled = players.filter((p) => p.nickname?.trim());
    if (filled.length < 2) {
      alert("최소 2명 이상의 닉네임을 입력해주세요.");
      return;
    }

    setSaving(true);
    const complete: PlayerStat[] = players
      .filter((p) => p.nickname?.trim())
      .map((p, i) => ({
        id: `p-${i}`,
        matchId: "",
        nickname: p.nickname || "",
        champion: p.champion || "",
        lane: p.lane,
        team: p.team || (i < 5 ? "blue" : "red"),
        win: p.team === "blue" ? blueWin : !blueWin,
        kills: Number(p.kills) || 0,
        deaths: Number(p.deaths) || 0,
        assists: Number(p.assists) || 0,
        cs: Number(p.cs) || 0,
        gold: Number(p.gold) || 0,
        damageDealt: Number(p.damageDealt) || 0,
        damageTaken: Number(p.damageTaken) || 0,
        visionScore: Number(p.visionScore) || 0,
        wardsPlaced: Number(p.wardsPlaced) || 0,
        wardsDestroyed: Number(p.wardsDestroyed) || 0,
        objectiveDamage: Number(p.objectiveDamage) || 0,
        ccScore: Number(p.ccScore) || 0,
        healingDone: Number(p.healingDone) || 0,
        shieldingDone: Number(p.shieldingDone) || 0,
        killParticipation: 0,
        mvpScore: 0,
        isMvp: false,
        isAce: false,
      }));

    try {
      // 날짜만 넣으면 그날 정오(한국 시각)로 저장하고 "시각 미상"으로 표시한다
      const playedAt = playedDate ? `${playedDate}T${playedTime || "12:00"}:00+09:00` : undefined;
      const match = await addMatch(complete, gameDuration, {
        playedAt,
        timeUnknown: Boolean(playedDate && !playedTime),
      });
      router.push(`/group/main/match/${match.id}`);
    } catch (err) {
      if (!(err instanceof AdminCancelledError)) {
        alert("저장 실패: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
      }
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 min-w-0">
      <button
        onClick={() => router.push("/group/main")}
        className="flex items-center gap-1 text-sm text-ink-subtle hover:text-ink mb-4 transition-fast cursor-pointer"
      >
        <ChevronLeft size={16} />
        돌아가기
      </button>

      <h1 className="text-lg font-semibold text-ink mb-1">수동 경기 등록</h1>
      <p className="text-sm text-ink-subtle mb-5 break-keep">
        게임 결과를 직접 입력합니다. 단톡·디스코드의 결과표나 스크린샷을 보고 과거 경기를 옮겨 적을 때는 경기 날짜를 지정하세요.
        딜량·피해량·시야를 모르면 비워 두면 됩니다(미수집으로 처리). 저장에는 관리자 비밀번호가 필요합니다.
      </p>

      {/* Game info */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 mb-5">
        <label className="flex flex-col gap-1 text-xs text-ink-subtle">
          경기 날짜 (비우면 오늘)
          <input
            type="date"
            value={playedDate}
            onChange={(e) => setPlayedDate(e.target.value)}
            className="rounded-lg bg-surface-1 border border-hairline px-3 py-2 text-sm text-ink w-40 [color-scheme:dark]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-subtle">
          시작 시각 (선택)
          <input
            type="time"
            value={playedTime}
            onChange={(e) => setPlayedTime(e.target.value)}
            disabled={!playedDate}
            className="rounded-lg bg-surface-1 border border-hairline px-3 py-2 text-sm text-ink w-32 disabled:opacity-40 [color-scheme:dark]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-subtle">
          게임 시간
          <Input
            placeholder="예: 32:15"
            value={gameDuration}
            onChange={(e) => setGameDuration(e.target.value)}
            className="w-28"
          />
        </label>
        <div className="flex items-center gap-2 pb-1.5">
          <span className="text-xs text-ink-subtle whitespace-nowrap">승리팀:</span>
          <button
            onClick={() => setBlueWin(true)}
            className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-fast ${
              blueWin ? "bg-blue-500/20 text-blue-400" : "bg-surface-1 text-ink-subtle"
            }`}
          >
            블루
          </button>
          <button
            onClick={() => setBlueWin(false)}
            className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-fast ${
              !blueWin ? "bg-red-500/20 text-red-400" : "bg-surface-1 text-ink-subtle"
            }`}
          >
            레드
          </button>
        </div>
      </div>

      {/* Blue team */}
      <TeamForm
        label="블루팀"
        color="blue"
        win={blueWin}
        players={players.filter((p) => p.team === "blue")}
        startIndex={0}
        onUpdate={update}
      />

      <div className="my-4" />

      {/* Red team */}
      <TeamForm
        label="레드팀"
        color="red"
        win={!blueWin}
        players={players.filter((p) => p.team === "red")}
        startIndex={5}
        onUpdate={update}
      />

      <div className="flex justify-end mt-6">
        <Button onClick={handleSave} disabled={saving}>
          <Save size={16} />
          {saving ? "저장 중..." : "저장하기"}
        </Button>
      </div>
    </div>
  );
}

function TeamForm({
  label, color, win, players, startIndex, onUpdate,
}: {
  label: string; color: "blue" | "red"; win: boolean;
  players: Partial<PlayerStat>[]; startIndex: number;
  onUpdate: (i: number, field: string, value: unknown) => void;
}) {
  const borderColor = color === "blue" ? "border-l-blue-500/40" : "border-l-red-500/40";
  const teamColor = color === "blue" ? "text-blue-400" : "text-red-400";

  return (
    <Card className={`border-l-4 ${borderColor} p-0 overflow-hidden`}>
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-hairline/50">
        <span className={`text-sm font-bold ${teamColor}`}>{label}</span>
        <Badge variant={win ? "win" : "lose"}>{win ? "승리" : "패배"}</Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink-subtle text-xs border-b border-hairline whitespace-nowrap">
              <th className="text-left py-2 px-3">닉네임</th>
              <th className="text-left py-2 px-2">챔피언</th>
              <th className="text-center py-2 px-1">라인</th>
              <th className="text-center py-2 px-1">K</th>
              <th className="text-center py-2 px-1">D</th>
              <th className="text-center py-2 px-1">A</th>
              <th className="text-center py-2 px-1">CS</th>
              <th className="text-right py-2 px-2">골드</th>
              <th className="text-right py-2 px-2">딜량</th>
              <th className="text-right py-2 px-2">피해량</th>
              <th className="text-center py-2 px-1">시야</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const idx = startIndex + i;
              return (
                <tr key={idx} className="border-b border-hairline/30">
                  <td className="py-1.5 px-3">
                    <input className="bg-transparent border-b border-transparent hover:border-hairline focus:border-primary outline-none w-24 text-ink text-sm" value={p.nickname || ""} onChange={(e) => onUpdate(idx, "nickname", e.target.value)} placeholder={`Player ${i+1}`} />
                  </td>
                  <td className="py-1.5 px-2">
                    <input className="bg-transparent border-b border-transparent hover:border-hairline focus:border-primary outline-none w-20 text-ink text-sm" value={p.champion || ""} onChange={(e) => onUpdate(idx, "champion", e.target.value)} />
                  </td>
                  <td className="py-1.5 px-1">
                    <select className="bg-surface-1 border border-hairline rounded px-1 py-0.5 text-xs text-ink cursor-pointer" value={p.lane || ""} onChange={(e) => onUpdate(idx, "lane", e.target.value || undefined)}>
                      <option value="">-</option>
                      {LANES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 px-1"><NumInput value={p.kills} onChange={(v) => onUpdate(idx, "kills", v)} /></td>
                  <td className="py-1.5 px-1"><NumInput value={p.deaths} onChange={(v) => onUpdate(idx, "deaths", v)} /></td>
                  <td className="py-1.5 px-1"><NumInput value={p.assists} onChange={(v) => onUpdate(idx, "assists", v)} /></td>
                  <td className="py-1.5 px-1"><NumInput value={p.cs} onChange={(v) => onUpdate(idx, "cs", v)} /></td>
                  <td className="py-1.5 px-2"><NumInput value={p.gold} onChange={(v) => onUpdate(idx, "gold", v)} w="w-16" /></td>
                  <td className="py-1.5 px-2"><NumInput value={p.damageDealt} onChange={(v) => onUpdate(idx, "damageDealt", v)} w="w-16" /></td>
                  <td className="py-1.5 px-2"><NumInput value={p.damageTaken} onChange={(v) => onUpdate(idx, "damageTaken", v)} w="w-16" /></td>
                  <td className="py-1.5 px-1"><NumInput value={p.visionScore} onChange={(v) => onUpdate(idx, "visionScore", v)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function NumInput({ value, onChange, w = "w-10" }: { value?: number; onChange: (v: number) => void; w?: string }) {
  return (
    <input
      type="number"
      className={`${w} bg-transparent border-b border-transparent hover:border-hairline focus:border-primary outline-none text-center text-ink text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
      value={value ?? 0}
      onChange={(e) => onChange(parseInt(e.target.value) || 0)}
    />
  );
}
