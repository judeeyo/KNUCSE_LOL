import type { Metadata } from "next";
import { Navbar } from "@/components/layout/navbar";
import { AdminLoginHost } from "@/components/admin/admin-login-host";
import { EntryTracker } from "@/components/layout/entry-tracker";
import "./globals.css";

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

// 공유 미리보기(카톡 등)에 쓰는 절대 주소의 기준. Vercel 이 배포 주소를 환경변수로 넣어 준다
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  openGraph: { siteName: "컴학내전", locale: "ko_KR", type: "website" },
  title: "컴학내전",
  description: "컴학과 내전 전적 기록 & 통계",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <Navbar />
        <main className="flex-1 min-w-0">{children}</main>
        <AdminLoginHost />
        <EntryTracker />
      </body>
    </html>
  );
}
