import {
  ArrowLeft,
  Backpack,
  Camera,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Dumbbell,
  Flag,
  Footprints,
  Gauge,
  HeartPulse,
  ImagePlus,
  Map as MapIcon,
  MapPin,
  Mountain,
  Sun,
  Timer,
  TrendingUp,
  Trophy,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  axesFor,
  chartsFor,
  overviewStats,
  samplePositions,
  statGroups,
  weatherStats,
  type Axis,
  type ChartSpec,
  type GroupId,
  type Stat,
} from "../activityData";
import {
  api,
  ApiError,
  type ActivityDetails,
  type ActivityPageData,
  type GarminFields,
  type Photo,
  type RaceResult,
} from "../api";
import ActivityCharts from "../components/ActivityCharts";
import ActivityMap from "../components/ActivityMap";
import ActivityTitle from "../components/ActivityTitle";
import CardSparkline from "../components/CardSparkline";
import PhotoGallery from "../components/PhotoGallery";
import PhotoPicker from "../components/PhotoPicker";
import RaceResultSection from "../components/RaceResult";
import { activityDate, clock, hours, km, meters, paceOrSpeed, paceOrSpeedLabel, sportLabel } from "../format";
import { SportBadge } from "../sports";
import { errorNotice, useSync } from "../sync";

type DetailsState = { status: "loading" } | { status: "ready"; data: ActivityDetails } | { status: "error" };

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// --- Small building blocks -------------------------------------------------------------

function StatList({ stats }: { stats: Stat[] }) {
  return (
    <dl className="detail-stats">
      {stats.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Which graph, if any, is drawn faded behind each card. */
const GROUP_SPARKLINE: Partial<Record<GroupId, string[]>> = {
  pace: ["pace", "speed"],
  heart: ["hr"],
  elevation: ["elevation"],
  form: ["cadence"],
};

const GROUP_ICONS: Record<GroupId, LucideIcon> = {
  pace: Gauge,
  heart: HeartPulse,
  elevation: Mountain,
  form: Footprints,
  swim: Waves,
  power: Zap,
  training: TrendingUp,
  efforts: Trophy,
};

/** A big faded icon in the card's corner, for cards without a graph to draw. */
const GROUP_DECO: Partial<Record<GroupId, { icon: LucideIcon; color: string }>> = {
  training: { icon: TrendingUp, color: "var(--sport-swimming)" },
  efforts: { icon: Trophy, color: "var(--sport-walking)" },
};

/** Garmin's weather description ("Fair", "Light rain"...) as an icon. */
function weatherIcon(conditions: string | undefined): LucideIcon {
  const text = (conditions ?? "").toLowerCase();
  if (/thunder|storm/.test(text)) return CloudLightning;
  if (/snow|sleet|flurr/.test(text)) return CloudSnow;
  if (/rain|shower|drizzle/.test(text)) return CloudRain;
  if (/fog|mist|haze/.test(text)) return CloudFog;
  if (/overcast|cloudy/.test(text)) return Cloud;
  if (/clear|sunny|fair/.test(text)) return Sun;
  return CloudSun;
}

type StatCardProps = {
  title: string;
  icon: LucideIcon;
  stats: Stat[];
  sparkline?: ChartSpec;
  deco?: { icon: LucideIcon; color: string };
};

function StatCard({ title, icon: Icon, stats, sparkline, deco }: StatCardProps) {
  const Deco = deco?.icon;
  return (
    <section
      className={`card detail-group ${sparkline ? "has-sparkline" : ""} ${deco ? "has-deco" : ""}`}
      style={deco ? { ["--deco-color" as string]: deco.color } : undefined}
      aria-label={title}
    >
      {sparkline && <CardSparkline chart={sparkline} />}
      {Deco && <Deco className="card-deco" strokeWidth={1.5} aria-hidden />}
      <h2>
        <Icon size={16} className="title-icon" aria-hidden /> {title}
      </h2>
      <StatList stats={stats} />
    </section>
  );
}

type SectionProps = { title: string; icon: LucideIcon; sub?: string; children: React.ReactNode; actions?: React.ReactNode };

function Section({ title, icon: Icon, sub, children, actions }: SectionProps) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-head">
        <div>
          <h2>
            <Icon size={16} className="title-icon" aria-hidden /> {title}
          </h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// --- Heart-rate zones ------------------------------------------------------------------

const ZONE_COLORS = ["var(--text-muted)", "var(--sport-running)", "var(--sport-swimming)", "var(--sport-walking)", "var(--danger-text)"];

function HrZones({ zones }: { zones: NonNullable<ActivityDetails["hr_zones"]> }) {
  const total = zones.reduce((sum, z) => sum + (z.secsInZone || 0), 0);
  if (total <= 0) return null;
  const sorted = [...zones].sort((a, b) => a.zoneNumber - b.zoneNumber);
  return (
    <Section title="Heart-rate zones" icon={HeartPulse} sub="Time spent in each zone">
      <ul className="zones">
        {sorted.map((z, i) => {
          const next = sorted[i + 1]?.zoneLowBoundary;
          const share = (z.secsInZone || 0) / total;
          return (
            <li key={z.zoneNumber}>
              <span className="zone-name">Zone {z.zoneNumber}</span>
              <span className="zone-range muted">{next ? `${z.zoneLowBoundary}–${next - 1}` : `${z.zoneLowBoundary}+`} bpm</span>
              <span className="zone-bar">
                <span style={{ width: `${share * 100}%`, background: ZONE_COLORS[i] ?? ZONE_COLORS[4] }} />
              </span>
              <span className="zone-time">{hours(z.secsInZone || 0)}</span>
              <span className="zone-share muted">{Math.round(share * 100)}%</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// --- Laps ------------------------------------------------------------------------------

type Column = { label: string; value: (lap: GarminFields) => number | null; format: (v: number) => string };

function lapColumns(sportType: string): Column[] {
  const n = (key: string) => (lap: GarminFields) => num(lap[key]);
  return [
    // Swim laps are a few lengths: metres, not tenths of a kilometre.
    { label: "Distance", value: n("distance"), format: (v) => (sportType.includes("swim") ? `${Math.round(v)} m` : km(v)) },
    { label: "Time", value: n("duration"), format: clock },
    { label: paceOrSpeedLabel(sportType), value: n("averageSpeed"), format: (v) => paceOrSpeed(sportType, v) },
    { label: "Avg HR", value: n("averageHR"), format: (v) => String(Math.round(v)) },
    { label: "Max HR", value: n("maxHR"), format: (v) => String(Math.round(v)) },
    { label: "Cadence", value: n("averageRunCadence"), format: (v) => String(Math.round(v)) },
    { label: "Stride", value: n("strideLength"), format: (v) => `${(v / 100).toFixed(2)} m` },
    { label: "Gain", value: n("elevationGain"), format: (v) => meters(v) },
    { label: "Loss", value: n("elevationLoss"), format: (v) => meters(v) },
    { label: "Lengths", value: n("numberOfActiveLengths"), format: (v) => String(v) },
    { label: "Strokes", value: n("totalNumberOfStrokes"), format: (v) => String(v) },
    { label: "SWOLF", value: n("averageSWOLF"), format: (v) => String(Math.round(v)) },
    { label: "Stroke rate", value: n("averageSwimCadence"), format: (v) => String(Math.round(v)) },
    { label: "Calories", value: n("calories"), format: (v) => String(Math.round(v)) },
  ];
}

function Laps({ laps, sportType }: { laps: GarminFields[]; sportType: string }) {
  // Only the columns this activity's laps actually fill.
  const columns = lapColumns(sportType).filter((c) => laps.some((lap) => (c.value(lap) ?? 0) !== 0));
  return (
    <Section title="Laps" icon={Flag} sub={`${laps.length} ${laps.length === 1 ? "lap" : "laps"}`}>
      <div className="table-scroll">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>#</th>
              {columns.map((c) => (
                <th key={c.label} className="num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {laps.map((lap, i) => {
              // Pool swims record rests as laps without distance.
              const rest = sportType.includes("swim") && !num(lap.distance);
              return (
                <tr key={i} className={rest ? "muted" : undefined}>
                  <td>{rest ? "Rest" : i + 1}</td>
                  {columns.map((c) => {
                    const v = c.value(lap);
                    return (
                      <td key={c.label} className="num">
                        {v ? c.format(v) : "–"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// --- Generic tables for data Garmin rarely fills ----------------------------------------

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, "");
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  }
  return String(value);
}

function RecordsTable({ rows }: { rows: GarminFields[] }) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) =>
    rows.some((r) => r[k] !== null && r[k] !== undefined && r[k] !== ""),
  );
  return (
    <div className="table-scroll">
      <table className="data-table compact">
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td key={k}>{display(r[k])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Map + graphs ----------------------------------------------------------------------

function MapAndGraphs({ activity, details }: { activity: ActivityPageData; details: ActivityDetails }) {
  const series = details.series;
  const charts = useMemo(() => chartsFor(series, activity.sport_type), [series, activity.sport_type]);
  const axes = useMemo(() => axesFor(series), [series]);
  const [axisKind, setAxisKind] = useState<Axis["kind"]>("distance");
  const axis = axes.find((a) => a.kind === axisKind) ?? axes[0];
  const [hover, setHover] = useState<number | null>(null);

  // The map draws the samples that have a position; keep both index directions for the cursor.
  const { points, pointOfSample, sampleOfPoint } = useMemo(() => {
    const positions = samplePositions(series);
    const points: [number, number][] = [];
    const sampleOfPoint: number[] = [];
    const pointOfSample: (number | null)[] = [];
    positions.forEach((p, i) => {
      if (p) {
        points.push(p);
        sampleOfPoint.push(i);
      }
      pointOfSample.push(points.length ? points.length - 1 : null);
    });
    return { points, pointOfSample, sampleOfPoint };
  }, [series]);

  // No positions in the samples (older recordings): fall back to the stored route, without cursor.
  const [fallback, setFallback] = useState<[number, number][] | null>(null);
  useEffect(() => {
    if (points.length === 0 && activity.has_track) {
      api.track(activity.id).then(({ points }) => setFallback(points)).catch(() => setFallback(null));
    }
  }, [points.length, activity.has_track, activity.id]);

  const hasMap = points.length > 1 || (fallback?.length ?? 0) > 1;
  const hasCharts = charts.length > 0 && !!axis;
  if (!hasMap && !hasCharts) return null;

  return (
    <Section
      title={hasMap && hasCharts ? "Map & graphs" : hasMap ? "Map" : "Graphs"}
      icon={hasMap ? MapIcon : TrendingUp}
      sub={hasMap && hasCharts ? "Hover a graph or the route: both follow" : undefined}
      actions={
        hasCharts && axes.length > 1 ? (
          <div className="segmented" role="group" aria-label="Graph axis">
            {axes.map((a) => (
              <button key={a.kind} type="button" aria-pressed={a.kind === axis.kind} onClick={() => setAxisKind(a.kind)}>
                {a.kind === "distance" ? "Distance" : "Time"}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className={`map-graphs ${hasMap && hasCharts ? "both" : ""}`}>
        {hasMap && (
          <div className="map-graphs-map">
            {points.length > 1 ? (
              <ActivityMap
                points={points}
                family={activity.sport_family}
                highlight={hover !== null ? pointOfSample[hover] : null}
                onHover={(i) => setHover(i === null ? null : sampleOfPoint[i])}
              />
            ) : (
              <ActivityMap points={fallback!} family={activity.sport_family} />
            )}
          </div>
        )}
        {hasCharts && <ActivityCharts charts={charts} axis={axis} hover={hover} onHover={setHover} />}
      </div>
    </Section>
  );
}

// --- Page ------------------------------------------------------------------------------

export default function ActivityDetailPage() {
  const { id } = useParams();
  const activityId = Number(id);
  const { setNotice } = useSync();
  const [activity, setActivity] = useState<ActivityPageData | null>(null);
  const [missing, setMissing] = useState(false);
  const [details, setDetails] = useState<DetailsState>({ status: "loading" });
  const [race, setRace] = useState<RaceResult | null>(null);
  const [editingRace, setEditingRace] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setActivity(null);
    setMissing(false);
    setDetails({ status: "loading" });
    setEditingRace(false);
    api
      .activity(activityId)
      .then((a) => {
        if (cancelled) return;
        setActivity(a);
        setRace(a.race_result);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else if (!(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      });
    api
      .activityDetails(activityId)
      .then((data) => !cancelled && setDetails({ status: "ready", data }))
      .catch((err) => {
        if (cancelled) return;
        setDetails({ status: "error" });
        if (err instanceof ApiError && err.status !== 404 && err.status !== 401) setNotice(errorNotice(err));
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, setNotice]);

  if (missing) {
    return (
      <div className="page">
        <BackLink />
        <section className="card empty-state">
          <h2>Activity not found</h2>
          <p>It may have been deleted in Garmin Connect.</p>
        </section>
      </div>
    );
  }
  if (!activity) {
    return (
      <div className="page-loading" role="status">
        <div className="loader" aria-hidden />
      </div>
    );
  }

  const data = details.status === "ready" ? details.data : null;
  const overview = overviewStats(activity.raw, data?.summary ?? null, activity.sport_type);
  const groups = statGroups(activity.raw, data?.summary ?? null, activity.sport_type);
  const charts = chartsFor(data?.series ?? null, activity.sport_type);
  const weather = weatherStats(data?.weather ?? null);

  return (
    <div className="page">
      <BackLink />
      <div className="detail-head">
        <SportBadge family={activity.sport_family} size={48} />
        <div className="detail-head-body">
          <div className="detail-title">
            <ActivityTitle activity={activity}
              onRenamed={(name, renamed) => setActivity({ ...activity, name, renamed })} />
            <p className="page-sub">
              {sportLabel(activity.sport_type)} · {activityDate(activity.start_time_local)}
              {activity.location_name && (
                <span className="detail-place">
                  <MapPin size={14} aria-hidden /> {activity.location_name}
                </span>
              )}
            </p>
          </div>
          {!activity.is_race && !race && !editingRace && (
            <button type="button" className="button ghost small detail-race-button" onClick={() => setEditingRace(true)}>
              <Trophy size={14} aria-hidden /> Add race result
            </button>
          )}
          {activity.gear.length > 0 && (
            <p className="detail-gear">
              {activity.gear.map((g) => (
                <Link key={g.uuid} to="/equipment" className="chip">
                  <Backpack size={13} aria-hidden /> {g.name}
                </Link>
              ))}
            </p>
          )}
          {overview.length > 0 && (
            <dl className="detail-overview">
              {overview.map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {(activity.is_race || race || editingRace) && (
        <RaceResultSection
          activity={activity}
          result={race}
          editing={editingRace}
          onEdit={() => setEditingRace(true)}
          onCancel={() => setEditingRace(false)}
          onDone={(saved) => {
            setRace(saved);
            setEditingRace(false);
          }}
        />
      )}

      <Photos key={activity.id} activity={activity} />

      {details.status === "loading" && (
        <section className="card detail-loading" role="status">
          <div className="loader" aria-hidden />
          <p>Loading the map, graphs and laps from Garmin…</p>
        </section>
      )}
      {details.status === "error" && (
        <section className="card">
          <p className="empty-text">Garmin's detailed data isn't available right now. Try again in a moment.</p>
        </section>
      )}
      {data && <MapAndGraphs activity={activity} details={data} />}

      {(groups.length > 0 || weather.length > 0) && (
        <div className="detail-groups">
          {groups.map((g) => (
            <StatCard
              key={g.id}
              title={g.title}
              icon={GROUP_ICONS[g.id]}
              stats={g.stats}
              sparkline={charts.find((c) => GROUP_SPARKLINE[g.id]?.includes(c.key))}
              deco={GROUP_DECO[g.id]}
            />
          ))}
          {weather.length > 0 && (
            <StatCard
              title="Weather"
              icon={CloudSun}
              stats={weather}
              deco={{ icon: weatherIcon(weather.find((w) => w.label === "Conditions")?.value), color: "var(--sport-running)" }}
            />
          )}
        </div>
      )}

      {data && (
        <>
          {data.hr_zones && data.hr_zones.length > 0 && <HrZones zones={data.hr_zones} />}
          {data.laps && data.laps.length > 1 && <Laps laps={data.laps} sportType={activity.sport_type} />}
          {data.typed_splits && data.typed_splits.length > 0 && (
            <Section title="Intervals" icon={Timer} sub="Run/walk or workout segments recorded by the watch">
              <RecordsTable rows={data.typed_splits} />
            </Section>
          )}
          {data.split_summaries && data.split_summaries.length > 0 && (
            <Section title="Interval summary" icon={Timer}>
              <RecordsTable rows={data.split_summaries} />
            </Section>
          )}
          {data.exercise_sets && data.exercise_sets.length > 0 && (
            <Section title="Exercise sets" icon={Dumbbell}>
              <RecordsTable rows={data.exercise_sets} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/** Your photos of the activity, and adding more: from the device, the clipboard or the web. */
function Photos({ activity }: { activity: ActivityPageData }) {
  const [photos, setPhotos] = useState<Photo[]>(activity.photos);
  const [adding, setAdding] = useState(false);
  const name = activity.name || sportLabel(activity.sport_type);
  const add = (
    <button type="button" className="button small" onClick={() => setAdding(true)}>
      <ImagePlus size={14} aria-hidden /> Add photos
    </button>
  );
  return (
    <Section title="Photos" icon={Camera} actions={add}
      sub={photos.length ? undefined : "Add your own photos, or pictures found on the web."}>
      <PhotoGallery label="Photos of this activity" items={photos.map((photo) => ({ photo, caption: name }))}
        onDelete={async (photo) => {
          await api.deleteActivityPhoto(photo.id);
          setPhotos((list) => list.filter((p) => p.id !== photo.id));
        }} />
      {adding && (
        <PhotoPicker
          title={`Photos of ${name}`}
          searchQuery={activity.location_name || name}
          multiple
          save={async (source) => {
            const photo = await api.addActivityPhoto(activity.id, source);
            setPhotos((list) => [...list, photo]);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </Section>
  );
}

function BackLink() {
  return (
    <Link to="/activities" className="back-link">
      <ArrowLeft size={15} aria-hidden /> Activities
    </Link>
  );
}
