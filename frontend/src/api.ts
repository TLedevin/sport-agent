export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(API_URL);
const TOKEN_KEY = "sport-agent-token";
/** Fired when the server rejects the session, so the app can return to the login page. */
export const SESSION_EXPIRED_EVENT = "sport-agent:session-expired";

export type Family = "running" | "cycling" | "swimming" | "walking" | "fitness" | "other";

export type Activity = {
  id: number;
  name: string;
  sport_type: string;
  sport_family: Family;
  start_time_utc: string;
  start_time_local: string;
  location_name: string | null;
  distance: number;
  duration: number;
  moving_duration: number | null;
  elevation_gain: number | null;
  average_speed: number | null;
  average_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  /** Garmin recorded GPS for it: the map can be fetched. */
  has_track: boolean;
  /** Photos added in the app, in the order they were added. */
  photos: Photo[];
  /** Tagged as a race in Garmin Connect. */
  is_race: boolean;
  /** Your official result, when typed in. */
  race_result: RaceResult | null;
};

export type Gender = "men" | "women";
/** Official time (seconds) and rankings of a race: overall ("scratch"), by sex, by category.
 * Totals are the number of finishers, when known. */
export type RaceResult = {
  official_time: number | null;
  overall_rank: number | null;
  overall_total: number | null;
  gender: Gender | null;
  gender_rank: number | null;
  gender_total: number | null;
  category: string | null;
  category_rank: number | null;
  category_total: number | null;
};

/** A photo added to an activity. `url` and `thumb_url` are signed paths on the API: an <img> can load them. */
export type Photo = { id: number; width: number; height: number; url: string; thumb_url: string };
/** A recent photo on the dashboard, with the activity it belongs to. */
export type RecentPhoto = Photo & { activity_id: number; activity_name: string; sport_family: Family };
export type PhotoGroup = { activity: Activity; photos: Photo[] };

/** Full address of a signed photo path. */
export function photoSrc(path: string): string {
  return `${API_URL}${path}`;
}

export type SortField = "date" | "name" | "distance" | "duration" | "speed" | "hr" | "elevation";
/** Filters and sort for the activity list. Dates are the athlete's local dates; distances in meters. */
export type ActivityQuery = {
  date_from?: string;
  date_to?: string;
  min_distance?: number;
  max_distance?: number;
  sport?: Family;
  sort: SortField;
  order: "asc" | "desc";
};
/** `families`: the sport families that exist in the data, for the filter buttons. */
export type ActivityList = { items: Activity[]; total: number; families: Family[] };

/** Garmin's own field names and values, as stored: the page picks what each activity has. */
export type GarminFields = Record<string, unknown>;

export type ActivityPageData = Activity & {
  /** Sex and category of the latest result entered, to prefill a new one. */
  race_defaults: { gender: Gender | null; category: string | null };
  raw: GarminFields;
  gear: { uuid: string; name: string; gear_type: string }[];
};

/** One value per sample for each metric (Garmin keys, e.g. directHeartRate); null where missing. */
export type Series = { length: number; metrics: Record<string, (number | null)[]>; units: Record<string, string | null> };

/** Everything beyond the summary. Each part is null when this kind of activity doesn't have it. */
export type ActivityDetails = {
  summary: GarminFields | null;
  series: Series | null;
  laps: GarminFields[] | null;
  typed_splits: GarminFields[] | null;
  split_summaries: GarminFields[] | null;
  weather: GarminFields | null;
  hr_zones: { zoneNumber: number; secsInZone: number; zoneLowBoundary: number }[] | null;
  power_zones: { zoneNumber: number; secsInZone: number; zoneLowBoundary: number }[] | null;
  exercise_sets: GarminFields[] | null;
};

export type Totals = { count: number; distance: number; duration: number; elevation_gain: number };
export type PeriodKey = "week" | "month" | "year";
export type EvolutionRange = "1m" | "3m" | "6m" | "1y" | "all";
export type BucketUnit = "day" | "week" | "month" | "year";
/** One bar: seconds and meters per sport, from `start` (a date) to the next bucket. */
export type Bucket = {
  start: string;
  duration_by_family: Record<Family, number>;
  distance_by_family: Record<Family, number>;
};
export type BucketSeries = { unit: BucketUnit; buckets: Bucket[] };
export type FamilyTotals = Totals & { family: Family };
export type PersonalRecord = {
  key: string;
  label: string;
  value: number;
  activity_id: number;
  activity_name: string;
  family: Family;
  date: string;
};
export type Periods = Record<PeriodKey, { current: Totals; previous: Totals }>;
export type Dashboard = {
  today: string;
  periods: Periods;
  /** Only sports active since 1 January last year, in palette order. */
  periods_by_family: Partial<Record<Family, Periods>>;
  /** Per range, one series per granularity it offers; the first is the default. */
  evolution: Record<EvolutionRange, BucketSeries[]>;
  breakdown: FamilyTotals[];
  records: PersonalRecord[];
  last_activity: Activity | null;
  /** Photos of the latest activities that have some. */
  recent_photos: RecentPhoto[];
};
/** An activity on the map of all activities. */
export type MapActivity = Pick<
  Activity,
  "id" | "name" | "sport_type" | "sport_family" | "start_time_local" | "distance" | "duration"
> & {
  /** [lat, lon] where it started, when Garmin knows it. */
  start: [number, number] | null;
  /** Simplified route as an encoded polyline; null until its GPS data has been loaded. */
  route: string | null;
};
export type FitnessMetric =
  | "vo2max_running"
  | "vo2max_cycling"
  | "fitness_age"
  | "race_5k"
  | "race_10k"
  | "race_half"
  | "race_marathon"
  | "endurance_score"
  | "hill_score"
  | "hill_strength"
  | "hill_endurance";
/** [date, value] pairs, oldest first. Race predictions are in seconds. */
export type FitnessPoint = [string, number];
export type Fitness = {
  series: Partial<Record<FitnessMetric, FitnessPoint[]>>;
  /** False until the first sync has asked Garmin (it runs in the background after a sync). */
  checked: boolean;
};
/** [lat, lon] pairs, in recording order. */
export type Track = { points: [number, number][] };
export type GarminStatus = { connected: boolean; tokens_updated_at: string | null; last_sync_at: string | null };
export type SyncResult = { imported: number; gear_changed: boolean; last_sync_at: string | null };
export type Gear = {
  uuid: string;
  name: string;
  make_model: string | null;
  gear_type: string;
  status: "active" | "retired";
  date_begin: string | null;
  date_end: string | null;
  /** Meters: the replacement target set in Garmin Connect. */
  maximum_distance: number | null;
  total_distance: number;
  total_activities: number;
  last_used: string | null;
  /** Set when a photo was added in the app; changes with each new photo. */
  photo_version: string | null;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session just won't survive a reload.
  }
}

/** Sends an authenticated request; errors become ApiError. */
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network_error");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && token) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(response.status, typeof body.detail === "string" ? body.detail : response.statusText);
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await send(path, init)).json() as Promise<T>;
}

/** The browser's local date (YYYY-MM-DD), so weeks and months follow your calendar. */
function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

export const api = {
  /** Fire-and-forget: starts waking the database while the user logs in. */
  wake: () => request("/api/wake", { method: "POST" }).catch(() => undefined),
  login: (password: string) =>
    request<{ token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  dashboard: () => request<Dashboard>(`/api/dashboard?today=${localToday()}`),
  activities: (limit: number, offset: number, query: ActivityQuery) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    return request<ActivityList>(`/api/activities?${params}`);
  },
  activity: (activityId: number) => request<ActivityPageData>(`/api/activities/${activityId}`),
  activityDetails: (activityId: number) => request<ActivityDetails>(`/api/activities/${activityId}/details`),
  track: (activityId: number) => request<Track>(`/api/activities/${activityId}/track`),
  gear: () => request<Gear[]>("/api/gear"),
  /** The photo as a blob: it needs the session header, so an <img> can't load it directly.
   * The version in the address lets the browser cache each photo for good. */
  gearPhoto: async (uuid: string, version: string) =>
    (await send(`/api/gear/${encodeURIComponent(uuid)}/photo?v=${encodeURIComponent(version)}`)).blob(),
  setGearPhoto: (uuid: string, url: string) =>
    request<{ photo_version: string }>(`/api/gear/${encodeURIComponent(uuid)}/photo`, {
      method: "PUT",
      body: JSON.stringify({ url }),
    }),
  deleteGearPhoto: async (uuid: string) => {
    await send(`/api/gear/${encodeURIComponent(uuid)}/photo`, { method: "DELETE" });
  },
  map: () => request<MapActivity[]>("/api/map"),
  photos: () => request<PhotoGroup[]>("/api/photos"),
  saveRaceResult: (activityId: number, result: RaceResult) =>
    request<RaceResult>(`/api/activities/${activityId}/race-result`, { method: "PUT", body: JSON.stringify(result) }),
  deleteRaceResult: async (activityId: number) => {
    await send(`/api/activities/${activityId}/race-result`, { method: "DELETE" });
  },
  /** `url`: an image address, or a data: URL (pasted, or picked on the device). */
  addActivityPhoto: (activityId: number, url: string) =>
    request<Photo>(`/api/activities/${activityId}/photos`, { method: "POST", body: JSON.stringify({ url }) }),
  deleteActivityPhoto: async (photoId: number) => {
    await send(`/api/activity-photos/${photoId}`, { method: "DELETE" });
  },
  fitness: () => request<Fitness>("/api/fitness"),
  garminStatus: () => request<GarminStatus>("/api/garmin/status"),
  sync: () => request<SyncResult>("/api/sync", { method: "POST" }),
};
