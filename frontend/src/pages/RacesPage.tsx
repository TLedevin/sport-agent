import { ChartLine, FileText, Medal, Table, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, photoSrc, type Activity } from "../api";
import { Segmented } from "../components/EvolutionChart";
import RaceChart from "../components/RaceChart";
import { clock, km, meters, paceOrSpeed, shortDate } from "../format";
import { buildRaces, groupLabel, records, STANDARD, topText, type DistanceKey, type Race } from "../races";
import { sportColor } from "../sports";
import { errorNotice, useSync } from "../sync";

const RUN = sportColor("running");
const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

function pace(r: Race): string | null {
  return r.time && r.distance > 0 ? paceOrSpeed(r.activity.sport_type, r.distance / r.time) : null;
}

function rank(rank: number | null, total: number | null): string {
  if (!rank) return "–";
  return total ? `${rank} / ${total.toLocaleString("en")}` : String(rank);
}

/** "5:06 /km · D+ 120 m": the extra line in chart tooltips. */
function describe(r: Race): string {
  return [pace(r), r.activity.elevation_gain ? `D+ ${meters(r.activity.elevation_gain)}` : null, `${groupLabel(r.group)}`]
    .filter(Boolean)
    .join(" · ");
}

type Data = { races: Race[]; missing: Activity[] };

export default function RacesPage() {
  const { version, setNotice } = useSync();
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .races()
      .then((d) => !cancelled && setData({ races: buildRaces(d.races), missing: d.missing_results }))
      .catch((err) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version, setNotice]);

  if (!data) {
    return (
      <div className="page-loading" role="status">
        <div className="loader" aria-hidden />
      </div>
    );
  }

  const { races, missing } = data;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Races</h1>
        <p className="page-sub">Your results, records and how your times and rankings evolve</p>
      </div>

      {missing.length > 0 && <MissingResults activities={missing} />}

      {races.length === 0 ? (
        <section className="card empty-state">
          <h2>No race results yet</h2>
          <p>
            Open a race (or any activity that was one) and click <strong>Add race result</strong> to enter your official
            time and rankings. They'll all be summed up here.
          </p>
          <Link to="/activities" className="button">Go to activities</Link>
        </section>
      ) : (
        <>
          <Summary races={races} />
          <Records races={races} />
          <TimesChart races={races} />
          <RankingsChart races={races} />
          <History races={races} />
        </>
      )}
    </div>
  );
}

function MissingResults({ activities }: { activities: Activity[] }) {
  return (
    <section className="card race-missing" aria-label="Races without a result">
      <Trophy size={18} aria-hidden />
      <div>
        <strong>
          {activities.length} {activities.length === 1 ? "race has" : "races have"} no result yet
        </strong>
        <p className="muted">
          Tagged as races in Garmin Connect:{" "}
          {activities.slice(0, 4).map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <Link to={`/activities/${a.id}`}>{a.name}</Link> ({shortDate(a.start_time_local.slice(0, 10))})
            </span>
          ))}
          {activities.length > 4 && ` and ${activities.length - 4} more`}.
        </p>
      </div>
    </section>
  );
}

function Summary({ races }: { races: Race[] }) {
  const year = String(new Date().getFullYear());
  const thisYear = races.filter((r) => r.date.startsWith(year)).length;
  const distance = races.reduce((sum, r) => sum + r.distance, 0);
  const last = races.at(-1)!;
  const ranked = races.filter((r) => r.top.overall !== null);
  const best = ranked.length ? ranked.reduce((a, b) => (b.top.overall! < a.top.overall! ? b : a)) : null;
  return (
    <div className="fitness-tiles">
      <section className="card tile" aria-label="Races">
        <div className="tile-label">Races</div>
        <div className="tile-value">{races.length}</div>
        <div className="delta neutral">{thisYear} this year · {km(distance)} raced</div>
      </section>
      <section className="card tile" aria-label="Last race">
        <div className="tile-label">Last race</div>
        <div className="tile-value">{last.time ? clock(last.time) : groupLabel(last.group)}</div>
        <div className="delta neutral">
          <Link to={`/activities/${last.activity.id}`}>{last.activity.name}</Link>
          {last.top.overall !== null && ` · ${topText(last.top.overall)}`}
        </div>
      </section>
      <section className="card tile" aria-label="Best overall ranking">
        <div className="tile-label">Best overall ranking</div>
        <div className="tile-value">{best ? topText(best.top.overall) : "–"}</div>
        <div className="delta neutral">
          {best ? (
            <>
              {rank(best.activity.race_result!.overall_rank, best.activity.race_result!.overall_total)} ·{" "}
              <Link to={`/activities/${best.activity.id}`}>{best.activity.name}</Link>
            </>
          ) : (
            "Add the number of finishers to see it"
          )}
        </div>
      </section>
    </div>
  );
}

function Records({ races }: { races: Race[] }) {
  return (
    <section aria-labelledby="records-title">
      <h2 className="section-title" id="records-title">Records</h2>
      <div className="race-records">
        {records(races).map((rec) => (
          <article key={rec.key} className={`card race-record ${rec.best ? "" : "empty"}`}>
            <div className="race-record-head">
              <span className="tile-label">{rec.label}</span>
              {rec.count > 0 && <span className="muted">{rec.count} {rec.count === 1 ? "race" : "races"}</span>}
            </div>
            {rec.best ? (
              <>
                <div className="race-record-time">{clock(rec.best.time!)}</div>
                <div className="muted">{pace(rec.best)}</div>
                <div className="race-record-race">
                  <Link to={`/activities/${rec.best.activity.id}`}>{rec.best.activity.name}</Link> ·{" "}
                  {shortDate(rec.best.date)}
                </div>
                <div className={`delta ${rec.gain ? "up" : "neutral"}`}>
                  {rec.gain ? (
                    <span><strong>−{clock(rec.gain)}</strong> on the previous record</span>
                  ) : (
                    <span>First record at this distance</span>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">{rec.count ? "No official time yet" : `No ${rec.label} yet`}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ChartCard({ id, title, sub, controls, children, table }: {
  id: string; title: string; sub: string; controls?: React.ReactNode; children: React.ReactNode; table: React.ReactNode;
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
      {controls}
      {showTable ? table : children}
    </section>
  );
}

function TimesChart({ races }: { races: Race[] }) {
  const timed = races.filter((r) => r.time && r.group !== "other");
  const offered = STANDARD.filter((s) => timed.some((r) => r.group === s.key));
  // Start on the distance raced most.
  const busiest = [...offered].sort((a, b) => timed.filter((r) => r.group === b.key).length - timed.filter((r) => r.group === a.key).length)[0];
  const [chosen, setChosen] = useState<DistanceKey | null>(null);
  const key = offered.some((s) => s.key === chosen) ? chosen! : busiest?.key;
  if (!key) return null;
  const at = timed.filter((r) => r.group === key);
  return (
    <ChartCard id="times-title" title="Times" sub={`${groupLabel(key)}: each race, and your record over time. Faster is higher.`}
      controls={offered.length > 1 && (
        <div className="chart-controls">
          <Segmented label="Distance" value={key} onChange={setChosen}
            options={offered.map((s) => ({ key: s.key, short: s.label === "Half marathon" ? "Half" : s.label, label: s.label }))} />
        </div>
      )}
      table={<RaceTable races={[...at].reverse()} />}>
      <RaceChart races={at} durations recordLine format={clock} describe={describe} label={`${groupLabel(key)} times`}
        series={[{ key: "time", label: "Official time", color: RUN, value: (r) => r.time }]} />
    </ChartCard>
  );
}

function RankingsChart({ races }: { races: Race[] }) {
  const ranked = races.filter((r) => r.top.overall !== null || r.top.gender !== null || r.top.category !== null);
  if (!ranked.length) return null;
  const series = [
    { key: "overall", label: "Overall", color: RUN, value: (r: Race) => r.top.overall, connect: true },
    { key: "gender", label: "By sex", color: sportColor("cycling"), value: (r: Race) => r.top.gender, connect: true },
    { key: "category", label: "By category", color: sportColor("swimming"), value: (r: Race) => r.top.category, connect: true },
  ].filter((s) => ranked.some((r) => s.value(r) !== null));
  return (
    <ChartCard id="rankings-title" title="Rankings"
      sub="Top %: your rank among the finishers (5% = in the first 5%). Better is higher."
      table={<RaceTable races={[...ranked].reverse()} />}>
      <RaceChart races={ranked} series={series} format={percent} label="Rankings as a share of finishers"
        describe={(r) => [groupLabel(r.group), r.time ? clock(r.time) : null].filter(Boolean).join(" · ")} />
    </ChartCard>
  );
}

const FILTERS: { key: DistanceKey | "all"; short: string; label: string }[] = [
  { key: "all", short: "All", label: "All distances" },
  ...STANDARD.map((s) => ({ key: s.key, short: s.label === "Half marathon" ? "Half" : s.label, label: s.label })),
  { key: "other", short: "Other", label: "Other distances" },
];

function History({ races }: { races: Race[] }) {
  const [distance, setDistance] = useState<DistanceKey | "all">("all");
  const [year, setYear] = useState("all");
  const years = useMemo(() => [...new Set(races.map((r) => r.date.slice(0, 4)))].sort().reverse(), [races]);
  const shown = races
    .filter((r) => (distance === "all" || r.group === distance) && (year === "all" || r.date.startsWith(year)))
    .reverse();
  return (
    <section className="card" aria-labelledby="history-title">
      <div className="card-head">
        <div>
          <h2 id="history-title">All races</h2>
          <p className="card-sub">{shown.length} {shown.length === 1 ? "race" : "races"}, newest first</p>
        </div>
      </div>
      <div className="chart-controls">
        <Segmented label="Distance" options={FILTERS.filter((f) => f.key === "all" || races.some((r) => r.group === f.key))}
          value={distance} onChange={setDistance} />
        {years.length > 1 && (
          <select className="race-year" aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>
      {shown.length ? <RaceTable races={shown} /> : <p className="empty-text">No races match.</p>}
    </section>
  );
}

function RaceTable({ races }: { races: Race[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table compact race-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Race</th>
            <th className="num">Distance</th>
            <th className="num">Time</th>
            <th className="num">Pace</th>
            <th className="num" title="Elevation gain of the whole activity">D+</th>
            <th className="num">Overall</th>
            <th className="num">Sex</th>
            <th className="num">Category</th>
            <th className="num">Top %</th>
          </tr>
        </thead>
        <tbody>
          {races.map((r) => {
            const res = r.activity.race_result!;
            return (
              <tr key={r.activity.id}>
                <td className="nowrap muted">{shortDate(r.date)}</td>
                <td>
                  <Link to={`/activities/${r.activity.id}`} className="activity-name">{r.activity.name}</Link>
                  {r.pr && <span className="pr-badge" title="A personal record when it was run"><Medal size={11} aria-hidden /> PR</span>}
                  {(res.certificates ?? []).map((c) => (
                    <a key={c.id} className="certificate-icon" href={photoSrc(c.url)} target="_blank" rel="noopener noreferrer"
                      title={`Open ${c.filename}`} aria-label={`Certificate of ${r.activity.name}: ${c.filename}`}>
                      <FileText size={14} aria-hidden />
                    </a>
                  ))}
                </td>
                <td className="num">{r.group === "other" ? km(r.distance) : groupLabel(r.group)}</td>
                <td className="num strong">{r.time ? clock(r.time) : "–"}</td>
                <td className="num">{pace(r) ?? "–"}</td>
                <td className="num">{r.activity.elevation_gain ? meters(r.activity.elevation_gain) : "–"}</td>
                <td className="num">{rank(res.overall_rank, res.overall_total)}</td>
                <td className="num">{rank(res.gender_rank, res.gender_total)}</td>
                <td className="num">
                  {res.category_rank ? `${rank(res.category_rank, res.category_total)}${res.category ? ` ${res.category}` : ""}` : "–"}
                </td>
                <td className="num">{topText(r.top.overall)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
