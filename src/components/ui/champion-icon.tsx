"use client";

import { useEffect, useRef, useState } from "react";
import { getChampionIconUrl, getLatestDdragonVersion, withDdragonVersion } from "@/lib/champions";
import { cn } from "@/lib/cn";

interface ChampionIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function ChampionIcon({ name, size = 28, className }: ChampionIconProps) {
  const baseUrl = getChampionIconUrl(name);
  // 고정 버전 주소가 실패하면 최신 패치 주소로 한 번 더 시도하고, 그래도 실패하면 이니셜
  const [retryUrl, setRetryUrl] = useState<{ for: string; url: string } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const url = retryUrl && retryUrl.for === baseUrl ? retryUrl.url : baseUrl;

  const handleError = () => {
    if (!baseUrl) return;
    if (retryUrl?.for === baseUrl) {
      setFailedUrl(url);
      return;
    }
    getLatestDdragonVersion().then((v) => {
      const next = v ? withDdragonVersion(baseUrl, v) : null;
      if (next && next !== baseUrl) setRetryUrl({ for: baseUrl, url: next });
      else setFailedUrl(baseUrl);
    });
  };

  // 하이드레이션 전에 이미 로드에 실패한 이미지는 onError 가 오지 않으므로 마운트 시 한 번 확인
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) handleError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // 아이콘이 없거나 불러오지 못하면 같은 크기의 이니셜 상자로 대체 (깨진 이미지의 대체 텍스트가 레이아웃을 밀지 않도록)
  if (!url || failedUrl === url) {
    return (
      <div
        title={name}
        className={cn(
          "rounded bg-surface-2 flex items-center justify-center text-xs font-semibold text-ink-subtle shrink-0 overflow-hidden",
          className
        )}
        style={{ width: size, height: size }}
      >
        {name.charAt(0)}
      </div>
    );
  }

  return (
    // 원격 CDN(Data Dragon)에서 오는 소형 아이콘(28~48px)이고 실패 시 이니셜로 폴백하는
    // 커스텀 onError 처리가 필요해 next/image 대신 <img>를 의도적으로 사용한다.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={url}
      alt={name}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("rounded shrink-0 object-cover", className)}
      onError={handleError}
    />
  );
}
