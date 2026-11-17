import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 수집기 다운로드 API가 런타임에 readFileSync로 읽는 파일들을 서버 번들에 포함
  outputFileTracingIncludes: {
    "/api/collector": ["./collector/**/*"],
  },
  // 첫 화면을 서버 리다이렉트로 즉시 이동 (기존: 클라이언트에서 debug/seed API 순차 호출 후 이동 → 수 초 지연)
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
