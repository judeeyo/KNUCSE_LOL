import type { Metadata } from "next";
import { Navbar } from "@/components/layout/navbar";
import { AdminLoginHost } from "@/components/admin/admin-login-host";
import "./globals.css";

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
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
      </body>
    </html>
  );
}
