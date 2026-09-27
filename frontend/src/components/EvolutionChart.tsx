import { ChartColumn, Table } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { Bucket, BucketUnit, EvolutionRange, Family, Series } from "../api";
import { hours, km, shortDate } from "../format";
import { FAMILIES, SPORTS, sportColor } from "../sports";

const PLOT_HEIGHT = 256;
const TOP = 26; // room for the cap label
const AXIS_LEFT = 48;
const AXIS_BOTTOM = 28;
const GAP = 2; // surface gap between stacked segments
const MAX_BAR = 24;
const RADIUS = 4;
const MIN_LABEL_SPACING = 46; // px between x-axis labels
// Below this band width (dense ranges on a phone) the cap label would sit over neighbouring bars.
const MIN_BAND_FOR_CAP = 12;

const RANGES: { key: EvolutionRange; short: string; label: string }[] = [
  { key: "1m", short: "1M", label: "Last 30 days" },
  { key: "3m", short: "3M", label: "Last 3 months" },
  { key: "6m", short: "6M", label: "Last 6 months" },
  { key: "1y", short: "1Y", label: "Last 12 months" },
  { key: "all", short: "All", label: "All time" },
];

type Metric = "time" | "distance";

/** How each metric reads its values, scales the axis and formats numbers. */
const METRICS: Record<Metric, { label: string; values: (b: Bucket) => Record<Family, number>; axisUnit: number;
  tick: (t: number) => string; format: (v: number) => string }> = {
  time: { label: "Time", values: (b) => b.duration_by_family, axisUnit: 3600, tick: (t) => `${t}h`, format: hours },
  distance: { label: "Distance", values: (b) => b.distance_by_family, axisUnit: 1000, tick: (t) => `${t} km`, format: km },
};

const PER_UNIT: Record<BucketUnit, string> = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
const UNIT_NAME: Record<BucketUnit, string> = { day: "Day", week: "Week", month: "Month", year: "Year" };
const UNIT_OPTION: Record<BucketUnit, string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Tooltip and table label: "Sun 27 Sept", "Week of 21 Sept", "September 2026", "2026". */
function bucketTitle(start: string, unit: BucketUnit): string {
  if (unit === "year") return start.slice(0, 4);
  if (unit === "day") return parse(start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (unit === "week") return `Week of ${shortDate(start)}`;
  return parse(start).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** X-axis label: dates for days and weeks; month names, with the year on January. */
function axisLabel(start: string, unit: BucketUnit): string {
  if (unit === "year") return start.slice(0, 4);
  if (unit !== "month") return shortDate(start);
  const date = parse(start);
  return date.getMonth() === 0 ? String(date.getFullYear()) : date.toLocaleDateString("en-GB", { month: "short" });
}

function restLabel(unit: BucketUnit): string {
  return unit === "day" || unit === "week" ? `Rest ${unit}` : "No activity";
}

/** Tracks an element's width. A callback ref, so it re-attaches whenever the element is re-created
 * (e.g. switching back from the table view) and measures immediately instead of waiting for a resize. */
function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(node);
  }, []);
  return [ref, width] as const;
}

/** Clean tick step (1, 2, 2.5 or 5 times a power of ten) for roughly 4 gridlines. */
function niceStep(max: number): number {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
}

/** Rectangle with rounded top corners only (square on the baseline side). */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string; options: { key: T; short: string; label: string }[]; value: T; onChange: (key: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={o.key === value} aria-label={o.label} title={o.label}
          onClick={() => onChange(o.key)}>
          {o.short}
        </button>
      ))}
    </div>
  );
}

export default function EvolutionChart({ evolution }: { evolution: Record<EvolutionRange, Series[]> }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [range, setRange] = useState<EvolutionRange>("3m");
  const [metric, setMetric] = useState<Metric>("time");
  // The granularity last picked, kept across ranges that offer it; otherwise the range's default.
  const [preferredUnit, setPreferredUnit] = useState<BucketUnit | null>(null);

  const offered = evolution[range];
  const { unit, buckets } = offered.find((s) => s.unit === preferredUnit) ?? offered[0];
  const m = METRICS[metric];
  const families = FAMILIES.filter((f) => buckets.some((b) => m.values(b)[f] > 0));
  const totals = buckets.map((b) => FAMILIES.reduce((sum, f) => sum + m.values(b)[f], 0));
  const max = Math.max(0, ...totals) / m.axisUnit;
  const step = max > 0 ? niceStep(max) : 1;
  const top = Math.max(step * 4, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(2));

  const plotWidth = Math.max(0, width - AXIS_LEFT);
  const band = buckets.length ? plotWidth / buckets.length : 0;
  const barWidth = Math.min(MAX_BAR, band * 0.56);
  const y = (v: number) => TOP + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;
  const last = buckets.length - 1;
  // Label every nth bar, counted back from the latest so it always has one. Month bars label
  // Januaries (as the year) when there are too many to name each month, thinning years too if needed.
  const labelEvery = Math.max(1, Math.ceil(MIN_LABEL_SPACING / (band || 1)));
  const yearEvery = [1, 2, 5, 10].find((n) => n * 12 * band >= MIN_LABEL_SPACING) ?? 10;
  const showLabel = (i: number) => {
    if (unit !== "month" || labelEvery === 1) return (last - i) % labelEvery === 0;
    const date = parse(buckets[i].start);
    return date.getMonth() === 0 && date.getFullYear() % yearEvery === 0;
  };
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;

  function selectRange(key: EvolutionRange) {
    setRange(key);
    setHovered(null);
  }

  function selectUnit(key: BucketUnit) {
    setPreferredUnit(key);
    setHovered(null);
  }

  return (
    <section className="card chart-card" aria-labelledby="evolution-title">
      <div className="card-head">
        <div>
          <h2 id="evolution-title">Evolution</h2>
          <p className="card-sub">
            {rangeLabel}, {PER_UNIT[unit]} {m.label.toLowerCase()} by sport
          </p>
        </div>
        <button className="button ghost small" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? <ChartColumn size={14} aria-hidden /> : <Table size={14} aria-hidden />}
          {showTable ? "Chart" : "Table"}
        </button>
      </div>

      <div className="chart-controls">
        <div className="chart-controls-group">
          <Segmented label="Time range" options={RANGES} value={range} onChange={selectRange} />
          {offered.length > 1 && (
            <Segmented
              label="Granularity"
              options={offered.map((s) => ({ key: s.unit, short: UNIT_OPTION[s.unit], label: UNIT_OPTION[s.unit] }))}
              value={unit}
              onChange={selectUnit}
            />
          )}
        </div>
        <Segmented
          label="Measure"
          options={(["time", "distance"] as Metric[]).map((key) => ({ key, short: METRICS[key].label, label: METRICS[key].label }))}
          value={metric}
          onChange={setMetric}
        />
      </div>

      {families.length > 0 && (
        <ul className="legend" aria-label="Sports">
          {families.map((f) => (
            <li key={f}>
              <span className="legend-swatch" style={{ background: sportColor(f) }} aria-hidden />
              {SPORTS[f].label}
            </li>
          ))}
        </ul>
      )}

      {showTable ? (
        <EvolutionTable buckets={buckets} unit={unit} metric={metric} families={families} totals={totals} />
      ) : (
        <div className="chart-wrap" ref={wrapRef}>
          {width > 0 && (
            <svg
              width={width}
              height={TOP + PLOT_HEIGHT + AXIS_BOTTOM}
              role="img"
              aria-label={`${rangeLabel}: ${PER_UNIT[unit]} ${m.label.toLowerCase()} by sport`}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={AXIS_LEFT} x2={width} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-baseline" : "gridline"} />
                  <text x={AXIS_LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                    {m.tick(t)}
                  </text>
                </g>
              ))}

              {buckets.map((bucket, i) => {
                const values = m.values(bucket);
                const cx = AXIS_LEFT + band * i + band / 2;
                const x = cx - barWidth / 2;
                const present = FAMILIES.filter((f) => values[f] > 0);
                let base = y(0);
                const dim = hovered !== null && hovered !== i;
                return (
                  <g key={bucket.start} className="column" opacity={dim ? 0.4 : 1}>
                    {present.map((f, k) => {
                      const h = (values[f] / m.axisUnit / top) * PLOT_HEIGHT;
                      const isTop = k === present.length - 1;
                      const drawn = isTop ? h : h - GAP; // the gap separates it from the next segment
                      base -= h;
                      if (drawn <= 0) return null;
                      const segY = isTop ? base : base + GAP;
                      return isTop ? (
                        <path key={f} d={roundedTop(x, segY, barWidth, drawn, RADIUS)} fill={sportColor(f)} />
                      ) : (
                        <rect key={f} x={x} y={segY} width={barWidth} height={drawn} fill={sportColor(f)} />
                      );
                    })}
                    {i === last && totals[i] > 0 && band >= MIN_BAND_FOR_CAP && (
                      <text x={cx} y={y(totals[i] / m.axisUnit) - 8} textAnchor="middle" className="cap-label">
                        {m.format(totals[i])}
                      </text>
                    )}
                    {showLabel(i) && (
                      <text x={cx} y={TOP + PLOT_HEIGHT + 18} textAnchor="middle" className="tick">
                        {axisLabel(bucket.start, unit)}
                      </text>
                    )}
                    {/* The whole band is the hover/focus target, not just the painted bar. */}
                    <rect
                      x={AXIS_LEFT + band * i}
                      y={TOP}
                      width={band}
                      height={PLOT_HEIGHT}
                      fill="transparent"
                      tabIndex={0}
                      className="hit"
                      aria-label={`${bucketTitle(bucket.start, unit)}: ${m.format(totals[i])}`}
                      onPointerEnter={() => setHovered(i)}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered(i)}
                      onBlur={() => setHovered(null)}
                    />
                  </g>
                );
              })}
            </svg>
          )}
          {hovered !== null && hovered <= last && width > 0 && (
            <Tooltip
              bucket={buckets[hovered]}
              unit={unit}
              metric={metric}
              total={totals[hovered]}
              left={AXIS_LEFT + band * hovered + band / 2}
              width={width}
            />
          )}
        </div>
      )}
    </section>
  );
}

function Tooltip({ bucket, unit, metric, total, left, width }: {
  bucket: Bucket; unit: BucketUnit; metric: Metric; total: number; left: number; width: number;
}) {
  const m = METRICS[metric];
  const values = m.values(bucket);
  const rows = FAMILIES.filter((f) => values[f] > 0);
  const flip = left > width - 240;
  return (
    <div className="tooltip" style={flip ? { right: width - left + 14 } : { left: left + 14 }} role="status">
      <div className="tooltip-title">{bucketTitle(bucket.start, unit)}</div>
      <div className="tooltip-total">{total > 0 ? m.format(total) : restLabel(unit)}</div>
      {rows.map((f) => (
        <div key={f} className="tooltip-row">
          <span className="line-key" style={{ background: sportColor(f) }} aria-hidden />
          <strong>{m.format(values[f])}</strong>
          <span>{SPORTS[f].label}</span>
        </div>
      ))}
    </div>
  );
}

function EvolutionTable({ buckets, unit, metric, families, totals }: {
  buckets: Bucket[]; unit: BucketUnit; metric: Metric; families: Family[]; totals: number[];
}) {
  const m = METRICS[metric];
  return (
    <div className="table-scroll">
      <table className="data-table compact">
        <thead>
          <tr>
            <th>{UNIT_NAME[unit]}</th>
            {families.map((f) => (
              <th key={f} className="num">
                {SPORTS[f].label}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr key={b.start}>
              <td>{bucketTitle(b.start, unit)}</td>
              {families.map((f) => (
                <td key={f} className="num">
                  {m.values(b)[f] > 0 ? m.format(m.values(b)[f]) : "–"}
                </td>
              ))}
              <td className="num strong">{totals[i] > 0 ? m.format(totals[i]) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
