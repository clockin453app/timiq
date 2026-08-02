/**
 * Regression: Leaflet maps must not be evaluated during SSR, and dynamic loaders
 * must resolve the real named export via `{ default: Component }` with explicit height.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../src");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const index = read("components/maps/index.ts");
const locLazy = read("components/maps/location-geofence-map-lazy.tsx");
const clockLazy = read("components/maps/clock-sites-map-lazy.tsx");
const locMap = read("components/maps/location-geofence-map.tsx");
const clockMap = read("components/maps/clock-sites-map.tsx");
const locClient = read("app/(app)/locations/locations-client.tsx");
const clockPanel = read("features/time-clock/clock-location-panel.tsx");
const placeholder = read("components/maps/map-loading-placeholder.tsx");

check("barrel does not re-export LocationGeofenceMap (SSR risk)", !/LocationGeofenceMap/.test(index));
check("barrel does not re-export ClockSitesMap (SSR risk)", !/ClockSitesMap/.test(index));
check("barrel exports CLOCK_MAP_FALLBACK_MESSAGE without leaflet", /CLOCK_MAP_FALLBACK_MESSAGE/.test(index) && !/leaflet/.test(index));

check("locations imports lazy map wrapper", /location-geofence-map-lazy/.test(locClient));
check("locations does not import map from barrel", !/from ["']@\/components\/maps["']/.test(locClient));
check("clock panel imports lazy ClockSitesMap", /clock-sites-map-lazy/.test(clockPanel));
check("clock panel imports fallback message without leaflet module", /map-messages/.test(clockPanel));

check("location lazy uses ssr: false", /ssr:\s*false/.test(locLazy));
check("clock lazy uses ssr: false", /ssr:\s*false/.test(clockLazy));
check(
  "location lazy resolves named export via default module shape",
  /default:\s*mod\.LocationGeofenceMap/.test(locLazy),
);
check(
  "clock lazy resolves named export via default module shape",
  /default:\s*mod\.ClockSitesMap/.test(clockLazy),
);
check("location lazy shows loading placeholder", /MapLoadingPlaceholder/.test(locLazy));
check("clock lazy shows loading placeholder", /MapLoadingPlaceholder/.test(clockLazy));

check("location map keeps leaflet import inside client module", /import L from ["']leaflet["']/.test(locMap));
check("location map loads leaflet CSS", /leaflet\/dist\/leaflet\.css/.test(locMap));
check("clock map loads leaflet CSS", /leaflet\/dist\/leaflet\.css/.test(clockMap));
check(
  "location map container has explicit non-zero height",
  /height:\s*["']220px["']/.test(locMap) && /min-h-\[220px\]/.test(locMap),
);
check("placeholder is temporary loading UI", /Loading map/.test(placeholder) && /aria-busy/.test(placeholder));
check("original LocationGeofenceMap export retained", /export function LocationGeofenceMap/.test(locMap));
check("original ClockSitesMap export retained", /export function ClockSitesMap/.test(clockMap));

if (failures.length) {
  console.error("FAILED map SSR/dynamic regression checks:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log(`ok - map SSR/dynamic regression (${passed} checks)`);
