import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getChampionIconUrl, getChampionSplashUrl } from "@/lib/champions";

// 미리보기 이미지용 공통 도구: 한글 폰트(Pretendard) 로드, 챔피언 아이콘을 미리 받아 data URL 로.
let fontCache: Promise<Buffer> | null = null;
export function ogFont(): Promise<Buffer> {
  fontCache ??= readFile(join(process.cwd(), "node_modules/pretendard/dist/public/static/Pretendard-Bold.otf"));
  return fontCache;
}

export const OG_SIZE = { width: 1200, height: 630 };

export const C = {
  bg: "#0b0c0e",
  panel: "#141516",
  line: "#23252a",
  ink: "#f7f8f8",
  muted: "#a0a6b0",
  subtle: "#62666d",
  blue: "#60a5fa",
  red: "#f87171",
  win: "#27a644",
  lose: "#e05555",
  mvp: "#e8a020",
  ace: "#9b6dd7",
  primary: "#828fff",
};

/** 챔피언 아이콘을 받아 data URL 로. 못 받으면 null (이미지 생성 전체가 실패하지 않도록 시간 제한) */
export async function championIconData(name: string): Promise<string | null> {
  const url = getChampionIconUrl(name);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** 챔피언 일러스트(jpg)를 data URL 로. 못 받으면 null */
export async function championSplashData(name: string | null): Promise<string | null> {
  const url = name ? getChampionSplashUrl(name) : null;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** 아이콘 또는 이니셜 상자 */
export function Icon({ name, data, size }: { name: string; data: string | null; size: number }) {
  if (data) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={data} width={size} height={size} style={{ borderRadius: 8 }} alt="" />;
  }
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 8, background: C.line, color: C.muted,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.45,
      }}
    >
      {name.charAt(0)}
    </div>
  );
}
