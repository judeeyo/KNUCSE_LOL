#!/usr/bin/env node
// 28경기가 들어 있는 화면을 여러 폭에서 열어 레이아웃을 자동 점검한다 (Playwright 필요).
//   BASE=http://localhost:3100 MOCK=http://127.0.0.1:54321 ADMIN_PASSWORD=... node scripts/dev/check-responsive.mjs [스크린샷 폴더]
//
// 점검 항목 (화면마다)
//   1. 페이지 전체 가로 스크롤 없음 (documentElement.scrollWidth <= 뷰포트 폭)
//   2. 뷰포트 오른쪽 밖으로 나간 요소 없음 — 단, 가로 스크롤 영역(탭 줄·넓은 표) 안쪽은 허용
//   3. 글자가 잘린 요소 없음 (overflow 로 가려진 텍스트. 말줄임표 처리된 것도 따로 집계)
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE || "http://localhost:3100";
const MOCK = process.env.MOCK || "http://127.0.0.1:54321";
const ADMIN = process.env.ADMIN_PASSWORD || "";
const shotDir = process.argv[2];
if (shotDir) mkdirSync(shotDir, { recursive: true });

const VIEWPORTS = [
  { name: "320", width: 320, height: 640 },
  { name: "390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
];
const TABS = ["선수별 성적", "챔피언 승률", "포지션별 순위", "진영별 통계", "듀오 상성", "매치 기록", "선수 정보", "팀 밸런스"];

/** 브라우저 안에서 실행되는 레이아웃 검사 */
function audit() {
  const vw = document.documentElement.clientWidth;
  const problems = [];
  const describe = (el) => {
    const cls = (el.getAttribute("class") || "").split(/\s+/).slice(0, 4).join(".");
    const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> "${text}"`;
  };
  /** 가로 스크롤이 가능한 조상이 있으면 그 안에서는 넘쳐도 정상 */
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth + 1) return p;
    }
    return null;
  };
  /** overflow:hidden 인 조상에 가려지는지. "partial" = 일부만 보임(잘림), "hidden" = 통째로 안 보임(캐러셀의 다른 슬라이드 등 — 정상) */
  const clippedBy = (el, rect) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "hidden" || cs.overflowX === "clip") {
        const pr = p.getBoundingClientRect();
        if (rect.left >= pr.right - 1 || rect.right <= pr.left + 1) return "hidden";
        if (rect.right > pr.right + 1 || rect.left < pr.left - 1) return "partial";
      }
    }
    return null;
  };

  if (document.documentElement.scrollWidth > vw + 1) {
    problems.push(`페이지 가로 스크롤 발생: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
  }

  let ellipsis = 0;
  const all = document.body.querySelectorAll("*");
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const scroller = inScroller(el);
    const clip = clippedBy(el, rect);
    if (clip === "hidden") continue; // 화면에 아예 그려지지 않는 요소

    // 2. 뷰포트 밖으로 삐져나감
    if (!scroller && (rect.right > vw + 1 || rect.left < -1) && cs.position !== "fixed") {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText || el.tagName === "BUTTON" || el.tagName === "INPUT" || el.tagName === "IMG" || el.tagName === "svg") {
        problems.push(`뷰포트 밖: ${describe(el)} right=${Math.round(rect.right)}`);
      }
    }

    // 3. 글자 잘림: 자기 텍스트가 자기 상자보다 넓은데 overflow 로 가려짐
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText) {
      const hiddenX = cs.overflowX === "hidden" || cs.overflowX === "clip";
      if (hiddenX && el.scrollWidth > el.clientWidth + 1) {
        if (cs.textOverflow === "ellipsis") ellipsis++;
        else problems.push(`글자 잘림: ${describe(el)} ${el.scrollWidth}>${el.clientWidth}`);
      }
      // 조상의 overflow:hidden 에 텍스트 상자가 잘림
      if (!scroller && clip === "partial" && cs.textOverflow !== "ellipsis") {
        problems.push(`조상에 가려 잘림: ${describe(el)}`);
      }
    }
  }
  return { problems: [...new Set(problems)], ellipsis };
}

const results = [];
let failures = 0;
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  // 자동으로 넘어가는 캐러셀의 "이동 중" 프레임이 잡히지 않도록 전환 효과를 끈다
  await context.addInitScript(() => {
    const off = () => {
      const st = document.createElement("style");
      st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
      document.head.appendChild(st);
    };
    if (document.head) off();
    else document.addEventListener("DOMContentLoaded", off);
  });
  const page = await context.newPage();
  const check = async (label, { expectText } = {}) => {
    await page.waitForTimeout(250);
    if (expectText) await page.getByText(expectText).first().waitFor({ timeout: 8000 });
    const r = await page.evaluate(audit);
    const ok = r.problems.length === 0;
    if (!ok) failures++;
    results.push({ viewport: vp.name, screen: label, ok, ellipsis: r.ellipsis, problems: r.problems });
    console.log(`${ok ? "✓" : "✗"} [${vp.name}] ${label}${r.ellipsis ? `  (말줄임 ${r.ellipsis})` : ""}`);
    for (const p of r.problems.slice(0, 8)) console.log("     " + p);
    if (shotDir) await page.screenshot({ path: `${shotDir}/${vp.name}-${label.replace(/[^0-9A-Za-z가-힣]+/g, "_")}.png`, fullPage: true });
  };

  await fetch(MOCK + "/__mock/reset", { method: "POST" });
  await page.goto(BASE + "/group/main", { waitUntil: "networkidle" });
  await page.getByText("22명 · 28경기").waitFor({ timeout: 10000 });

  for (const tab of TABS) {
    await page.getByRole("tab", { name: tab }).click();
    await check(`탭 - ${tab}`);
    if (tab === "선수별 성적") {
      // 탭 줄과 표는 "자기 영역 안에서" 스크롤돼야 한다
      const scroll = await page.evaluate(() => {
        const tabs = document.querySelector('[role="tablist"]');
        const table = document.querySelector("table")?.parentElement;
        return {
          tabs: tabs ? [tabs.scrollWidth, tabs.clientWidth, getComputedStyle(tabs).overflowX] : null,
          table: table ? [table.scrollWidth, table.clientWidth, getComputedStyle(table).overflowX] : null,
        };
      });
      console.log(`     탭 줄 ${scroll.tabs?.join("/")}, 표 ${scroll.table?.join("/")}`);
      await page.locator("tbody tr").first().click();
      await check("모달 - 선수 상세");
      await page.keyboard.press("Escape");
    }
    if (tab === "챔피언 승률") {
      await page.locator("tbody tr").first().click();
      await check("모달 - 챔피언 상세");
      await page.keyboard.press("Escape");
    }
  }

  await page.getByRole("button", { name: "수집기 사용법" }).click();
  await check("모달 - 수집기 사용법");
  await page.keyboard.press("Escape");

  // 매치 상세 (카드 클릭)
  await page.getByRole("tab", { name: "매치 기록" }).click();
  await page.locator("div.group.relative").first().click();
  await page.waitForURL(/\/match\//);
  await check("매치 상세", { expectText: "블루팀" });
  await page.getByRole("button", { name: "수정" }).click();
  await check("매치 상세 - 수정 모드");

  await page.goto(BASE + "/group/main/player/Eddie", { waitUntil: "networkidle" });
  await check("선수 페이지", { expectText: "경기 기록" });

  await page.goto(BASE + "/group/main/new", { waitUntil: "networkidle" });
  await check("수동 등록", { expectText: "수동 경기 등록" });
  // 저장 시 관리자 확인 창
  await page.getByPlaceholder("Player 1").first().fill("테스트1");
  await page.getByPlaceholder("Player 2").first().fill("테스트2");
  await page.getByRole("button", { name: "저장하기" }).click();
  await check("모달 - 관리자 확인", { expectText: "관리자 확인" });
  await page.keyboard.press("Escape");

  await page.goto(BASE + "/group/main/admin", { waitUntil: "networkidle" });
  await check("기록 관리", { expectText: "기록 관리" });
  if (ADMIN) {
    await page.getByRole("button", { name: "관리자 로그인" }).click();
    await page.getByLabel("관리자 비밀번호").fill(ADMIN);
    await page.getByRole("button", { name: "확인", exact: true }).click();
    await page.getByRole("button", { name: "로그아웃" }).waitFor();
    await page.locator('input[type="file"]').setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: Buffer.from(await (await fetch(MOCK + "/__mock/state")).text().then((t) => JSON.stringify({ format: "naejeon-backup", ...JSON.parse(t) }))),
    });
    await page.getByText("미리보기 (아직 반영 안 됨)").waitFor();
    await page.getByRole("button", { name: "점검" }).click();
    await page.getByText("anonWriteBlocked").waitFor();
    await check("기록 관리 - 가져오기 미리보기·점검");
  }

  // 조회 실패 화면 + 재시도
  await context.clearCookies();
  await page.evaluate(() => sessionStorage.clear());
  await fetch(MOCK + "/__mock/fail", { method: "POST", body: JSON.stringify({ on: true }) });
  await page.goto(BASE + "/group/main", { waitUntil: "networkidle" });
  await check("조회 실패 화면", { expectText: "기록을 불러오지 못했습니다" });
  const zero = await page.getByText("0명 · 0경기").count();
  if (zero > 0) {
    failures++;
    console.log("     ✗ 조회 실패인데 '0명 · 0경기'가 표시됨");
  }
  await fetch(MOCK + "/__mock/fail", { method: "POST", body: JSON.stringify({ on: false }) });
  await page.getByRole("button", { name: "다시 시도" }).click();
  await page.getByText("22명 · 28경기").waitFor({ timeout: 10000 });
  console.log(`✓ [${vp.name}] 다시 시도 → 22명 · 28경기 복구`);

  // 캐시가 있는 상태에서 실패: 이전 내용 유지 + 경고 배너
  await fetch(MOCK + "/__mock/fail", { method: "POST", body: JSON.stringify({ on: true }) });
  await page.reload({ waitUntil: "networkidle" });
  await check("조회 실패 배너(캐시 표시 중)", { expectText: "최신 기록을 불러오지 못했습니다" });
  await fetch(MOCK + "/__mock/fail", { method: "POST", body: JSON.stringify({ on: false }) });

  await context.close();
}

// 빈 DB: 오류가 아니라 "0경기" 빈 상태로 보여야 한다 (오류와 구분)
await browser.close();
await fetch(MOCK + "/__mock/reset", { method: "POST" });
const total = results.length;
console.log(`\n${failures === 0 ? "OK" : "FAIL"}: ${total - results.filter((r) => !r.ok).length}/${total} 화면 통과 (${VIEWPORTS.map((v) => v.name).join(", ")})`);
process.exit(failures === 0 ? 0 : 1);
