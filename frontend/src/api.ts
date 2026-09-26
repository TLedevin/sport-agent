const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "sport-agent-token";

export type Activity = {
  id: number;
  name: string;
  sport_type: string;
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

export type PeriodStats = { count: number; distance: number; duration: number; elevation_gain: number };
export type Stats = { week: PeriodStats; month: PeriodStats; year: PeriodStats };
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
    throw new ApiError(response.status, typeof body.detail === "string" ? body.detail : response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  /** Fire-and-forget: starts waking the database while the user logs in. */
  wake: () => request("/api/wake", { method: "POST" }).catch(() => undefined),
  login: (password: string) =>
    request<{ token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  activities: (limit: number, offset: number) =>
    request<Activity[]>(`/api/activities?limit=${limit}&offset=${offset}`),
  stats: () => request<Stats>("/api/stats"),
  garminStatus: () => request<GarminStatus>("/api/garmin/status"),
  sync: () => request<SyncResult>("/api/sync", { method: "POST" }),
};
