"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getMatch, getAllMembers, updateMatch, deleteMatch, setMatchExcluded } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Trophy, Flame, Shield, Eye, Clock, Swords, Edit3, Save, Trash2 } from "lucide-react";
import { ChampionIcon } from "@/components/ui/champion-icon";
import { LoadError } from "@/components/ui/load-error";
import { AdminCancelledError } from "@/lib/admin-client";
import { backToList } from "@/lib/list-position";
import Link from "next/link";
import { playerHref } from "@/lib/profile";
import type { Match, PlayerStat, Member } from "@/lib/types";

const LANE_EMOJI: Record<string, string> = {
  top: "🛡️", jungle: "🌿", mid: "🔥", adc: "🏹", support: "💚",
};
const LANE_LABEL: Record<string, string> = {
  top: "탑", jungle: "정글", mid: "미드", adc: "원딜", support: "서폿",
};

export default function MatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [match, setMatch] = useState<Match | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editPlayers, setEditPlayers] = useState<PlayerStat[]>([]);
  const [editDuration, setEditDuration] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const matchId = params.matchId as string;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [m, mems] = await Promise.all([getMatch(matchId), getAllMembers()]);
        if (cancelled) return;
        setMatch(m);
        setMembers(mems);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [matchId, reloadKey]);

  const fail = (what: string, err: unknown) => {
    if (!(err instanceof AdminCancelledError)) {
      alert(`${what} 실패: ` + (err instanceof Error ? err.message : "알 수 없는 오류"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 조회 실패는 "경기를 찾을 수 없습니다"와 구분한다
  if (loadError) {
    return (
      <LoadError
        message={loadError}
        onRetry={() => {
          setLoading(true);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  if (!match) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-ink-subtle">경기를 찾을 수 없습니다</p>
      </div>
    );
  }

  const blue = match.players.filter((p) => p.team === "blue");
  const red = match.players.filter((p) => p.team === "red");
  const blueWin = blue.length > 0 && blue[0].win;

  const blueKills = blue.reduce((s, p) => s + p.kills, 0);
  const redKills = red.reduce((s, p) => s + p.kills, 0);
  const blueGold = blue.reduce((s, p) => s + p.gold, 0);
  const redGold = red.reduce((s, p) => s + p.gold, 0);

  const maxDamage = Math.max(...match.players.map((p) => p.damageDealt || 1));
  const maxTaken = Math.max(...match.players.map((p) => p.damageTaken || 1));
  const maxGold = Math.max(...match.players.map((p) => p.gold || 1));

  const mvp = match.players.find((p) => p.isMvp);
  const ace = match.players.find((p) => p.isAce);
  const uncollected = [
    match.missing?.damage && "딜량",
    match.missing?.damageTaken && "받은 피해",
    match.missing?.vision && "시야점수",
  ].filter(Boolean) as string[];

  const getMemberRealName = (nickname: string) =>
    members.find((m) => m.nickname === nickname)?.realName;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <button
          onClick={() => backToList(router)}
          className="flex items-center gap-1 text-sm text-ink-subtle hover:text-ink transition-fast cursor-pointer"
        >
          <ChevronLeft size={16} />
          돌아가기
        </button>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>취소</Button>
              <Button size="sm" disabled={saving} onClick={async () => {
                setSaving(true);
                try {
                  await updateMatch(matchId, editPlayers, editDuration);
                  const m = await getMatch(matchId);
                  setMatch(m);
                  setEditing(false);
                } catch (err) {
                  fail("저장", err);
                }
                setSaving(false);
              }}>
                <Save size={13} />
                {saving ? "저장 중..." : "저장"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => {
                setEditPlayers([...match.players]);
                setEditDuration(match.gameDuration);
                setEditing(true);
              }}>
                <Edit3 size={13} />
                수정
              </Button>
              <Button variant="ghost" size="sm" onClick={async () => {
                if (match.excludedReason) {
                  if (!confirm(`"${match.excludedReason}" 표시를 해제하고 다시 통계에 반영할까요?`)) return;
                  try {
                    await setMatchExcluded(matchId, null);
                    setMatch(await getMatch(matchId));
                  } catch (err) {
                    fail("제외 해제", err);
                  }
                  return;
                }
                const reason = prompt("이 경기를 없던 경기로 처리합니다 (어떤 통계에도 반영되지 않음).\n매치 기록에 표시할 문구:", "Zeus's Law");
                if (!reason?.trim()) return;
                try {
                  await setMatchExcluded(matchId, reason);
                  setMatch(await getMatch(matchId));
                } catch (err) {
                  fail("기록 제외", err);
                }
              }}>
                {match.excludedReason ? "제외 해제" : "기록 제외"}
              </Button>
              <Button variant="danger" size="sm" onClick={async () => {
                if (!confirm("이 경기를 삭제하시겠습니까?")) return;
                try {
                  await deleteMatch(matchId);
                } catch (err) {
                  fail("삭제", err);
                  return;
                }
                // 삭제한 경기는 목록에서 사라지므로 뒤로가기 대신 매치 기록 탭으로
                router.push("/group/main?tab=matches");
              }}>
                <Trash2 size={13} />
                삭제
              </Button>
            </>
          )}
        </div>
      </div>

      {match.excludedReason && (
        <div className="mb-4 rounded-xl border border-hairline-strong bg-surface-2 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-white text-xl font-extrabold tracking-wide">{match.excludedReason}</span>
          <span className="text-xs text-ink-subtle break-keep">없던 경기로 처리됨 — 선수·챔피언·포지션 통계, 어워즈, 팀 밸런스 어디에도 반영되지 않습니다.</span>
        </div>
      )}

      <div className={match.excludedReason ? "grayscale-75 opacity-75" : undefined}>
      {/* Match Header Card */}
      <Card className="mb-6 p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-500/5 via-transparent to-red-500/5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 mb-5">
            <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
              <Clock size={12} />
              {new Date(match.createdAt).toLocaleString("ko-KR", {
                year: "numeric", month: "long", day: "numeric",
                ...(match.timeUnknown ? {} : { hour: "2-digit", minute: "2-digit" }),
              })}
            </div>
            {match.gameDuration && (
              <span className="text-xs text-ink-subtle px-2 py-0.5 rounded-full bg-surface-2">
                {match.gameDuration}
              </span>
            )}
            {match.source === "legacy-import" && (
              <span className="text-xs text-ink-subtle px-2 py-0.5 rounded-full bg-surface-2 whitespace-nowrap">수기 기록 · 시각 미상</span>
            )}
          </div>

          {uncollected.length > 0 && (
            <p className="text-center text-[11px] text-ink-tertiary mb-4 break-keep">
              이 경기는 {uncollected.join("·")}이(가) 수집되지 않았습니다. 해당 항목은 0이 아니라 <span className="text-ink-subtle">미수집</span>으로 표시하고 통계 평균에서도 제외합니다.
            </p>
          )}

          <div className="flex items-center justify-center gap-4 sm:gap-10">
            <div className="text-center">
              <div className={`text-4xl sm:text-5xl font-bold tabular-nums ${blueWin ? "text-blue-400" : "text-ink-tertiary"}`}>
                {blueKills}
              </div>
              <div className="text-sm font-bold text-blue-400 mt-1">블루팀</div>
              <Badge variant={blueWin ? "win" : "lose"} className="mt-1.5">
                {blueWin ? "승리" : "패배"}
              </Badge>
              <div className="text-xs text-ink-subtle mt-1">
                <span className="text-gold">{blueGold.toLocaleString()}</span> G
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Swords size={24} className="text-ink-tertiary/30" />
              <span className="text-xs font-bold text-ink-tertiary/40">VS</span>
            </div>
            <div className="text-center">
              <div className={`text-4xl sm:text-5xl font-bold tabular-nums ${!blueWin ? "text-red-400" : "text-ink-tertiary"}`}>
                {redKills}
              </div>
              <div className="text-sm font-bold text-red-400 mt-1">레드팀</div>
              <Badge variant={!blueWin ? "win" : "lose"} className="mt-1.5">
                {!blueWin ? "승리" : "패배"}
              </Badge>
              <div className="text-xs text-ink-subtle mt-1">
                <span className="text-gold">{redGold.toLocaleString()}</span> G
              </div>
            </div>
          </div>

          {match.bans && (match.bans.blue.length > 0 || match.bans.red.length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-blue-400/70 uppercase">밴</span>
                {match.bans.blue.map((champ, i) => (
                  <div key={`${champ}-${i}`} className="relative" title={champ}>
                    <ChampionIcon name={champ} size={24} className="grayscale opacity-70" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-full h-px bg-lose rotate-45" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                {match.bans.red.map((champ, i) => (
                  <div key={`${champ}-${i}`} className="relative" title={champ}>
                    <ChampionIcon name={champ} size={24} className="grayscale opacity-70" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-full h-px bg-lose rotate-45" />
                    </div>
                  </div>
                ))}
                <span className="text-[10px] font-bold text-red-400/70 uppercase">밴</span>
              </div>
            </div>
          )}

          {(mvp || ace) && (
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 mt-5">
              {mvp && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-mvp/10 border border-mvp/20 max-w-full min-w-0">
                  <Trophy size={14} className="text-mvp shrink-0" />
                  <span className="text-xs font-bold text-mvp shrink-0">MVP</span>
                  <span className="text-sm font-bold text-ink truncate">{mvp.nickname}</span>
                  <span className="text-xs text-ink-subtle whitespace-nowrap shrink-0">{mvp.mvpScore.toFixed(1)}점</span>
                </div>
              )}
              {ace && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ace/10 border border-ace/20 max-w-full min-w-0">
                  <span className="text-xs font-bold text-ace shrink-0">ACE</span>
                  <span className="text-sm font-bold text-ink truncate">{ace.nickname}</span>
                  <span className="text-xs text-ink-subtle whitespace-nowrap shrink-0">{ace.mvpScore.toFixed(1)}점</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <TeamSection team="blue" players={editing ? editPlayers.filter(p => p.team === "blue") : blue} win={blueWin} maxDamage={maxDamage} maxTaken={maxTaken} maxGold={maxGold} getRealName={getMemberRealName} editing={editing} onUpdate={editing ? (idx, field, val) => {
        const blueIdxMap = editPlayers.map((p, i) => p.team === "blue" ? i : -1).filter(i => i !== -1);
        const realIdx = blueIdxMap[idx];
        if (realIdx !== undefined) setEditPlayers(prev => { const next = [...prev]; next[realIdx] = { ...next[realIdx], [field]: val }; return next; });
      } : undefined} />
      <div className="my-4" />
      <TeamSection team="red" players={editing ? editPlayers.filter(p => p.team === "red") : red} win={!blueWin} maxDamage={maxDamage} maxTaken={maxTaken} maxGold={maxGold} getRealName={getMemberRealName} editing={editing} onUpdate={editing ? (idx, field, val) => {
        const redIdxMap = editPlayers.map((p, i) => p.team === "red" ? i : -1).filter(i => i !== -1);
        const realIdx = redIdxMap[idx];
        if (realIdx !== undefined) setEditPlayers(prev => { const next = [...prev]; next[realIdx] = { ...next[realIdx], [field]: val }; return next; });
      } : undefined} />
      </div>
    </div>
  );
}

function TeamSection({ team, players, win, maxDamage, maxTaken, maxGold, getRealName, editing, onUpdate }: {
  team: "blue" | "red"; players: PlayerStat[]; win: boolean;
  maxDamage: number; maxTaken: number; maxGold: number;
  getRealName: (n: string) => string | undefined;
  editing?: boolean;
  onUpdate?: (playerIdx: number, field: string, value: unknown) => void;
}) {
  const borderColor = team === "blue" ? "border-l-blue-500/40" : "border-l-red-500/40";
  const headerBg = team === "blue" ? "bg-blue-500/5" : "bg-red-500/5";
  const teamColor = team === "blue" ? "text-blue-400" : "text-red-400";

  return (
    <Card className={`border-l-4 ${borderColor} p-0 overflow-hidden`}>
      <div className={`${headerBg} px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-hairline/50`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${teamColor}`}>{team === "blue" ? "블루팀" : "레드팀"}</span>
          <Badge variant={win ? "win" : "lose"}>{win ? "승리" : "패배"}</Badge>
        </div>
        <div className="text-xs text-ink-subtle">
          {players.reduce((s, p) => s + p.kills, 0)}/{players.reduce((s, p) => s + p.deaths, 0)}/{players.reduce((s, p) => s + p.assists, 0)}
        </div>
      </div>
      <div className="divide-y divide-hairline/30">
        {players.map((p, pIdx) => {
          const kda = p.deaths === 0 ? "Perfect" : ((p.kills + p.assists) / p.deaths).toFixed(1);
          const kdaColor = kda === "Perfect" || parseFloat(kda) >= 4 ? "text-win" : parseFloat(kda) < 2 ? "text-lose" : "text-ink";
          const damagePercent = maxDamage > 0 ? (p.damageDealt / maxDamage) * 100 : 0;
          const takenPercent = maxTaken > 0 ? (p.damageTaken / maxTaken) * 100 : 0;
          const goldPercent = maxGold > 0 ? (p.gold / maxGold) * 100 : 0;
          const realName = getRealName(p.nickname);
          const editNum = (field: string, value: string) => onUpdate?.(pIdx, field, parseInt(value) || 0);

          return (
            <div key={p.id} className="px-3 sm:px-4 py-3 hover:bg-surface-1/30 transition-fast">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ChampionIcon name={p.champion || "?"} size={36} className="rounded-lg" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {editing ? (
                        <input className="bg-transparent border-b border-hairline focus:border-primary outline-none w-24 text-ink text-sm font-semibold" value={p.nickname} onChange={(e) => onUpdate?.(pIdx, "nickname", e.target.value)} />
                      ) : (
                        <Link href={playerHref(p.nickname)} className="font-semibold text-ink text-sm break-all hover:text-primary hover:underline underline-offset-2">
                          {p.nickname}
                        </Link>
                      )}
                      {!editing && realName && <span className="text-xs text-ink-tertiary">({realName})</span>}
                      {!editing && p.isMvp && <Badge variant="mvp">MVP</Badge>}
                      {!editing && p.isAce && <Badge variant="ace">ACE</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-tertiary">
                      {editing ? (
                        <input className="bg-transparent border-b border-hairline focus:border-primary outline-none w-16 text-xs" value={p.champion} onChange={(e) => onUpdate?.(pIdx, "champion", e.target.value)} />
                      ) : (
                        <span>{p.champion}</span>
                      )}
                      {p.lane && <span className="whitespace-nowrap">{LANE_EMOJI[p.lane]} {LANE_LABEL[p.lane]}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-right ml-auto">
                  {editing ? (
                    <div className="flex items-center gap-1 text-sm">
                      <input type="number" className="w-8 bg-transparent border-b border-hairline text-center text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.kills} onChange={(e) => editNum("kills", e.target.value)} />
                      <span className="text-ink-tertiary">/</span>
                      <input type="number" className="w-8 bg-transparent border-b border-hairline text-center text-lose outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.deaths} onChange={(e) => editNum("deaths", e.target.value)} />
                      <span className="text-ink-tertiary">/</span>
                      <input type="number" className="w-8 bg-transparent border-b border-hairline text-center text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.assists} onChange={(e) => editNum("assists", e.target.value)} />
                    </div>
                  ) : (
                    <div>
                      <div className="text-sm font-bold text-ink tabular-nums whitespace-nowrap">
                        {p.kills} / <span className="text-lose">{p.deaths}</span> / {p.assists}
                      </div>
                      <div className={`text-xs font-medium ${kdaColor}`}>{kda} KDA</div>
                    </div>
                  )}
                  {!editing && (
                    <div className="w-10 text-center">
                      <div className="text-sm font-bold text-primary">{p.mvpScore.toFixed(1)}</div>
                      <div className="text-[10px] text-ink-tertiary">점수</div>
                    </div>
                  )}
                </div>
              </div>
              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:ml-[46px] text-xs">
                  <div><span className="text-ink-tertiary">CS</span><input type="number" className="w-full bg-transparent border-b border-hairline text-ink text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.cs} onChange={(e) => editNum("cs", e.target.value)} /></div>
                  <div><span className="text-ink-tertiary">골드</span><input type="number" className="w-full bg-transparent border-b border-hairline text-ink text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.gold} onChange={(e) => editNum("gold", e.target.value)} /></div>
                  <div><span className="text-ink-tertiary">딜량</span><input type="number" className="w-full bg-transparent border-b border-hairline text-ink text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.damageDealt} onChange={(e) => editNum("damageDealt", e.target.value)} /></div>
                  <div><span className="text-ink-tertiary">피해량</span><input type="number" className="w-full bg-transparent border-b border-hairline text-ink text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.damageTaken} onChange={(e) => editNum("damageTaken", e.target.value)} /></div>
                  <div><span className="text-ink-tertiary">시야</span><input type="number" className="w-full bg-transparent border-b border-hairline text-ink text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.visionScore} onChange={(e) => editNum("visionScore", e.target.value)} /></div>
                  <div><span className="text-ink-tertiary">와드</span><input type="number" className="w-full bg-transparent border-b border-hairline text-ink text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.wardsPlaced} onChange={(e) => editNum("wardsPlaced", e.target.value)} /></div>
                  <div><span className="text-ink-tertiary">오브젝트</span><input type="number" className="w-full bg-transparent border-b border-hairline text-ink text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={p.objectiveDamage} onChange={(e) => editNum("objectiveDamage", e.target.value)} /></div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:gap-3 sm:ml-[46px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-x-1 text-xs mb-1">
                      <span className="text-ink-tertiary whitespace-nowrap">CS / 골드</span>
                      <span className="text-ink tabular-nums">{p.cs}</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-yellow-500/60 to-yellow-400 rounded-full" style={{ width: `${goldPercent}%` }} />
                    </div>
                    <div className="text-[10px] text-gold mt-0.5 tabular-nums">{(p.gold || 0).toLocaleString()}G</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-x-1 text-xs mb-1">
                      <span className="text-ink-tertiary flex items-center gap-0.5 whitespace-nowrap"><Flame size={10} />딜량</span>
                      {p.noDamage
                        ? <span className="text-ink-tertiary whitespace-nowrap">미수집</span>
                        : <span className="text-ink tabular-nums">{(p.damageDealt || 0).toLocaleString()}</span>}
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full" style={{ width: `${damagePercent}%` }} />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-x-1 text-xs mb-1">
                      <span className="text-ink-tertiary flex items-center gap-0.5 whitespace-nowrap"><Shield size={10} />피해</span>
                      {p.noDamageTaken
                        ? <span className="text-ink-tertiary whitespace-nowrap">미수집</span>
                        : <span className="text-ink tabular-nums">{(p.damageTaken || 0).toLocaleString()}</span>}
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full" style={{ width: `${takenPercent}%` }} />
                    </div>
                  </div>
                </div>
              )}
              {!editing && p.noVision && (
                <div className="sm:ml-[46px] mt-1.5 text-xs text-ink-tertiary flex items-center gap-0.5"><Eye size={10} /> 시야 미수집</div>
              )}
              {(p.visionScore > 0 || p.wardsPlaced > 0) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-[46px] mt-1.5 text-xs text-ink-tertiary">
                  {p.visionScore > 0 && <span className="flex items-center gap-0.5"><Eye size={10} /> 시야 {p.visionScore}</span>}
                  {p.wardsPlaced > 0 && <span>와드 {p.wardsPlaced}개</span>}
                  {p.wardsDestroyed > 0 && <span>제거 {p.wardsDestroyed}개</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
