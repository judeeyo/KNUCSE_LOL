#!/usr/bin/env node
// 로컬 검증용 가짜 Supabase(PostgREST). 실제 Supabase 없이 사이트를 띄워 화면·API 를 확인할 때 쓴다.
// 운영 코드에서는 전혀 사용하지 않는다.
//
//   node scripts/dev/mock-supabase.mjs [--port 54321] [--empty]
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-test \
//   SUPABASE_SERVICE_ROLE_KEY=service-test ADMIN_PASSWORD=... UPLOAD_SECRET=... npm run dev
//
// 흉내 내는 것: 이 앱이 쓰는 PostgREST 쿼리(eq / is.null / in / order / limit, insert·upsert·patch·delete,
// count=exact) 와 01_schema.sql 의 권한 모델(anon 키는 읽기만, service 키는 쓰기 가능).
// 기본으로 02_restore_28_matches.sql 과 같은 28경기가 들어 있다.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLegacyRows } from "../build-legacy-sql.mjs";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 54321;
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ANON = "anon-test";
const SERVICE = "service-test";

function seed() {
  if (args.includes("--empty")) return { matches: [], members: [] };
  const raw = JSON.parse(readFileSync(join(root, "data/legacy/naejeon-lol-28-matches.json"), "utf8"));
  const matches = buildLegacyRows(raw).map((r) => ({ ...r, uploaded_at: "2026-11-01T00:00:00+00:00" }));
  const names = [...new Set(matches.flatMap((m) => m.players.map((p) => p.nickname)))].sort();
  const members = names.map((nickname) => ({
    nickname, real_name: null, tier: null, preferred_lanes: [], aliases: [], created_at: "2026-11-01T00:00:00+00:00",
  }));
  return { matches, members };
}

let db = seed();
let failReads = false;
const PK = { matches: "id", members: "nickname" };
const DEFAULTS = {
  matches: () => ({
    group_name: "컴학내전", created_at: new Date().toISOString(), game_duration: null, game_mode: "rift", game_id: null,
    bans: null, source: "collector", time_unknown: false, review_status: null, duplicate_of: null,
    uploaded_at: new Date().toISOString(),
  }),
  members: () => ({ real_name: null, tier: null, preferred_lanes: [], aliases: [], created_at: new Date().toISOString() }),
};

const pgError = (res, status, code, message) => send(res, status, { code, message, details: null, hint: null });

function send(res, status, body, headers = {}) {
  const data = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Expose-Headers": "Content-Range",
    ...headers,
  });
  res.end(data);
}

function parseValue(v) {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

/** PostgREST 필터 → 행 판별 함수 */
function buildFilter(params) {
  const tests = [];
  for (const [key, value] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    const dot = value.indexOf(".");
    const op = value.slice(0, dot);
    const arg = value.slice(dot + 1);
    if (op === "eq") tests.push((r) => String(r[key]) === arg && r[key] !== null);
    else if (op === "is") tests.push((r) => (r[key] ?? null) === parseValue(arg));
    else if (op === "in") {
      const list = arg.slice(1, -1).split(",").map((s) => s.replace(/^"|"$/g, ""));
      tests.push((r) => list.includes(String(r[key])));
    } else throw new Error(`mock: 지원하지 않는 필터 ${key}=${value}`);
  }
  return (r) => tests.every((t) => t(r));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return send(res, 204);

    // ── 테스트 제어 ──
    if (url.pathname === "/__mock/fail") {
      failReads = (await readBody(req))?.on === true;
      return send(res, 200, { failReads });
    }
    if (url.pathname === "/__mock/reset") {
      db = seed();
      failReads = false;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__mock/state") return send(res, 200, db);

    const m = url.pathname.match(/^\/rest\/v1\/(matches|members)$/);
    if (!m) return send(res, 404, { message: "not found" });
    const table = m[1];
    const rows = db[table];
    const key = req.headers.apikey;
    if (key !== ANON && key !== SERVICE) return send(res, 401, { message: "Invalid API key" });
    const isService = key === SERVICE;
    const prefer = String(req.headers.prefer || "");
    const filter = buildFilter(url.searchParams);
    const wantsReturn = prefer.includes("return=representation");

    if (req.method === "GET" || req.method === "HEAD") {
      if (failReads) return pgError(res, 503, "PGRST000", "mock: 데이터베이스에 연결할 수 없습니다");
      let out = rows.filter(filter);
      const order = url.searchParams.get("order");
      if (order) {
        const [col, dir] = order.split(".");
        out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1));
      }
      const total = out.length;
      const limit = url.searchParams.get("limit");
      if (limit) out = out.slice(0, Number(limit));
      const range = { "Content-Range": total ? `0-${out.length - 1}/${total}` : `*/0` };
      return req.method === "HEAD" ? send(res, 200, undefined, range) : send(res, 200, out, range);
    }

    // ── 쓰기: anon 키는 거부 (01_schema.sql 의 RLS/권한과 같은 결과) ──
    if (!isService) {
      return pgError(res, 401, "42501", `new row violates row-level security policy for table "${table}"`);
    }
    const pk = PK[table];

    if (req.method === "POST") {
      const body = await readBody(req);
      const list = Array.isArray(body) ? body : [body];
      const merge = prefer.includes("resolution=merge-duplicates");
      const ignore = prefer.includes("resolution=ignore-duplicates");
      const inserted = [];
      // 전부 검사한 뒤 반영 (한 문장은 원자적)
      const staged = [...rows];
      for (const item of list) {
        if (table === "matches" && (item.players === undefined || item.players === null)) {
          return pgError(res, 400, "23502", 'null value in column "players" of relation "matches" violates not-null constraint');
        }
        if (item[pk] === undefined || item[pk] === null) return pgError(res, 400, "23502", `null value in column "${pk}"`);
        const idx = staged.findIndex((r) => r[pk] === item[pk]);
        if (idx >= 0) {
          if (ignore) continue;
          if (!merge) return pgError(res, 409, "23505", `duplicate key value violates unique constraint "${table}_pkey"`);
          staged[idx] = { ...staged[idx], ...item };
          inserted.push(staged[idx]);
          continue;
        }
        if (table === "matches" && item.game_id && staged.some((r) => r.game_id === item.game_id)) {
          return pgError(res, 409, "23505", 'duplicate key value violates unique constraint "matches_game_id_key"');
        }
        const row = { ...DEFAULTS[table](), ...item };
        staged.push(row);
        inserted.push(row);
      }
      db[table] = staged;
      return send(res, 201, wantsReturn ? inserted : undefined);
    }

    if (req.method === "PATCH") {
      const body = await readBody(req);
      const targets = rows.filter(filter);
      if (table === "matches" && body.game_id && rows.some((r) => r.game_id === body.game_id && !targets.includes(r))) {
        return pgError(res, 409, "23505", 'duplicate key value violates unique constraint "matches_game_id_key"');
      }
      for (const r of targets) Object.assign(r, body);
      return send(res, wantsReturn ? 200 : 204, wantsReturn ? targets : undefined);
    }

    if (req.method === "DELETE") {
      const gone = rows.filter(filter);
      db[table] = rows.filter((r) => !gone.includes(r));
      return send(res, wantsReturn ? 200 : 204, wantsReturn ? gone : undefined);
    }
    return send(res, 405, { message: "method not allowed" });
  } catch (err) {
    console.error(err);
    return send(res, 500, { code: "XX000", message: String(err?.message || err) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock supabase on http://127.0.0.1:${port}  (anon key: ${ANON}, service key: ${SERVICE}, matches: ${db.matches.length})`);
});
