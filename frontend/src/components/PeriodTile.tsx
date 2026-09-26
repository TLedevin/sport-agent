import { ArrowDown, ArrowUp } from "lucide-react";
import type { Totals } from "../api";
import { change, hours, km, meters } from "../format";

type Props = { label: string; compareLabel: string; current: Totals; previous: Totals };

export default function PeriodTile({ label, compareLabel, current, previous }: Props) {
  // Distance leads, unless the period only has distance-less sessions (e.g. strength).
  const byTime = current.distance === 0 && current.duration > 0;
  const value = byTime ? hours(current.duration) : km(current.distance);
  const delta = byTime ? change(current.duration, previous.duration) : change(current.distance, previous.distance);

  return (
    <section className="card tile" aria-label={label}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <Delta value={delta} hasCurrent={current.count > 0} compareLabel={compareLabel} />
      <dl className="tile-facts">
        <div>
          <dt>Time</dt>
          <dd>{hours(current.duration)}</dd>
        </div>
        <div>
          <dt>Activities</dt>
          <dd>{current.count}</dd>
        </div>
        <div>
          <dt>Elevation</dt>
          <dd>{meters(current.elevation_gain)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Delta({ value, hasCurrent, compareLabel }: { value: number | null; hasCurrent: boolean; compareLabel: string }) {
  if (value === null) {
    return <div className="delta neutral">{hasCurrent ? "No earlier data to compare" : "No activities yet"}</div>;
  }
  const pct = Math.round(Math.abs(value) * 100);
  if (pct === 0) return <div className="delta neutral">Same as {compareLabel.replace(/^vs /, "")}</div>;
  // Less training isn't "bad": a decrease stays neutral, only an increase gets the success color.
  const up = value > 0;
  return (
    <div className={`delta ${up ? "up" : "neutral"}`}>
      {up ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />}
      <span>
        <strong>{pct}%</strong> {compareLabel}
      </span>
    </div>
  );
}
