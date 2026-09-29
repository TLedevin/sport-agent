import { ArrowDown, ArrowUp, ArrowUpDown, Trophy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError, photoSrc, type Activity, type ActivityQuery, type Family, type SortField } from "../api";
import SportFilter from "../components/SportFilter";
import { activityDate, clock, km, meters, paceOrSpeed, sportLabel } from "../format";
import { FAMILIES, SportBadge } from "../sports";
import { errorNotice, useSync } from "../sync";

const PAGE_SIZE = 50;
const TYPING_DELAY = 400; // ms before a typed distance refetches

const COLUMNS: { field: SortField; label: string; numeric?: boolean }[] = [
  { field: "name", label: "Activity" },
  { field: "date", label: "Date" },
  { field: "distance", label: "Distance", numeric: true },
  { field: "duration", label: "Time", numeric: true },
  { field: "speed", label: "Pace / speed", numeric: true },
  { field: "hr", label: "Avg HR", numeric: true },
  { field: "elevation", label: "Elevation", numeric: true },
];

const SORT_FIELDS = COLUMNS.map((c) => c.field);

/** Filters and sort live in the address, so going back from an activity keeps them. */
function queryFrom(params: URLSearchParams): ActivityQuery {
  const kmParam = (name: string) => {
    const value = Number(params.get(name));
    return params.get(name) && Number.isFinite(value) && value >= 0 ? value * 1000 : undefined;
  };
  const sort = params.get("sort") as SortField | null;
  const sport = params.get("sport") as Family | null;
  return {
    sport: sport && FAMILIES.includes(sport) ? sport : undefined,
    date_from: params.get("from") || undefined,
    date_to: params.get("to") || undefined,
    min_distance: kmParam("min"),
    max_distance: kmParam("max"),
    sort: sort && SORT_FIELDS.includes(sort) ? sort : "date",
    order: params.get("order") === "asc" ? "asc" : "desc",
  };
}

export default function ActivitiesPage() {
  const { version, setNotice } = useSync();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = queryFrom(params);
  const queryKey = JSON.stringify(query);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [total, setTotal] = useState(0);
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  // Distances are typed: keep the text locally and push it to the address after a pause.
  const [minKm, setMinKm] = useState(params.get("min") ?? "");
  const [maxKm, setMaxKm] = useState(params.get("max") ?? "");

  function update(changes: Record<string, string | null>) {
    // Start from the address as it is now: React Router's functional form hands every call the
    // params of the last render, so two quick updates (e.g. both dates) would drop the first.
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  useEffect(() => {
    const timer = setTimeout(() => update({ min: minKm.trim() || null, max: maxKm.trim() || null }), TYPING_DELAY);
    return () => clearTimeout(timer);
  }, [minKm, maxKm]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .activities(PAGE_SIZE, 0, JSON.parse(queryKey) as ActivityQuery)
      .then(({ items, total, families }) => {
        if (cancelled) return;
        setActivities(items);
        setTotal(total);
        setFamilies(families);
      })
      .catch((err) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [version, queryKey, setNotice]);

  async function loadMore() {
    try {
      const { items } = await api.activities(PAGE_SIZE, activities?.length ?? 0, query);
      setActivities((current) => [...(current ?? []), ...items]);
    } catch (err) {
      setNotice(errorNotice(err));
    }
  }

  function sortBy(field: SortField) {
    // A new column starts with its most useful direction: A→Z for names, biggest/latest first otherwise.
    const order = field === query.sort ? (query.order === "desc" ? "asc" : "desc") : field === "name" ? "asc" : "desc";
    update({ sort: field === "date" && order === "desc" ? null : field, order: order === "desc" ? null : order });
  }

  const filtered = Boolean(query.sport || query.date_from || query.date_to || query.min_distance !== undefined || query.max_distance !== undefined);

  function clearFilters() {
    setMinKm("");
    setMaxKm("");
    update({ sport: null, from: null, to: null, min: null, max: null });
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Activities</h1>
        <p className="page-sub">Everything imported from Garmin Connect</p>
      </div>

      <section className="card filters" aria-label="Filters">
        {families.length > 1 && (
          <div className="filter-group">
            <span className="filter-title">Sport</span>
            <SportFilter families={families} selected={query.sport ?? null} onSelect={(f) => update({ sport: f })} />
          </div>
        )}
        <div className="filter-group">
          <span className="filter-title">Date</span>
          <label>
            <span>From</span>
            <input type="date" value={params.get("from") ?? ""} max={params.get("to") ?? undefined}
              onChange={(e) => update({ from: e.target.value || null })} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={params.get("to") ?? ""} min={params.get("from") ?? undefined}
              onChange={(e) => update({ to: e.target.value || null })} />
          </label>
        </div>
        <div className="filter-group">
          <span className="filter-title">Distance (km)</span>
          <label>
            <span>Min</span>
            <input type="number" inputMode="decimal" min={0} step="any" placeholder="0" value={minKm}
              onChange={(e) => setMinKm(e.target.value)} />
          </label>
          <label>
            <span>Max</span>
            <input type="number" inputMode="decimal" min={0} step="any" placeholder="Any" value={maxKm}
              onChange={(e) => setMaxKm(e.target.value)} />
          </label>
        </div>
        <div className="filter-summary">
          <span className="muted" role="status">
            {activities === null ? "" : `${total.toLocaleString("en")} ${total === 1 ? "activity" : "activities"}`}
          </span>
          {filtered && (
            <button className="button ghost small" onClick={clearFilters}>
              <X size={14} aria-hidden /> Clear filters
            </button>
          )}
        </div>
      </section>

      <section className={`card ${loading && activities ? "refetching-card" : ""}`}>
        {activities === null ? (
          <div className="page-loading" role="status">
            <div className="loader" aria-hidden />
          </div>
        ) : activities.length === 0 ? (
          <p className="empty-text">
            {filtered ? "No activities match these filters." : "No activities yet. Click Refresh to import them from Garmin."}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const active = query.sort === c.field;
                    const Arrow = !active ? ArrowUpDown : query.order === "asc" ? ArrowUp : ArrowDown;
                    return (
                      <th key={c.field} className={c.numeric ? "num" : undefined}
                        aria-sort={active ? (query.order === "asc" ? "ascending" : "descending") : "none"}>
                        <button type="button" className={`sort-button ${active ? "active" : ""}`} onClick={() => sortBy(c.field)}>
                          {c.label}
                          <Arrow size={13} aria-hidden />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id} className="row-link" onClick={() => navigate(`/activities/${a.id}`)}>
                    <td>
                      <div className="activity-cell">
                        <SportBadge family={a.sport_family} size={30} />
                        <div>
                          <Link to={`/activities/${a.id}`} className="activity-name" onClick={(e) => e.stopPropagation()}>
                            {a.name || sportLabel(a.sport_type)}
                          </Link>
                          <div className="activity-sport">
                            {sportLabel(a.sport_type)}
                            {a.race_result ? (
                              <span className="race-chip" title="Race result">
                                <Trophy size={12} aria-hidden />
                                {[
                                  a.race_result.official_time && clock(a.race_result.official_time),
                                  a.race_result.overall_rank && `#${a.race_result.overall_rank}`,
                                ].filter(Boolean).join(" · ") || "Race"}
                              </span>
                            ) : a.is_race ? (
                              <span className="race-chip muted-chip"><Trophy size={12} aria-hidden /> Race</span>
                            ) : null}
                          </div>
                        </div>
                        {a.photos.length > 0 && (
                          <span className="row-photo" title={`${a.photos.length} ${a.photos.length === 1 ? "photo" : "photos"}`}>
                            <img src={photoSrc(a.photos[0].thumb_url)} alt="" loading="lazy" />
                            {a.photos.length > 1 && <span>+{a.photos.length - 1}</span>}
                          </span>
                        )}
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
        {activities !== null && activities.length < total && (
          <button className="button ghost load-more" onClick={loadMore}>
            Load more
          </button>
        )}
      </section>
    </div>
  );
}
