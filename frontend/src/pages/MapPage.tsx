import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError, type Family, type MapActivity } from "../api";
import { cssVar, DARK, JAWG_TOKEN, tileLayer } from "../components/mapTiles";
import SportFilter from "../components/SportFilter";
import { activityDate, clock, km, sportLabel } from "../format";
import { decodePolyline } from "../polyline";
import { FAMILIES, SportBadge } from "../sports";
import { errorNotice, useSync } from "../sync";

const ROWS_STEP = 50;
const LINE = { weight: 3, opacity: 0.6 };
const LINE_HIGHLIGHT = { weight: 5, opacity: 1 };
const DOT = { radius: 4, weight: 1.5, opacity: 0.9, fillOpacity: 0.7 };
const DOT_HIGHLIGHT = { radius: 7, weight: 2, opacity: 1, fillOpacity: 1 };

/** An activity with its decoded route (or its start point alone) and the area it covers. */
type Placed = MapActivity & { points: [number, number][]; bounds: L.LatLngBounds };

function place(activity: MapActivity): Placed | null {
  const points = activity.route ? decodePolyline(activity.route) : activity.start ? [activity.start] : [];
  return points.length ? { ...activity, points, bounds: L.latLngBounds(points) } : null;
}

/** "45.18,5.72,11" in the address, so coming back from an activity restores the view. */
function parseView(value: string | null): { center: [number, number]; zoom: number } | null {
  const [lat, lon, zoom] = (value ?? "").split(",").map(Number);
  return [lat, lon, zoom].every(Number.isFinite) ? { center: [lat, lon], zoom } : null;
}

export default function MapPage() {
  const { version, setNotice } = useSync();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const sportParam = params.get("sport") as Family | null;
  const sport = sportParam && FAMILIES.includes(sportParam) ? sportParam : null;

  const [items, setItems] = useState<Placed[] | null>(null);
  const [viewBounds, setViewBounds] = useState<L.LatLngBounds | null>(null);
  const [rows, setRows] = useState(ROWS_STEP);
  const [hovered, setHovered] = useState<number | null>(null);

  const container = useRef<HTMLDivElement>(null);
  const layers = useRef(new Map<number, L.Path>());
  const mapRef = useRef<L.Map | null>(null);
  // Leaflet handlers are bound once: reach the latest values through refs.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const initialView = useRef(parseView(params.get("at")));

  function update(changes: Record<string, string | null>) {
    // From the address as it is now, like the Activities page: map moves come in quick bursts.
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    api
      .map()
      .then((data) => {
        if (!cancelled) setItems(data.map(place).filter((a): a is Placed => a !== null));
      })
      .catch((err) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version, setNotice]);

  // Build the map once the activities are known (and again after a sync brings new ones).
  useEffect(() => {
    const element = container.current;
    if (!element || !items?.length) return;

    const map = L.map(element, { attributionControl: false, zoomSnap: 0.25, wheelPxPerZoomLevel: 120 });
    mapRef.current = map;
    L.control.attribution({ prefix: false }).addTo(map);
    const media = window.matchMedia(DARK);
    let tiles = tileLayer(media.matches).addTo(map);
    // One canvas for every route: thousands of SVG paths would make panning sluggish.
    const renderer = L.canvas({ tolerance: 6 });

    for (const a of items) {
      const layer =
        a.points.length > 1
          ? L.polyline(a.points, { renderer, ...LINE, lineJoin: "round" })
          : L.circleMarker(a.points[0], { renderer, ...DOT });
      layer.bindTooltip(a.name || sportLabel(a.sport_type), { sticky: true });
      layer.on("click", () => navigateRef.current(`/activities/${a.id}`));
      layer.on("mouseover", () => setHovered(a.id));
      layer.on("mouseout", () => setHovered((h) => (h === a.id ? null : h)));
      layers.current.set(a.id, layer);
    }

    const view = initialView.current;
    if (view) map.setView(view.center, view.zoom);
    else map.fitBounds(L.latLngBounds(items.flatMap((a) => a.points)), { padding: [24, 24] });
    initialView.current = null; // a rebuild after a sync keeps the view the user has now

    const moved = () => {
      setViewBounds(map.getBounds());
      const center = map.getCenter();
      update({ at: `${center.lat.toFixed(5)},${center.lng.toFixed(5)},${map.getZoom()}` });
    };
    map.on("moveend", moved);
    moved();

    const paint = () => {
      if (JAWG_TOKEN) {
        tiles.remove();
        tiles = tileLayer(media.matches).addTo(map);
      }
      const surface = cssVar(element, "--surface");
      const colors = Object.fromEntries(FAMILIES.map((f) => [f, cssVar(element, `--sport-${f}`)]));
      for (const a of items) {
        const color = colors[a.sport_family];
        layers.current.get(a.id)?.setStyle(a.points.length > 1 ? { color } : { color: surface, fillColor: color });
      }
    };
    paint();
    media.addEventListener("change", paint);

    return () => {
      media.removeEventListener("change", paint);
      layers.current.clear();
      mapRef.current = null;
      map.remove();
    };
  }, [items]);

  // Show only the chosen sport on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !items) return;
    for (const a of items) {
      const layer = layers.current.get(a.id);
      if (!layer) continue;
      if (!sport || a.sport_family === sport) layer.addTo(map);
      else layer.remove();
    }
  }, [items, sport]);

  // Emphasize the activity under the pointer, in the table or on the map.
  useEffect(() => {
    if (hovered === null) return;
    const layer = layers.current.get(hovered);
    if (!layer) return;
    const isDot = layer instanceof L.CircleMarker;
    layer.setStyle(isDot ? DOT_HIGHLIGHT : LINE_HIGHLIGHT);
    layer.bringToFront();
    return () => {
      layer.setStyle(isDot ? DOT : LINE);
    };
  }, [hovered, items]);

  const families = useMemo(() => FAMILIES.filter((f) => items?.some((a) => a.sport_family === f)), [items]);
  const visible = useMemo(
    () =>
      items && viewBounds
        ? items.filter((a) => (!sport || a.sport_family === sport) && viewBounds.intersects(a.bounds))
        : [],
    [items, viewBounds, sport],
  );
  const visibleDistance = visible.reduce((sum, a) => sum + a.distance, 0);
  const pending = items?.filter((a) => !a.route).length ?? 0;

  // A new area or sport starts again from the top of the list.
  useEffect(() => setRows(ROWS_STEP), [viewBounds, sport]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Map</h1>
        <p className="page-sub">Everywhere you've trained. Move the map to list the activities in view.</p>
      </div>

      {items === null ? (
        <div className="page-loading" role="status">
          <div className="loader" aria-hidden />
        </div>
      ) : items.length === 0 ? (
        <section className="card">
          <p className="empty-text">No activities with a location yet. Click Refresh to import them from Garmin.</p>
        </section>
      ) : (
        <div className="map-layout">
          <section className="card map-card">
            {families.length > 1 && (
              <SportFilter families={families} selected={sport} onSelect={(f) => update({ sport: f })} />
            )}
            <div
              ref={container}
              className={`activity-map all-activities-map ${JAWG_TOKEN ? "" : "osm"}`}
              role="img"
              aria-label="Map of all activity routes"
            />
            {pending > 0 && (
              <p className="map-note muted">
                Dots are activities whose route isn't loaded yet ({pending.toLocaleString("en")}). Routes fill in
                after each sync, or when you open an activity.
              </p>
            )}
          </section>

          <section className="card map-list" aria-label="Activities in view">
            <div className="map-list-head">
              <strong role="status">
                {visible.length.toLocaleString("en")} {visible.length === 1 ? "activity" : "activities"} in view
              </strong>
              {visibleDistance > 0 && <span className="muted">{km(visibleDistance)}</span>}
            </div>
            {visible.length === 0 ? (
              <p className="empty-text">No activities here. Zoom out or move the map.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th className="num">Distance</th>
                      <th className="num">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.slice(0, rows).map((a) => (
                      <tr
                        key={a.id}
                        className={`row-link ${hovered === a.id ? "hovered" : ""}`}
                        onClick={() => navigate(`/activities/${a.id}`)}
                        onMouseEnter={() => setHovered(a.id)}
                        onMouseLeave={() => setHovered((h) => (h === a.id ? null : h))}
                      >
                        <td>
                          <div className="activity-cell">
                            <SportBadge family={a.sport_family} size={28} />
                            <div>
                              <Link
                                to={`/activities/${a.id}`}
                                className="activity-name"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {a.name || sportLabel(a.sport_type)}
                              </Link>
                              <div className="activity-sport">{activityDate(a.start_time_local)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num">{a.distance > 0 ? km(a.distance) : "–"}</td>
                        <td className="num">{clock(a.duration)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {visible.length > rows && (
              <button className="button ghost load-more" onClick={() => setRows((n) => n + ROWS_STEP)}>
                Show more
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
