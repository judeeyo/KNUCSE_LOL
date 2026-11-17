import { redirect } from "next/navigation";

// next.config.ts의 redirects()가 먼저 처리하지만, 클라이언트 내비게이션 등
// 리다이렉트를 안 타는 경로를 위한 폴백.
export default function HomePage() {
  redirect("/group/main");
}
