import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 수집기 다운로드 API가 런타임에 readFileSync로 읽는 파일들을 서버 번들에 포함
  outputFileTracingIncludes: {
    "/api/collector": ["./collector/**/*"],
  },
  // 첫 화면을 서버 리다이렉트로 즉시 이동 (기존: 클라이언트에서 debug/seed API 순차 호출 후 이동 → 수 초 지연)
  // 미리보기 전용: PREVIEW_DB_PROXY 가 설정된 빌드에서만 /_db/* 를 로컬 가짜 DB 로 넘긴다.
  // (운영 배포에서는 이 변수를 설정하지 않으므로 아무 경로도 추가되지 않는다)
  async rewrites() {
    const target = process.env.PREVIEW_DB_PROXY;
    return target ? [{ source: "/_db/:path*", destination: `${target}/:path*` }] : [];
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/group/main",
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ddragon.leagueoflegends.com",
      },
    ],
  },
};

export default nextConfig;
