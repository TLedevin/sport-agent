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
  distance: number;
  duration: number;
  moving_duration: number | null;
  elevation_gain: number | null;
  average_speed: number | null;
  average_hr: number | null;
  max_hr: number | null;
  calories: number | null;
};

export type Totals = { count: number; distance: number; duration: number; elevation_gain: number };
export type PeriodKey = "week" | "month" | "year";
export type WeekBucket = { week_start: string; duration_by_family: Record<Family, number> };
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
export type Dashboard = {
  today: string;
  periods: Record<PeriodKey, { current: Totals; previous: Totals }>;
  weekly: WeekBucket[];
  breakdown: FamilyTotals[];
  records: PersonalRecord[];
};
export type GarminStatus = { connected: boolean; tokens_updated_at: string | null; last_sync_at: string | null };
export type SyncResult = { imported: number; last_sync_at: string | null };

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  return response.json() as Promise<T>;
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
  activities: (limit: number, offset: number) =>
    request<Activity[]>(`/api/activities?limit=${limit}&offset=${offset}`),
  garminStatus: () => request<GarminStatus>("/api/garmin/status"),
  sync: () => request<SyncResult>("/api/sync", { method: "POST" }),
};
