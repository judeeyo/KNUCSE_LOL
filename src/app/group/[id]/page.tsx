"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function GroupRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/group/main");
  }, [router]);
  return null;
}
