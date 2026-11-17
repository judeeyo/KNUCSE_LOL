"""수집기 로직 테스트 (롤 클라이언트·Windows 없이 실행 가능)

    python -m unittest collector/test_collector.py

가짜 사이트 서버(/api/upload)와 가짜 LCU 응답으로 백업·전송 대기열·재전송·과거 경기 추출을 검증한다.
"""
import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("collector_mod", os.path.join(HERE, "collector.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

TOKEN = "test-upload-token"


class FakeSite(BaseHTTPRequestHandler):
    mode = "ok"       # ok | down | reject
    received = []     # 업로드된 경기 본문
    auth_seen = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])).decode())
        FakeSite.auth_seen.append(self.headers.get("Authorization"))
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self._send(401, {"error": "인증 실패"})
        if body.get("ping"):
            return self._send(200, {"ok": True})
        if FakeSite.mode == "down":
            return self._send(500, {"error": "boom"})
        if FakeSite.mode == "reject":
            return self._send(400, {"error": "Invalid match data"})
        dup = any(m["match"].get("gameId") == body["match"].get("gameId") for m in FakeSite.received)
        FakeSite.received.append(body)
        self._send(200, {"success": True, "updated": dup})

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def sample_match(game_id=1001):
    players = []
    for i in range(10):
        players.append({
            "nickname": f"p{i}", "champion": "Ahri", "team": "blue" if i < 5 else "red", "win": i < 5,
            "kills": i, "deaths": 1, "assists": 2, "cs": 100, "gold": 9000,
            "damageDealt": 12000, "damageTaken": 8000, "visionScore": 20,
        })
    return {"gameId": game_id, "gameCreation": 1780000000000, "gameDuration": "30:00", "players": players}


class CollectorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeSite)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        os.environ["NAEJEON_SERVER_URL"] = f"http://127.0.0.1:{cls.server.server_port}"
        os.environ.pop("NAEJEON_UPLOAD_TOKEN", None)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["NAEJEON_DATA_DIR"] = self.tmp.name
        FakeSite.mode = "ok"
        FakeSite.received = []
        FakeSite.auth_seen = []
        self.logs = []
        collector.log = lambda *a: self.logs.append(" ".join(str(x) for x in a))

    def tearDown(self):
        self.tmp.cleanup()

    def files(self, sub):
        return sorted(os.listdir(os.path.join(self.tmp.name, sub))) if os.path.isdir(os.path.join(self.tmp.name, sub)) else []

    # ── 비밀값 ──
    def test_script_contains_no_secret(self):
        src = open(os.path.join(HERE, "collector.py"), encoding="utf-8").read()
        self.assertNotIn("naejeon-upload-2024", src)
        self.assertNotRegex(src, r'UPLOAD_SECRET\s*=')

    def test_token_is_stored_locally_and_sent_as_bearer(self):
        self.assertEqual(collector.get_upload_token(), "")
        collector.set_upload_token(f"  {TOKEN}  ")
        self.assertEqual(collector.get_upload_token(), TOKEN)
        self.assertEqual(collector.check_connection(), (True, "서버 연결 및 토큰 확인 완료"))
        self.assertEqual(FakeSite.auth_seen[-1], f"Bearer {TOKEN}")
        collector.set_upload_token("wrong")
        ok, msg = collector.check_connection()
        self.assertFalse(ok)
        self.assertIn("UPLOAD_SECRET", msg)

    # ── 백업 → 업로드 ──
    def test_success_keeps_backup_and_clears_pending(self):
        collector.set_upload_token(TOKEN)
        status, result = collector.deliver(sample_match(), raw={"gameId": 1001, "teams": []})
        self.assertEqual(status, "ok")
        self.assertEqual(self.files("backups"), ["match_1001.json"])
        self.assertEqual(self.files("pending"), [])
        saved = json.load(open(os.path.join(self.tmp.name, "backups", "match_1001.json"), encoding="utf-8"))
        self.assertEqual(saved["gameId"], 1001)
        self.assertEqual(len(saved["players"]), 10)
        self.assertIn("_raw", saved)  # LCU 원본도 함께 보관
        self.assertEqual(FakeSite.received[0]["match"]["gameId"], 1001)
        self.assertNotIn("secret", FakeSite.received[0])

    def test_backup_is_written_before_upload_even_if_server_is_down(self):
        collector.set_upload_token(TOKEN)
        FakeSite.mode = "down"
        status, _ = collector.deliver(sample_match(2002))
        self.assertEqual(status, "retry")
        self.assertEqual(self.files("backups"), ["match_2002.json"])
        self.assertEqual(self.files("pending"), ["match_2002.json"])

        # 서버가 살아나면 재전송으로 올라가고 대기열이 비워진다 (백업은 남는다)
        FakeSite.mode = "ok"
        self.assertEqual(collector.retry_pending(), (1, 0))
        self.assertEqual(self.files("pending"), [])
        self.assertEqual(self.files("backups"), ["match_2002.json"])
        self.assertEqual([m["match"]["gameId"] for m in FakeSite.received], [2002])

    def test_no_token_saves_locally_then_uploads_after_token_is_set(self):
        status, _ = collector.deliver(sample_match(3003))
        self.assertEqual(status, "no_token")
        self.assertEqual(self.files("pending"), ["match_3003.json"])
        self.assertEqual(FakeSite.received, [])
        self.assertEqual(collector.retry_pending(), (0, 1))
        collector.set_upload_token(TOKEN)
        self.assertEqual(collector.retry_pending(), (1, 0))

    def test_unreachable_server_is_retryable(self):
        collector.set_upload_token(TOKEN)
        os.environ["NAEJEON_SERVER_URL"] = "http://127.0.0.1:9"  # 닫힌 포트
        try:
            status, _ = collector.deliver(sample_match(4004))
        finally:
            os.environ["NAEJEON_SERVER_URL"] = f"http://127.0.0.1:{self.server.server_port}"
        self.assertEqual(status, "retry")
        self.assertEqual(self.files("pending"), ["match_4004.json"])

    def test_rejected_match_is_moved_out_of_the_queue(self):
        collector.set_upload_token(TOKEN)
        FakeSite.mode = "reject"
        status, _ = collector.deliver(sample_match(5005))
        self.assertEqual(status, "rejected")
        self.assertEqual(self.files("pending"), [])
        self.assertEqual(self.files("rejected"), ["match_5005.json"])
        self.assertEqual(self.files("backups"), ["match_5005.json"])

    def test_retry_stops_early_when_server_is_still_down(self):
        collector.set_upload_token(TOKEN)
        FakeSite.mode = "down"
        for gid in (1, 2, 3):
            collector.deliver(sample_match(gid))
        self.assertEqual(collector.retry_pending(), (0, 3))

    def test_same_game_twice_does_not_duplicate_backup_files(self):
        collector.set_upload_token(TOKEN)
        collector.deliver(sample_match(6006))
        collector.deliver(sample_match(6006))
        self.assertEqual(self.files("backups"), ["match_6006.json"])

    # ── 과거 경기 ──
    def _fake_lcu(self, pages):
        """endpoint → 응답. 히스토리는 begIndex 로 페이지를 나눠 준다."""
        def fake(lock_info, endpoint):
            if endpoint == "/lol-summoner/v1/current-summoner":
                return {"puuid": "PUUID", "gameName": "테스트 유저"}
            if "/matches?" in endpoint:
                beg = int(endpoint.split("begIndex=")[1].split("&")[0])
                end = int(endpoint.split("endIndex=")[1])
                return {"games": {"games": pages[beg:end]}}
            if endpoint.startswith("/lol-match-history/v1/games/"):
                gid = int(endpoint.rsplit("/", 1)[1])
                return {
                    "gameId": gid, "gameCreation": 1780000000000 + gid, "gameDuration": 1805, "gameMode": "CLASSIC",
                    "teams": [{"teamId": 100, "bans": [{"championId": 1, "pickTurn": 1}]}, {"teamId": 200, "bans": []}],
                    "participantIdentities": [{"participantId": i + 1, "player": {"gameName": f"n{i}"}} for i in range(10)],
                    "participants": [{
                        "participantId": i + 1, "teamId": 100 if i < 5 else 200, "championId": 103,
                        "timeline": {"lane": "MIDDLE", "role": "SOLO"},
                        "stats": {"win": i < 5, "kills": i, "deaths": 2, "assists": 3, "totalMinionsKilled": 150,
                                  "neutralMinionsKilled": 10, "goldEarned": 10000, "totalDamageDealtToChampions": 15000,
                                  "totalDamageTaken": 9000, "visionScore": 25},
                    } for i in range(10)],
                }
            return None
        collector.lcu_request = fake
        collector._champion_map = {103: "Ahri", 1: "Annie"}

    def test_history_paginates_and_keeps_only_custom_games(self):
        games = [{"gameId": i, "queueId": 0 if i % 2 == 0 else 420, "gameType": "CUSTOM_GAME" if i % 2 == 0 else "MATCHED_GAME"} for i in range(450)]
        self._fake_lcu(games)
        self.assertEqual(len(collector.get_match_history({}, 200)), 450)
        custom = collector.fetch_custom_games({})
        self.assertEqual(len(custom), 225)
        self.assertTrue(all(g["queueId"] == 0 for g in custom))

    def test_export_history_writes_importable_json_without_uploading(self):
        collector.set_upload_token(TOKEN)
        self._fake_lcu([{"gameId": 71, "queueId": 0}, {"gameId": 72, "queueId": 0}])
        path, count = collector.export_history({}, collector.fetch_custom_games({}))
        self.assertEqual(count, 2)
        self.assertEqual(FakeSite.received, [])  # 저장만 하고 올리지 않는다
        data = json.load(open(path, encoding="utf-8"))
        self.assertEqual(data["format"], "naejeon-history-export")
        self.assertEqual(data["exportedBy"], "테스트 유저")
        self.assertEqual([m["gameId"] for m in data["matches"]], [71, 72])
        m = data["matches"][0]
        self.assertEqual(len(m["players"]), 10)
        self.assertEqual(m["players"][0], {**m["players"][0], "nickname": "n0", "champion": "Ahri", "team": "blue", "win": True,
                                           "cs": 160, "gold": 10000, "damageDealt": 15000, "visionScore": 25})
        self.assertEqual(m["gameDuration"], "30:05")
        self.assertEqual(m["bans"], {"blue": ["Annie"], "red": []})
        self.assertEqual(self.files("backups"), ["match_71.json", "match_72.json"])

    def test_upload_history_game_reports_duplicates(self):
        collector.set_upload_token(TOKEN)
        self._fake_lcu([{"gameId": 81, "queueId": 0}])
        self.assertTrue(collector.upload_history_game({}, {"gameId": 81}))
        self.assertEqual(FakeSite.received[0]["source"], "history")

    # ── 자동 실행 ──
    def test_autostart_command_runs_in_background_mode(self):
        cmd = collector.autostart_command()
        self.assertTrue(cmd.endswith('collector.py" --background'))
        self.assertIn(os.path.abspath(os.path.join(HERE, "collector.py")), cmd)

    def test_single_instance_guard(self):
        self.assertTrue(collector.acquire_single_instance())
        first = collector._instance_socket
        try:
            self.assertFalse(collector.acquire_single_instance())
        finally:
            first.close()
            collector._instance_socket = None


if __name__ == "__main__":
    unittest.main()
