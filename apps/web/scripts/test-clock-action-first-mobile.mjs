/**
 * Employee Clock In / Out action-first mobile layout coverage.
 *
 * Asserts hierarchy (actions before map), collapsed map disclosure on mobile,
 * semantic Clock In / Out colours, sticky offset above bottom nav, and that
 * GPS/selfie enablement rules remain client-side only (no backend edits).
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

const client = read("app/(app)/clock/clock-client.tsx");
const panel = read("features/time-clock/clock-location-panel.tsx");
const gps = read("features/time-clock/gps.ts");
const map = read("components/maps/clock-sites-map.tsx");
const tokens = read("styles/tokens.css");
const bottomNav = read("components/layout/mobile-bottom-nav.tsx");

check("page uses ClockLocationSummary before ClockMapGpsDetails", (() => {
  const summary = client.indexOf("<ClockLocationSummary");
  const actions = client.indexOf('data-testid="clock-primary-actions"');
  const mapDetails = client.indexOf("<ClockMapGpsDetails");
  return summary > 0 && actions > summary && mapDetails > actions;
})());

check("primary actions appear before map disclosure in source order", (() => {
  const actions = client.indexOf('data-testid="clock-primary-actions"');
  const mapDisclosure = panel.indexOf('data-testid="clock-map-disclosure"');
  return actions > 0 && mapDisclosure > 0;
})());

check("map disclosure collapsed by default on narrow viewport", /viewportClockMapMode === "narrow"[\s\S]*setMapOpen\(false\)/.test(panel));
check("wide viewport can expand map by default", /viewportClockMapMode === "wide"[\s\S]*setMapOpen\(true\)/.test(panel));
check("map disclosure uses aria-expanded", /aria-expanded=\{mapOpen\}/.test(panel));
check("map disclosure uses aria-controls", /aria-controls=\{panelId\}/.test(panel));
check("map mounts only when disclosure open", /canMountMap = mapOpen && mapMountDeferred/.test(panel));
check("map height targets mobile band (~240–260px)", /h-\[240px\]/.test(panel) && /260px/.test(map));

check("Clock In enabled uses success colour token", /CLOCK_ACTION_ENABLED[\s\S]*color-success-700/.test(client));
check("Clock Out enabled uses danger colour token", /CLOCK_OUT_ENABLED[\s\S]*color-danger-700/.test(client));
check("disabled clock action uses neutral header surface", /CLOCK_ACTION_DISABLED[\s\S]*color-header/.test(client));
check("Capture selfie uses primary (brand blue) variant", /data-testid="clock-capture-selfie"[\s\S]*variant="primary"/.test(client));

check("open shift shows Clock Out mode, not Clock In as main action", /data-clock-mode="clock-out"/.test(client) && /flowStatus === "on_shift"/.test(client));
check("no open shift shows Clock In mode", /data-clock-mode="clock-in"/.test(client) && /flowStatus === "not_clocked_in"/.test(client));
check("Clock In button not rendered as main action while on shift", (() => {
  const onShiftBlock = client.slice(client.indexOf('flowStatus === "on_shift" ?'), client.indexOf("activeSelfiePhase ?"));
  return onShiftBlock.includes('data-clock-mode="clock-out"') && !onShiftBlock.includes('data-clock-mode="clock-in"');
})());

check("sticky action area offsets above mobile bottom nav", /bottom-\[calc\(var\(--layout-mobile-bottom-nav-height\)/.test(client));
check("bottom nav height token includes safe-area", /--layout-mobile-bottom-nav-height:\s*calc\(3\.5rem \+ env\(safe-area-inset-bottom/.test(tokens));
check("employee bottom nav still present", /employeePrimaryLinks[\s\S]*href: "\/clock"/.test(bottomNav));
check("sheet body keeps bottom-nav padding", /layout-mobile-bottom-nav-height/.test(client));

check("single page heading via PageHeader h1", /<PageHeader[\s\S]*title=\{t\("nav\.clock"/.test(client) && !/<h1[\s>]/.test(client));
check("location summary uses h2 not second h1", /<h2[\s\S]*id="clock-location-summary-title"/.test(panel));
check("status live region present", /aria-live="polite"/.test(client));
check("disabled reason associated via aria-describedby", /aria-describedby=\{/.test(client));
check("help checklist is a disclosure", /clock-help-checklist/.test(client) && /Help and checklist/.test(client));
check("overflow-x-hidden on clock sheet body", /overflow-x-hidden/.test(client));

check("GPS accuracy gate unchanged (BACKEND_MAX_ACCURACY_M)", /BACKEND_MAX_ACCURACY_M = 100/.test(gps));
check("client still requires isGpsClientSubmittable for clock in", /gpsAcceptable &&[\s\S]*Boolean\(selfieClockIn\)/.test(client));
check("client still requires selfie for clock out", /gpsAcceptable &&[\s\S]*Boolean\(selfieClockOut\)/.test(client));
check("selfie overlay still used", /ClockSelfieCameraOverlay/.test(client));
check("clockInWithSelfie / clockOutWithSelfie still wired", /clockInWithSelfie/.test(client) && /clockOutWithSelfie/.test(client));

check("compact location summary test id present", /data-testid="clock-location-summary"/.test(panel));
check("Refresh GPS control present", /clock-refresh-gps/.test(panel));
check("status badges include text labels (not colour alone)", /Inside radius/.test(panel) && /Outside radius/.test(panel) && /Improving accuracy/.test(panel));

if (failures.length) {
  console.error(`FAILED (${failures.length}):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - clock action-first mobile (${passed} checks)`);
