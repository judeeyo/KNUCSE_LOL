"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function InvitePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/group/main");
  }, [router]);
  return null;
}
