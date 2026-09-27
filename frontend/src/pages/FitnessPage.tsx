import { ArrowDown, ArrowUp, ChartLine, Table } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Fitness, type FitnessMetric, type FitnessPoint } from "../api";
import { Segmented } from "../components/EvolutionChart";
import TrendChart, { type TrendSeries } from "../components/TrendChart";
import { clock, shortDate } from "../format";
import { sportColor } from "../sports";
import { errorNotice, useSync } from "../sync";

type RangeKey = "3m" | "6m" | "1y" | "2y" | "all";
const RANGES: { key: RangeKey; short: string; label: string; days: number | null }[] = [
  { key: "3m", short: "3M", label: "Last 3 months", days: 91 },
  { key: "6m", short: "6M", label: "Last 6 months", days: 182 },
  { key: "1y", short: "1Y", label: "Last 12 months", days: 365 },
  { key: "2y", short: "2Y", label: "Last 2 years", days: 730 },
  { key: "all", short: "All", label: "All time", days: null },
];

const RACES: { metric: FitnessMetric; label: string; km: number }[] = [
  { metric: "race_5k", label: "5K", km: 5 },
  { metric: "race_10k", label: "10K", km: 10 },
  { metric: "race_half", label: "Half marathon", km: 21.0975 },
  { metric: "race_marathon", label: "Marathon", km: 42.195 },
];

const POLL_MS = 15_000; // while the first fitness sync runs in the background
const POLL_TRIES = 8;

const RUN = sportColor("running");
const RIDE = sportColor("cycling");
// Endurance score covers every sport: neutral ink rather than a sport's color.
const ALL_SPORTS = "var(--text-primary)";

const whole = (v: number) => Math.round(v).toLocaleString("en");
const oneDecimal = (v: number) => v.toFixed(1);

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA");
}

/** The value as it stood at `day`: the last reading on or before it, else the first after. */
function asOf(points: FitnessPoint[], day: string): FitnessPoint | null {
  return points.filter(([d]) => d <= day).at(-1) ?? points.find(([d]) => d > day) ?? null;
}

type Change = { text: string; better: boolean } | null;

/** Change from the start of the window to the latest value. */
function changeOver(points: FitnessPoint[], from: string, format: (v: number) => string, lowerIsBetter = false): Change {
  const latest = points.at(-1);
  const start = asOf(points, from);
  if (!latest || !start || start[0] === latest[0]) return null;
  const diff = latest[1] - start[1];
  if (Math.abs(diff) < 1e-9) return { text: "No change", better: false };
  return { text: `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))}`, better: lowerIsBetter ? diff < 0 : diff > 0 };
}

function Delta({ change, since }: { change: Change; since: string }) {
  if (!change) return <div className="delta neutral">No earlier value to compare</div>;
  const Icon = change.text.startsWith("−") ? ArrowDown : ArrowUp;
  return (
    <div className={`delta ${change.better ? "up" : "neutral"}`}>
      {change.text !== "No change" && <Icon size={14} aria-hidden />}
      <span>
        <strong>{change.text}</strong> since {since}
      </span>
    </div>
  );
}

function Tile({ label, points, from, format, lowerIsBetter, since, children }: {
  label: string; points: FitnessPoint[]; from: string; format: (v: number) => string; lowerIsBetter?: boolean;
  since: string; children?: ReactNode;
}) {
  const latest = points.at(-1)!;
  return (
    <section className="card tile" aria-label={label}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{format(latest[1])}</div>
      <Delta change={changeOver(points, from, format, lowerIsBetter)} since={since} />
      <div className="tile-foot">
        {children}
        <span>Updated {shortDate(latest[0])}</span>
      </div>
    </section>
  );
}

/** A card with a trend chart and its table view. */
function TrendCard({ id, title, sub, children, ...chart }: {
  id: string; title: string; sub: string; children?: ReactNode;
  series: TrendSeries[]; from: string; to: string; format: (v: number) => string; tick?: (v: number) => string;
  durations?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card chart-card" aria-labelledby={id}>
      <div className="card-head">
        <div>
          <h2 id={id}>{title}</h2>
          <p className="card-sub">{sub}</p>
        </div>
        <button className="button ghost small" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? <ChartLine size={14} aria-hidden /> : <Table size={14} aria-hidden />}
          {showTable ? "Chart" : "Table"}
        </button>
      </div>
      {children}
      <TrendChart {...chart} label={`${title}: ${sub}`} showTable={showTable} />
    </section>
  );
}

export default function FitnessPage() {
  const { version, setNotice } = useSync();
  const [data, setData] = useState<Fitness | null>(null);
  const [range, setRange] = useState<RangeKey>("1y");
  const [race, setRace] = useState<FitnessMetric>("race_10k");

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api
        .fitness()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          // The first read from Garmin runs after the sync: check back until it has happened.
          if (!d.checked && ++tries < POLL_TRIES) timer = setTimeout(load, POLL_MS);
        })
        .catch((err) => {
          if (!cancelled && !(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
        });
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [version, setNotice]);

  if (!data) {
    return (
      <div className="page-loading" role="status">
        <div className="loader" aria-hidden />
      </div>
    );
  }

  const s = data.series;
  const hasAny = Object.values(s).some((points) => points && points.length > 0);
  const today = new Date().toLocaleDateString("en-CA");
  const r = RANGES.find((x) => x.key === range)!;
  const earliest = Object.values(s).flatMap((p) => (p?.length ? [p[0][0]] : [])).sort()[0] ?? today;
  const from = r.days === null ? earliest : isoDaysAgo(r.days);
  const since = r.days === null ? shortDate(earliest) : shortDate(from);

  const vo2 = s.vo2max_running?.length ? s.vo2max_running : s.vo2max_cycling;
  const races = RACES.filter((x) => s[x.metric]?.length);
  const plotted = races.find((x) => x.metric === race) ?? races[0];
  const vo2Series: TrendSeries[] = [
    { key: "running", label: "Running", color: RUN, points: s.vo2max_running ?? [] },
    { key: "cycling", label: "Cycling", color: RIDE, points: s.vo2max_cycling ?? [] },
  ].filter((x) => x.points.length);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Fitness</h1>
        <p className="page-sub">How your fitness evolves, as Garmin estimates it from your training.</p>
      </div>

      {!hasAny ? (
        <section className="card empty-state">
          <h2>{data.checked ? "No fitness data from Garmin" : "Loading your fitness history…"}</h2>
          <p>
            {data.checked
              ? "Garmin estimates VO2 max, race predictions, endurance and hill scores on compatible watches, from runs and rides recorded with heart rate. They'll appear here once Garmin has them."
              : "It's read from Garmin in the background after each sync. The first time, this can take a minute."}
          </p>
        </section>
      ) : (
        <>
          <Segmented label="Time range" options={RANGES} value={range} onChange={setRange} />

          <div className="fitness-tiles">
            {vo2 && (
              <Tile label={vo2 === s.vo2max_running ? "VO2 max" : "VO2 max (cycling)"} points={vo2} from={from}
                format={oneDecimal} since={since} />
            )}
            {!!s.fitness_age?.length && (
              <Tile label="Fitness age" points={s.fitness_age} from={from} format={whole} lowerIsBetter since={since} />
            )}
            {!!s.endurance_score?.length && (
              <Tile label="Endurance score" points={s.endurance_score} from={from} format={whole} since={since} />
            )}
            {!!s.hill_score?.length && (
              <Tile label="Hill score" points={s.hill_score} from={from} format={whole} since={since}>
                {!!s.hill_strength?.length && <span>Strength {whole(s.hill_strength.at(-1)![1])}</span>}
                {!!s.hill_endurance?.length && <span>Endurance {whole(s.hill_endurance.at(-1)![1])}</span>}
              </Tile>
            )}
          </div>

          {plotted && (
            <TrendCard id="race-title" title="Race predictions" sub={`${plotted.label} predicted time, ${r.label.toLowerCase()}. Lower is faster.`}
              series={[{ key: plotted.metric, label: plotted.label, color: RUN, points: s[plotted.metric]! }]}
              from={from} to={today} format={clock} durations>
              <div className="race-grid" role="group" aria-label="Distance to chart">
                {races.map((x) => {
                  const points = s[x.metric]!;
                  const latest = points.at(-1)![1];
                  const change = changeOver(points, from, clock, true);
                  return (
                    <button key={x.metric} type="button" className="race-option" aria-pressed={x === plotted}
                      onClick={() => setRace(x.metric)}>
                      <span className="race-name">{x.label}</span>
                      <span className="race-time">{clock(latest)}</span>
                      <span className="race-pace">{clock(latest / x.km)} /km</span>
                      <span className={`race-change ${change?.better ? "better" : ""}`}>
                        {change ? `${change.text} since ${since}` : "–"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </TrendCard>
          )}

          <div className="fitness-charts">
            {vo2Series.length > 0 && (
              <TrendCard id="vo2-title" title="VO2 max" sub={`${r.label}, in ml/kg/min`} series={vo2Series}
                from={from} to={today} format={oneDecimal} tick={whole} />
            )}
            {!!s.endurance_score?.length && (
              <TrendCard id="endurance-title" title="Endurance score" sub={`${r.label}, weekly, all sports`}
                series={[{ key: "endurance", label: "Endurance score", color: ALL_SPORTS, points: s.endurance_score }]}
                from={from} to={today} format={whole} />
            )}
            {!!s.hill_score?.length && (
              <TrendCard id="hill-title" title="Hill score" sub={`${r.label}, climbing strength and endurance`}
                series={[{ key: "hill", label: "Hill score", color: RUN, points: s.hill_score }]}
                from={from} to={today} format={whole} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
