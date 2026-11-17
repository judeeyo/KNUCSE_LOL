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
    roster = None     # /api/roster 응답 (None 이면 503)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/api/roster"):
            if FakeSite.roster is None:
                return self._send(503, {"error": "x"})
            return self._send(200, FakeSite.roster)
        self._send(404, {})

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
        self.solo_games, self.one_v_one, self.aram_games = set(), set(), set()
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["NAEJEON_DATA_DIR"] = self.tmp.name
        FakeSite.mode = "ok"
        FakeSite.roster = None
        collector._roster_cache.update(at=0.0, names=None, puuids=None)
        collector._pending_enrich.clear()
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
    def _fake_lcu(self, pages, max_range=None):
        """endpoint → 응답. 히스토리는 begIndex 로 페이지를 나눠 준다.
        max_range 를 주면 그보다 큰 범위 요청에 500 을 돌려준다 (실제 클라이언트에서 관찰된 동작)."""
        def fake_get(lock_info, endpoint, timeout=15):
            if "/matches?" in endpoint and max_range:
                beg = int(endpoint.split("begIndex=")[1].split("&")[0])
                end = int(endpoint.split("endIndex=")[1])
                if end - beg > max_range:
                    return 500, None, '{"errorCode":"RPC_ERROR","message":"range too large"}'
            data = fake(lock_info, endpoint)
            return (200, data, "") if data is not None else (404, None, "")

        def fake(lock_info, endpoint):
            if endpoint.startswith("/lol-ranked/v1/ranked-stats/"):
                puuid = endpoint.rsplit("/", 1)[1]
                if puuid == "p-0":
                    return {"queueMap": {"RANKED_SOLO_5x5": {"tier": "DIAMOND", "division": "II"}}}
                if puuid == "p-1":
                    return {"queueMap": {"RANKED_SOLO_5x5": {"tier": "MASTER", "division": "NA"}}}
                return {"queueMap": {"RANKED_SOLO_5x5": {"tier": "", "division": "NA"}}}
            if endpoint == "/lol-summoner/v1/current-summoner":
                return {"puuid": "aB3_" + "x" * 74, "gameName": "테스트 유저"}
            if "/matches?" in endpoint:
                beg = int(endpoint.split("begIndex=")[1].split("&")[0])
                end = int(endpoint.split("endIndex=")[1])
                return {"games": {"games": pages[beg:end]}}
            if endpoint.startswith("/lol-match-history/v1/games/"):
                gid = int(endpoint.rsplit("/", 1)[1])
                if gid in self.solo_games:  # 나 + 봇 9명
                    return {
                        "gameId": gid, "gameCreation": 1780000000000, "gameDuration": 900, "mapId": 11,
                        "participantIdentities": [{"participantId": 1, "player": {"gameName": "나", "puuid": "aB3_" + "x" * 74}}]
                        + [{"participantId": i + 1, "player": {"gameName": f"Bot{i}", "puuid": "00000000-0000-0000-0000-000000000000", "summonerId": 0}} for i in range(1, 10)],
                        "participants": [{"participantId": i + 1, "teamId": 100 if i < 5 else 200, "championId": 103, "stats": {}} for i in range(10)],
                    }
                if gid in self.one_v_one:
                    return {
                        "gameId": gid, "gameCreation": 1780000000000, "gameDuration": 600, "mapId": 11,
                        "participantIdentities": [{"participantId": i + 1, "player": {"gameName": f"n{i}", "puuid": f"p{i}" + "y" * 70}} for i in range(2)],
                        "participants": [{"participantId": i + 1, "teamId": 100 if i == 0 else 200, "championId": 103, "stats": {}} for i in range(2)],
                    }
                if gid in self.aram_games:
                    return {"gameId": gid, "mapId": 12, "participants": [], "participantIdentities": []}
                return {
                    "gameId": gid, "gameCreation": 1780000000000 + gid, "gameDuration": 1805, "gameMode": "CLASSIC", "mapId": 11,
                    "teams": [
                        {"teamId": 100, "bans": [{"championId": 1, "pickTurn": 1}], "towerKills": 9, "inhibitorKills": 2, "dragonKills": 3, "baronKills": 1, "riftHeraldKills": 1},
                        {"teamId": 200, "bans": [], "towerKills": 2, "inhibitorKills": 0, "dragonKills": 1, "baronKills": 0, "riftHeraldKills": 0},
                    ],
                    "participantIdentities": [{"participantId": i + 1, "player": {"gameName": f"n{i}", "puuid": f"p-{i}", "tagLine": "KR1"}} for i in range(10)],
                    "participants": [{
                        "participantId": i + 1, "teamId": 100 if i < 5 else 200, "championId": 103,
                        "spell1Id": 4, "spell2Id": 14,
                        "timeline": {"lane": "MIDDLE", "role": "SOLO"},
                        "stats": {"win": i < 5, "kills": i, "deaths": 2, "assists": 3, "totalMinionsKilled": 150,
                                  "neutralMinionsKilled": 10, "goldEarned": 10000, "totalDamageDealtToChampions": 15000,
                                  "totalDamageTaken": 9000, "visionScore": 25,
                                  "item0": 3089, "item1": 3020, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 3340,
                                  "perk0": 8112, "perkPrimaryStyle": 8100, "perkSubStyle": 8300},
                    } for i in range(10)],
                }
            return None
        collector.lcu_request = fake
        collector.lcu_get = fake_get
        collector._champion_map = {103: "Ahri", 1: "Annie"}

    def test_history_paginates_and_keeps_only_custom_games(self):
        games = [{"gameId": i, "queueId": 0 if i % 2 == 0 else 420, "gameType": "CUSTOM_GAME" if i % 2 == 0 else "MATCHED_GAME"} for i in range(450)]
        self._fake_lcu(games)
        self.assertEqual(len(collector.get_match_history({})), 450)
        custom = collector.fetch_custom_games({})
        self.assertEqual(len(custom), 225)
        self.assertTrue(all(g["queueId"] == 0 for g in custom))

    def test_history_falls_back_to_smaller_pages_when_client_returns_500(self):
        games = [{"gameId": i, "queueId": 0, "gameCreation": 1780000000000 + i} for i in range(73)]
        self._fake_lcu(games, max_range=20)
        self.assertEqual(len(collector.fetch_custom_games({})), 73)
        self.assertTrue(any("전체 73경기" in l for l in self.logs))

    def test_history_failure_is_logged_with_reason(self):
        self._fake_lcu([{"gameId": 1, "queueId": 0}], max_range=1)
        self.assertEqual(collector.get_match_history({}), [])
        joined = "\n".join(self.logs)
        self.assertIn("HTTP 500", joined)
        self.assertIn("range too large", joined)
        self.assertNotIn("xxxxxxxx", joined)
        self.assertIn("/products/lol/<puuid>/matches", joined)

    def test_diagnose_report(self):
        self._fake_lcu([{"gameId": i, "queueId": 0} for i in range(30)], max_range=20)
        report = collector.diagnose({})
        self.assertIn("current-summoner: HTTP 200 OK", report)
        self.assertIn("[0~200]: HTTP 500", report)
        self.assertIn("[0~20]: HTTP 200 20경기", report)

    def test_only_5v5_human_games_count_as_naejeon(self):
        self.solo_games, self.one_v_one, self.aram_games = {2}, {3}, {4}
        games = [{"gameId": i, "queueId": 0} for i in (1, 2, 3, 4, 5)]
        self._fake_lcu(games)
        naejeon, excluded = collector.classify_custom_games({}, collector.fetch_custom_games({}))
        self.assertEqual([g["gameId"] for g in naejeon], [1, 5])
        reasons = {g["gameId"]: r for g, r in excluded}
        self.assertEqual(reasons[2], "사람 1명 + 봇 9명")
        self.assertEqual(reasons[3], "2명 게임")
        self.assertTrue(reasons[4].startswith("협곡이 아님"))
        # 저장할 때도 내전만 들어가고, 이미 받아 둔 상세를 재사용한다
        path, count = collector.export_history({}, naejeon + [g for g, _ in excluded])
        self.assertEqual(count, 2)

    def test_realtime_skips_solo_custom(self):
        collector.set_upload_token(TOKEN)
        eog = {"gameId": 77, "gameLength": 600, "teams": [
            {"isWinningTeam": True, "players": [{"summonerName": "나", "championName": "Ahri", "stats": {}}]},
            {"isWinningTeam": False, "players": [{"summonerName": f"Bot{i}", "botPlayer": True, "championName": "Annie", "stats": {}} for i in range(5)]},
        ]}
        collector.get_eog_stats = lambda lock: eog
        collector.is_custom_game = lambda lock: True
        self.assertEqual(collector.handle_end_of_game({}, None), 77)
        self.assertEqual(FakeSite.received, [])
        self.assertTrue(any("내전이 아니므로" in l for l in self.logs))

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

    def test_history_records_puuid_tag_and_current_solo_tier(self):
        self._fake_lcu([{"gameId": 91, "queueId": 0}])
        match, _ = collector.build_history_match({}, {"gameId": 91})
        p0, p1, p2 = match["players"][:3]
        self.assertEqual((p0["puuid"], p0["tagLine"], p0["soloTier"]), ("p-0", "KR1", "다이아 2"))
        self.assertEqual(p1["soloTier"], "마스터")
        self.assertNotIn("soloTier", p2)  # 언랭은 기록하지 않음

    def test_history_records_items_spells_runes_and_objectives(self):
        self._fake_lcu([{"gameId": 92, "queueId": 0}])
        match, _ = collector.build_history_match({}, {"gameId": 92})
        p0 = match["players"][0]
        self.assertEqual(p0["items"], [3089, 3020, 0, 0, 0, 0, 3340])
        self.assertEqual((p0["spell1Id"], p0["spell2Id"]), (4, 14))
        self.assertEqual((p0["perkKeystone"], p0["perkPrimaryStyle"], p0["perkSubStyle"]), (8112, 8100, 8300))
        self.assertEqual(match["objectives"], {
            "blue": {"towers": 9, "inhibitors": 2, "dragons": 3, "barons": 1, "heralds": 1},
            "red": {"towers": 2, "inhibitors": 0, "dragons": 1, "barons": 0, "heralds": 0},
        })

    def test_eog_loadout_and_late_enrichment(self):
        # 게임 직후: 종료 화면 데이터에 아이템이 있으면 쓰고, 매치 상세가 아직 없으면 대기열에 넣었다가 나중에 보강·재업로드
        collector.set_upload_token(TOKEN)
        self.assertEqual(collector.loadout_from_eog({"items": [1, 2, 3], "spell1Id": 4, "stats": {"PERK0": 8010}}),
                         {"items": [1, 2, 3, 0, 0, 0, 0], "spell1Id": 4, "perkKeystone": 8010})
        players = [{"summonerName": f"n{i}", "championName": "Ahri", "stats": {}} for i in range(10)]
        eog = {"gameId": 93, "gameLength": 1805, "teams": [
            {"isWinningTeam": True, "players": players[:5]}, {"isWinningTeam": False, "players": players[5:]}]}
        self._fake_lcu([{"gameId": 93, "queueId": 0}])
        real_full = collector.get_full_game
        collector.get_full_game = lambda lock, gid: None  # 아직 매치 기록에 없음
        collector.get_eog_stats = lambda lock: eog
        collector.is_custom_game = lambda lock: True
        try:
            collector.handle_end_of_game({}, None)
        finally:
            collector.get_full_game = real_full
        self.assertIn(93, collector._pending_enrich)
        self.assertNotIn("objectives", FakeSite.received[-1]["match"])
        collector._pending_enrich[93]["next"] = 0
        collector.process_pending_enrich({})
        self.assertNotIn(93, collector._pending_enrich)
        last = FakeSite.received[-1]["match"]
        self.assertEqual(last["gameId"], 93)
        self.assertEqual(last["objectives"]["blue"]["towers"], 9)
        self.assertEqual(last["players"][0]["items"][0], 3089)

    def test_embedded_token_is_used_when_nothing_is_configured(self):
        self.assertEqual(collector.get_upload_token(), "")
        collector.EMBEDDED_UPLOAD_TOKEN = TOKEN
        try:
            self.assertEqual(collector.get_upload_token(), TOKEN)
            self.assertEqual(collector.check_connection()[0], True)
        finally:
            collector.EMBEDDED_UPLOAD_TOKEN = ""

    def test_roster_check(self):
        m = sample_match(1)
        self.assertEqual(collector.roster_check(m), (True, None))  # 명단을 못 받으면 거르지 않음
        FakeSite.roster = {"names": ["p0", "p1", "p2", "p3"], "puuids": ["pu9"]}
        collector._roster_cache["at"] = 0
        self.assertEqual(collector.roster_check(m), (False, 4))
        m["players"][9]["puuid"] = "pu9"  # 닉네임이 달라도 계정 ID 가 같으면 아는 사람
        self.assertEqual(collector.roster_check(m), (True, 5))

    def test_auto_sync_uploads_only_new_member_games_once(self):
        collector.set_upload_token(TOKEN)
        self._fake_lcu([{"gameId": 71, "queueId": 0}, {"gameId": 72, "queueId": 0}, {"gameId": 73, "queueId": 0}])
        self.solo_games = {73}  # 봇전
        FakeSite.roster = {"names": [f"n{i}" for i in range(10)], "puuids": []}
        self.assertEqual(collector.auto_sync_history({}), (2, 0))
        self.assertEqual(sorted(m["match"]["gameId"] for m in FakeSite.received), [71, 72])
        self.assertTrue(all(m["source"] == "history" for m in FakeSite.received))
        # 6시간 안에는 다시 하지 않고, 강제로 해도 이미 처리한 경기는 다시 올리지 않음
        self.assertEqual(collector.auto_sync_history({}), (0, 0))
        self.assertEqual(collector.auto_sync_history({}, force=True), (0, 0))
        self.assertEqual(len(FakeSite.received), 2)

    def test_auto_sync_skips_games_with_strangers(self):
        collector.set_upload_token(TOKEN)
        self._fake_lcu([{"gameId": 81, "queueId": 0}])
        FakeSite.roster = {"names": ["someone-else"], "puuids": []}
        self.assertEqual(collector.auto_sync_history({}), (0, 1))
        self.assertEqual(FakeSite.received, [])
        self.assertEqual(self.files("not-uploaded"), ["match_81.json"])

    def test_realtime_skips_games_with_strangers(self):
        collector.set_upload_token(TOKEN)
        FakeSite.roster = {"names": ["someone-else"], "puuids": []}
        players = [{"summonerName": f"x{i}", "championName": "Ahri", "stats": {}} for i in range(10)]
        eog = {"gameId": 94, "gameLength": 1805, "teams": [
            {"isWinningTeam": True, "players": players[:5]}, {"isWinningTeam": False, "players": players[5:]}]}
        self._fake_lcu([])
        collector.get_eog_stats = lambda lock: eog
        collector.is_custom_game = lambda lock: True
        self.assertEqual(collector.handle_end_of_game({}, None), 94)
        self.assertEqual(FakeSite.received, [])
        self.assertEqual(self.files("not-uploaded"), ["match_94.json"])

    def test_solo_tier_parsing(self):
        f = collector.solo_tier_from_ranked
        self.assertEqual(f({"queues": [{"queueType": "RANKED_SOLO_5x5", "tier": "GOLD", "division": "IV"}]}), "골드 4")
        self.assertIsNone(f({"queueMap": {}}))
        self.assertIsNone(f(None))

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
