import { useEffect, useState } from "react";
import { api, ApiError, type Activity } from "../api";
import { activityDate, clock, km, meters, paceOrSpeed, sportLabel } from "../format";
import { SportBadge } from "../sports";
import { errorNotice, useSync } from "../sync";

const PAGE_SIZE = 50;

export default function ActivitiesPage() {
  const { version, setNotice } = useSync();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .activities(PAGE_SIZE, 0)
      .then((rows) => {
        if (cancelled) return;
        setActivities(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((err) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version, setNotice]);

  async function loadMore() {
    try {
      const more = await api.activities(PAGE_SIZE, activities?.length ?? 0);
      setActivities((current) => [...(current ?? []), ...more]);
      setHasMore(more.length === PAGE_SIZE);
    } catch (err) {
      setNotice(errorNotice(err));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Activities</h1>
        <p className="page-sub">Everything imported from Garmin Connect, newest first</p>
      </div>
      <section className="card">
        {activities === null ? (
          <div className="page-loading" role="status">
            <div className="loader" aria-hidden />
          </div>
        ) : activities.length === 0 ? (
          <p className="empty-text">No activities yet. Click Refresh to import them from Garmin.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Date</th>
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
                    <td>
                      <div className="activity-cell">
                        <SportBadge family={a.sport_family} size={30} />
                        <div>
                          <div className="activity-name">{a.name || sportLabel(a.sport_type)}</div>
                          <div className="activity-sport">{sportLabel(a.sport_type)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="nowrap muted">{activityDate(a.start_time_local)}</td>
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
        )}
        {hasMore && (
          <button className="button ghost load-more" onClick={loadMore}>
            Load more
          </button>
        )}
      </section>
    </div>
  );
}
