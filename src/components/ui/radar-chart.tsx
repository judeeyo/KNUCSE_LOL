"use client";

export interface RadarAxis {
  label: string;
  value: number; // 0~100
  hint?: string;
}

export function RadarChart({ axes, size = 200 }: { axes: RadarAxis[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 34; // 라벨 공간
  const n = axes.length;

  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, radius: number): [number, number] => [
    cx + radius * Math.cos(angle(i)),
    cy + radius * Math.sin(angle(i)),
  ];
  const polygon = (f: number) => axes.map((_, i) => point(i, r * f).join(",")).join(" ");

  const dataPoints = axes.map((a, i) => point(i, (Math.max(a.value, 2) / 100) * r));
  const dataPolygon = dataPoints.map((p) => p.join(",")).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="5각 능력치">
      {/* 배경 그리드 (은은하게) */}
      {[1 / 3, 2 / 3, 1].map((f) => (
        <polygon key={f} points={polygon(f)} fill="none" stroke="var(--hairline)" strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, r);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--hairline)" strokeWidth={1} />;
      })}

      {/* 데이터 */}
      <polygon points={dataPolygon} fill="var(--primary)" fillOpacity={0.18} stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" />
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill="var(--primary)" stroke="var(--surface-1)" strokeWidth={2}>
          <title>{`${axes[i].label} ${Math.round(axes[i].value)}${axes[i].hint ? ` — ${axes[i].hint}` : ""}`}</title>
        </circle>
      ))}

      {/* 축 라벨 + 값 */}
      {axes.map((a, i) => {
        const [x, y] = point(i, r + 14);
        const cos = Math.cos(angle(i));
        const anchor = Math.abs(cos) < 0.35 ? "middle" : cos > 0 ? "start" : "end";
        const sin = Math.sin(angle(i));
        const dy = sin < -0.35 ? -4 : sin > 0.35 ? 8 : 2;
        return (
          <g key={a.label}>
            <title>{a.hint ? `${a.label} — ${a.hint}` : a.label}</title>
            <text x={x} y={y + dy} textAnchor={anchor} fontSize={10} fill="var(--ink-subtle)">
              {a.label}
            </text>
            <text x={x} y={y + dy + 11} textAnchor={anchor} fontSize={10} fontWeight={600} fill="var(--ink-muted)">
              {Math.round(a.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
