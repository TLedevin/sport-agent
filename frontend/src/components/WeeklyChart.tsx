import { ChartColumn, Table } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { Family, WeekBucket } from "../api";
import { hours, shortDate } from "../format";
import { FAMILIES, SPORTS, sportColor } from "../sports";

const PLOT_HEIGHT = 256;
const TOP = 26; // room for the cap label
const AXIS_LEFT = 40;
const AXIS_BOTTOM = 28;
const GAP = 2; // surface gap between stacked segments
const MAX_BAR = 24;
const RADIUS = 4;

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

/** Clean tick step in hours for roughly 4 gridlines. */
function niceStep(maxHours: number): number {
  const raw = maxHours / 4;
  return [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100].find((s) => s >= raw) ?? Math.ceil(raw / 100) * 100;
}

/** Rectangle with rounded top corners only (square on the baseline side). */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export default function WeeklyChart({ weeks }: { weeks: WeekBucket[] }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const families = FAMILIES.filter((f) => weeks.some((w) => w.duration_by_family[f] > 0));
  const totals = weeks.map((w) => FAMILIES.reduce((sum, f) => sum + w.duration_by_family[f], 0));
  const maxHours = Math.max(...totals) / 3600;
  const step = maxHours > 0 ? niceStep(maxHours) : 1;
  const top = Math.max(step * 4, Math.ceil(maxHours / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const plotWidth = Math.max(0, width - AXIS_LEFT);
  const band = weeks.length ? plotWidth / weeks.length : 0;
  const barWidth = Math.min(MAX_BAR, band * 0.56);
  const y = (h: number) => TOP + PLOT_HEIGHT - (h / top) * PLOT_HEIGHT;
  const labelEvery = band >= 46 ? 1 : 2;
  const last = weeks.length - 1;

  return (
    <section className="card chart-card" aria-labelledby="weekly-title">
      <div className="card-head">
        <div>
          <h2 id="weekly-title">Weekly training time</h2>
          <p className="card-sub">Last 12 weeks, by sport</p>
        </div>
        <button className="button ghost small" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? <ChartColumn size={14} aria-hidden /> : <Table size={14} aria-hidden />}
          {showTable ? "Chart" : "Table"}
        </button>
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
        <WeeklyTable weeks={weeks} families={families} totals={totals} />
      ) : (
        <div className="chart-wrap" ref={wrapRef}>
          {width > 0 && (
            <svg width={width} height={TOP + PLOT_HEIGHT + AXIS_BOTTOM} role="img" aria-label="Weekly training time by sport">
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={AXIS_LEFT}
                    x2={width}
                    y1={y(t)}
                    y2={y(t)}
                    className={t === 0 ? "axis-baseline" : "gridline"}
                  />
                  <text x={AXIS_LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                    {Number.isInteger(t) ? t : t.toFixed(1)}h
                  </text>
                </g>
              ))}

              {weeks.map((week, i) => {
                const cx = AXIS_LEFT + band * i + band / 2;
                const x = cx - barWidth / 2;
                const present = FAMILIES.filter((f) => week.duration_by_family[f] > 0);
                let base = y(0);
                const dim = hovered !== null && hovered !== i;
                return (
                  <g key={week.week_start} className="column" opacity={dim ? 0.4 : 1}>
                    {present.map((f, k) => {
                      const h = (week.duration_by_family[f] / 3600 / top) * PLOT_HEIGHT;
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
                    {i === last && totals[i] > 0 && (
                      <text x={cx} y={y(totals[i] / 3600) - 8} textAnchor="middle" className="cap-label">
                        {hours(totals[i])}
                      </text>
                    )}
                    {(i % labelEvery === (last % labelEvery) || i === last) && (
                      <text x={cx} y={TOP + PLOT_HEIGHT + 18} textAnchor="middle" className="tick">
                        {shortDate(week.week_start)}
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
                      aria-label={`Week of ${shortDate(week.week_start)}: ${hours(totals[i])}`}
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
          {hovered !== null && width > 0 && (
            <Tooltip
              week={weeks[hovered]}
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

function Tooltip({ week, total, left, width }: { week: WeekBucket; total: number; left: number; width: number }) {
  const rows = FAMILIES.filter((f) => week.duration_by_family[f] > 0);
  const flip = left > width - 240;
  return (
    <div className="tooltip" style={flip ? { right: width - left + 14 } : { left: left + 14 }} role="status">
      <div className="tooltip-title">Week of {shortDate(week.week_start)}</div>
      <div className="tooltip-total">{total > 0 ? hours(total) : "Rest week"}</div>
      {rows.map((f) => (
        <div key={f} className="tooltip-row">
          <span className="line-key" style={{ background: sportColor(f) }} aria-hidden />
          <strong>{hours(week.duration_by_family[f])}</strong>
          <span>{SPORTS[f].label}</span>
        </div>
      ))}
    </div>
  );
}

function WeeklyTable({ weeks, families, totals }: { weeks: WeekBucket[]; families: Family[]; totals: number[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table compact">
        <thead>
          <tr>
            <th>Week of</th>
            {families.map((f) => (
              <th key={f} className="num">
                {SPORTS[f].label}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={w.week_start}>
              <td>{shortDate(w.week_start)}</td>
              {families.map((f) => (
                <td key={f} className="num">
                  {w.duration_by_family[f] > 0 ? hours(w.duration_by_family[f]) : "–"}
                </td>
              ))}
              <td className="num strong">{totals[i] > 0 ? hours(totals[i]) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
