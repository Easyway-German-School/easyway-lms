"use client";

/**
 * A tiny line chart with no axes: the shape of the last few readings is the
 * message. `values` are plotted left (oldest) to right (newest); `null` leaves a
 * gap for a poll that failed rather than drawing a false zero.
 */
export default function Sparkline({
  values,
  width = 160,
  height = 36,
  color = "currentColor",
  min,
  max,
}: {
  values: Array<number | null>;
  width?: number;
  height?: number;
  color?: string;
  min?: number;
  max?: number;
}) {
  const real = values.filter((v): v is number => v !== null);
  if (real.length < 2) {
    return <svg width={width} height={height} aria-hidden className="opacity-30"><line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeDasharray="3 4" /></svg>;
  }
  const lo = min ?? Math.min(...real);
  const hi = Math.max(max ?? Math.max(...real), lo + 1e-9);
  const pad = 3;
  const x = (i: number) => pad + (i / Math.max(values.length - 1, 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2);

  let path = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  const lastIndex = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
  const last = values[lastIndex] as number;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ color }}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(lastIndex)} cy={y(last)} r="2.6" fill="currentColor" />
    </svg>
  );
}
