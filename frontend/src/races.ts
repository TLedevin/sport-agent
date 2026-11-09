import type { Activity } from "./api";

/** The four distances races are grouped by; anything else is "other". */
export const STANDARD = [
  { key: "5k", label: "5K", meters: 5000 },
  { key: "10k", label: "10K", meters: 10000 },
  { key: "half", label: "Half marathon", meters: 21097.5 },
  { key: "marathon", label: "Marathon", meters: 42195 },
] as const;
export type DistanceKey = (typeof STANDARD)[number]["key"] | "other";

/** GPS distances wander: within 3% of a standard distance counts as that distance. */
const TOLERANCE = 0.03;

/** A race with what the page needs, worked out once. */
export type Race = {
  activity: Activity;
  date: string; // local YYYY-MM-DD
  distance: number; // meters: the race's own, else the activity's
  group: DistanceKey;
  time: number | null; // official time, seconds
  /** Rank / finishers for each ranking, when both are known. */
  top: { overall: number | null; gender: number | null; category: number | null };
  /** The best time at its distance so far when it was run: a personal record then. */
  pr: boolean;
};

export function distanceGroup(meters: number): DistanceKey {
  return STANDARD.find((s) => Math.abs(meters - s.meters) <= s.meters * TOLERANCE)?.key ?? "other";
}

export function groupLabel(key: DistanceKey): string {
  return STANDARD.find((s) => s.key === key)?.label ?? "Other distances";
}

function share(rank: number | null, total: number | null): number | null {
  return rank && total ? rank / total : null;
}

/** Races (oldest first, as the API sends them) with distances grouped and records marked. */
export function buildRaces(activities: Activity[]): Race[] {
  const best = new Map<DistanceKey, number>();
  return activities.map((a) => {
    const r = a.race_result!;
    const distance = r.race_distance ?? a.distance;
    const group = distanceGroup(distance);
    const time = r.official_time;
    let pr = false;
    if (time && group !== "other") {
      const previous = best.get(group);
      pr = previous === undefined || time < previous;
      if (pr) best.set(group, time);
    }
    return {
      activity: a,
      date: a.start_time_local.slice(0, 10),
      distance,
      group,
      time,
      top: {
        overall: share(r.overall_rank, r.overall_total),
        gender: share(r.gender_rank, r.gender_total),
        category: share(r.category_rank, r.category_total),
      },
      pr,
    };
  });
}

export type DistanceRecord = {
  key: DistanceKey;
  label: string;
  count: number;
  best: Race | null; // fastest timed race
  /** How much the record improved on the one before it, in seconds; null for a first record. */
  gain: number | null;
};

export function records(races: Race[]): DistanceRecord[] {
  return STANDARD.map(({ key, label }) => {
    const at = races.filter((r) => r.group === key);
    const prs = at.filter((r) => r.pr);
    const best = prs.at(-1) ?? null;
    const before = prs.at(-2);
    return { key, label, count: at.length, best, gain: best && before ? before.time! - best.time! : null };
  });
}

/** "Top 5.5%". */
export function topText(share: number | null): string {
  if (share === null) return "–";
  const pct = share * 100;
  return `Top ${pct < 10 ? pct.toFixed(1).replace(/\.0$/, "") : Math.round(pct)}%`;
}
