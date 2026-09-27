import L from "leaflet";

// Jawg tiles (Streets, or Dark in dark mode). The token is public by design: it ships in
// every tile request, so it's restricted to the app's domains in the Jawg dashboard.
export const JAWG_TOKEN = import.meta.env.VITE_JAWG_TOKEN as string | undefined;
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const DARK = "(prefers-color-scheme: dark)";

export function tileLayer(dark: boolean): L.TileLayer {
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
export function cssVar(element: HTMLElement, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}
