import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Family } from "../api";

// Jawg tiles (Streets, or Dark in dark mode). The token is public by design: it ships in
// every tile request, so it's restricted to the app's domains in the Jawg dashboard.
const JAWG_TOKEN = import.meta.env.VITE_JAWG_TOKEN as string | undefined;
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DARK = "(prefers-color-scheme: dark)";

function tileLayer(dark: boolean): L.TileLayer {
  if (!JAWG_TOKEN) {
    // No token (fresh checkout): plain OpenStreetMap, dimmed in dark mode by .activity-map.osm.
    return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: OSM, maxZoom: 19 });
  }
  const style = dark ? "jawg-dark" : "jawg-streets";
  return L.tileLayer(`https://tile.jawg.io/${style}/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`, {
    attribution: `<a href="https://jawg.io">&copy; Jawg</a> ${OSM}`,
    maxZoom: 22,
  });
}

/** Leaflet sets SVG attributes, which can't use var(): resolve the theme color first. */
function cssVar(element: HTMLElement, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

export default function ActivityMap({ points, family }: { points: [number, number][]; family: Family }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element || points.length === 0) return;

    const map = L.map(element, { attributionControl: false, zoomSnap: 0.25, wheelPxPerZoomLevel: 120 });
    L.control.attribution({ prefix: false }).addTo(map);
    const media = window.matchMedia(DARK);
    let tiles = tileLayer(media.matches).addTo(map);

    const line = L.polyline(points, { weight: 4, opacity: 0.95, lineJoin: "round" }).addTo(map);
    const dot = (at: [number, number]) =>
      L.circleMarker(at, { radius: 5, weight: 2, fillOpacity: 1 }).addTo(map);
    const start = dot(points[0]);
    const finish = dot(points[points.length - 1]);
    map.fitBounds(line.getBounds(), { padding: [24, 24] });

    // Restyle when the theme flips, so the map matches the rest of the page.
    const paint = () => {
      if (JAWG_TOKEN) {
        tiles.remove();
        tiles = tileLayer(media.matches).addTo(map);
      }
      const color = cssVar(element, `--sport-${family}`);
      const surface = cssVar(element, "--surface");
      line.setStyle({ color });
      start.setStyle({ color: surface, fillColor: color });
      finish.setStyle({ color, fillColor: surface });
    };
    paint();
    media.addEventListener("change", paint);

    return () => {
      media.removeEventListener("change", paint);
      map.remove();
    };
  }, [points, family]);

  return <div ref={container} className={`activity-map ${JAWG_TOKEN ? "" : "osm"}`} role="img" aria-label="Map of the activity route" />;
}
