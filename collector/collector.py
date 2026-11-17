"""
컴학내전 데이터 수집기 (GUI)
- 롤 클라이언트 자동 감지
- 게임 종료 시 상세 데이터 추출 → 로컬 백업 → 서버 자동 업로드 (실패분은 자동 재전송)
- 과거 커스텀 게임 조회 → 선택 업로드 / JSON 파일로 저장
- Windows 로그인 시 자동 실행 (백그라운드)

설치: Python 3만 있으면 됨 (외부 패키지 불필요, GUI는 내장 tkinter 사용)
실행: 내전수집기.bat 더블클릭  (또는 python collector.py)

명령행:
  --background           창을 최소화한 채 실시간 수집을 바로 시작 (자동 실행용)
  --cli                  콘솔 모드 실시간 수집
  --history              콘솔 모드: 과거 커스텀 게임 선택 업로드
  --export-history [경로] 조회 가능한 과거 커스텀 게임을 전부 JSON 파일로 저장 (업로드 안 함)
  --retry                전송 대기(pending) 중인 경기를 다시 전송
  --set-token            업로드 토큰 입력·저장
  --install-autostart / --uninstall-autostart   Windows 로그인 시 자동 실행 등록/해제
"""

import json
import time
import os
import re
import sys
import ssl
import base64
import threading
import subprocess
import urllib.request
import urllib.error
from datetime import datetime

# ─── 설정 ───
SERVER_URL = "https://your-site.vercel.app"  # 사이트에서 내려받으면 자동으로 채워짐
# 업로드 토큰(서버의 UPLOAD_SECRET)은 이 파일에 넣지 않는다.
# 처음 실행할 때 한 번 입력하면 이 PC의 설정 파일(collector_config.json)에만 저장된다.
APP_NAME = "naejeon-collector"
# 관리 화면의 "토큰 포함 수집기"로 내려받으면 업로드 토큰이 여기 채워진다 (공개 다운로드에는 비어 있음)
EMBEDDED_UPLOAD_TOKEN = ""
# 다른 사람들과 한 5대5 커스텀이 올라가지 않도록: 10명 중 이만큼 이상이 사이트에 등록된 멤버일 때만 업로드
ROSTER_MIN_KNOWN = 5
HISTORY_SYNC_INTERVAL = 6 * 3600  # 같은 계정의 과거 경기 자동 동기화 간격 (초)
SINGLE_INSTANCE_PORT = 47631
RETRY_PENDING_INTERVAL = 300  # 전송 대기 건 자동 재전송 간격 (초)
POLL_INTERVAL = 5  # 클라이언트 감지 간격 (초)
GAME_CHECK_INTERVAL = 10  # 게임 상태 체크 간격 (초)
EOG_RETRY_COUNT = 5  # 게임 종료 후 데이터 조회 재시도 횟수
EOG_RETRY_INTERVAL = 3  # 재시도 간격 (초)

# SSL 인증서 무시 (LCU는 자체 서명 인증서 사용)
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

# 모듈 전역 로거 — GUI 모드에서 큐에 넣는 함수로 교체됨
log = print


# ═══════════════════════════════════════════════
#  로컬 저장소: 설정 · 경기 백업 · 전송 대기열
# ═══════════════════════════════════════════════

def get_data_dir():
    """설정과 백업을 두는 폴더. NAEJEON_DATA_DIR > %APPDATA%\\naejeon-collector > 스크립트 폴더"""
    custom = os.environ.get("NAEJEON_DATA_DIR")
    if custom:
        base = custom
    elif os.environ.get("APPDATA"):
        base = os.path.join(os.environ["APPDATA"], APP_NAME)
    else:
        base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "naejeon-data")
    os.makedirs(base, exist_ok=True)
    return base


def _subdir(name):
    path = os.path.join(get_data_dir(), name)
    os.makedirs(path, exist_ok=True)
    return path


def backups_dir():
    """모든 경기의 원본 백업 (업로드 성공 여부와 무관하게 영구 보관)"""
    return _subdir("backups")


def pending_dir():
    """아직 서버에 올라가지 않은 경기 (성공하면 지워짐)"""
    return _subdir("pending")


def rejected_dir():
    """서버가 형식 오류로 거부한 경기 (재전송해도 소용없는 건)"""
    return _subdir("rejected")


def config_path():
    return os.path.join(get_data_dir(), "collector_config.json")


def load_config():
    try:
        with open(config_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    tmp = config_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, config_path())


def get_upload_token():
    """업로드 토큰: 환경변수 NAEJEON_UPLOAD_TOKEN > 설정 파일"""
    return (os.environ.get("NAEJEON_UPLOAD_TOKEN") or load_config().get("upload_token") or EMBEDDED_UPLOAD_TOKEN or "").strip()


def set_upload_token(token):
    cfg = load_config()
    cfg["upload_token"] = (token or "").strip()
    save_config(cfg)


def get_server_url():
    return (os.environ.get("NAEJEON_SERVER_URL") or load_config().get("server_url") or SERVER_URL).rstrip("/")


def _match_file_name(match_data):
    game_id = match_data.get("gameId")
    if game_id:
        return f"match_{game_id}.json"
    # gameId 가 없으면 내용 기반 이름 (같은 경기를 두 번 저장해도 파일이 늘지 않게)
    import hashlib
    digest = hashlib.sha1(json.dumps(match_data.get("players", []), sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
    return f"match_nogameid_{digest}.json"


def _write_json_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def save_backup(match_data, raw=None, source="collector"):
    """서버 전송 전에 경기 원본을 로컬에 저장. 저장된 경로를 반환.
    파일 내용은 사이트의 '기록 관리 > 가져오기'에 그대로 넣을 수 있는 형식이다."""
    record = dict(match_data)
    record["_backup"] = {
        "savedAt": datetime.now().isoformat(timespec="seconds"),
        "source": source,
        "collectorVersion": 2,
    }
    if raw is not None:
        record["_raw"] = raw  # LCU 원본 응답 (나중에 필드를 더 뽑아야 할 때 대비)
    path = os.path.join(backups_dir(), _match_file_name(match_data))
    _write_json_atomic(path, record)
    return path


def enqueue_pending(match_data, source="collector"):
    path = os.path.join(pending_dir(), _match_file_name(match_data))
    _write_json_atomic(path, {"source": source, "match": match_data})
    return path


def list_pending():
    try:
        return sorted(
            os.path.join(pending_dir(), n) for n in os.listdir(pending_dir()) if n.endswith(".json")
        )
    except OSError:
        return []


TIER_KO = {
    "IRON": "아이언", "BRONZE": "브론즈", "SILVER": "실버", "GOLD": "골드", "PLATINUM": "플래티넘",
    "EMERALD": "에메랄드", "DIAMOND": "다이아", "MASTER": "마스터", "GRANDMASTER": "그랜드마스터", "CHALLENGER": "챌린저",
}
DIVISION_NUM = {"I": 1, "II": 2, "III": 3, "IV": 4}


def solo_tier_from_ranked(stats):
    """LCU 랭크 정보 → "다이아 2" 형식 (솔로랭크 기록이 없으면 None)"""
    if not isinstance(stats, dict):
        return None
    entry = (stats.get("queueMap") or {}).get("RANKED_SOLO_5x5")
    if not entry:
        entry = next((q for q in stats.get("queues") or [] if q.get("queueType") == "RANKED_SOLO_5x5"), None)
    if not entry:
        return None
    tier = TIER_KO.get(str(entry.get("tier") or "").upper())
    if not tier:
        return None  # 배치 전 / 언랭
    if tier in ("마스터", "그랜드마스터", "챌린저"):
        return tier
    div = DIVISION_NUM.get(str(entry.get("division") or "").upper())
    return f"{tier} {div}" if div else tier


def attach_solo_tiers(lock_info, match_data):
    """참가자별 현재 솔랭 티어를 롤 클라이언트에서 조회해 기록해 둔다 (실패해도 무시).
    팀 밸런스에는 자동으로 쓰지 않는다 — 나중에 티어가 필요할 때 꺼내 쓰기 위한 기록."""
    if lock_info is None:
        return
    for p in match_data.get("players", []):
        puuid = p.get("puuid")
        if not puuid or p.get("soloTier"):
            continue
        try:
            tier = solo_tier_from_ranked(lcu_request(lock_info, f"/lol-ranked/v1/ranked-stats/{puuid}"))
        except Exception:
            tier = None
        if tier:
            p["soloTier"] = tier


# ─── 멤버 확인 (다른 무리와 한 커스텀 거르기) ───

_roster_cache = {"at": 0.0, "names": None, "puuids": None}


def fetch_roster(force=False):
    """사이트에 등록된 멤버 닉네임·부캐·계정 ID. 받을 수 없으면 None (그때는 거르지 않는다)"""
    if not force and _roster_cache["names"] is not None and time.time() - _roster_cache["at"] < 600:
        return _roster_cache
    try:
        with urllib.request.urlopen(f"{get_server_url()}/api/roster", timeout=10) as resp:
            data = json.loads(resp.read().decode())
        _roster_cache.update(at=time.time(), names=set(data.get("names") or []), puuids=set(data.get("puuids") or []))
        return _roster_cache
    except Exception:
        return None


def roster_check(match_data):
    """(올려도 되는지, 아는 사람 수). 명단을 못 받았거나 명단이 비어 있으면(새 사이트) 올린다"""
    roster = fetch_roster()
    if not roster or not roster["names"]:
        return True, None
    known = sum(
        1 for p in match_data.get("players", [])
        if p.get("nickname") in roster["names"] or (p.get("puuid") and p.get("puuid") in roster["puuids"])
    )
    return known >= ROSTER_MIN_KNOWN, known


def skipped_dir():
    """멤버가 아닌 사람들과 한 커스텀 (올리지 않고 보관만)"""
    return _subdir("not-uploaded")


def keep_unuploaded(match_data, known):
    try:
        path = os.path.join(skipped_dir(), _match_file_name(match_data))
        _write_json_atomic(path, match_data)
    except OSError:
        path = None
    log(f"  ⏭️  등록된 멤버가 {known}명뿐이라 내전이 아닌 것으로 보고 올리지 않았습니다 (PC에만 보관: not-uploaded 폴더)")
    return path


# ─── 과거 경기 자동 동기화 ───

def _synced_path():
    return os.path.join(get_data_dir(), "synced_games.json")


def load_synced():
    try:
        with open(_synced_path(), "r", encoding="utf-8") as f:
            return set(str(x) for x in json.load(f))
    except (OSError, ValueError):
        return set()


def save_synced(ids):
    try:
        _write_json_atomic(_synced_path(), sorted(ids))
    except OSError:
        pass


def auto_sync_history(lock_info, force=False):
    """롤에 로그인한 계정의 과거 내전 중 아직 안 올린 것을 올린다. (올린 수, 건너뛴 수) 반환.
    같은 계정은 HISTORY_SYNC_INTERVAL 마다 한 번만. 한 번 처리한 경기는 synced_games.json 에 기억한다."""
    puuid = get_current_puuid(lock_info) or "unknown"
    cfg = load_config()
    last = (cfg.get("history_synced_at") or {}).get(puuid, 0)
    if not force and time.time() - last < HISTORY_SYNC_INTERVAL:
        return 0, 0
    if not get_upload_token():
        return 0, 0

    synced = load_synced()
    games = [g for g in fetch_custom_games(lock_info) if str(g.get("gameId")) not in synced]
    uploaded = skipped = 0
    if games:
        log(f"  🔄 과거 경기 자동 동기화: 확인할 커스텀 게임 {len(games)}개")
        naejeon, excluded = classify_custom_games(lock_info, games)
        for g, _ in excluded:
            synced.add(str(g.get("gameId")))  # 내전이 아님 — 다시 볼 필요 없음
        for g in naejeon:
            match_data, raw = build_history_match(lock_info, g)
            if not match_data:
                continue
            ok, known = roster_check(match_data)
            if not ok:
                keep_unuploaded(match_data, known)
                synced.add(str(g.get("gameId")))
                skipped += 1
                continue
            status, result = deliver(match_data, source="history", raw=raw)
            if status in ("ok", "rejected"):
                synced.add(str(g.get("gameId")))
            if status == "ok":
                uploaded += 1
            elif status in ("retry", "no_token"):
                break  # 서버 문제 — 다음 동기화 때 이어서
        save_synced(synced)
        log(f"  🔄 과거 경기 자동 동기화 완료: 올림 {uploaded}건, 멤버가 아니라 건너뜀 {skipped}건")
    cfg = load_config()
    cfg.setdefault("history_synced_at", {})[puuid] = time.time()
    save_config(cfg)
    return uploaded, skipped


def deliver(match_data, source="collector", raw=None):
    """경기 1건 처리의 단일 경로: ① 로컬 백업 → ② 전송 대기열 등록 → ③ 업로드 시도.
    업로드가 실패해도 ①②가 남으므로 데이터는 사라지지 않는다.
    반환: (status, result)  status ∈ ok | retry | rejected | no_token"""
    try:
        save_backup(match_data, raw=raw, source=source)
    except OSError as e:
        log(f"  ⚠️  로컬 백업 저장 실패: {e}")
    try:
        pending_path = enqueue_pending(match_data, source=source)
    except OSError as e:
        log(f"  ⚠️  전송 대기열 저장 실패: {e}")
        pending_path = None

    status, result = upload_match(match_data, source=source)
    _settle_pending(pending_path, status)
    return status, result


def _settle_pending(pending_path, status):
    if not pending_path or not os.path.exists(pending_path):
        return
    try:
        if status == "ok":
            os.remove(pending_path)
        elif status == "rejected":
            os.replace(pending_path, os.path.join(rejected_dir(), os.path.basename(pending_path)))
    except OSError:
        pass


def retry_pending(quiet=False):
    """전송 대기 중인 경기를 다시 올린다. (성공 수, 남은 수) 반환"""
    files = list_pending()
    if not files:
        return 0, 0
    if not get_upload_token():
        if not quiet:
            log(f"  ⚠️  전송 대기 {len(files)}건 — 업로드 토큰이 설정되지 않아 보류 중")
        return 0, len(files)
    if not quiet:
        log(f"  🔁 전송 대기 {len(files)}건 재전송 시도...")
    sent = 0
    for path in files:
        try:
            with open(path, "r", encoding="utf-8") as f:
                item = json.load(f)
        except (OSError, ValueError):
            try:
                os.replace(path, os.path.join(rejected_dir(), os.path.basename(path)))
            except OSError:
                pass
            continue
        match_data = item.get("match") if isinstance(item, dict) and "match" in item else item
        status, _ = upload_match(match_data, source=(item.get("source") if isinstance(item, dict) else None) or "collector", quiet=True)
        _settle_pending(path, status)
        if status == "ok":
            sent += 1
        elif status in ("retry", "no_token"):
            break  # 서버/네트워크 문제 — 나머지도 실패할 테니 다음 기회에
    remaining = len(list_pending())
    if not quiet or sent:
        log(f"  🔁 재전송 결과: 성공 {sent}건, 남은 대기 {remaining}건")
    return sent, remaining


# ═══════════════════════════════════════════════
#  Windows 로그인 시 자동 실행
# ═══════════════════════════════════════════════

AUTOSTART_VALUE_NAME = "NaejeonCollector"
_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def autostart_command():
    """자동 실행에 등록할 명령줄 (콘솔 창이 뜨지 않도록 pythonw 사용)"""
    exe = sys.executable or "pythonw"
    folder, name = os.path.split(exe)
    if name.lower() in ("python.exe", "python3.exe"):
        candidate = os.path.join(folder, "pythonw.exe")
        if os.path.exists(candidate):
            exe = candidate
    return f'"{exe}" "{os.path.abspath(__file__)}" --background'


def install_autostart():
    """현재 사용자(HKCU)의 로그인 시 실행 목록에 등록. 관리자 권한 불필요."""
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, AUTOSTART_VALUE_NAME, 0, winreg.REG_SZ, autostart_command())


def uninstall_autostart():
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, AUTOSTART_VALUE_NAME)
    except FileNotFoundError:
        pass


def is_autostart_installed():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_READ) as key:
            value, _ = winreg.QueryValueEx(key, AUTOSTART_VALUE_NAME)
            return bool(value)
    except Exception:
        return False


_instance_socket = None


def acquire_single_instance():
    """수집기가 이미 떠 있으면 False (자동 실행 + 수동 실행이 겹쳐 같은 경기를 두 번 올리지 않게)"""
    global _instance_socket
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", SINGLE_INSTANCE_PORT))
        s.listen(1)
    except OSError:
        s.close()
        return False
    _instance_socket = s
    return True


def find_lockfile():
    """롤 클라이언트 lockfile 찾기"""
    # Windows 기본 경로들
    paths = [
        os.path.expandvars(r"%LOCALAPPDATA%\Riot Games\League of Legends\lockfile"),
        r"C:\Riot Games\League of Legends\lockfile",
        r"D:\Riot Games\League of Legends\lockfile",
    ]

    # 환경변수로 커스텀 경로 지원
    custom = os.environ.get("LOL_PATH")
    if custom:
        paths.insert(0, os.path.join(custom, "lockfile"))

    for path in paths:
        if os.path.exists(path):
            return path
    return None


def find_credentials_from_process():
    """실행 중인 롤 클라이언트 프로세스에서 접속 정보 추출
    (설치 경로가 어디든 동작 — lockfile을 못 찾을 때의 폴백)"""
    try:
        flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
        out = subprocess.run(
            [
                "powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\""
                " | ForEach-Object { $_.CommandLine }",
            ],
            capture_output=True,
            timeout=20,
            creationflags=flags,
        ).stdout.decode("utf-8", errors="ignore")
    except Exception:
        return None

    port = re.search(r"--app-port=(\d+)", out)
    token = re.search(r"--remoting-auth-token=([\w-]+)", out)
    if port and token:
        return {"port": port.group(1), "password": token.group(1), "protocol": "https"}
    return None


def get_credentials():
    """LCU 접속 정보: lockfile 우선, 실패 시 프로세스에서 추출"""
    path = find_lockfile()
    if path:
        info = parse_lockfile(path)
        if info:
            return info
    return find_credentials_from_process()


def parse_lockfile(path):
    """lockfile에서 포트와 비밀번호 추출"""
    try:
        with open(path, "r") as f:
            content = f.read().strip()
        parts = content.split(":")
        if len(parts) >= 5:
            return {
                "port": parts[2],
                "password": parts[3],
                "protocol": parts[4],
            }
    except (IOError, PermissionError):
        pass
    return None


def _redact(endpoint):
    """로그에 남길 때 puuid 같은 긴 식별자를 가린다"""
    # Riot PUUID 는 78자 base64url 문자열이라 UUID 형식이 아니다 — 경로 위치로 가린다
    endpoint = re.sub(r"(/products/lol/)(?!current-summoner/)[^/?]+", r"\1<puuid>", endpoint)
    return re.sub(r"[A-Za-z0-9_-]{40,}", "<id>", endpoint)


def lcu_get(lock_info, endpoint, timeout=15):
    """LCU API 호출. (HTTP 상태코드, JSON 또는 None, 오류 본문 앞부분) 반환. 연결 실패는 상태 0."""
    url = f"https://127.0.0.1:{lock_info['port']}{endpoint}"
    auth = base64.b64encode(f"riot:{lock_info['password']}".encode()).decode()

    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Accept", "application/json")

    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "null"), ""
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode(errors="ignore")
        except Exception:
            body = ""
        return e.code, None, body[:300]
    except Exception as e:
        return 0, None, str(e)[:300]


def lcu_request(lock_info, endpoint):
    """LCU API 호출 (JSON 또는 None). 404 가 아닌 오류는 어떤 요청이 왜 실패했는지 로그에 남긴다."""
    status, data, body = lcu_get(lock_info, endpoint)
    if status and status != 404 and data is None and status >= 400:
        log(f"  HTTP 에러: {status} ({_redact(endpoint).split('?')[0]}) {body[:150]}")
    return data


def get_game_phase(lock_info):
    """현재 게임 상태 확인"""
    result = lcu_request(lock_info, "/lol-gameflow/v1/gameflow-phase")
    return result if isinstance(result, str) else None


def get_eog_stats(lock_info):
    """게임 종료 후 상세 스탯 가져오기"""
    return lcu_request(lock_info, "/lol-end-of-game/v1/eog-stats-block")


def is_custom_game(lock_info):
    """현재 게임이 커스텀 게임인지 확인
    True/False = 확인됨, None = 확인 불가"""
    session = lcu_request(lock_info, "/lol-gameflow/v1/session")
    if not session:
        return None
    game_data = session.get("gameData", {})
    if game_data.get("isCustomGame"):
        return True
    queue = game_data.get("queue", {})
    if queue.get("id") == 0 or queue.get("gameTypeConfig", {}).get("name") == "GAME_CFG_CUSTOM":
        return True
    if queue.get("id") is not None:
        return False
    return None


# ─── 챔피언 ID → 이름 매핑 (Data Dragon) ───

_champion_map = None


def get_champion_map():
    """championId(숫자) → 영문 이름 매핑. 최초 1회 Data Dragon에서 로드"""
    global _champion_map
    if _champion_map is not None:
        return _champion_map
    try:
        with urllib.request.urlopen(
            "https://ddragon.leagueoflegends.com/api/versions.json", timeout=10
        ) as resp:
            version = json.loads(resp.read().decode())[0]
        url = f"https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json"
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        _champion_map = {int(v["key"]): v["id"] for v in data["data"].values()}
    except Exception as e:
        log(f"  ⚠️  챔피언 목록 로드 실패 ({e}) — 챔피언이 숫자로 표시될 수 있습니다")
        _champion_map = {}
    return _champion_map


def champion_id_to_name(champion_id):
    """championId → 영문 이름 (실패 시 숫자 문자열)"""
    if not champion_id:
        return ""
    try:
        return get_champion_map().get(int(champion_id), str(champion_id))
    except (TypeError, ValueError):
        return str(champion_id)


def lane_from_timeline(participant):
    """매치 상세의 timeline에서 포지션 추출 (top/jungle/mid/adc/support, 불명이면 None)"""
    tl = participant.get("timeline", {}) or {}
    lane = tl.get("lane", "")
    role = tl.get("role", "")
    if lane == "TOP":
        return "top"
    if lane == "JUNGLE":
        return "jungle"
    if lane in ("MIDDLE", "MID"):
        return "mid"
    if lane in ("BOTTOM", "BOT"):
        return "support" if role == "DUO_SUPPORT" else "adc"
    return None


def extract_bans(game):
    """매치 상세의 teams[].bans에서 밴 챔피언 추출 (드래프트 모드만 존재)"""
    bans = {"blue": [], "red": []}
    for team in game.get("teams", []):
        side = "blue" if team.get("teamId", 100) == 100 else "red"
        team_bans = sorted(team.get("bans", []) or [], key=lambda b: b.get("pickTurn", 0))
        for b in team_bans:
            cid = b.get("championId", -1)
            if cid and cid != -1:  # -1 = 밴 안 함
                bans[side].append(champion_id_to_name(cid))
    return bans if (bans["blue"] or bans["red"]) else None


def loadout_from_history(participant):
    """매치 상세(참가자)에서 아이템·소환사 주문·룬 (op.gg 식 경기 상세용)"""
    stats = participant.get("stats", {}) or {}
    items = [int(stats.get(f"item{i}", 0) or 0) for i in range(7)]  # 0~5 아이템, 6 장신구
    return {
        "items": items,
        "spell1Id": participant.get("spell1Id") or None,
        "spell2Id": participant.get("spell2Id") or None,
        "perkKeystone": stats.get("perk0") or None,
        "perkPrimaryStyle": stats.get("perkPrimaryStyle") or None,
        "perkSubStyle": stats.get("perkSubStyle") or None,
    }


def loadout_from_eog(player):
    """게임 종료 화면 데이터에서 아이템·주문·룬 (필드가 없으면 빈 값 — 매치 상세 보강이 채움)"""
    stats = player.get("stats", {}) or {}
    items = player.get("items")
    out = {}
    if isinstance(items, list) and items:
        out["items"] = [int(x or 0) for x in items[:7]] + [0] * max(0, 7 - len(items))
    for key, src in (("spell1Id", player.get("spell1Id")), ("spell2Id", player.get("spell2Id")),
                     ("perkKeystone", stats.get("PERK0")), ("perkPrimaryStyle", stats.get("PERK_PRIMARY_STYLE")),
                     ("perkSubStyle", stats.get("PERK_SUB_STYLE"))):
        if src:
            out[key] = src
    return out


def objectives_from_history(game):
    """팀별 오브젝트 (포탑·억제기·드래곤·바론·전령). 정보가 없으면 None"""
    out = {}
    for team in game.get("teams", []) or []:
        side = "blue" if team.get("teamId", 100) == 100 else "red"
        if "towerKills" not in team and "dragonKills" not in team:
            continue
        out[side] = {
            "towers": int(team.get("towerKills", 0) or 0),
            "inhibitors": int(team.get("inhibitorKills", 0) or 0),
            "dragons": int(team.get("dragonKills", 0) or 0),
            "barons": int(team.get("baronKills", 0) or 0),
            "heralds": int(team.get("riftHeraldKills", 0) or 0),
        }
    return out if len(out) == 2 else None


def format_duration(total_seconds):
    minutes = int(total_seconds) // 60
    seconds = int(total_seconds) % 60
    return f"{minutes}:{seconds:02d}"


def format_match_data(eog_data):
    """LCU EOG 데이터를 서버 포맷으로 변환"""
    if not eog_data or "teams" not in eog_data:
        return None

    teams = eog_data.get("teams", [])
    if len(teams) < 2:
        return None

    players = []

    for team_idx, team in enumerate(teams):
        team_side = "blue" if team_idx == 0 else "red"
        is_winner = team.get("isWinningTeam", False)

        for p in team.get("players", []):
            stats = p.get("stats", {})
            # Riot ID 체계 대응: 여러 필드에서 닉네임 찾기
            nickname = (
                p.get("summonerName")
                or p.get("riotIdGameName")
                or p.get("gameName")
                or p.get("puuid", "")[:8]
            )
            champion = (
                p.get("championName")
                or p.get("skinName")
                or champion_id_to_name(p.get("championId"))
            )
            player = {
                "nickname": nickname,
                # 계정 고유 ID·태그: 닉네임이 바뀌어도 같은 사람으로 이어 주고, 나중에 티어를 조회할 때 쓴다
                "puuid": p.get("puuid") or None,
                "tagLine": p.get("riotIdTagLine") or p.get("tagLine") or None,
                "champion": champion,
                "team": team_side,
                "win": is_winner,
                "kills": stats.get("CHAMPIONS_KILLED", 0),
                "deaths": stats.get("NUM_DEATHS", 0),
                "assists": stats.get("ASSISTS", 0),
                "cs": stats.get("MINIONS_KILLED", 0) + stats.get("NEUTRAL_MINIONS_KILLED", 0),
                "gold": stats.get("GOLD_EARNED", 0),
                "damageDealt": stats.get("TOTAL_DAMAGE_DEALT_TO_CHAMPIONS", 0),
                "damageTaken": stats.get("TOTAL_DAMAGE_TAKEN", 0),
                "visionScore": stats.get("VISION_SCORE", 0),
                "wardsPlaced": stats.get("WARD_PLACED", 0),
                "wardsDestroyed": stats.get("WARD_KILLED", 0),
                "objectiveDamage": stats.get("TOTAL_DAMAGE_DEALT_TO_OBJECTIVES", 0),
                "ccScore": stats.get("TOTAL_TIME_CROWD_CONTROL_DEALT", 0),
                "healingDone": stats.get("TOTAL_HEAL", 0),
                "shieldingDone": stats.get("TOTAL_DAMAGE_SHIELDED_ON_TEAMMATES", 0),
                "turretDamage": stats.get("TOTAL_DAMAGE_DEALT_TO_TURRETS", 0),
                "firstBlood": bool(stats.get("FIRST_BLOOD", 0)),
                "largestMultiKill": stats.get("LARGEST_MULTI_KILL", 0),
            }
            player.update(loadout_from_eog(p))
            players.append(player)

    return {
        "gameId": eog_data.get("gameId"),
        "gameDuration": format_duration(eog_data.get("gameLength", 0)),
        "players": players,
        "gameMode": eog_data.get("gameMode", "CLASSIC"),
    }


def upload_match(match_data, source="collector", quiet=False):
    """서버에 매치 데이터 업로드.
    반환: (status, result)
      ok       — 서버가 받음 (result 에 inserted/updated/duplicate/pendingReview 정보)
      retry    — 네트워크·서버 문제. 나중에 다시 보내면 됨
      rejected — 서버가 형식 오류로 거부 (다시 보내도 같은 결과)
      no_token — 업로드 토큰 미설정/불일치"""
    token = get_upload_token()
    if not token:
        if not quiet:
            log("  ⚠️  업로드 토큰이 설정되지 않았습니다 — 로컬에만 저장합니다 ([업로드 토큰 설정] 버튼)")
        return "no_token", None

    url = f"{get_server_url()}/api/upload"
    payload = json.dumps({"match": match_data, "source": source}).encode()

    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return "ok", json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")[:300]
        if e.code == 401:
            if not quiet:
                log("  업로드 실패: 업로드 토큰이 서버와 다릅니다 ([업로드 토큰 설정]에서 다시 입력)")
            return "no_token", None
        if e.code == 400:
            if not quiet:
                log(f"  업로드 거부(형식 오류): {body}")
            return "rejected", None
        if not quiet:
            log(f"  업로드 실패: {e.code} - {body}")
        return "retry", None
    except Exception as e:
        if not quiet:
            log(f"  업로드 에러: {e}")
        return "retry", None


def check_connection():
    """서버 주소와 업로드 토큰이 맞는지 확인. (성공 여부, 메시지)"""
    token = get_upload_token()
    if not token:
        return False, "업로드 토큰이 설정되지 않았습니다"
    req = urllib.request.Request(
        f"{get_server_url()}/api/upload", data=json.dumps({"ping": True}).encode(), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            json.loads(resp.read().decode())
        return True, "서버 연결 및 토큰 확인 완료"
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return False, "토큰이 서버의 UPLOAD_SECRET 과 다릅니다"
        if e.code == 503:
            return False, "서버에 UPLOAD_SECRET 환경변수가 설정되지 않았습니다"
        return False, f"서버 오류 ({e.code})"
    except Exception as e:
        return False, f"서버에 연결할 수 없습니다: {e}"


def describe_upload(status, result):
    """업로드 결과를 사람이 읽을 한 줄로"""
    if status == "ok":
        result = result or {}
        if result.get("pendingReview"):
            return "🟡 업로드됨 — 기존 수기 기록과 중복 후보로 보류 (사이트 '관리'에서 검토)"
        if result.get("merged"):
            return "🔗 기존 수기 기록과 같은 경기 — 상세 지표를 채워 합침"
        if result.get("updated"):
            return "🔄 기존 경기 갱신 완료 (날짜·스탯 덮어쓰기)"
        if result.get("duplicate"):
            return "ℹ️  이미 등록된 게임입니다 (중복 업로드 방지)"
        return "✅ 업로드 성공!"
    if status == "no_token":
        return "⚠️  로컬 백업만 저장됨 — 토큰 설정 후 자동 재전송됩니다"
    if status == "rejected":
        return "❌ 서버가 형식 오류로 거부 — rejected 폴더에 보관"
    return "⚠️  업로드 실패 — 로컬 백업 저장됨, 자동으로 재전송합니다"


def print_match_summary(match_data):
    """매치 플레이어/팀 요약 출력"""
    blue = [p for p in match_data["players"] if p["team"] == "blue"]
    red = [p for p in match_data["players"] if p["team"] == "red"]
    blue_win = blue[0]["win"] if blue else False

    log(f"  {'🔵 승' if blue_win else '🔵 패'}: {', '.join(p['nickname'] for p in blue)}")
    log(f"  {'🔴 승' if not blue_win else '🔴 패'}: {', '.join(p['nickname'] for p in red)}")


def enrich_from_history(lock_info, match_data, game_id):
    """EOG에 없거나 불확실한 정보(포지션, 포탑딜, 선취점, 멀티킬)를
    매치 히스토리 상세로 보강. 게임 직후라 히스토리에 아직 없을 수
    있음 — 실패해도 무시 (서버가 폴백 처리)"""
    full = get_full_game(lock_info, game_id)
    if not full:
        return False
    bans = extract_bans(full)
    if bans:
        match_data["bans"] = bans
    objectives = objectives_from_history(full)
    if objectives:
        match_data["objectives"] = objectives
    if full.get("gameCreation"):
        match_data["gameCreation"] = full["gameCreation"]
    ident_map = {
        i.get("participantId"): (i.get("player", {}) or {})
        for i in full.get("participantIdentities", [])
    }
    extra_by_name = {}
    for p in full.get("participants", []):
        info = ident_map.get(p.get("participantId"), {})
        name = (
            info.get("summonerName")
            or info.get("gameName")
            or info.get("riotIdGameName")
        )
        if not name:
            continue
        stats = p.get("stats", {})
        extra_by_name[name] = {
            "loadout": loadout_from_history(p),
            "lane": lane_from_timeline(p),
            "turretDamage": stats.get("damageDealtToTurrets", 0),
            "firstBlood": stats.get("firstBloodKill", False),
            "largestMultiKill": stats.get("largestMultiKill", 0),
        }
    for mp in match_data["players"]:
        extra = extra_by_name.get(mp["nickname"])
        if not extra:
            continue
        if extra["lane"]:
            mp["lane"] = extra["lane"]
        if extra["turretDamage"]:
            mp["turretDamage"] = extra["turretDamage"]
        if extra["firstBlood"]:
            mp["firstBlood"] = True
        if extra["largestMultiKill"]:
            mp["largestMultiKill"] = extra["largestMultiKill"]
        mp.update({k: v for k, v in extra["loadout"].items() if v})
    return True


def handle_end_of_game(lock_info, last_game_id):
    """게임 종료 처리. 처리한 game_id를 반환 (처리 실패/스킵 시 last_game_id 그대로)"""
    # EOG 데이터가 준비될 때까지 재시도
    eog = None
    for attempt in range(EOG_RETRY_COUNT):
        eog = get_eog_stats(lock_info)
        if eog and eog.get("teams"):
            break
        if attempt < EOG_RETRY_COUNT - 1:
            time.sleep(EOG_RETRY_INTERVAL)

    if not eog:
        log("  ⚠️  EOG 데이터를 가져올 수 없습니다")
        return last_game_id

    game_id = eog.get("gameId")
    if game_id == last_game_id:
        return last_game_id  # 이미 처리한 게임

    # 커스텀 게임 확인
    custom = is_custom_game(lock_info)
    if custom is False:
        log("  ⏭️  커스텀 게임이 아니므로 건너뜁니다 (일반/랭크 게임)")
        return game_id  # 같은 게임을 반복 체크하지 않도록 기록

    match_data = format_match_data(eog)
    if not match_data or len(match_data["players"]) < 2:
        log("  ⚠️  데이터 불완전, 건너뜁니다")
        return game_id

    # 혼자 한 커스텀(봇전·1대1 등)은 내전이 아니므로 올리지 않는다
    humans = [p for t in eog.get("teams", []) for p in t.get("players", []) if not p.get("botPlayer")]
    blue = sum(1 for p in match_data["players"] if p["team"] == "blue")
    if len(match_data["players"]) != 10 or len(humans) != 10 or blue != 5:
        log(f"  ⏭️  내전이 아니므로 건너뜁니다 (참가 {len(match_data['players'])}명, 사람 {len(humans)}명)")
        return game_id
    map_id = (eog.get("mapId") if isinstance(eog, dict) else None)
    if map_id is not None and int(map_id) != RIFT_MAP_ID:
        log(f"  ⏭️  소환사의 협곡이 아니므로 건너뜁니다 (map {map_id})")
        return game_id

    log(f"  📊 {len(match_data['players'])}명 데이터 추출 완료")
    log(f"  ⏱️  게임 시간: {match_data['gameDuration']}")

    # 닉네임 누락 체크
    empty_names = [p for p in match_data["players"] if not p["nickname"]]
    if empty_names:
        log(f"  ⚠️  닉네임 누락 {len(empty_names)}명!")

    print_match_summary(match_data)

    # 포지션·포탑딜·선취점·멀티킬·아이템·룬·오브젝트 보강.
    # 게임 직후에는 매치 상세가 아직 없을 수 있어, 없으면 잠시 뒤 다시 받아 같은 경기로 갱신 업로드한다
    try:
        enriched = enrich_from_history(lock_info, match_data, game_id)
    except Exception:
        enriched = False
    if not enriched and game_id:
        _pending_enrich[game_id] = {"match": match_data, "tries": 0, "next": time.time() + ENRICH_RETRY_INTERVAL}

    # 히스토리 보강이 안 됐으면(게임 직후라 아직 없음) 종료 시각에서 역산해 경기 시각을 채운다
    if not match_data.get("gameCreation"):
        match_data["gameCreation"] = int(time.time() * 1000) - int(eog.get("gameLength", 0) or 0) * 1000

    attach_solo_tiers(lock_info, match_data)

    ok, known = roster_check(match_data)
    if not ok:
        keep_unuploaded(match_data, known)
        _pending_enrich.pop(game_id, None)
        return game_id

    # 로컬 백업 → 업로드 (실패해도 백업과 전송 대기열에 남는다)
    log("  💾 로컬 백업 후 서버에 업로드 중...")
    status, result = deliver(match_data, source="collector", raw=eog)
    log("  " + describe_upload(status, result))

    return game_id


# 게임 직후 매치 상세가 없던 경기: 나중에 보강해서 다시 올린다 (gameId 가 같아 서버에서는 갱신)
ENRICH_RETRY_INTERVAL = 30  # 초
ENRICH_MAX_TRIES = 20  # 약 10분
_pending_enrich = {}


def process_pending_enrich(lock_info):
    """보강 대기 중인 경기를 다시 시도. 성공하면 갱신 업로드"""
    now = time.time()
    for game_id, item in list(_pending_enrich.items()):
        if now < item["next"]:
            continue
        item["tries"] += 1
        item["next"] = now + ENRICH_RETRY_INTERVAL
        try:
            ok = enrich_from_history(lock_info, item["match"], game_id)
        except Exception:
            ok = False
        if ok:
            del _pending_enrich[game_id]
            status, result = deliver(item["match"], source="collector")
            log(f"  🧩 경기 {game_id} 상세(아이템·룬·오브젝트) 보강 후 다시 업로드: " + describe_upload(status, result))
        elif item["tries"] >= ENRICH_MAX_TRIES:
            del _pending_enrich[game_id]
            log(f"  ℹ️  경기 {game_id} 상세 보강 포기 (매치 기록에 아직 없음) — 기본 기록은 이미 올라가 있음")


PHASE_NAMES = {
    None: "클라이언트 응답 대기",
    "None": "대기",
    "Lobby": "로비",
    "Matchmaking": "매칭 중",
    "ReadyCheck": "수락 대기",
    "ChampSelect": "챔피언 선택",
    "GameStart": "게임 시작",
}

IN_GAME_PHASES = ("InProgress", "WaitingForStats", "PreEndOfGame", "Reconnect")


def realtime_loop(stop_event, set_status):
    """실시간 수집 루프. stop_event가 set되면 종료.
    set_status(text)로 현재 상태를 한 줄로 알림 (GUI 상태 표시줄 / 콘솔 출력)"""
    last_game_id = None
    was_in_game = False
    client_found = False
    last_phase = "__init__"
    history_due = False
    next_retry = 0.0  # 시작하자마자 한 번 재전송 시도

    while not stop_event.is_set():
        # 0. 전송 대기 건 자동 재전송 (게임 중이 아닐 때만, 일정 간격으로)
        if not was_in_game and time.time() >= next_retry:
            next_retry = time.time() + RETRY_PENDING_INTERVAL
            try:
                retry_pending(quiet=True)
            except Exception as e:
                log(f"  ⚠️  재전송 중 오류: {e}")

        # 1. 클라이언트 접속 정보 찾기 (lockfile → 프로세스 순)
        lock_info = get_credentials()
        if not lock_info:
            set_status("롤 클라이언트를 찾는 중... (로그인된 롤 클라이언트가 켜져 있어야 합니다)")
            client_found = False
            if stop_event.wait(POLL_INTERVAL):
                break
            continue

        if not client_found:
            log("  ✅ 롤 클라이언트 감지 완료")
            client_found = True
            history_due = True


        # 2. 게임 상태 확인
        phase = get_game_phase(lock_info)

        if phase != last_phase:
            if phase not in IN_GAME_PHASES and phase != "EndOfGame":
                set_status(f"게임 시작을 기다리는 중 (현재: {PHASE_NAMES.get(phase, phase)})")
            last_phase = phase

        # 게임 중 (종료 대기 화면 포함 — WaitingForStats/PreEndOfGame에서
        # 플래그를 리셋하면 EndOfGame을 놓치므로 반드시 '게임 중'으로 취급)
        if phase in IN_GAME_PHASES:
            if not was_in_game:
                log("  🎮 게임 진행 중... 종료를 기다리는 중")
                was_in_game = True
            set_status("게임 진행 중 — 종료를 기다리는 중")
            if stop_event.wait(GAME_CHECK_INTERVAL):
                break
            continue

        if phase == "EndOfGame":
            # 수집기를 게임 종료 후에 켰어도 처리되도록 was_in_game과 무관하게 시도
            # (중복은 game_id + 서버 측 중복 방지로 걸러짐)
            if was_in_game:
                log("  ✅ 게임 종료 감지! 데이터 추출 중...")
            set_status("게임 종료 — 데이터 추출/업로드 중")
            try:
                last_game_id = handle_end_of_game(lock_info, last_game_id)
            except Exception as e:
                # 한 경기 처리 실패로 수집 루프 전체가 멈추지 않도록
                log(f"  ⚠️  게임 종료 처리 중 오류: {e}")
            set_status("게임 종료 처리 완료 — 다음 게임을 기다리는 중")
            was_in_game = False
            if stop_event.wait(GAME_CHECK_INTERVAL):
                break
            continue

        # 대기 상태 — 보강 대기 중인 경기가 있으면 처리
        if _pending_enrich:
            process_pending_enrich(lock_info)
        # 롤에 로그인하면 아직 안 올린 과거 내전을 자동으로 올림 (게임 중이 아닐 때)
        if history_due and phase not in IN_GAME_PHASES and get_current_puuid(lock_info):
            history_due = False
            set_status("과거 내전 확인 중...")
            try:
                auto_sync_history(lock_info)
            except Exception as e:
                log(f"  ⚠️  과거 경기 동기화 중 오류: {e}")
            set_status("게임 시작을 기다리는 중")
        was_in_game = False
        if stop_event.wait(POLL_INTERVAL):
            break


def get_current_puuid(lock_info):
    """현재 로그인한 소환사의 puuid"""
    me = lcu_request(lock_info, "/lol-summoner/v1/current-summoner")
    return (me or {}).get("puuid")


HISTORY_PAGE_SIZES = (100, 50, 20, 10)  # 클라이언트가 큰 범위를 거부(500)하면 점점 줄여서 다시 요청


def _history_page(lock_info, base, beg, size):
    """히스토리 한 페이지. (게임 목록 또는 None=요청 실패, 상태코드, 오류 본문)"""
    status, data, body = lcu_get(lock_info, f"{base}?begIndex={beg}&endIndex={beg + size}", timeout=30)
    if data is None:
        return None, status, body
    games = (data.get("games") or {}).get("games") if isinstance(data, dict) else None
    return (games or []), status, body


def get_match_history(lock_info, count=None, max_total=2000):
    """과거 매치 히스토리 가져오기 (puuid 우선, 구버전 엔드포인트 폴백).
    한 페이지씩 더 나오지 않을 때까지 넘겨 가며 모은다. 클라이언트가 큰 범위 요청에 500 을 주는 경우가 있어
    실패하면 페이지 크기를 줄여 다시 시도한다.
    (클라이언트가 보관·제공하는 범위까지만 조회된다 — 그 이전 경기는 이 방법으로 얻을 수 없다)"""
    bases = []
    puuid = get_current_puuid(lock_info)
    if puuid:
        bases.append(f"/lol-match-history/v1/products/lol/{puuid}/matches")
    bases.append("/lol-match-history/v1/products/lol/current-summoner/matches")
    sizes = (count,) if count else HISTORY_PAGE_SIZES

    failures = []
    for base in bases:
        games, seen, beg = [], set(), 0
        size_idx = 0
        while beg < max_total:
            size = sizes[size_idx]
            page, status, body = _history_page(lock_info, base, beg, size)
            if page is None:
                failures.append(f"{_redact(base)} [{beg}~{beg + size}] → HTTP {status} {body[:120]}")
                if size_idx + 1 < len(sizes):
                    size_idx += 1  # 더 작은 범위로 같은 위치를 다시 요청
                    continue
                break
            if not page:
                break
            fresh = [g for g in page if g.get("gameId") not in seen]
            if not fresh:
                break  # 같은 페이지가 반복되면(서버가 범위를 무시) 중단
            for g in fresh:
                seen.add(g.get("gameId"))
            games.extend(fresh)
            if len(page) < size:
                break
            beg += size
        if games:
            if failures:
                log(f"  ℹ️  일부 요청은 실패했지만 더 작은 범위로 {len(games)}경기를 가져왔습니다")
            return games
    for f in failures[:6]:
        log(f"  ⚠️  히스토리 요청 실패: {f}")
    return []


def summarize_history(games):
    """조회된 전체 전적 요약 (커스텀이 0개일 때 '전적 자체가 없는지'와 구분하기 위함)"""
    if not games:
        return "전적을 하나도 받지 못했습니다"
    stamps = [g.get("gameCreation") for g in games if g.get("gameCreation")]
    span = ""
    if stamps:
        fmt = lambda ms: datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d")
        span = f", {fmt(min(stamps))} ~ {fmt(max(stamps))}"
    queues = {}
    for g in games:
        q = g.get("queueId", "?")
        queues[q] = queues.get(q, 0) + 1
    top = ", ".join(f"큐 {q}: {n}" for q, n in sorted(queues.items(), key=lambda x: -x[1])[:6])
    return f"전체 {len(games)}경기{span} ({top})"


def diagnose(lock_info):
    """과거 전적 조회 문제 진단 — 각 요청의 상태코드를 모아 한 덩어리 문자열로 반환 (비밀값·puuid 없음)"""
    lines = []
    st, me, body = lcu_get(lock_info, "/lol-summoner/v1/current-summoner")
    lines.append(f"current-summoner: HTTP {st} {'OK' if me else body[:120]}")
    puuid = (me or {}).get("puuid")
    st, phase, _ = lcu_get(lock_info, "/lol-gameflow/v1/gameflow-phase")
    lines.append(f"gameflow-phase: HTTP {st} {phase}")
    bases = ([f"/lol-match-history/v1/products/lol/{puuid}/matches"] if puuid else []) + [
        "/lol-match-history/v1/products/lol/current-summoner/matches"
    ]
    for base in bases:
        for size in (200, 100, 20, 5):
            page, st, body = _history_page(lock_info, base, 0, size)
            desc = f"{len(page)}경기" if page is not None else body[:120]
            lines.append(f"{_redact(base)} [0~{size}]: HTTP {st} {desc}")
    return "\n".join(lines)


def get_full_game(lock_info, game_id):
    """특정 게임의 10명 전체 상세 데이터 조회
    (히스토리 목록에는 본인 참가자 정보만 들어있음)"""
    return lcu_request(lock_info, f"/lol-match-history/v1/games/{game_id}")


def format_history_match(game):
    """매치 히스토리 상세 데이터를 서버 포맷으로 변환"""
    participants = game.get("participants", [])
    identities = game.get("participantIdentities", [])

    # participantId → 닉네임 매핑
    id_map = {}
    ident_map = {}
    for ident in identities:
        pid = ident.get("participantId")
        player_info = ident.get("player", {})
        ident_map[pid] = player_info
        id_map[pid] = (
            player_info.get("summonerName")
            or player_info.get("gameName")
            or player_info.get("riotIdGameName")
            or f"Player{pid}"
        )

    players = []
    for p in participants:
        pid = p.get("participantId")
        stats = p.get("stats", {})
        team_id = p.get("teamId", 100)
        team_side = "blue" if team_id == 100 else "red"

        player = {
            "nickname": id_map.get(pid, f"Player{pid}"),
            "puuid": (ident_map.get(pid) or {}).get("puuid") or None,
            "tagLine": (ident_map.get(pid) or {}).get("tagLine") or (ident_map.get(pid) or {}).get("riotIdTagline") or None,
            "champion": champion_id_to_name(p.get("championId")),
            "lane": lane_from_timeline(p),
            "team": team_side,
            "win": stats.get("win", False),
            "kills": stats.get("kills", 0),
            "deaths": stats.get("deaths", 0),
            "assists": stats.get("assists", 0),
            "cs": stats.get("totalMinionsKilled", 0) + stats.get("neutralMinionsKilled", 0),
            "gold": stats.get("goldEarned", 0),
            "damageDealt": stats.get("totalDamageDealtToChampions", 0),
            "damageTaken": stats.get("totalDamageTaken", 0),
            "visionScore": stats.get("visionScore", 0),
            "wardsPlaced": stats.get("wardsPlaced", 0),
            "wardsDestroyed": stats.get("wardsKilled", 0),
            "objectiveDamage": stats.get("damageDealtToObjectives", 0),
            "ccScore": stats.get("totalTimeCrowdControlDealt", 0),
            "healingDone": stats.get("totalHeal", 0),
            "shieldingDone": stats.get("totalDamageShieldedOnTeammates", 0),
            "turretDamage": stats.get("damageDealtToTurrets", 0),
            "firstBlood": stats.get("firstBloodKill", False),
            "largestMultiKill": stats.get("largestMultiKill", 0),
        }
        player.update(loadout_from_history(p))
        players.append(player)

    return {
        "objectives": objectives_from_history(game),
        "gameId": game.get("gameId"),
        "gameCreation": game.get("gameCreation"),  # 실제 게임 시작 시각 (epoch ms)
        "gameDuration": format_duration(game.get("gameDuration", 0)),
        "players": players,
        "gameMode": game.get("gameMode", "CLASSIC"),
        "bans": extract_bans(game),
    }


def fetch_custom_games(lock_info):
    """매치 히스토리에서 커스텀 게임만 필터해 반환"""
    games = get_match_history(lock_info)
    log(f"  조회 결과: {summarize_history(games)}")
    return [
        g for g in games
        if g.get("queueId", -1) == 0 or g.get("gameType") == "CUSTOM_GAME"
    ]


# ─── 내전 판별 ───
# 내전 = 소환사의 협곡에서 사람 10명이 5대5 로 한 사용자 설정 게임.
# 혼자 한 커스텀(봇전, 1대1, 연습 등)은 제외한다.
RIFT_MAP_ID = 11
_ZERO_PUUID = "00000000-0000-0000-0000-000000000000"


def _is_bot_identity(player_info):
    """매치 상세의 participantIdentities[].player 가 봇인지.
    응답 형식이 버전마다 달라 "봇이라는 분명한 신호"가 있을 때만 봇으로 본다 (사람을 봇으로 오판해 내전을 버리지 않도록)."""
    if player_info is None:
        return True
    if player_info.get("isBot") or player_info.get("botPlayer"):
        return True
    puuid = str(player_info.get("puuid") or "")
    if puuid in (_ZERO_PUUID, "BOT"):
        return True
    # puuid 가 없고 계정 번호가 명시적으로 0 이면 봇
    if not puuid and "summonerId" in player_info and not player_info.get("summonerId") and not player_info.get("accountId"):
        return True
    return False


def naejeon_check(full_game):
    """(내전 여부, 사유). 사유는 제외될 때 로그·목록에 보여 줄 짧은 설명"""
    if not full_game:
        return False, "상세 조회 실패"
    map_id = full_game.get("mapId")
    if map_id is not None and int(map_id) != RIFT_MAP_ID:
        return False, f"협곡이 아님(map {map_id})"
    participants = full_game.get("participants") or []
    identities = {i.get("participantId"): (i.get("player") or {}) for i in full_game.get("participantIdentities") or []}
    humans = [p for p in participants if not _is_bot_identity(identities.get(p.get("participantId")))]
    blue = sum(1 for p in humans if p.get("teamId", 100) == 100)
    red = len(humans) - blue
    if len(participants) != 10:
        return False, f"{len(participants)}명 게임"
    if len(humans) != 10:
        return False, f"사람 {len(humans)}명 + 봇 {10 - len(humans)}명"
    if blue != 5 or red != 5:
        return False, f"{blue}대{red}"
    return True, "5대5 10명"


def classify_custom_games(lock_info, games, progress=None):
    """커스텀 게임마다 10명 상세를 조회해 내전만 골라낸다.
    반환: (내전 목록, 제외 목록[(game, 사유)]). 각 게임에 상세(_full)를 붙여 두어 저장·업로드 때 다시 조회하지 않는다."""
    naejeon, excluded = [], []
    for i, g in enumerate(games):
        if progress:
            progress(i + 1, len(games))
        full = g.get("_full") or get_full_game(lock_info, g.get("gameId"))
        g["_full"] = full
        ok, reason = naejeon_check(full)
        g["_reason"] = reason
        (naejeon if ok else excluded).append(g if ok else (g, reason))
    return naejeon, excluded


def build_history_match(lock_info, game, label=""):
    """과거 게임 1개의 10명 전체 데이터를 조회해 서버 포맷으로 변환. (match_data, raw) 또는 (None, None)"""
    game_id = game.get("gameId")
    if not game_id:
        log(f"  {label} ⚠️  gameId 없음, 건너뜀")
        return None, None

    # 전체 10명 데이터 조회 (목록에는 본인만 들어있음). 내전 판별 때 받아 둔 상세가 있으면 재사용
    full_game = game.get("_full") or get_full_game(lock_info, game_id)
    if not full_game:
        log(f"  {label} ⚠️  상세 데이터 조회 실패, 건너뜀")
        return None, None

    ok, reason = naejeon_check(full_game)
    if not ok:
        log(f"  {label} ⏭️  내전이 아님({reason}), 건너뜀")
        return None, None

    match_data = format_history_match(full_game)
    if not match_data or len(match_data["players"]) != 10:
        log(f"  {label} ⚠️  데이터 불완전, 건너뜀")
        return None, None
    attach_solo_tiers(lock_info, match_data)  # 과거 경기여도 "지금" 티어를 기록 (당시 티어는 클라이언트가 주지 않음)
    return match_data, full_game


def upload_history_game(lock_info, game, label=""):
    """과거 게임 1개 상세 조회 → 로컬 백업 → 업로드. 성공 여부 반환"""
    match_data, raw = build_history_match(lock_info, game, label)
    if not match_data:
        return False

    blue_names = ", ".join(p["nickname"] for p in match_data["players"] if p["team"] == "blue")
    red_names = ", ".join(p["nickname"] for p in match_data["players"] if p["team"] == "red")
    log(f"  {label} {match_data['gameDuration']} | {blue_names} vs {red_names}")

    status, result = deliver(match_data, source="history", raw=raw)
    log("       " + describe_upload(status, result))
    return status == "ok" and not (result or {}).get("duplicate")


def export_history(lock_info, games, out_path=None):
    """과거 커스텀 게임을 JSON 파일 하나로 저장 (서버 업로드 없음).
    여러 참가자가 각자 만든 파일을 사이트 '기록 관리 > 가져오기'에 함께 넣으면 gameId 로 중복이 제거된다.
    저장 경로와 경기 수를 반환."""
    me = lcu_request(lock_info, "/lol-summoner/v1/current-summoner") or {}
    who = me.get("gameName") or me.get("displayName") or me.get("internalName") or "unknown"
    matches = []
    for i, game in enumerate(games):
        match_data, raw = build_history_match(lock_info, game, label=f"[{i + 1}/{len(games)}]")
        if not match_data:
            continue
        try:
            save_backup(match_data, raw=raw, source="history")
        except OSError:
            pass
        matches.append(match_data)

    if not out_path:
        safe = re.sub(r"[^0-9A-Za-z가-힣_-]", "_", str(who))
        out_path = os.path.join(
            get_data_dir(), f"history_export_{safe}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
    _write_json_atomic(out_path, {
        "format": "naejeon-history-export",
        "version": 1,
        "exportedAt": datetime.now().isoformat(timespec="seconds"),
        "exportedBy": who,
        "count": len(matches),
        "matches": matches,
    })
    return out_path, len(matches)


def history_game_summary(game):
    """히스토리 목록 한 줄 요약: (날짜, 시간, 내 챔피언, 승패)"""
    duration = format_duration(game.get("gameDuration", 0))
    timestamp = game.get("gameCreation", 0) / 1000
    date_str = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M") if timestamp else "?"
    # 히스토리 목록에는 본인 참가자만 들어있음 → 내 챔피언/승패만 표시
    me = (game.get("participants") or [{}])[0]
    my_champ = champion_id_to_name(me.get("championId"))
    my_win = me.get("stats", {}).get("win", False)
    return date_str, duration, my_champ, my_win


# ═══════════════════════════════════════════════
#  GUI (tkinter — 파이썬 기본 내장)
# ═══════════════════════════════════════════════

# 다크 테마 색상
C_BG = "#16171c"
C_PANEL = "#1e2027"
C_PANEL2 = "#262933"
C_FG = "#e7e9ee"
C_MUTED = "#9aa0ad"
C_ACCENT = "#5b8cff"
C_ACCENT_HOVER = "#6f9aff"
C_GREEN = "#3ecf8e"
C_RED = "#f06a6a"
C_BORDER = "#33363f"


class CollectorGUI:
    def __init__(self, root, background=False):
        import tkinter as tk
        from tkinter import ttk
        import queue

        self.tk = tk
        self.ttk = ttk
        self.root = root
        self.ui_queue = queue.Queue()
        self.stop_event = None
        self.worker = None
        self.custom_games = []
        self.lock_info_for_history = None
        self.busy = False

        # 전역 log를 GUI 큐로 교체 (워커 스레드에서 호출됨)
        global log
        log = self.log_from_thread

        root.title("컴학내전 데이터 수집기")
        root.geometry("760x600")
        root.minsize(620, 480)
        root.configure(bg=C_BG)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        self._setup_style()
        self._build_layout()

        self.log(f"서버: {get_server_url()}")
        self.log(f"백업 폴더: {get_data_dir()}")
        if not get_upload_token():
            self.log("⚠️  업로드 토큰이 없습니다. [업로드 토큰 설정]을 눌러 입력하세요. (그 전까지는 로컬 백업만 저장)")
        waiting = len(list_pending())
        if waiting:
            self.log(f"전송 대기 중인 경기 {waiting}건 — 실시간 수집을 시작하면 자동으로 재전송합니다.")
        root.after(100, self._poll_queue)

        # 실행하면 알아서: 자동 실행 등록 → 수집 시작 → (롤 로그인 시) 과거 내전 동기화
        self._ensure_autostart()
        if background:
            root.iconify()
        root.after(300, self.toggle_realtime)
        if get_upload_token():
            self.log("준비 완료 — 이 창은 닫지 말고 두세요(최소화 가능). 롤 내전이 끝나면 자동으로 올라갑니다.")
            threading.Thread(target=self._startup_check, daemon=True).start()
        else:
            root.after(600, self.ask_token)

    # ─── 스타일 ───

    def _setup_style(self):
        ttk = self.ttk
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except Exception:
            pass

        style.configure(".", background=C_BG, foreground=C_FG, fieldbackground=C_PANEL)
        style.configure("TNotebook", background=C_BG, borderwidth=0)
        style.configure("TNotebook.Tab", background=C_PANEL, foreground=C_MUTED,
                        padding=(18, 8), borderwidth=0, font=("맑은 고딕", 10))
        style.map("TNotebook.Tab",
                  background=[("selected", C_PANEL2)],
                  foreground=[("selected", C_FG)])
        style.configure("TFrame", background=C_BG)
        style.configure("Panel.TFrame", background=C_PANEL)

        style.configure("Treeview", background=C_PANEL, foreground=C_FG,
                        fieldbackground=C_PANEL, borderwidth=0, rowheight=26,
                        font=("맑은 고딕", 9))
        style.configure("Treeview.Heading", background=C_PANEL2, foreground=C_MUTED,
                        borderwidth=0, font=("맑은 고딕", 9, "bold"))
        style.map("Treeview",
                  background=[("selected", C_ACCENT)],
                  foreground=[("selected", "#ffffff")])
        style.configure("Vertical.TScrollbar", background=C_PANEL2,
                        troughcolor=C_BG, borderwidth=0, arrowcolor=C_MUTED)

    def _button(self, parent, text, command, primary=False, **kw):
        tk = self.tk
        btn = tk.Button(
            parent, text=text, command=command,
            bg=C_ACCENT if primary else C_PANEL2,
            fg="#ffffff" if primary else C_FG,
            activebackground=C_ACCENT_HOVER if primary else C_BORDER,
            activeforeground="#ffffff",
            relief="flat", bd=0, cursor="hand2",
            font=("맑은 고딕", 10, "bold" if primary else "normal"),
            padx=16, pady=7, **kw,
        )
        return btn

    # ─── 레이아웃 ───

    def _build_layout(self):
        tk, ttk = self.tk, self.ttk

        # 헤더
        header = tk.Frame(self.root, bg=C_BG)
        header.pack(fill="x", padx=16, pady=(14, 8))
        tk.Label(header, text="컴학내전 데이터 수집기", bg=C_BG, fg=C_FG,
                 font=("맑은 고딕", 14, "bold")).pack(side="left")
        self.server_label = tk.Label(header, text=get_server_url().replace("https://", ""),
                                     bg=C_BG, fg=C_MUTED, font=("맑은 고딕", 9))
        self.server_label.pack(side="right")

        # 탭
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill="both", expand=True, padx=16, pady=(0, 8))

        self._build_realtime_tab()
        self._build_history_tab()

        # 로그 (공용)
        log_frame = tk.Frame(self.root, bg=C_BG)
        log_frame.pack(fill="both", expand=True, padx=16, pady=(0, 12))
        tk.Label(log_frame, text="로그", bg=C_BG, fg=C_MUTED,
                 font=("맑은 고딕", 9)).pack(anchor="w")
        text_wrap = tk.Frame(log_frame, bg=C_BORDER)
        text_wrap.pack(fill="both", expand=True, pady=(4, 0))
        self.log_text = tk.Text(
            text_wrap, height=9, bg=C_PANEL, fg=C_FG, bd=0,
            insertbackground=C_FG, wrap="word", state="disabled",
            font=("Consolas", 9), padx=10, pady=8,
        )
        scroll = tk.Scrollbar(text_wrap, command=self.log_text.yview,
                              bg=C_PANEL2, troughcolor=C_BG, bd=0)
        self.log_text.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y", padx=(0, 1), pady=1)
        self.log_text.pack(fill="both", expand=True, padx=1, pady=1)

    def _build_realtime_tab(self):
        tk = self.tk
        tab = tk.Frame(self.notebook, bg=C_PANEL2)
        self.notebook.add(tab, text="  실시간 수집  ")

        inner = tk.Frame(tab, bg=C_PANEL2)
        inner.pack(fill="both", expand=True, padx=24, pady=20)

        tk.Label(inner, text="실행만 해 두면 내전이 끝날 때마다 자동으로 올라갑니다. 누를 버튼은 없습니다.",
                 bg=C_PANEL2, fg=C_MUTED, font=("맑은 고딕", 10)).pack(anchor="w")
        tk.Label(inner, text="롤에 로그인하면 아직 안 올린 과거 내전도 알아서 올립니다. (등록된 멤버 5명 이상인 5대5만)",
                 bg=C_PANEL2, fg=C_MUTED, font=("맑은 고딕", 10)).pack(anchor="w", pady=(2, 14))

        row = tk.Frame(inner, bg=C_PANEL2)
        row.pack(fill="x")
        self.start_btn = self._button(row, "▶  실시간 수집 시작", self.toggle_realtime, primary=True)
        self.start_btn.pack(side="left")

        status_row = tk.Frame(inner, bg=C_PANEL2)
        status_row.pack(fill="x", pady=(16, 0))
        self.status_dot = tk.Label(status_row, text="●", bg=C_PANEL2, fg=C_MUTED,
                                   font=("맑은 고딕", 11))
        self.status_dot.pack(side="left")
        self.status_label = tk.Label(status_row, text="대기 중 — 시작 버튼을 눌러주세요",
                                     bg=C_PANEL2, fg=C_MUTED, font=("맑은 고딕", 10))
        self.status_label.pack(side="left", padx=(6, 0))

        # 설정/백업 도구
        tools = tk.Frame(inner, bg=C_PANEL2)
        tools.pack(fill="x", pady=(18, 0))
        self._button(tools, "업로드 토큰 설정", self.ask_token).pack(side="left")
        self._button(tools, "연결 확인", self.check_connection_clicked).pack(side="left", padx=(8, 0))
        self._button(tools, "실패 건 재전송", self.retry_clicked).pack(side="left", padx=(8, 0))
        self._button(tools, "백업 폴더 열기", self.open_data_dir).pack(side="left", padx=(8, 0))

        self.autostart_var = tk.BooleanVar(value=is_autostart_installed())
        tk.Checkbutton(
            inner, text="Windows 로그인 시 자동 실행 (백그라운드에서 바로 수집 시작)",
            variable=self.autostart_var, command=self.toggle_autostart,
            bg=C_PANEL2, fg=C_FG, selectcolor=C_PANEL, activebackground=C_PANEL2,
            activeforeground=C_FG, font=("맑은 고딕", 10), bd=0, highlightthickness=0,
        ).pack(anchor="w", pady=(12, 0))

    def _build_history_tab(self):
        tk, ttk = self.tk, self.ttk
        tab = tk.Frame(self.notebook, bg=C_PANEL2)
        self.notebook.add(tab, text="  과거 경기 가져오기  ")

        inner = tk.Frame(tab, bg=C_PANEL2)
        inner.pack(fill="both", expand=True, padx=24, pady=16)

        toolbar = tk.Frame(inner, bg=C_PANEL2)
        toolbar.pack(fill="x", pady=(0, 10))
        self.load_btn = self._button(toolbar, "경기 불러오기", self.load_history)
        self.load_btn.pack(side="left")
        self.select_all_btn = self._button(toolbar, "전체 선택", self.select_all_games)
        self.select_all_btn.pack(side="left", padx=(8, 0))
        self.upload_btn = self._button(toolbar, "선택한 경기 업로드", self.upload_selected, primary=True)
        self.upload_btn.pack(side="right")
        self.export_btn = self._button(toolbar, "선택한 경기 JSON 저장", self.export_selected)
        self.export_btn.pack(side="right", padx=(0, 8))
        self.diag_btn = self._button(toolbar, "진단", self.diagnose_clicked)
        self.diag_btn.pack(side="left", padx=(8, 0))

        hint = tk.Label(inner, text="Ctrl/Shift 클릭으로 여러 경기를 선택할 수 있습니다. (목록에는 내 챔피언/승패만 표시)",
                        bg=C_PANEL2, fg=C_MUTED, font=("맑은 고딕", 9))
        hint.pack(anchor="w", pady=(0, 6))

        tree_wrap = tk.Frame(inner, bg=C_BORDER)
        tree_wrap.pack(fill="both", expand=True)
        columns = ("no", "date", "duration", "champ", "result")
        self.tree = ttk.Treeview(tree_wrap, columns=columns, show="headings",
                                 selectmode="extended")
        self.tree.heading("no", text="#")
        self.tree.heading("date", text="날짜")
        self.tree.heading("duration", text="게임 시간")
        self.tree.heading("champ", text="내 챔피언")
        self.tree.heading("result", text="결과")
        self.tree.column("no", width=44, anchor="center", stretch=False)
        self.tree.column("date", width=150, anchor="center")
        self.tree.column("duration", width=90, anchor="center", stretch=False)
        self.tree.column("champ", width=140, anchor="center")
        self.tree.column("result", width=70, anchor="center", stretch=False)
        self.tree.tag_configure("win", foreground=C_GREEN)
        self.tree.tag_configure("loss", foreground=C_RED)

        tree_scroll = ttk.Scrollbar(tree_wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=tree_scroll.set)
        tree_scroll.pack(side="right", fill="y", padx=(0, 1), pady=1)
        self.tree.pack(fill="both", expand=True, padx=1, pady=1)

    # ─── 로그/상태 (스레드 → UI 큐) ───

    def log_from_thread(self, *args):
        self.ui_queue.put(("log", " ".join(str(a) for a in args)))

    def log(self, text):
        self.log_text.configure(state="normal")
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert("end", f"[{stamp}] {text.strip()}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def set_status_from_thread(self, text):
        self.ui_queue.put(("status", text))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.ui_queue.get_nowait()
                if kind == "log":
                    self.log(payload)
                elif kind == "status":
                    self.status_label.configure(text=payload)
                elif kind == "games":
                    self._show_games(payload)
                elif kind == "busy_done":
                    self._set_busy(False)
        except Exception:
            pass
        self.root.after(100, self._poll_queue)

    def _set_busy(self, busy):
        self.busy = busy
        state = "disabled" if busy else "normal"
        for btn in (self.load_btn, self.upload_btn, self.select_all_btn, self.export_btn):
            btn.configure(state=state)

    # ─── 실시간 수집 ───

    def toggle_realtime(self):
        if self.stop_event is None:
            self.stop_event = threading.Event()
            self.worker = threading.Thread(
                target=self._realtime_worker, daemon=True)
            self.worker.start()
            self.start_btn.configure(text="■  실시간 수집 중지", bg=C_RED,
                                     activebackground="#ff8080")
            self.status_dot.configure(fg=C_GREEN)
            self.status_label.configure(text="시작됨 — 롤 클라이언트를 찾는 중...")
            self.log("실시간 수집을 시작합니다.")
        else:
            self.stop_event.set()
            self.stop_event = None
            self.start_btn.configure(text="▶  실시간 수집 시작", bg=C_ACCENT,
                                     activebackground=C_ACCENT_HOVER)
            self.status_dot.configure(fg=C_MUTED)
            self.status_label.configure(text="대기 중 — 시작 버튼을 눌러주세요")
            self.log("실시간 수집을 중지했습니다.")

    def _realtime_worker(self):
        stop = self.stop_event
        try:
            realtime_loop(stop, self.set_status_from_thread)
        except Exception as e:
            self.log_from_thread(f"⚠️  수집 루프 오류: {e}")

    # ─── 과거 경기 ───

    def load_history(self):
        if self.busy:
            return
        self._set_busy(True)
        self.log("매치 히스토리 조회 중...")
        threading.Thread(target=self._load_history_worker, daemon=True).start()

    def _load_history_worker(self):
        try:
            lock_info = get_credentials()
            if not lock_info:
                self.log_from_thread("❌ 롤 클라이언트를 찾을 수 없습니다. 리엇 런처 말고, 로그인 후 뜨는 롤 클라이언트(로비 화면)가 켜져 있어야 합니다.")
                self.ui_queue.put(("games", []))
                return
            self.lock_info_for_history = lock_info
            games = fetch_custom_games(lock_info)
            if games:
                self.log_from_thread(f"커스텀 게임 {len(games)}개 — 10명이 5대5로 한 내전인지 하나씩 확인하는 중...")
                last = [0]

                def progress(i, n):
                    if i == n or i - last[0] >= 20:
                        last[0] = i
                        self.ui_queue.put(("status", f"내전 확인 중 {i}/{n}"))

                games, excluded = classify_custom_games(lock_info, games, progress)
                if excluded:
                    reasons = {}
                    for _, r in excluded:
                        key = r.split("(")[0] if r.startswith("협곡") else r
                        reasons[key] = reasons.get(key, 0) + 1
                    detail = ", ".join(f"{k} {v}개" for k, v in sorted(reasons.items(), key=lambda x: -x[1]))
                    self.log_from_thread(f"내전이 아닌 커스텀 {len(excluded)}개 제외: {detail}")
                if not games:
                    self.log_from_thread("10명이 5대5로 한 내전이 없습니다.")
            else:
                self.log_from_thread("조회 가능한 전적에 커스텀 게임이 없습니다.")
                self.log_from_thread("[진단] 버튼을 누르면 원인 파악용 결과가 로그에 나옵니다. 그 내용을 관리자에게 보내주세요.")
            self.ui_queue.put(("games", games))
        except Exception as e:
            self.log_from_thread(f"⚠️  조회 실패: {e}")
            self.ui_queue.put(("games", []))
        finally:
            self.ui_queue.put(("busy_done", None))

    def _show_games(self, games):
        self.custom_games = games
        self.tree.delete(*self.tree.get_children())
        for i, game in enumerate(games):
            date_str, duration, my_champ, my_win = history_game_summary(game)
            self.tree.insert(
                "", "end", iid=str(i),
                values=(i + 1, date_str, duration, my_champ, "승" if my_win else "패"),
                tags=("win" if my_win else "loss",),
            )
        if games:
            self.log(f"내전 {len(games)}경기를 찾았습니다. (전체를 저장하려면 아무것도 선택하지 않고 [JSON 저장])")
            self.notebook.select(1)

    def select_all_games(self):
        self.tree.selection_set(self.tree.get_children())

    def upload_selected(self):
        if self.busy:
            return
        selected = [int(i) for i in self.tree.selection()]
        if not selected:
            self.log("⚠️  선택된 경기가 없습니다. 목록에서 경기를 클릭해 선택하세요.")
            return
        self._set_busy(True)
        threading.Thread(target=self._upload_worker, args=(sorted(selected),), daemon=True).start()

    def _upload_worker(self, indices):
        try:
            lock_info = self.lock_info_for_history or get_credentials()
            if not lock_info:
                self.log_from_thread("❌ 롤 클라이언트를 찾을 수 없습니다.")
                return
            self.log_from_thread(f"{len(indices)}개 경기 업로드 시작...")
            success = 0
            for idx in indices:
                if upload_history_game(lock_info, self.custom_games[idx], label=f"[{idx + 1}]"):
                    success += 1
            self.log_from_thread(f"완료: {success}/{len(indices)} 업로드됨")
        except Exception as e:
            self.log_from_thread(f"⚠️  업로드 실패: {e}")
        finally:
            self.ui_queue.put(("busy_done", None))

    def diagnose_clicked(self):
        def work():
            lock_info = get_credentials()
            if not lock_info:
                self.log_from_thread("❌ 롤 클라이언트를 찾을 수 없습니다. 로그인 후 로비 화면이 떠 있어야 합니다.")
                return
            self.log_from_thread("진단 중... (최대 1분)")
            report = diagnose(lock_info)
            self.log_from_thread("──── 진단 결과 (이 부분을 복사해 보내주세요) ────\n" + report + "\n────────────────")
        threading.Thread(target=work, daemon=True).start()

    def export_selected(self):
        """선택한(없으면 전체) 과거 경기를 JSON 파일로 저장 — 서버에 올리지 않는다"""
        if self.busy:
            return
        selected = sorted(int(i) for i in self.tree.selection()) or list(range(len(self.custom_games)))
        if not selected:
            self.log("⚠️  저장할 경기가 없습니다. 먼저 [경기 불러오기]를 누르세요.")
            return
        self._set_busy(True)
        threading.Thread(target=self._export_worker, args=(selected,), daemon=True).start()

    def _export_worker(self, indices):
        try:
            lock_info = self.lock_info_for_history or get_credentials()
            if not lock_info:
                self.log_from_thread("❌ 롤 클라이언트를 찾을 수 없습니다.")
                return
            self.log_from_thread(f"{len(indices)}개 경기를 JSON 으로 저장하는 중...")
            path, count = export_history(lock_info, [self.custom_games[i] for i in indices])
            self.log_from_thread(f"💾 {count}경기 저장 완료: {path}")
            self.log_from_thread("이 파일을 사이트의 [관리] → [경기 자료 가져오기]에 넣으면 새 DB로 들어갑니다.")
        except Exception as e:
            self.log_from_thread(f"⚠️  저장 실패: {e}")
        finally:
            self.ui_queue.put(("busy_done", None))

    # ─── 설정/백업 도구 ───

    def ask_token(self):
        from tkinter import simpledialog
        token = simpledialog.askstring(
            "업로드 토큰 설정",
            "사이트 관리자에게 받은 업로드 토큰을 입력하세요.\n(이 PC의 설정 파일에만 저장됩니다)",
            show="*", parent=self.root,
        )
        if token is None:
            return
        set_upload_token(token)
        self.log("업로드 토큰을 저장했습니다. 연결을 확인합니다...")
        self.check_connection_clicked()
        self.log("준비 완료 — 이 창은 닫지 말고 두세요(최소화 가능). 롤 내전이 끝나면 자동으로 올라갑니다.")

    def check_connection_clicked(self):
        def work():
            ok, msg = check_connection()
            self.log_from_thread(("✅ " if ok else "❌ ") + msg)
            if ok:
                retry_pending()
        threading.Thread(target=work, daemon=True).start()

    def retry_clicked(self):
        def work():
            if not list_pending():
                self.log_from_thread("전송 대기 중인 경기가 없습니다.")
                return
            retry_pending()
        threading.Thread(target=work, daemon=True).start()

    def open_data_dir(self):
        path = get_data_dir()
        try:
            os.startfile(path)  # Windows 탐색기
        except Exception:
            self.log(f"백업 폴더: {path}")

    def _ensure_autostart(self):
        """처음 실행할 때 Windows 로그인 시 자동 실행을 알아서 등록 (사용자가 끈 적이 있으면 그대로 둠)"""
        try:
            if not is_autostart_installed() and not load_config().get("autostart_disabled"):
                install_autostart()
                self.autostart_var.set(True)
                self.log("Windows 로그인 시 자동 실행을 등록했습니다. 다음부터는 PC를 켜면 알아서 켜집니다.")
        except Exception as e:
            self.log(f"⚠️  자동 실행 등록 실패: {e}")

    def _startup_check(self):
        ok, msg = check_connection()
        self.log_from_thread(("✅ " if ok else "❌ ") + msg)

    def toggle_autostart(self):
        try:
            cfg = load_config()
            cfg["autostart_disabled"] = not self.autostart_var.get()
            save_config(cfg)
            if self.autostart_var.get():
                install_autostart()
                self.log("Windows 로그인 시 자동 실행을 등록했습니다. 다음 로그인부터 버튼 없이 자동 수집됩니다.")
            else:
                uninstall_autostart()
                self.log("자동 실행을 해제했습니다.")
        except Exception as e:
            self.autostart_var.set(is_autostart_installed())
            self.log(f"⚠️  자동 실행 설정 실패: {e}")

    def on_close(self):
        if self.stop_event is not None:
            self.stop_event.set()
        self.root.destroy()


def run_gui(background=False):
    if not acquire_single_instance():
        # 이미 실행 중 — 자동 실행으로 뜬 경우에는 조용히 종료
        if not background:
            _show_windows_alert("컴학내전 수집기가 이미 실행 중입니다.\n작업 표시줄에서 창을 확인하세요.")
        return
    try:
        import tkinter as tk
    except ImportError:
        # tkinter가 없는 환경(임베디드 파이썬 등) — 안내 후 콘솔 모드로
        _show_windows_alert(
            "이 파이썬에는 tkinter(GUI)가 없습니다.\n"
            "python.org 설치 파이썬을 사용하거나,\n"
            "콘솔 모드로 실행하세요: python collector.py --cli"
        )
        return cli_main()

    try:
        # 고해상도 모니터에서 흐릿하게 보이는 것 방지
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

    root = tk.Tk()
    CollectorGUI(root, background=background)
    root.mainloop()


def _show_windows_alert(message):
    """콘솔 없이(pythonw) 실행됐을 때도 보이는 안내창"""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, "컴학내전 수집기", 0x10)
    except Exception:
        print(message)


# ═══════════════════════════════════════════════
#  콘솔 모드 (--cli / --history)
# ═══════════════════════════════════════════════


def cli_main():
    print("=" * 50)
    print("  컴학내전 데이터 수집기")
    print("=" * 50)
    print(f"  서버: {get_server_url()}")
    print(f"  백업 폴더: {get_data_dir()}")
    if not get_upload_token():
        print("  ⚠️  업로드 토큰 미설정 — 로컬 백업만 저장합니다 (python collector.py --set-token)")
    print(f"  클라이언트 감지 간격: {POLL_INTERVAL}초")
    print()

    stop_event = threading.Event()

    def set_status(text):
        print(f"  ⏳ {text}")

    realtime_loop(stop_event, set_status)


def parse_selection(choice, total):
    """선택 입력 파싱: '1,3,5' / '1-5' / 'all' → 인덱스 리스트 (실패 시 None)"""
    if choice.lower() == "all":
        return list(range(total))

    selected = set()
    try:
        for part in choice.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                start, end = part.split("-", 1)
                for n in range(int(start) - 1, int(end)):
                    selected.add(n)
            else:
                selected.add(int(part) - 1)
    except ValueError:
        return None

    return sorted(s for s in selected if 0 <= s < total)


def history_mode():
    """과거 커스텀 게임 조회 → 선택 업로드 (콘솔)"""
    print("=" * 50)
    print("  컴학내전 — 과거 경기 가져오기")
    print("=" * 50)

    lock_info = get_credentials()
    if not lock_info:
        print("  ❌ 롤 클라이언트를 찾을 수 없습니다.")
        print("     리엇 런처 말고, 로그인 후 뜨는 롤 클라이언트(로비 화면)가 켜져 있어야 합니다.")
        return

    print("  클라이언트 감지 완료. 매치 히스토리 조회 중...")
    custom_games, excluded = classify_custom_games(lock_info, fetch_custom_games(lock_info))
    if excluded:
        print(f"  내전이 아닌 커스텀 {len(excluded)}개 제외")

    if not custom_games:
        print("  커스텀 게임이 없거나 매치 히스토리를 가져올 수 없습니다.")
        return

    print(f"\n  커스텀 게임 {len(custom_games)}개 발견:\n")
    print("  (목록에는 내 정보만 표시됩니다. 전체 명단은 선택 후 조회됩니다)\n")

    for i, game in enumerate(custom_games):
        date_str, duration, my_champ, my_win = history_game_summary(game)
        print(f"  [{i+1:2d}] {date_str}  ({duration})  {my_champ:15s} {'✅ 승' if my_win else '❌ 패'}")

    # 사용자 선택
    print()
    print("  ─────────────────────────────────")
    print("  업로드할 게임 번호를 입력하세요.")
    print("  여러 개: 1,3,5  |  범위: 1-5  |  전체: all  |  취소: q")
    print()

    while True:
        choice = input("  선택: ").strip()
        if choice.lower() == "q":
            print("  취소합니다.")
            return
        selected = parse_selection(choice, len(custom_games))
        if selected is None:
            print("  ⚠️  잘못된 입력입니다. 예: 1,3,5 또는 1-5 또는 all")
            continue
        if not selected:
            print("  ⚠️  선택된 게임이 없습니다. 다시 입력해주세요.")
            continue
        break

    print(f"\n  {len(selected)}개 게임 업로드 시작...\n")

    success = 0
    for idx in selected:
        if upload_history_game(lock_info, custom_games[idx], label=f"[{idx+1}]"):
            success += 1

    print(f"\n  완료: {success}/{len(selected)} 업로드됨")


def export_history_mode(out_path=None):
    """조회 가능한 과거 커스텀 게임 전부를 JSON 으로 저장 (콘솔)"""
    lock_info = get_credentials()
    if not lock_info:
        print("  ❌ 롤 클라이언트를 찾을 수 없습니다. 로그인된 롤 클라이언트(로비 화면)가 켜져 있어야 합니다.")
        return 1
    games, excluded = classify_custom_games(lock_info, fetch_custom_games(lock_info))
    if excluded:
        print(f"  내전이 아닌 커스텀 {len(excluded)}개 제외")
    if not games:
        print("  10명이 5대5로 한 내전이 없습니다.")
        return 1
    print(f"  커스텀 게임 {len(games)}개 상세 조회 중...")
    path, count = export_history(lock_info, games, out_path)
    print(f"  💾 {count}경기 저장 완료: {path}")
    print("  이 파일을 사이트의 [관리] → [경기 자료 가져오기]에 넣으세요.")
    return 0


def main(argv):
    args = argv[1:]
    flag = args[0] if args else ""
    if flag == "--history":
        history_mode()
    elif flag == "--cli":
        cli_main()
    elif flag == "--export-history":
        return export_history_mode(args[1] if len(args) > 1 else None)
    elif flag == "--diagnose":
        lock_info = get_credentials()
        print(diagnose(lock_info) if lock_info else "  ❌ 롤 클라이언트를 찾을 수 없습니다.")
    elif flag == "--retry":
        retry_pending()
    elif flag == "--set-token":
        import getpass
        set_upload_token(getpass.getpass("  업로드 토큰: "))
        ok, msg = check_connection()
        print(("  ✅ " if ok else "  ❌ ") + msg)
    elif flag == "--install-autostart":
        install_autostart()
        print("  Windows 로그인 시 자동 실행을 등록했습니다:")
        print("  " + autostart_command())
    elif flag == "--uninstall-autostart":
        uninstall_autostart()
        print("  자동 실행을 해제했습니다.")
    else:
        run_gui(background=(flag == "--background"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except KeyboardInterrupt:
        print("\n  종료합니다.")
