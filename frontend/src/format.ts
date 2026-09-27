const PACE_SPORTS = ["running", "walking", "hiking"];

export function sportLabel(typeKey: string): string {
  const label = typeKey.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function km(meters: number): string {
  const value = meters / 1000;
  if (value >= 10000) return `${(value / 1000).toFixed(1)}K km`;
  return `${value.toLocaleString("en", { maximumFractionDigits: value >= 100 ? 0 : 1 })} km`;
}

export function meters(value: number): string {
  return `${Math.round(value).toLocaleString("en")} m`;
}

/** 3725 -> "1:02:05", 605 -> "10:05" */
export function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Long totals: 45000 -> "12h 30m" */
export function hours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Pace for foot sports, per 100 m for swimming, speed for everything else. */
export function paceOrSpeed(sportType: string, speed: number | null): string {
  if (!speed) return "–";
  if (sportType.includes("swim")) return `${clock(100 / speed)} /100m`;
  if (PACE_SPORTS.some((s) => sportType.includes(s))) return `${clock(1000 / speed)} /km`;
  return `${(speed * 3.6).toFixed(1)} km/h`;
}

/** The name for what paceOrSpeed shows. */
export function paceOrSpeedLabel(sportType: string): string {
  if (sportType.includes("swim") || PACE_SPORTS.some((s) => sportType.includes(s))) return "Pace";
  return "Speed";
}

export function calories(kcal: number): string {
  return `${Math.round(kcal).toLocaleString("en")} kcal`;
}

export function activityDate(localIso: string): string {
  // start_time_local is already the athlete's local wall-clock time: format it as-is.
  const date = new Date(localIso);
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2026-09-21" -> "21 Sep" (or "21 Sep 2025" when not this year) */
export function shortDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/** Relative change, or null when there's nothing to compare against. */
export function change(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
