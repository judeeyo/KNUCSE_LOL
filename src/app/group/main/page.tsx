"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { getGroup, deleteMatch as deleteMatchApi } from "@/lib/store";
import { buildPlayerStats, computeAwards } from "@/lib/stats";
import { Button } from "@/components/ui/button";
import { PlayerStatsTab } from "@/components/group/player-stats-tab";
import { ChampionStatsTab } from "@/components/group/champion-stats-tab";
import { LaneRankingTab } from "@/components/group/lane-ranking-tab";
import { MatchHistoryTab } from "@/components/group/match-history-tab";
import { BalanceTab } from "@/components/group/balance-tab";
import { PlayerInfoTab } from "@/components/group/player-info-tab";
import { TeamSideTab } from "@/components/group/team-side-tab";
import { DuoTab } from "@/components/group/duo-tab";
import { Modal } from "@/components/ui/modal";
import { LoadError } from "@/components/ui/load-error";
import { AdminCancelledError } from "@/lib/admin-client";
import {
  Users,
  Swords,
  Gamepad2,
  Scale,
  UserCog,
  GitCompareArrows,
  Handshake,
  ListOrdered,
  Download,
  Plus,
  HelpCircle,
  Settings,
} from "lucide-react";
import type { Group } from "@/lib/types";

type Tab = "players" | "champions" | "lanes" | "sides" | "duos" | "matches" | "info" | "balance";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "players", label: "선수별 성적", icon: <Users size={16} /> },
  { key: "champions", label: "챔피언 승률", icon: <Swords size={16} /> },
  { key: "lanes", label: "포지션별 순위", icon: <ListOrdered size={16} /> },
  { key: "sides", label: "진영별 통계", icon: <GitCompareArrows size={16} /> },
  { key: "duos", label: "듀오 상성", icon: <Handshake size={16} /> },
  { key: "matches", label: "매치 기록", icon: <Gamepad2 size={16} /> },
  { key: "info", label: "선수 정보", icon: <UserCog size={16} /> },
  { key: "balance", label: "팀 밸런스", icon: <Scale size={16} /> },
];

const CACHE_KEY = "naejeon-group-cache-v1";

export default function MainGroupPage() {
  const [group, setGroup] = useState<Group | null>(null);
  const [tab, setTab] = useState<Tab>("players");
  const [loading, setLoading] = useState(true);
  const [showManual, setShowManual] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const loadData = useCallback(async () => {
    // 같은 세션 내 재방문이면 캐시로 즉시 렌더한 뒤, 네트워크로 최신 데이터를 덮어쓴다.
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        setGroup(JSON.parse(cached) as Group);
        setLoading(false);
      }
    } catch {
      // 캐시 파손 시 무시하고 네트워크 로드
    }

    // 조회 실패를 "0명 · 0경기"로 보여 주지 않도록, 실패하면 오류 상태로 두고 재시도 버튼을 제공한다.
    // (이전에 불러온 캐시가 있으면 그 내용은 유지하되 최신이 아님을 알린다)
    let g: Group;
    try {
      g = await getGroup();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      return;
    }
    setLoadError(null);
    setGroup(g);
    setLoading(false);
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(g));
    } catch {
      // 저장 실패(용량 초과 등)해도 동작에는 지장 없음
    }
  }, []);

  const retry = async () => {
    setRetrying(true);
    await loadData();
    setRetrying(false);
  };

  useEffect(() => {
    // 마운트 시 1회 데이터 로드. loadData는 캐시 즉시 렌더 후 네트워크로 최신화하는
    // 비동기 로더로, 이 페이지의 유일한 진입점이라 cascading render 우려가 없다.
    // (SSR 안전을 위해 캐시/네트워크 접근은 반드시 마운트 이후에만 실행)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const playerStats = useMemo(() => (group ? buildPlayerStats(group) : []), [group]);
  const awards = useMemo(() => (group ? computeAwards(group) : []), [group]);

  const handleDeleteMatch = async (matchId: string) => {
    try {
      await deleteMatchApi(matchId);
    } catch (err) {
      if (!(err instanceof AdminCancelledError)) {
        alert("삭제 실패: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
      }
      return;
    }
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-ink-subtle text-sm">데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!group) {
    return <LoadError message={loadError || "알 수 없는 오류"} onRetry={retry} retrying={retrying} />;
  }

  const uniquePlayers = new Set(group.matches.flatMap((m) => m.players.map((p) => p.nickname))).size;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 min-w-0">
      {/* Header — 좁은 화면에서는 제목 줄과 버튼 줄이 나뉘어 줄바꿈된다 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
          <h1 className="text-lg font-semibold text-ink tracking-tight break-keep">{group.name}</h1>
          <span className="text-xs text-ink-tertiary whitespace-nowrap">{uniquePlayers}명 · {group.matches.length}경기</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setShowManual(true)}
            aria-label="수집기 사용법"
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-ink-tertiary hover:text-ink hover:bg-surface-1 transition-fast cursor-pointer"
          >
            <HelpCircle size={13} />
          </button>
          <Link href="/group/main/admin" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-ink-subtle hover:text-ink hover:bg-surface-1 transition-fast whitespace-nowrap">
            <Settings size={13} />
            관리
          </Link>
          <a href="/api/collector" download className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-ink-subtle hover:text-ink hover:bg-surface-1 transition-fast whitespace-nowrap">
            <Download size={13} />
            수집기
          </a>
          <Button size="sm" onClick={() => window.location.href = "/group/main/new"}>
            <Plus size={13} />
            수동 등록
          </Button>
        </div>
      </div>

      {loadError && <LoadError compact message={loadError} onRetry={retry} retrying={retrying} />}

      {/* Tabs — 탭 줄 안에서만 가로 스크롤 */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 mb-5 border-b border-hairline bg-canvas/90 backdrop-blur-sm">
        <div role="tablist" aria-label="통계 탭" className="flex items-center gap-1 px-4 sm:px-6 lg:px-8 py-2 overflow-x-auto overscroll-x-contain">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap transition-fast ${
                tab === t.key
                  ? "bg-primary/15 text-primary"
                  : "text-ink-subtle hover:text-ink hover:bg-surface-1"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {tab === "players" && <PlayerStatsTab playerStats={playerStats} awards={awards} matchCount={group.matches.length} />}
      {tab === "champions" && <ChampionStatsTab group={group} />}
      {tab === "lanes" && <LaneRankingTab group={group} />}
      {tab === "sides" && <TeamSideTab group={group} />}
      {tab === "duos" && <DuoTab group={group} />}
      {tab === "matches" && (
        <MatchHistoryTab
          matches={group.matches}
          groupId="main"
          onDelete={handleDeleteMatch}
        />
      )}
      {tab === "info" && (
        <PlayerInfoTab
          group={group}
          playerStats={playerStats}
          onUpdate={loadData}
        />
      )}
      {tab === "balance" && <BalanceTab playerStats={playerStats} group={group} />}

      {/* 수집기 메뉴얼 */}
      <Modal open={showManual} onClose={() => setShowManual(false)} title="수집기 사용법" className="max-w-2xl">
        <div className="space-y-5 text-sm text-ink-muted break-keep">
          <div>
            <h3 className="text-ink font-semibold mb-2">처음 한 번만 설정</h3>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>Python 설치 — <a href="https://python.org/downloads" target="_blank" rel="noreferrer" className="text-primary hover:text-primary-hover underline">python.org/downloads</a> (설치 시 <span className="text-ink font-medium">&quot;Add to PATH&quot; 반드시 체크</span>)</li>
              <li>상단 <span className="text-ink font-medium">수집기</span> 버튼 → ZIP을 지워지지 않을 폴더에 풀기</li>
              <li><code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">내전수집기.bat</code> 실행 → <span className="text-ink font-medium">[업로드 토큰 설정]</span>에 관리자에게 받은 토큰 입력</li>
              <li><span className="text-ink font-medium">&quot;Windows 로그인 시 자동 실행&quot;</span> 체크</li>
            </ol>
            <p className="mt-2 text-xs">이후에는 버튼을 누를 필요가 없습니다. PC에 로그인하면 수집기가 백그라운드에서 켜지고, 내전이 끝나면 자동으로 올라갑니다.</p>
          </div>

          <div className="space-y-3">
            <div className="bg-surface-2/50 rounded-lg px-4 py-3">
              <p className="text-ink font-medium text-xs mb-1">백업과 재전송</p>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">
                <li>모든 경기는 서버로 보내기 전에 PC에 먼저 저장됩니다 ([백업 폴더 열기])</li>
                <li>업로드가 실패하면 대기열에 남아 자동으로 다시 전송됩니다</li>
              </ul>
            </div>
            <div className="bg-surface-2/50 rounded-lg px-4 py-3">
              <p className="text-ink font-medium text-xs mb-1">과거 경기 가져오기 탭</p>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">
                <li><span className="text-ink">경기 불러오기</span> → 내 계정으로 조회되는 커스텀 게임 목록</li>
                <li><span className="text-ink">선택한 경기 업로드</span> 또는 <span className="text-ink">JSON 저장</span> (파일은 관리 화면에서 가져오기)</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-hairline pt-4">
            <h3 className="text-ink font-semibold mb-2">주의사항</h3>
            <ul className="list-disc pl-4 space-y-1 text-xs">
              <li>롤 클라이언트에 로그인돼 있어야 합니다 (커스텀 게임만 수집)</li>
              <li>같은 게임은 서버에서 자동으로 중복 방지됩니다 (여러 명이 실행해도 안전)</li>
              <li>내려받는 ZIP에는 비밀값이 없습니다. 업로드 토큰은 각자 PC에만 저장됩니다</li>
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  );
}
