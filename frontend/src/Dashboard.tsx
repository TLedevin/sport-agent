import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Activity, type GarminStatus, type PeriodStats, type Stats } from "./api";
import { activityDate, clock, hours, km, meters, paceOrSpeed, sportLabel, timeAgo } from "./format";

const PAGE_SIZE = 50;

type Notice = { kind: "info" | "warning" | "error"; content: ReactNode };

const reconnectNotice: Notice = {
  kind: "warning",
  content: (
    <>
      Garmin isn't connected. On your PC, in <code>backend/</code>, run{" "}
      <code>uv run python scripts/garmin_login.py --api {import.meta.env.VITE_API_URL}</code>
    </>
  ),
};

function errorNotice(err: unknown): Notice {
  if (err instanceof ApiError) {
    if (err.detail === "garmin_not_connected" || err.detail === "garmin_reconnect_needed") return reconnectNotice;
    if (err.status === 429) return { kind: "warning", content: "Garmin is limiting requests. Try again in a few minutes." };
    if (err.status === 0) return { kind: "error", content: "Can't reach the server. Check your connection and try again." };
    return { kind: "error", content: `Something went wrong (${err.detail}).` };
  }
  return { kind: "error", content: "Something went wrong." };
}

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const autoSynced = useRef(false);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) onLogout();
      else setNotice(errorNotice(err));
    },
    [onLogout],
  );

  const load = useCallback(async () => {
    const [s, a, st] = await Promise.all([api.stats(), api.activities(PAGE_SIZE, 0), api.garminStatus()]);
    setStats(s);
    setActivities(a);
    setHasMore(a.length === PAGE_SIZE);
    setStatus(st);
    return st;
  }, []);

  const sync = useCallback(
    async (automatic: boolean) => {
      setSyncing(true);
      try {
        const { imported } = await api.sync();
        if (imported > 0) {
          setNotice({ kind: "info", content: `Imported ${imported} new ${imported === 1 ? "activity" : "activities"}.` });
        } else if (!automatic) {
          setNotice({ kind: "info", content: "Already up to date." });
        }
        await load();
      } catch (err) {
        if (!(err instanceof ApiError && err.detail === "sync_in_progress")) handleError(err);
      } finally {
        setSyncing(false);
      }
    },
    [load, handleError],
  );

  // Initial load; the first request may wait for the database to wake up.
  // Then pull new activities from Garmin once per visit.
  useEffect(() => {
    const slowTimer = setTimeout(() => setSlow(true), 3000);
    load()
      .then((st) => {
        if (!st.connected) setNotice(reconnectNotice);
        else if (!autoSynced.current) {
          autoSynced.current = true;
          sync(true);
        }
      })
      .catch(handleError)
      .finally(() => {
        clearTimeout(slowTimer);
        setLoading(false);
        setSlow(false);
      });
    return () => clearTimeout(slowTimer);
  }, [load, sync, handleError]);

  async function loadMore() {
    try {
      const more = await api.activities(PAGE_SIZE, activities.length);
      setActivities((current) => [...current, ...more]);
      setHasMore(more.length === PAGE_SIZE);
    } catch (err) {
      handleError(err);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1>Sport Agent</h1>
        <div className="actions">
          <span className="muted">Synced {timeAgo(status?.last_sync_at ?? null)}</span>
          <button className="primary" onClick={() => sync(false)} disabled={syncing || loading}>
            {syncing ? "Refreshing…" : "Refresh"}
          </button>
          <button className="ghost" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          <div>{notice.content}</div>
          <button className="ghost small" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {loading ? (
        <p className="loading" role="status">
          {slow ? "Waking up the database… this can take up to a minute." : "Loading…"}
        </p>
      ) : (
        <>
          {stats && (
            <section className="kpis" aria-label="Totals">
              <StatTile label="Last 7 days" stats={stats.week} />
              <StatTile label="This month" stats={stats.month} />
              <StatTile label="This year" stats={stats.year} />
            </section>
          )}

          <section className="card">
            <h2>Activities</h2>
            {activities.length === 0 ? (
              <p className="muted">
                {syncing ? "Importing your Garmin history…" : "No activities yet. Click Refresh to import them from Garmin."}
              </p>
            ) : (
              <ActivityTable activities={activities} />
            )}
            {hasMore && (
              <button className="ghost load-more" onClick={loadMore}>
                Load more
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({ label, stats }: { label: string; stats: PeriodStats }) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{km(stats.distance)}</div>
      <div className="tile-sub">
        {stats.count} {stats.count === 1 ? "activity" : "activities"} · {hours(stats.duration)} ·{" "}
        {meters(stats.elevation_gain)} elevation
      </div>
    </div>
  );
}

function ActivityTable({ activities }: { activities: Activity[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Activity</th>
            <th className="num">Distance</th>
            <th className="num">Time</th>
            <th className="num">Pace / speed</th>
            <th className="num">Avg HR</th>
            <th className="num">Elevation</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => (
            <tr key={a.id}>
              <td className="nowrap">{activityDate(a.start_time_local)}</td>
              <td className="activity-cell">
                <div className="activity-name">{a.name || sportLabel(a.sport_type)}</div>
                <div className="muted small">{sportLabel(a.sport_type)}</div>
              </td>
              <td className="num">{a.distance > 0 ? km(a.distance) : "–"}</td>
              <td className="num">{clock(a.duration)}</td>
              <td className="num">{a.distance > 0 ? paceOrSpeed(a.sport_type, a.average_speed) : "–"}</td>
              <td className="num">{a.average_hr ? Math.round(a.average_hr) : "–"}</td>
              <td className="num">{a.elevation_gain != null ? meters(a.elevation_gain) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
