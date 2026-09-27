import { type PointerEvent } from "react";
import type { Axis, ChartSpec } from "../activityData";
import { clock, km } from "../format";
import { useWidth } from "../useWidth";

const HEIGHT = 96; // plot height per graph
const PAD_TOP = 6;
const AXIS_LEFT = 58;
const AXIS_BOTTOM = 22;

type Props = {
  charts: ChartSpec[];
  axis: Axis;
  hover: number | null; // sample index shared with the map
  onHover: (index: number | null) => void;
};

function axisLabel(kind: Axis["kind"], v: number): string {
  return kind === "distance" ? km(v) : clock(v);
}

/** Value range for the y axis, ignoring the most extreme 1% so one GPS glitch can't flatten a graph. */
function domain(values: (number | null)[]): [number, number] | null {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const lo = sorted[Math.floor((sorted.length - 1) * 0.01)];
  const hi = sorted[Math.ceil((sorted.length - 1) * 0.99)];
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  // Metrics that are never negative (speed, heart rate...) keep their axis at 0 or above.
  return [sorted[0] >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad];
}

/** Index of the sample whose x is closest to `x` (x values never decrease). */
function nearest(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x) ? lo - 1 : lo;
}

function stats(values: (number | null)[]): { avg: number; max: number; min: number } | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return {
    avg: present.reduce((a, b) => a + b, 0) / present.length,
    max: Math.max(...present),
    min: Math.min(...present),
  };
}

export default function ActivityCharts({ charts, axis, hover, onHover }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const xs = axis.values;
  const x0 = xs[0];
  const x1 = xs[xs.length - 1] || 1;
  const plotWidth = Math.max(0, width - AXIS_LEFT);
  const px = (x: number) => AXIS_LEFT + ((x - x0) / (x1 - x0 || 1)) * plotWidth;

  function move(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = x0 + ((event.clientX - rect.left - AXIS_LEFT) / (plotWidth || 1)) * (x1 - x0);
    onHover(nearest(xs, Math.min(Math.max(x, x0), x1)));
  }

  const ticks = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);

  return (
    <div className="activity-charts" ref={wrapRef}>
      {width > 0 &&
        charts.map((chart, n) => {
          const dom = domain(chart.values);
          if (!dom) return null;
          const [lo, hi] = dom;
          const y = (v: number) => {
            const t = (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo || 1);
            return PAD_TOP + (chart.invert ? t : 1 - t) * HEIGHT;
          };
          // One path, broken where the metric has no value.
          let d = "";
          let open = false;
          chart.values.forEach((v, i) => {
            if (v === null) {
              open = false;
              return;
            }
            d += `${open ? "L" : "M"}${px(xs[i]).toFixed(1)},${y(v).toFixed(1)}`;
            open = true;
          });
          const last = n === charts.length - 1;
          const s = stats(chart.values);
          const current = hover !== null ? chart.values[hover] : null;
          return (
            <div key={chart.key} className="activity-chart">
              <div className="activity-chart-head">
                <span className="activity-chart-label">
                  <span className="line-key" style={{ background: chart.color }} aria-hidden />
                  {chart.label}
                </span>
                <span className="activity-chart-value">
                  {hover !== null ? (
                    current !== null ? chart.format(current) : "–"
                  ) : s ? (
                    <>
                      avg {chart.format(s.avg)} <span className="muted">· {chart.invert ? "best" : "max"}{" "}
                      {chart.format(chart.invert ? s.min : s.max)}</span>
                    </>
                  ) : null}
                </span>
              </div>
              <svg
                width={width}
                height={PAD_TOP + HEIGHT + (last ? AXIS_BOTTOM : 4)}
                onPointerMove={move}
                onPointerDown={move}
                onPointerLeave={() => onHover(null)}
                role="img"
                aria-label={`${chart.label} along the activity`}
              >
                {[lo, (lo + hi) / 2, hi].map((t) => (
                  <g key={t}>
                    <line x1={AXIS_LEFT} x2={width} y1={y(t)} y2={y(t)} className="gridline" />
                    <text x={AXIS_LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                      {chart.format(t)}
                    </text>
                  </g>
                ))}
                <path d={d} fill="none" stroke={chart.color} strokeWidth={1.6} strokeLinejoin="round" />
                {hover !== null && (
                  <>
                    <line x1={px(xs[hover])} x2={px(xs[hover])} y1={PAD_TOP} y2={PAD_TOP + HEIGHT} className="cursor-line" />
                    {current !== null && (
                      <circle cx={px(xs[hover])} cy={y(current)} r={3.5} fill={chart.color} className="cursor-dot" />
                    )}
                  </>
                )}
                {last &&
                  ticks.map((t, i) => (
                    <text key={t} x={px(t)} y={PAD_TOP + HEIGHT + 16} className="tick"
                      textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}>
                      {axisLabel(axis.kind, t)}
                    </text>
                  ))}
              </svg>
            </div>
          );
        })}
    </div>
  );
}
