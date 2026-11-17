"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Download, Upload, ShieldCheck, LogOut, RefreshCw, GitMerge, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminFetch, AdminCancelledError, getAdminPassword, setAdminPassword } from "@/lib/admin-client";
import { rowToMatch, type MatchRow } from "@/lib/match-normalize";
import type { Match } from "@/lib/types";

interface ReportItem {
  status: "inserted" | "updated" | "merged" | "skipped" | "candidate" | "invalid";
  reason?: string;
  date?: string | null;
  gameId?: string | null;
  summary?: string;
}
interface ImportReport {
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  merged: number;
  skipped: number;
  candidates: number;
  invalid: number;
  membersAdded: number;
  aliasesAdded: Array<{ from: string; to: string }>;
  aliasConflicts: Array<{ from: string; to: string }>;
  items: ReportItem[];
  parseErrors: string[];
}
interface FilePayload {
  name: string;
  text: string;
  lastModified: number;
}

const STATUS_LABEL: Record<ReportItem["status"], string> = {
  inserted: "새로 추가",
  updated: "기존 경기 갱신",
  merged: "수기 기록에 합침",
  skipped: "이미 있음(건너뜀)",
  candidate: "중복 후보(보류)",
  invalid: "읽을 수 없음",
};
const REASON_LABEL: Record<string, string> = {
  "same-id": "같은 id",
  "same-game-id": "같은 gameId",
  "same-content": "10명의 챔피언·KDA가 모두 같음",
  "same-content-no-game-id": "수기 기록과 10명의 챔피언·KDA 가 같음 → 상세 지표 채움, 닉네임은 기존 표기 유지",
  similar: "날짜가 가깝고 챔피언 8개 이상 일치",
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "날짜 없음";

export default function AdminPage() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [files, setFiles] = useState<FilePayload[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<{ row: MatchRow; match: Match; target?: Match }[] | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setLoggedIn(Boolean(getAdminPassword()));
    sync();
    window.addEventListener("naejeon-admin-change", sync);
    return () => window.removeEventListener("naejeon-admin-change", sync);
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof AdminCancelledError)) {
        setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      }
    }
    setBusy("");
  }, []);

  const loadPending = useCallback(
    () =>
      run("pending", async () => {
        const res = await adminFetch<{ pending: MatchRow[]; targets: MatchRow[] }>("listPending");
        const targets = new Map(res.targets.map((t) => [t.id, rowToMatch(t)]));
        setPending(res.pending.map((row) => ({ row, match: rowToMatch(row), target: row.duplicate_of ? targets.get(row.duplicate_of) : undefined })));
      }),
    [run]
  );

  const checkHealth = () =>
    run("health", async () => {
      const res = await fetch("/api/health", { cache: "no-store" });
      setHealth(await res.json());
    });

  const exportBackup = () =>
    run("export", async () => {
      const data = await adminFetch<{ counts: { matches: number; members: number } }>("export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `naejeon-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice({ kind: "ok", text: `백업 파일을 내려받았습니다: 경기 ${data.counts.matches}건, 선수 ${data.counts.members}명` });
    });

  // 업로드 토큰이 들어 있는 수집기: 설치 후 아무것도 입력할 필요가 없다 (관리자만 받을 수 있음)
  const downloadReadyCollector = () =>
    run("collector", async () => {
      await adminFetch("verify"); // 로그인 안 돼 있으면 여기서 비밀번호 창
      const res = await fetch("/api/collector?withToken=1", { headers: { "x-admin-password": getAdminPassword() || "" } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(String((body as { error?: string }).error || `내려받기 실패 (${res.status})`));
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = "naejeon-collector-ready.zip";
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice({ kind: "ok", text: "토큰이 들어 있는 수집기를 내려받았습니다. 압축을 풀고 내전수집기.bat 을 더블클릭하면 끝입니다." });
    });

  const pickFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const loaded = await Promise.all(
      Array.from(list).map(async (f) => ({ name: f.name, text: await f.text(), lastModified: f.lastModified }))
    );
    setFiles(loaded);
    setReport(null);
    run("preview", async () => {
      setReport(await adminFetch<ImportReport>("import", { files: loaded, dryRun: true }));
    });
  };

  const applyImport = () =>
    run("import", async () => {
      const res = await adminFetch<ImportReport>("import", { files, dryRun: false });
      setReport(res);
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      setNotice({
        kind: "ok",
        text: `가져오기 완료: 추가 ${res.inserted} · 갱신 ${res.updated} · 수기 기록에 합침 ${res.merged} · 건너뜀 ${res.skipped} · 중복 후보 ${res.candidates} · 오류 ${res.invalid}`,
      });
      if (res.candidates > 0) await loadPending();
    });

  const resolve = (id: string, decision: "merge" | "keep" | "discard") =>
    run("resolve", async () => {
      await adminFetch("resolvePending", { id, decision });
      setPending((prev) => (prev ? prev.filter((p) => p.row.id !== id) : prev));
      setNotice({ kind: "ok", text: decision === "merge" ? "기존 기록에 합쳤습니다" : decision === "keep" ? "별개 경기로 등록했습니다" : "버렸습니다" });
    });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 min-w-0 space-y-4">
      <button
        onClick={() => router.push("/group/main")}
        className="flex items-center gap-1 text-sm text-ink-subtle hover:text-ink transition-fast cursor-pointer"
      >
        <ChevronLeft size={16} />
        돌아가기
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">기록 관리</h1>
          <p className="text-sm text-ink-subtle break-keep">백업·복원, 과거 경기 가져오기, 중복 후보 검토. 모든 작업에 관리자 비밀번호가 필요합니다.</p>
        </div>
        {loggedIn ? (
          <Button variant="ghost" size="sm" onClick={() => setAdminPassword(null)}>
            <LogOut size={13} /> 로그아웃
          </Button>
        ) : (
          <Button size="sm" onClick={() => run("login", async () => void (await adminFetch("verify")))}>
            <ShieldCheck size={13} /> 관리자 로그인
          </Button>
        )}
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm break-words ${
            notice.kind === "error" ? "border-lose/30 bg-lose/5 text-lose" : "border-win/30 bg-win/5 text-win"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* 0. 수집기 */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">수집기 (설치 없이 바로 쓰는 버전)</h2>
        <ol className="text-xs text-ink-subtle list-decimal pl-4 space-y-1 break-keep">
          <li>아래 버튼으로 받은 ZIP 을 지워지지 않을 폴더에 풉니다.</li>
          <li><code className="text-ink-muted">내전수집기.bat</code> 을 더블클릭합니다. 끝입니다.</li>
        </ol>
        <p className="text-xs text-ink-subtle break-keep">
          Python 이 없으면 자동 설치하고, 업로드 토큰도 들어 있어 입력할 것이 없습니다. 이후 PC 를 켜면 알아서 실행되고,
          내전이 끝날 때마다 자동으로 올리며, 롤에 로그인하면 아직 안 올린 과거 내전도 올립니다(등록된 멤버 5명 이상인 5대5만).
          이 ZIP 에는 업로드 토큰이 들어 있으니 <span className="text-ink-muted">내전하는 사람에게만</span> 주세요 — 토큰으로는 경기 추가만 가능하고 수정·삭제는 못 합니다.
        </p>
        <Button size="sm" onClick={downloadReadyCollector} disabled={Boolean(busy)}>
          <Download size={13} /> {busy === "collector" ? "만드는 중..." : "토큰 포함 수집기 내려받기"}
        </Button>
      </Card>

      {/* 1. 백업 */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">1. 백업 내보내기</h2>
        <p className="text-xs text-ink-subtle break-keep">
          경기(참가자 스탯 포함)와 선수 정보를 JSON 파일 하나로 내려받습니다. 이 파일을 아래 &quot;가져오기&quot;에 넣으면 그대로 복원됩니다
          (이미 있는 경기는 건너뛰므로 여러 번 넣어도 중복되지 않습니다).
        </p>
        <Button size="sm" variant="secondary" onClick={exportBackup} disabled={Boolean(busy)}>
          <Download size={13} /> {busy === "export" ? "내보내는 중..." : "백업 파일 내려받기"}
        </Button>
      </Card>

      {/* 2. 가져오기 */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">2. 경기 자료 가져오기 / 복원</h2>
        <ul className="text-xs text-ink-subtle list-disc pl-4 space-y-1 break-keep">
          <li>수집기 PC의 <code className="text-ink-muted">match_backup_*.json</code>, <code className="text-ink-muted">backups/</code>·<code className="text-ink-muted">pending/</code> 폴더의 파일</li>
          <li>수집기 &quot;과거 경기 JSON 저장&quot;으로 만든 <code className="text-ink-muted">history_export_*.json</code> (여러 사람 것을 한꺼번에 넣어도 gameId로 중복 제거)</li>
          <li>이 사이트의 백업 파일, 기존 DB에서 내보낸 matches / members 표 (JSON 또는 Supabase CSV)</li>
        </ul>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".json,.csv,application/json,text/csv"
          onChange={(e) => pickFiles(e.target.files)}
          className="block w-full text-xs text-ink-subtle file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:text-ink file:cursor-pointer"
        />
        {busy === "preview" && <p className="text-xs text-ink-subtle">파일을 확인하는 중...</p>}

        {report && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant="default">{report.dryRun ? "미리보기 (아직 반영 안 됨)" : "반영 완료"}</Badge>
              <Badge variant="win">추가 {report.inserted}</Badge>
              <Badge variant="default">갱신 {report.updated}</Badge>
              <Badge variant="default">수기 기록에 합침 {report.merged}</Badge>
              <Badge variant="default">건너뜀 {report.skipped}</Badge>
              <Badge variant="ace">중복 후보 {report.candidates}</Badge>
              {report.invalid > 0 && <Badge variant="lose">오류 {report.invalid}</Badge>}
              {report.membersAdded > 0 && <Badge variant="default">새 선수 {report.membersAdded}</Badge>}
            </div>
            {report.aliasesAdded.length > 0 && (
              <p className="text-xs text-ink-subtle break-keep">
                부캐로 자동 등록(통계는 기존 닉네임으로 합산):{" "}
                {report.aliasesAdded.map((a) => `${a.from} → ${a.to}`).join(", ")}
              </p>
            )}
            {report.aliasConflicts.length > 0 && (
              <p className="text-xs text-ace break-keep">
                같은 사람으로 보이지만 이미 따로 기록돼 있어 자동으로 합치지 않음 (선수 정보 → 아이디 통합에서 직접 합치세요):{" "}
                {report.aliasConflicts.map((a) => `${a.from} → ${a.to}`).join(", ")}
              </p>
            )}
            {report.parseErrors.length > 0 && (
              <ul className="text-xs text-lose list-disc pl-4 break-words">
                {report.parseErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            {report.items.length > 0 && (
              <div className="overflow-auto max-h-72 rounded-lg border border-hairline">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-1 text-ink-subtle">
                    <tr className="border-b border-hairline whitespace-nowrap">
                      <th className="text-left py-2 px-3">경기일</th>
                      <th className="text-left py-2 px-3">처리</th>
                      <th className="text-left py-2 px-3">참가자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.items.map((it, i) => (
                      <tr key={i} className="border-b border-hairline/30 align-top">
                        <td className="py-1.5 px-3 whitespace-nowrap text-ink-muted">{fmtDate(it.date)}</td>
                        <td className="py-1.5 px-3 whitespace-nowrap">
                          <span className={it.status === "inserted" ? "text-win" : it.status === "invalid" ? "text-lose" : it.status === "candidate" ? "text-ace" : "text-ink-subtle"}>
                            {STATUS_LABEL[it.status]}
                          </span>
                          {it.reason && <div className="text-ink-tertiary whitespace-normal min-w-32">{REASON_LABEL[it.reason] || it.reason}</div>}
                        </td>
                        <td className="py-1.5 px-3 text-ink-subtle min-w-56">{it.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.dryRun && report.total > 0 && (
              <Button size="sm" onClick={applyImport} disabled={Boolean(busy) || report.inserted + report.updated + report.merged + report.candidates + report.membersAdded === 0}>
                <Upload size={13} /> {busy === "import" ? "반영 중..." : "DB에 반영"}
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* 3. 중복 후보 */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">3. 중복 후보 검토</h2>
          <Button size="sm" variant="secondary" onClick={loadPending} disabled={Boolean(busy)}>
            <RefreshCw size={13} className={busy === "pending" ? "animate-spin" : ""} /> 불러오기
          </Button>
        </div>
        <p className="text-xs text-ink-subtle break-keep">
          gameId가 없는 기록(수기 28경기 등)과 같은 경기로 보이는 자료는 바로 합치지 않고 여기에 보류됩니다. 보류된 경기는 통계에 포함되지 않습니다.
        </p>
        {pending && pending.length === 0 && <p className="text-xs text-ink-tertiary">검토할 중복 후보가 없습니다.</p>}
        {pending?.map(({ row, match, target }) => (
          <div key={row.id} className="rounded-lg border border-hairline p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <MatchSummary title="새로 들어온 자료 (보류 중)" match={match} />
              {target ? <MatchSummary title="기존 기록" match={target} /> : <p className="text-xs text-ink-tertiary">기존 기록이 삭제됐습니다.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => resolve(row.id, "merge")} disabled={Boolean(busy) || !target}>
                <GitMerge size={13} /> 같은 경기 — 기존 기록에 합치기
              </Button>
              <Button size="sm" variant="secondary" onClick={() => resolve(row.id, "keep")} disabled={Boolean(busy)}>
                다른 경기 — 따로 등록
              </Button>
              <Button size="sm" variant="danger" onClick={() => confirm("보류된 자료를 버릴까요?") && resolve(row.id, "discard")} disabled={Boolean(busy)}>
                버리기
              </Button>
            </div>
          </div>
        ))}
      </Card>

      {/* 4. 점검 */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">4. 배포 상태 점검</h2>
          <Button size="sm" variant="secondary" onClick={checkHealth} disabled={Boolean(busy)}>
            <Activity size={13} /> 점검
          </Button>
        </div>
        <p className="text-xs text-ink-subtle break-keep">환경변수 설정 여부, DB 연결, 경기 수, anon key 쓰기 차단 여부를 확인합니다 (비밀값은 표시하지 않습니다).</p>
        {health && (
          <pre className="text-[11px] text-ink-muted bg-surface-2 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
      </Card>
    </div>
  );
}

function MatchSummary({ title, match }: { title: string; match: Match }) {
  const side = (team: "blue" | "red") => match.players.filter((p) => p.team === team);
  const win = side("blue")[0]?.win;
  return (
    <div className="min-w-0 text-xs">
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <span className="font-semibold text-ink">{title}</span>
        <span className="text-ink-tertiary">{fmtDate(match.createdAt)}{match.timeUnknown ? " (시각 미상)" : ""}</span>
        {match.gameDuration && <span className="text-ink-tertiary">{match.gameDuration}</span>}
        <Badge variant="default">{match.gameId ? `gameId ${match.gameId}` : "gameId 없음"}</Badge>
      </div>
      {(["blue", "red"] as const).map((team) => (
        <div key={team} className="mb-1">
          <span className={team === "blue" ? "text-blue-400" : "text-red-400"}>
            {team === "blue" ? "블루" : "레드"} {(team === "blue" ? win : !win) ? "승" : "패"}
          </span>
          <ul className="text-ink-subtle">
            {side(team).map((p) => (
              <li key={p.id} className="break-all">
                {p.nickname} · {p.champion} · {p.kills}/{p.deaths}/{p.assists}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
