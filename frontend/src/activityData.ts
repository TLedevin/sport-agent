/**
 * What the activity page knows how to show. Garmin's fields differ by activity type (a pool
 * swim has strokes but no GPS, a manual entry almost nothing), so everything here is optional:
 * a stat or graph appears only when the activity has a real value for it.
 */
import type { GarminFields, Series } from "./api";
import { calories, clock, km, meters, paceOrSpeed, paceOrSpeedLabel } from "./format";

export type Stat = { label: string; value: string };
/** Identifies a card, so the page can give it an icon. */
export type GroupId = "pace" | "heart" | "elevation" | "form" | "swim" | "power" | "training" | "efforts";
export type StatGroup = { id: GroupId; title: string; stats: Stat[] };

const PACE_SPORTS = ["running", "walking", "hiking"];
/** Step cadence and stride only mean something on foot: watches report noise for skiing, driving... */
const isFootSport = (sportType: string) => /run|walk|hik/.test(sportType);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value !== 0 ? value : null;
}

const round = (v: number) => String(Math.round(v));
const oneDecimal = (v: number) => v.toFixed(1);
const bpm = (v: number) => `${Math.round(v)} bpm`;
const spm = (v: number) => `${Math.round(v)} spm`;
const cmAsMeters = (v: number) => `${(v / 100).toFixed(2)} m`; // Garmin gives stride and stroke lengths in cm
const verticalSpeed = (v: number) => `${Math.round(v * 60)} m/min`;

type Field = {
  label: string;
  keys: string[]; // first present key wins (summary list, then the full activity summary)
  format: (v: number, sportType: string) => string;
};

/** The headline numbers, shown in a row under the title rather than in a card. */
const OVERVIEW: Field[] = [
  { label: "Distance", keys: ["distance"], format: (v) => km(v) },
  { label: "Timer time", keys: ["duration"], format: (v) => clock(v) },
  { label: "Moving time", keys: ["movingDuration"], format: (v) => clock(v) },
  { label: "Calories", keys: ["calories"], format: (v) => calories(v) },
  { label: "Resting calories", keys: ["bmrCalories"], format: (v) => calories(v) },
  { label: "Steps", keys: ["steps"], format: (v) => v.toLocaleString("en") },
];

const GROUPS: { id: GroupId; title: string; fields: Field[] }[] = [
  {
    id: "pace",
    title: "Pace & speed",
    fields: [
      { label: "Average", keys: ["averageSpeed"], format: (v, s) => paceOrSpeed(s, v) },
      { label: "Moving average", keys: ["averageMovingSpeed"], format: (v, s) => paceOrSpeed(s, v) },
      { label: "Best", keys: ["maxSpeed"], format: (v, s) => paceOrSpeed(s, v) },
    ],
  },
  {
    id: "heart",
    title: "Heart rate",
    fields: [
      { label: "Average", keys: ["averageHR"], format: bpm },
      { label: "Max", keys: ["maxHR"], format: bpm },
      { label: "Min", keys: ["minHR"], format: bpm },
    ],
  },
  {
    id: "elevation",
    title: "Elevation",
    fields: [
      { label: "Gain", keys: ["elevationGain"], format: (v) => meters(v) },
      { label: "Loss", keys: ["elevationLoss"], format: (v) => meters(v) },
      { label: "Highest", keys: ["maxElevation"], format: (v) => meters(v) },
      { label: "Lowest", keys: ["minElevation"], format: (v) => meters(v) },
      { label: "Average", keys: ["avgElevation"], format: (v) => meters(v) },
      { label: "Max climb rate", keys: ["maxVerticalSpeed"], format: verticalSpeed },
    ],
  },
  {
    id: "form",
    title: "Running form",
    fields: [
      { label: "Avg cadence", keys: ["averageRunningCadenceInStepsPerMinute", "averageRunCadence"], format: spm },
      { label: "Max cadence", keys: ["maxRunningCadenceInStepsPerMinute", "maxRunCadence"], format: spm },
      { label: "Avg stride", keys: ["avgStrideLength", "strideLength"], format: cmAsMeters },
    ],
  },
  {
    id: "swim",
    title: "Swimming",
    fields: [
      { label: "Pool", keys: ["poolLength"], format: cmAsMeters },
      { label: "Lengths", keys: ["activeLengths"], format: round },
      { label: "Strokes", keys: ["strokes"], format: (v) => Math.round(v).toLocaleString("en") },
      { label: "Strokes per length", keys: ["avgStrokes"], format: oneDecimal },
      { label: "SWOLF", keys: ["averageSwolf"], format: round },
      { label: "Distance per stroke", keys: ["avgStrokeDistance"], format: cmAsMeters },
      { label: "Avg stroke rate", keys: ["averageSwimCadenceInStrokesPerMinute"], format: (v) => `${Math.round(v)} /min` },
      { label: "Max stroke rate", keys: ["maxSwimCadenceInStrokesPerMinute"], format: (v) => `${Math.round(v)} /min` },
    ],
  },
  {
    id: "power",
    title: "Power",
    fields: [
      { label: "Average", keys: ["avgPower"], format: (v) => `${Math.round(v)} W` },
      { label: "Max", keys: ["maxPower"], format: (v) => `${Math.round(v)} W` },
      { label: "Normalized", keys: ["normPower"], format: (v) => `${Math.round(v)} W` },
      { label: "FTP", keys: ["maxFtp"], format: (v) => `${Math.round(v)} W` },
    ],
  },
  {
    id: "training",
    title: "Training",
    fields: [
      { label: "Aerobic effect", keys: ["aerobicTrainingEffect", "trainingEffect"], format: oneDecimal },
      { label: "Anaerobic effect", keys: ["anaerobicTrainingEffect"], format: oneDecimal },
      { label: "VO2 max", keys: ["vO2MaxValue"], format: round },
      { label: "Lactate threshold HR", keys: ["lactateThresholdBpm"], format: bpm },
      // Garmin stores this one in tenths of m/s
      { label: "Lactate threshold pace", keys: ["lactateThresholdSpeed"], format: (v, s) => paceOrSpeed(s, v * 10) },
    ],
  },
];

/** Best efforts Garmin found inside the activity (fastestSplit_<meters>, in seconds). */
function bestEfforts(raw: GarminFields): Stat[] {
  const names: Record<string, string> = { "1609": "1 mile", "21098": "Half marathon", "42195": "Marathon" };
  return Object.entries(raw)
    .filter(([k, v]) => k.startsWith("fastestSplit_") && num(v) !== null)
    .map(([k, v]) => ({ meters: Number(k.slice("fastestSplit_".length)), seconds: v as number }))
    .sort((a, b) => a.meters - b.meters)
    .map(({ meters: m, seconds }) => ({
      label: names[String(m)] ?? (m >= 1000 ? `${m / 1000} km` : `${m} m`),
      value: clock(seconds),
    }));
}

/** The fields that have a value, taken from the stored summary, else the full activity summary. */
function present(fields: Field[], raw: GarminFields, summary: GarminFields | null, sportType: string): Stat[] {
  return fields.flatMap((f) => {
    for (const key of f.keys) {
      const value = num(raw[key]) ?? num(summary?.[key]);
      if (value !== null) return [{ label: f.label, value: f.format(value, sportType) }];
    }
    return [];
  });
}

export function overviewStats(raw: GarminFields, summary: GarminFields | null, sportType: string): Stat[] {
  return present(OVERVIEW, raw, summary, sportType);
}

export function statGroups(raw: GarminFields, summary: GarminFields | null, sportType: string): StatGroup[] {
  const groups: StatGroup[] = GROUPS.filter((g) => g.id !== "form" || isFootSport(sportType)).map(({ id, title, fields }) => ({
    id,
    title: id === "pace" ? paceOrSpeedLabel(sportType) : title,
    stats: present(fields, raw, summary, sportType),
  }));
  const efforts = bestEfforts(raw);
  if (efforts.length) groups.push({ id: "efforts", title: "Best efforts", stats: efforts });
  return groups.filter((g) => g.stats.length > 0);
}

// --- Weather (Garmin reports °F and mph) ---------------------------------------------------

export function weatherStats(weather: GarminFields | null): Stat[] {
  if (!weather) return [];
  const f = (key: string) => (typeof weather[key] === "number" ? (weather[key] as number) : null);
  const celsius = (v: number) => `${Math.round(((v - 32) * 5) / 9)} °C`;
  const kmh = (v: number) => `${Math.round(v * 1.609)} km/h`;
  const desc = (weather.weatherTypeDTO as { desc?: string } | undefined)?.desc;
  const stats: (Stat | null)[] = [
    desc ? { label: "Conditions", value: desc } : null,
    f("temp") !== null ? { label: "Temperature", value: celsius(f("temp")!) } : null,
    f("apparentTemp") !== null ? { label: "Feels like", value: celsius(f("apparentTemp")!) } : null,
    f("relativeHumidity") !== null ? { label: "Humidity", value: `${f("relativeHumidity")}%` } : null,
    f("windSpeed") !== null
      ? { label: "Wind", value: `${kmh(f("windSpeed")!)} ${String(weather.windDirectionCompassPoint ?? "").toUpperCase()}`.trim() }
      : null,
    f("windGust") !== null ? { label: "Gusts", value: kmh(f("windGust")!) } : null,
    f("dewPoint") !== null ? { label: "Dew point", value: celsius(f("dewPoint")!) } : null,
  ];
  return stats.filter((s): s is Stat => s !== null);
}

// --- Time series ------------------------------------------------------------------------

export type ChartSpec = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  format: (v: number) => string;
  invert?: boolean; // pace: faster (smaller) is drawn higher
};

/** Metrics that are positions, timers or duplicates of another graph, never drawn themselves. */
const NOT_CHARTED = new Set([
  "directTimestamp",
  "directLatitude",
  "directLongitude",
  "directUncorrectedElevation",
  "directFractionalCadence",
  "directRunCadence", // half of directDoubleCadence
]);

function humanize(key: string): string {
  const words = key.replace(/^direct/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}


/** The graphs this activity can show, in a fixed reading order, then any unknown metrics. */
export function chartsFor(series: Series | null, sportType: string): ChartSpec[] {
  if (!series) return [];
  const m = series.metrics;
  const has = (key: string) => (m[key] ?? []).some((v) => v !== null && v !== 0);
  const map = (key: string, fn: (v: number) => number | null) => m[key].map((v) => (v === null ? null : fn(v)));
  const specs: ChartSpec[] = [];

  if (has("directSpeed")) {
    const swim = sportType.includes("swim");
    if (swim || PACE_SPORTS.some((s) => sportType.includes(s))) {
      const per = swim ? 100 : 1000;
      // Below a crawl the pace is meaningless (stops): leave a gap instead of a spike.
      specs.push({
        key: "pace", label: swim ? "Pace /100m" : "Pace", color: "var(--sport-running)", invert: true,
        values: map("directSpeed", (v) => (v > (swim ? 0.1 : 0.5) ? per / v : null)),
        format: (v) => `${clock(v)} ${swim ? "/100m" : "/km"}`,
      });
    } else {
      specs.push({
        key: "speed", label: "Speed", color: "var(--sport-running)",
        values: map("directSpeed", (v) => v * 3.6), format: (v) => `${v.toFixed(1)} km/h`,
      });
    }
  }
  if (has("directHeartRate")) {
    specs.push({ key: "hr", label: "Heart rate", color: "var(--danger-text)", values: m.directHeartRate, format: bpm });
  }
  const elevationKey = has("directCorrectedElevation") ? "directCorrectedElevation" : has("directElevation") ? "directElevation" : null;
  if (elevationKey) {
    specs.push({ key: "elevation", label: "Elevation", color: "var(--sport-walking)", values: m[elevationKey], format: (v) => meters(v) });
  }
  if (has("directDoubleCadence") && isFootSport(sportType)) {
    specs.push({ key: "cadence", label: "Cadence", color: "var(--sport-fitness)", values: m.directDoubleCadence, format: spm });
  }
  if (has("directBikeCadence")) {
    specs.push({ key: "bikeCadence", label: "Cadence", color: "var(--sport-fitness)", values: m.directBikeCadence, format: (v) => `${Math.round(v)} rpm` });
  }
  if (has("directSwimCadence")) {
    specs.push({ key: "swimCadence", label: "Stroke rate", color: "var(--sport-swimming)", values: m.directSwimCadence, format: (v) => `${Math.round(v)} /min` });
  }
  if (has("directPower")) {
    specs.push({ key: "power", label: "Power", color: "var(--sport-cycling)", values: m.directPower, format: (v) => `${Math.round(v)} W` });
  }
  if (has("directVerticalSpeed")) {
    specs.push({
      key: "vspeed", label: "Vertical speed", color: "var(--sport-swimming)",
      values: map("directVerticalSpeed", (v) => v * 60), format: (v) => `${Math.round(v)} m/min`,
    });
  }
  if (has("directPerformanceCondition")) {
    specs.push({
      key: "perf", label: "Performance condition", color: "var(--sport-other)", values: m.directPerformanceCondition,
      format: (v) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v))),
    });
  }

  // Anything else Garmin recorded (running dynamics, temperature, respiration...), as-is.
  const handled = new Set([
    "directSpeed", "directHeartRate", "directCorrectedElevation", "directElevation", "directDoubleCadence",
    "directBikeCadence", "directSwimCadence", "directPower", "directVerticalSpeed", "directPerformanceCondition",
  ]);
  for (const key of Object.keys(m)) {
    if (!key.startsWith("direct") || handled.has(key) || NOT_CHARTED.has(key) || !has(key)) continue;
    const unit = series.units[key];
    specs.push({
      key, label: humanize(key), color: "var(--text-secondary)", values: m[key],
      format: (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit && unit !== "dimensionless" ? ` ${unit}` : ""}`,
    });
  }
  return specs;
}

/** X axis for the graphs: distance when the activity has it, else timer time. */
export type Axis = { kind: "distance" | "time"; values: number[] };

function forwardFill(values: (number | null)[] | undefined): number[] | null {
  if (!values) return null;
  let last = 0;
  const filled = values.map((v) => (v === null ? last : (last = v)));
  return filled.some((v) => v > 0) ? filled : null;
}

export function axesFor(series: Series | null): Axis[] {
  if (!series) return [];
  const axes: Axis[] = [];
  const distance = forwardFill(series.metrics.sumDistance);
  if (distance) axes.push({ kind: "distance", values: distance });
  const time = forwardFill(series.metrics.sumDuration ?? series.metrics.sumElapsedDuration);
  if (time) axes.push({ kind: "time", values: time });
  return axes;
}

/** Sample positions, for the map: [lat, lon] or null where the watch had no fix. */
export function samplePositions(series: Series | null): ([number, number] | null)[] {
  const lat = series?.metrics.directLatitude;
  const lon = series?.metrics.directLongitude;
  if (!lat || !lon) return [];
  return lat.map((la, i) => (la !== null && lon[i] !== null ? [la, lon[i] as number] : null));
}
