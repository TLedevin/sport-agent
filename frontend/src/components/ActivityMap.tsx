import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Family } from "../api";
import { cssVar, DARK, JAWG_TOKEN, tileLayer } from "./mapTiles";

const HOVER_RADIUS = 28; // px: how close the pointer must be to the route to pick a point

type Props = {
  points: [number, number][];
  family: Family;
  /** Index into points to mark, shared with the graphs on the activity page. */
  highlight?: number | null;
  /** Called with the route point nearest the pointer (null when off the route). */
  onHover?: (index: number | null) => void;
};

export default function ActivityMap({ points, family, highlight = null, onHover }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cursor = useRef<L.CircleMarker | null>(null);
  // Latest callback without rebuilding the map when the parent re-renders.
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

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
    cursor.current = L.circleMarker(points[0], { radius: 7, weight: 3, opacity: 0, fillOpacity: 0 }).addTo(map);

    const pick = (event: L.LeafletMouseEvent) => {
      if (!hoverRef.current) return;
      let best = -1;
      let bestDistance = HOVER_RADIUS;
      points.forEach((p, i) => {
        const d = map.latLngToContainerPoint(p).distanceTo(event.containerPoint);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      hoverRef.current(best >= 0 ? best : null);
    };
    map.on("mousemove", pick);
    map.on("mouseout", () => hoverRef.current?.(null));

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
      cursor.current?.setStyle({ color, fillColor: surface });
    };
    paint();
    media.addEventListener("change", paint);

    return () => {
      media.removeEventListener("change", paint);
      cursor.current = null;
      map.remove();
    };
  }, [points, family]);

  // Move the cursor without rebuilding the map.
  useEffect(() => {
    const marker = cursor.current;
    if (!marker) return;
    const at = highlight !== null ? points[highlight] : undefined;
    if (at) {
      marker.setLatLng(at);
      marker.setStyle({ opacity: 1, fillOpacity: 1 });
      marker.bringToFront();
    } else {
      marker.setStyle({ opacity: 0, fillOpacity: 0 });
    }
  }, [highlight, points]);

  return <div ref={container} className={`activity-map ${JAWG_TOKEN ? "" : "osm"}`} role="img" aria-label="Map of the activity route" />;
}
