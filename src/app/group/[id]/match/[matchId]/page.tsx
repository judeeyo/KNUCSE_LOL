"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect } from "react";

export default function MatchRedirect() {
  const router = useRouter();
  const params = useParams();
  useEffect(() => {
    router.replace(`/group/main/match/${params.matchId}`);
  }, [router, params]);
  return null;
}
