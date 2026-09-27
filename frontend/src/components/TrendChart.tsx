import { useId, useState, type PointerEvent } from "react";
import type { FitnessPoint } from "../api";
import { shortDate } from "../format";
import { useWidth } from "../useWidth";

const HEIGHT = 200;
const TOP = 22; // room for the end label
const AXIS_LEFT = 52;
const AXIS_BOTTOM = 26;
const RIGHT = 8;
const MIN_LABEL_SPACING = 64; // px between x-axis labels
const DAY = 86_400_000;

export type TrendSeries = { key: string; label: string; color: string; points: FitnessPoint[] };

type Props = {
  series: TrendSeries[];
  /** The visible window, as YYYY-MM-DD. */
  from: string;
  to: string;
  format: (value: number) => string;
  /** Axis ticks, when shorter than `format`. */
  tick?: (value: number) => string;
  /** Values are durations in seconds: gridlines at round clock steps (15 s, 1 min, 5 min...). */
  durations?: boolean;
  label: string;
  showTable: boolean;
};

function time(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime();
}

/** Clean tick step (1, 2, 2.5 or 5 times a power of ten) for roughly 4 gridlines. */
function niceStep(span: number): number {
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
}

const CLOCK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** Month starts (or years, for long windows) that fit the width, as timestamps. */
function xTicks(start: number, end: number, width: number): { at: number; label: string }[] {
  const maxLabels = Math.max(2, Math.floor(width / MIN_LABEL_SPACING));
  const first = new Date(start);
  const months: Date[] = [];
  for (let d = new Date(first.getFullYear(), first.getMonth() + 1, 1); d.getTime() <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push(d);
  }
  const every = [1, 2, 3, 6, 12, 24, 60].find((n) => months.length / n <= maxLabels) ?? 120;
  const kept = every >= 12 ? months.filter((d) => d.getMonth() === 0 && d.getFullYear() % (every / 12) === 0)
    : months.filter((d) => d.getMonth() % every === 0);
  return kept.map((d) => ({
    at: d.getTime(),
    label: d.getMonth() === 0 ? String(d.getFullYear()) : d.toLocaleDateString("en-GB", { month: "short" }),
  }));
}

/** Points inside the window, plus the last one before it so the line enters from the edge. */
function windowed(points: FitnessPoint[], from: string, to: string): FitnessPoint[] {
  const inside = points.filter(([d]) => d >= from && d <= to);
  const before = points.filter(([d]) => d < from).at(-1);
  return before ? [before, ...inside] : inside;
}

export default function TrendChart({ series, from, to, format, tick = format, durations = false, label, showTable }: Props) {
  const clip = useId();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null); // timestamp under the pointer

  const lines = series
    .map((s) => ({ ...s, shown: windowed(s.points, from, to) }))
    .filter((s) => s.shown.length > 0);
  if (lines.length === 0) return <p className="empty-text">No values in this period.</p>;

  if (showTable) return <TrendTable lines={lines.map((l) => ({ ...l, shown: l.shown.filter(([d]) => d >= from) }))} format={format} />;

  const start = time(from);
  const end = time(to) + DAY / 2;
  const values = lines.flatMap((l) => l.shown.map(([, v]) => v));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-9) {
    lo -= Math.max(1, Math.abs(lo) * 0.05);
    hi += Math.max(1, Math.abs(hi) * 0.05);
  }
  const step = durations
    ? (CLOCK_STEPS.find((c) => (hi - lo) / c <= 5) ?? 3600 * Math.ceil((hi - lo) / 5 / 3600))
    : niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const yTicks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => +(lo + i * step).toFixed(6));

  const plotWidth = Math.max(0, width - AXIS_LEFT - RIGHT);
  const x = (t: number) => AXIS_LEFT + ((t - start) / (end - start)) * plotWidth;
  const y = (v: number) => TOP + HEIGHT - ((v - lo) / (hi - lo)) * HEIGHT;
  const path = (points: FitnessPoint[]) =>
    points.map(([d, v], i) => `${i ? "L" : "M"}${x(time(d)).toFixed(1)},${y(v).toFixed(1)}`).join("");

  // The crosshair snaps to the nearest recorded day of any series; each series shows its value then.
  const visibleDays = [...new Set(lines.flatMap((l) => l.shown.map(([d]) => d)).filter((d) => d >= from))].map(time);
  const snapped = hover === null || !visibleDays.length ? null
    : visibleDays.reduce((best, t) => (Math.abs(t - hover) < Math.abs(best - hover) ? t : best));
  const at = (points: FitnessPoint[], t: number) => points.filter(([d]) => time(d) <= t).at(-1) ?? null;

  function move(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(start + ((event.clientX - box.left) / box.width) * (end - start));
  }

  const single = lines.length === 1;
  return (
    <>
      {!single && (
        <ul className="legend" aria-label="Series">
          {lines.map((l) => (
            <li key={l.key}>
              <span className="line-key" style={{ background: l.color }} aria-hidden />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <div className="chart-wrap" ref={wrapRef}>
        {width > 0 && (
          <svg width={width} height={TOP + HEIGHT + AXIS_BOTTOM} role="img" aria-label={label}>
            <defs>
              <clipPath id={clip}>
                <rect x={AXIS_LEFT} y={0} width={plotWidth + RIGHT} height={TOP + HEIGHT + 1} />
              </clipPath>
            </defs>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={AXIS_LEFT} x2={width - RIGHT} y1={y(t)} y2={y(t)} className="gridline" />
                <text x={AXIS_LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                  {tick(t)}
                </text>
              </g>
            ))}
            {xTicks(start, end, plotWidth).map((t) => (
              <text key={t.at} x={x(t.at)} y={TOP + HEIGHT + 18} textAnchor="middle" className="tick">
                {t.label}
              </text>
            ))}
            <g clipPath={`url(#${clip})`}>
              {lines.map((l) => (
                <path key={l.key} d={path(l.shown)} className="trend-line" style={{ stroke: l.color }} />
              ))}
            </g>
            {snapped !== null && (
              <line x1={x(snapped)} x2={x(snapped)} y1={TOP} y2={TOP + HEIGHT} className="crosshair" />
            )}
            {lines.map((l) => {
              const point = snapped !== null ? at(l.shown, snapped) : l.shown.at(-1)!;
              if (!point || point[0] < from) return null;
              return (
                <circle key={l.key} cx={x(time(point[0]))} cy={y(point[1])} r={4.5}
                  className="trend-dot" style={{ fill: l.color }} />
              );
            })}
            {single && snapped === null && (() => {
              const [d, v] = lines[0].shown.at(-1)!;
              return d >= from ? (
                <text x={Math.min(x(time(d)), width - RIGHT)} y={y(v) - 10} textAnchor="end" className="cap-label">
                  {format(v)}
                </text>
              ) : null;
            })()}
            <rect x={AXIS_LEFT} y={TOP} width={plotWidth} height={HEIGHT} fill="transparent" className="hit"
              onPointerMove={move} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {snapped !== null && width > 0 && (
          <div className="tooltip" role="status"
            style={x(snapped) > width - 200 ? { right: width - x(snapped) + 14 } : { left: x(snapped) + 14 }}>
            <div className="tooltip-title">{shortDate(new Date(snapped).toLocaleDateString("en-CA"))}</div>
            {lines.map((l) => {
              const point = at(l.shown, snapped);
              return (
                <div key={l.key} className="tooltip-row">
                  <span className="line-key" style={{ background: l.color }} aria-hidden />
                  <strong>{point ? format(point[1]) : "–"}</strong>
                  <span>{l.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function TrendTable({ lines, format }: { lines: (TrendSeries & { shown: FitnessPoint[] })[]; format: (v: number) => string }) {
  const days = [...new Set(lines.flatMap((l) => l.shown.map(([d]) => d)))].sort().reverse();
  const lookup = lines.map((l) => new Map(l.shown));
  return (
    <div className="table-scroll trend-table">
      <table className="data-table compact">
        <thead>
          <tr>
            <th>Date</th>
            {lines.map((l) => (
              <th key={l.key} className="num">{l.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}>
              <td className="nowrap">{shortDate(d)}</td>
              {lookup.map((values, i) => (
                <td key={lines[i].key} className="num">{values.has(d) ? format(values.get(d)!) : "–"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
