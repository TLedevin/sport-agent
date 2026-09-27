import { useId } from "react";
import type { ChartSpec } from "../activityData";

const BUCKETS = 28; // enough for the overall shape, not every surge
const WINDOW = 2; // rolling average over ±2 buckets on top of the bucketing
const W = 100;
const H = 40;

/** Averages the samples into evenly spaced buckets; empty buckets borrow their neighbour's value. */
function smooth(values: (number | null)[]): number[] {
  const size = values.length / BUCKETS;
  const buckets: (number | null)[] = Array.from({ length: BUCKETS }, (_, b) => {
    const slice = values.slice(Math.floor(b * size), Math.max(Math.floor((b + 1) * size), Math.floor(b * size) + 1));
    const present = slice.filter((v): v is number => v !== null);
    return present.length ? present.reduce((a, c) => a + c, 0) / present.length : null;
  });
  const first = buckets.find((v) => v !== null) ?? 0;
  let last = first;
  const filled = buckets.map((v) => (v === null ? last : (last = v)));
  return filled.map((_, i) => {
    const around = filled.slice(Math.max(0, i - WINDOW), i + WINDOW + 1);
    return around.reduce((a, c) => a + c, 0) / around.length;
  });
}

/** Catmull-Rom through the points, as cubic Béziers: a soft curve with no overshoot corners. */
function curve(points: [number, number][]): string {
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] ?? points[i], points[i], points[i + 1], points[i + 2] ?? points[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

/** A faded, smoothed version of a graph, drawn behind a stat card's numbers. Decorative only. */
export default function CardSparkline({ chart }: { chart: ChartSpec }) {
  const gradient = useId();
  const values = smooth(chart.values);
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.03)];
  const hi = sorted[Math.ceil(sorted.length * 0.97) - 1];
  const span = hi - lo || 1;
  const points = values.map((v, i): [number, number] => {
    const t = (Math.min(Math.max(v, lo), hi) - lo) / span;
    // A little margin at the top of the band so the peaks stay soft.
    return [(i / (values.length - 1)) * W, 4 + (chart.invert ? t : 1 - t) * (H - 8)];
  });
  const line = curve(points);
  return (
    <svg className="card-sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: chart.color, stopOpacity: 0.22 }} />
          <stop offset="1" style={{ stopColor: chart.color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${gradient})`} />
      <path d={line} fill="none" style={{ stroke: chart.color }} strokeOpacity={0.45} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
