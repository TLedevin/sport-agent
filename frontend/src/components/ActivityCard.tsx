import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Activity } from "../api";
import { activityDate, calories, clock, km, meters, paceOrSpeed, paceOrSpeedLabel, sportLabel } from "../format";
import { SportBadge } from "../sports";
import ActivityMap from "./ActivityMap";

type MapState = { status: "loading" } | { status: "ready"; points: [number, number][] } | { status: "error" };

function stats(a: Activity): { label: string; value: string }[] {
  const hasDistance = a.distance > 0;
  const all = [
    { label: "Distance", value: hasDistance ? km(a.distance) : null },
    { label: a.moving_duration ? "Moving time" : "Time", value: clock(a.moving_duration || a.duration) },
    {
      label: paceOrSpeedLabel(a.sport_type),
      value: hasDistance && a.average_speed ? paceOrSpeed(a.sport_type, a.average_speed) : null,
    },
    { label: "Elevation gain", value: a.elevation_gain ? meters(a.elevation_gain) : null },
    { label: "Avg heart rate", value: a.average_hr ? `${Math.round(a.average_hr)} bpm` : null },
    { label: "Max heart rate", value: a.max_hr ? `${Math.round(a.max_hr)} bpm` : null },
    { label: "Calories", value: a.calories ? calories(a.calories) : null },
  ];
  return all.filter((s): s is { label: string; value: string } => s.value !== null);
}

/** One activity: its key numbers and, when Garmin recorded GPS, the route on a map. */
export default function ActivityCard({ activity, title }: { activity: Activity; title?: string }) {
  const [map, setMap] = useState<MapState>({ status: "loading" });

  useEffect(() => {
    if (!activity.has_track) return;
    let cancelled = false;
    setMap({ status: "loading" });
    api
      .track(activity.id)
      .then(({ points }) => !cancelled && setMap({ status: "ready", points }))
      .catch(() => !cancelled && setMap({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [activity.id, activity.has_track]);

  const showMap = activity.has_track && !(map.status === "ready" && map.points.length === 0);

  return (
    <section className={`card activity-card ${showMap ? "with-map" : ""}`} aria-label={title ?? activity.name}>
      <div className="activity-card-body">
        {title && <p className="activity-card-eyebrow">{title}</p>}
        <div className="activity-card-head">
          <SportBadge family={activity.sport_family} size={40} />
          <div className="activity-card-title">
            <h2>{activity.name || sportLabel(activity.sport_type)}</h2>
            <p className="card-sub">
              {sportLabel(activity.sport_type)} · {activityDate(activity.start_time_local)}
              {activity.location_name && (
                <span className="activity-card-place">
                  <MapPin size={13} aria-hidden /> {activity.location_name}
                </span>
              )}
            </p>
          </div>
        </div>
        <dl className="activity-stats">
          {stats(activity).map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {showMap && (
        <div className="activity-card-map">
          {map.status === "ready" ? (
            <ActivityMap points={map.points} family={activity.sport_family} />
          ) : (
            <div className="activity-map placeholder" role="status">
              {map.status === "loading" ? <div className="loader" aria-hidden /> : <p>Map unavailable right now.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
