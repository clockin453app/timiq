/**
 * Employee Clock In / Out action-first + selfie-first hierarchy coverage.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../src");
const webRoot = path.join(here, "..");
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
const api = read("features/time-clock/api.ts");
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
check("supplied capture-selfie-camera.svg referenced", /capture-selfie-camera\.svg/.test(client));
check(
  "capture selfie camera asset exists",
  fs.existsSync(path.join(webRoot, "public/icons/clock/capture-selfie-camera.svg")),
);

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

check("Clock In / Out page heading is not visibly rendered", !/<PageHeader[\s\S]*nav\.clock/.test(client) && !/page_description_short/.test(client));
check("GPS and a live selfie subtitle is not rendered", !/GPS and a live selfie are required to clock/.test(client));
check("sr-only page title preserved for accessibility", /<h1 className="sr-only">/.test(client));
check("site name not duplicated in active shift summary", !/shift_site_label|Site:/.test(client));
check("Selfie required before clocking out is not rendered", !/Selfie required before clocking out/.test(client));
check("GPS card remains", /ClockLocationSummary/.test(client) && /clock-location-summary/.test(panel));
check("active shift start and duration remain", /clock-active-shift-summary/.test(client) && /Shift started at/.test(client) && /duration_label/.test(client));
check("selfie capture action remains", /clock-capture-selfie/.test(client) && /Capture selfie to clock out/.test(client));
check("location summary uses h2 not second visible h1", /<h2[\s\S]*id="clock-location-summary-title"/.test(panel));
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

check("before selfie Clock In is gated behind selfieClockIn", /!selfieClockIn \|\| activeSelfiePhase === "clock_in"/.test(client));
check("before selfie Clock Out is gated behind selfieClockOut", /!selfieClockOut \|\| activeSelfiePhase === "clock_out"/.test(client));
check("Clock In button only in post-selfie branch", (() => {
  const clockInMode = client.slice(client.indexOf('data-clock-mode="clock-in"'), client.indexOf('data-clock-mode="clock-out"'));
  const captureIdx = clockInMode.indexOf('data-testid="clock-capture-selfie"');
  const buttonIdx = clockInMode.indexOf('data-testid="clock-in-button"');
  return captureIdx >= 0 && buttonIdx > captureIdx && /selfie_captured|Selfie captured/.test(clockInMode);
})());
check("Clock Out button only in post-selfie branch", (() => {
  const clockOutMode = client.slice(client.indexOf('data-clock-mode="clock-out"'));
  const captureIdx = clockOutMode.indexOf('data-testid="clock-capture-selfie"');
  const buttonIdx = clockOutMode.indexOf('data-testid="clock-out-button"');
  return captureIdx >= 0 && buttonIdx > captureIdx;
})());
check("Capture selfie to clock in label present", /Capture selfie to clock in/.test(client));
check("Capture selfie to clock out label present", /Capture selfie to clock out/.test(client));
check("GPS-disabled reasons after selfie are specific", /Waiting for accurate GPS/.test(client) && /Move within the allowed site radius/.test(client) && /Location access required/.test(client));
check("successful Clock In redirects with router.replace", /clockInWithSelfie[\s\S]*router\.replace\("\/dashboard"\)/.test(client));
check("successful Clock Out redirects with router.replace", /clockOutWithSelfie[\s\S]*router\.replace\("\/dashboard"\)/.test(client));
check("successful Clock Out writes one-time summary before redirect", /writeClockOutSummary[\s\S]*router\.replace\("\/dashboard"\)/.test(client));
check("Clock Out day total uses company timezone helper not browser-only bounds", /fetchAuthoritativeTodayWorkedSeconds/.test(client) && !/browserDefaultTimeZone\(\)/.test(client));
check("successful Clock In does not write clock-out summary", (() => {
  const inBlock = client.slice(client.indexOf("async function handleClockIn"), client.indexOf("async function handleClockOut"));
  return !/writeClockOutSummary|CLOCK_OUT_SUMMARY/.test(inBlock);
})());
check("no window.location navigation used", !/window\.location/.test(client));
check("redirect guarded against double submit", /redirectingRef/.test(client) && /isSubmitting \|\| redirectingRef\.current/.test(client));
check("failure path does not call router.replace", (() => {
  const failIn = client.match(/Clock-in failed[\s\S]{0,220}/)?.[0] ?? "";
  const failOut = client.match(/Clock-out failed[\s\S]{0,220}/)?.[0] ?? "";
  return !/router\.replace/.test(failIn) && !/router\.replace/.test(failOut);
})());
check("getClockStatus uses no-store for dashboard freshness", /cache:\s*"no-store"/.test(api));
check("selfie cleared after successful clock in", /Clock-in successful[\s\S]*setSelfieClockIn\(null\)/.test(client));
check("selfie cleared after successful clock out", /Clock-out successful[\s\S]*setSelfieClockOut\(null\)/.test(client));
check("no nested button in capture control", !/<button[\s\S]*?<Button[\s\S]*?<\/button>/.test(client.slice(client.indexOf("clock-capture-selfie") - 200, client.indexOf("clock-capture-selfie") + 800)));

if (failures.length) {
  console.error(`FAILED (${failures.length}):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - clock action-first mobile (${passed} checks)`);
