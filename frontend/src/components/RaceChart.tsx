import { useState, type PointerEvent } from "react";
import { shortDate } from "../format";
import type { Race } from "../races";
import { useWidth } from "../useWidth";
import { CLOCK_STEPS, niceStep, xTicks } from "./TrendChart";

const HEIGHT = 220;
const TOP = 16;
const AXIS_LEFT = 56;
const AXIS_BOTTOM = 26;
const RIGHT = 16;
const DAY = 86_400_000;

export type RaceSeries = {
  key: string;
  label: string;
  color: string;
  value: (r: Race) => number | null;
  /** Join this series' points with a line (rankings); times are shown as points only. */
  connect?: boolean;
};

type Props = {
  races: Race[];
  series: RaceSeries[];
  format: (value: number) => string;
  /** Values are durations in seconds: gridlines at round clock steps. */
  durations?: boolean;
  /** Draw the record line: the best of the first series so far, as a staircase. */
  recordLine?: boolean;
  /** Smaller is better (times, Top %): the best values are at the top. */
  label: string;
  /** Extra line in the tooltip, e.g. pace and elevation. */
  describe?: (r: Race) => string;
};

function time(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime();
}

/** Races over time, one point each; smaller values (faster, better ranked) at the top. */
export default function RaceChart({ races, series, format, durations = false, recordLine = false, label, describe }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null); // index into `shown`

  const shown = races.filter((r) => series.some((s) => s.value(r) !== null));
  if (shown.length === 0) return <p className="empty-text">No races to show yet.</p>;

  const times = shown.map((r) => time(r.date));
  const pad = Math.max(15 * DAY, (Math.max(...times) - Math.min(...times)) * 0.04);
  const start = Math.min(...times) - pad;
  const end = Math.max(...times) + pad;

  const values = shown.flatMap((r) => series.map((s) => s.value(r)).filter((v): v is number => v !== null));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-9) {
    lo -= durations ? 60 : Math.max(0.01, lo * 0.1);
    hi += durations ? 60 : Math.max(0.01, hi * 0.1);
  }
  const step = durations ? (CLOCK_STEPS.find((c) => (hi - lo) / c <= 5) ?? 3600) : niceStep(hi - lo);
  lo = Math.max(0, Math.floor(lo / step) * step);
  hi = Math.ceil(hi / step) * step;
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => +(lo + i * step).toFixed(6));

  const plotWidth = Math.max(0, width - AXIS_LEFT - RIGHT);
  const x = (t: number) => AXIS_LEFT + ((t - start) / (end - start)) * plotWidth;
  // Best at the top: the smallest value sits at TOP.
  const y = (v: number) => TOP + ((v - lo) / (hi - lo)) * HEIGHT;

  // Record line: from each record to the next, flat, then on to the last race.
  const first = series[0];
  let record = "";
  if (recordLine) {
    let best: number | null = null;
    for (const r of shown) {
      const v = first.value(r);
      if (v === null || (best !== null && v >= best)) continue;
      const px = x(time(r.date));
      record += best === null ? `M${px},${y(v)}` : `H${px}V${y(v)}`;
      best = v;
    }
    if (best !== null) record += `H${x(time(shown.at(-1)!.date))}`;
  }

  function move(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const at = start + ((event.clientX - box.left) / box.width) * (end - start);
    let nearest = 0;
    shown.forEach((r, i) => {
      if (Math.abs(time(r.date) - at) < Math.abs(time(shown[nearest].date) - at)) nearest = i;
    });
    setHover(nearest);
  }

  const hovered = hover !== null ? shown[hover] : null;
  return (
    <>
      {series.length === 1 && recordLine && (
        <ul className="legend" aria-label="Legend">
          <li>
            <span className="dot-key" style={{ background: series[0].color }} aria-hidden />
            Race
          </li>
          <li>
            <span className="record-key" aria-hidden />
            Record
          </li>
        </ul>
      )}
      {series.length > 1 && (
        <ul className="legend" aria-label="Series">
          {series.map((s) => (
            <li key={s.key}>
              <span className="line-key" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="chart-wrap" ref={wrapRef}>
        {width > 0 && (
          <svg width={width} height={TOP + HEIGHT + AXIS_BOTTOM} role="img" aria-label={label}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={AXIS_LEFT} x2={width - RIGHT} y1={y(t)} y2={y(t)} className="gridline" />
                <text x={AXIS_LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                  {format(t)}
                </text>
              </g>
            ))}
            {xTicks(start, end, plotWidth).map((t) => (
              <text key={t.at} x={x(t.at)} y={TOP + HEIGHT + 18} textAnchor="middle" className="tick">
                {t.label}
              </text>
            ))}
            {record && <path d={record} className="record-line" />}
            {series.map((s) => {
              const points = shown.filter((r) => s.value(r) !== null);
              return (
                <g key={s.key}>
                  {s.connect && points.length > 1 && (
                    <path className="trend-line" style={{ stroke: s.color }}
                      d={points.map((r, i) => `${i ? "L" : "M"}${x(time(r.date))},${y(s.value(r)!)}`).join("")} />
                  )}
                  {points.map((r) => (
                    <circle key={r.activity.id} cx={x(time(r.date))} cy={y(s.value(r)!)}
                      r={hovered === r ? 6.5 : 5} className="trend-dot" style={{ fill: s.color }} />
                  ))}
                </g>
              );
            })}
            {hovered && (
              <line x1={x(time(hovered.date))} x2={x(time(hovered.date))} y1={TOP} y2={TOP + HEIGHT} className="crosshair" />
            )}
            <rect x={AXIS_LEFT} y={TOP} width={plotWidth} height={HEIGHT} fill="transparent" className="hit"
              onPointerMove={move} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {hovered && width > 0 && (
          <div className="tooltip" role="status"
            style={x(time(hovered.date)) > width - 240 ? { right: width - x(time(hovered.date)) + 14 } : { left: x(time(hovered.date)) + 14 }}>
            <div className="tooltip-title">{shortDate(hovered.date)}</div>
            <div className="tooltip-total">{hovered.activity.name}</div>
            {series.map((s) => {
              const v = s.value(hovered);
              return v === null ? null : (
                <div key={s.key} className="tooltip-row">
                  <span className="line-key" style={{ background: s.color }} aria-hidden />
                  <strong>{format(v)}</strong>
                  <span>{s.label}{hovered.pr && s === first && recordLine ? " · record" : ""}</span>
                </div>
              );
            })}
            {describe && <div className="tooltip-row muted">{describe(hovered)}</div>}
          </div>
        )}
      </div>
    </>
  );
}
