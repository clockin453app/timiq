/**
 * Responsive typography and mobile density coverage.
 *
 * Part 1 parses the token declarations out of tokens.css and asserts the mobile
 * scale against the target sizes, and that the desktop override block restores
 * the pre-density-pass desktop sizes (desktop must not get smaller).
 * Part 2 asserts the shared primitives consume those tokens instead of hard-coded
 * sizes, and that wide-data pages contain their own horizontal scroll.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../src/", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const tokens = read("styles/tokens.css");

/** Read every `--name: value` pair inside a top-level block. */
function blockVars(source, startIndex) {
  const open = source.indexOf("{", source.indexOf("{", startIndex) + 1);
  let depth = 1;
  let index = open + 1;
  while (index < source.length && depth > 0) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    index += 1;
  }
  const body = source.slice(open + 1, index - 1);
  const vars = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

const mobile = (() => {
  const body = tokens.slice(0, tokens.indexOf("@media"));
  const vars = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
})();

const desktopIndex = tokens.indexOf("@media (min-width: 768px)");
check("a 768px typography override block exists", desktopIndex > 0);
const desktop = blockVars(tokens, desktopIndex);

const rem = (value) => Number.parseFloat(value) * 16;

/* ------------------------------------------------------------------ *
 * 1. Mobile typography targets
 * ------------------------------------------------------------------ */

const mobileTargets = [
  ["--text-body", 14, "base body text"],
  ["--text-secondary", 12, "secondary/helper text"],
  ["--text-label", 12, "form labels"],
  ["--text-button", 13, "buttons"],
  ["--text-table-head", 11, "table headers"],
  ["--text-table-cell", 12, "table cells"],
  ["--text-page-title", 22, "page title"],
  ["--text-section-title", 16, "section title"],
  ["--text-dialog-title", 17, "dialog title"],
  ["--text-nav-row", 13, "drawer rows"],
];

for (const [token, expectedPx, label] of mobileTargets) {
  check(`${label} token is declared`, typeof mobile[token] === "string");
  check(`${label} is ~${expectedPx}px on mobile`, Math.abs(rem(mobile[token] ?? "0") - expectedPx) <= 1);
}

// Nothing in the mobile scale may drop below 11px, and only table headers may sit
// that low. Body copy must stay at 14px or above.
check("no mobile text token is below 11px", mobileTargets.every(([token]) => rem(mobile[token]) >= 11));
check("mobile body text is at least 14px", rem(mobile["--text-body"]) >= 14);
check("form labels stay at 12px or more", rem(mobile["--text-label"]) >= 12);

// Form controls must stay at 16px on mobile: below that, iOS Safari zooms the
// viewport when the field takes focus.
check("form controls are 16px on mobile", rem(mobile["--text-form-control"]) === 16);

/* ------------------------------------------------------------------ *
 * 2. Desktop must not shrink
 * ------------------------------------------------------------------ */

const desktopFloors = [
  ["--text-body", 14.4],
  ["--text-secondary", 12.24],
  ["--text-label", 12.8],
  ["--text-button", 14],
  ["--text-table-head", 12],
  ["--text-table-cell", 14],
  ["--text-page-title", 26],
  ["--text-section-title", 16.4],
  ["--text-hero-title", 28],
];

for (const [token, floorPx] of desktopFloors) {
  check(`${token} is restored at 768px`, typeof desktop[token] === "string");
  check(
    `${token} is not smaller on desktop than before the density pass`,
    rem(desktop[token] ?? "0") >= floorPx - 0.01,
  );
  check(`${token} is larger on desktop than mobile`, rem(desktop[token]) >= rem(mobile[token]));
}
check("desktop form controls return to 14px", rem(desktop["--text-form-control"]) === 14);

/* ------------------------------------------------------------------ *
 * 3. Mobile spacing is tighter, desktop spacing is restored
 * ------------------------------------------------------------------ */

const spacingPairs = [
  "--space-table-cell-x",
  "--space-table-cell-y",
  "--space-form-gap",
  "--space-modal",
  "--space-section",
];
for (const token of spacingPairs) {
  check(`${token} has a mobile value`, typeof mobile[token] === "string");
  check(`${token} is restored at 768px`, typeof desktop[token] === "string");
  check(`${token} is tighter on mobile`, rem(mobile[token]) < rem(desktop[token]));
}
check("mobile page padding is 0.75rem", mobile["--space-page-x"] === "0.75rem");
check("page padding widens at 640px", /--space-page-x: 1\.5rem/.test(tokens.slice(tokens.indexOf("@media (min-width: 640px)"))));
check("a touch-target floor is declared", mobile["--control-touch-min"] === "44px");

/* ------------------------------------------------------------------ *
 * 4. Primitives consume the tokens
 * ------------------------------------------------------------------ */

const typography = read("styles/typography.css");
for (const [cls, token] of [
  ["timiq-title-lg", "--text-page-title"],
  ["timiq-title-md", "--text-section-title"],
  ["timiq-title-dialog", "--text-dialog-title"],
  ["timiq-body", "--text-body"],
  ["timiq-caption", "--text-secondary"],
  ["timiq-label", "--text-label"],
]) {
  const block = typography.slice(typography.indexOf(`.${cls} {`));
  check(`.${cls} reads its size from ${token}`, block.slice(0, 320).includes(`var(${token})`));
}
check(
  "typography.css has no remaining hard-coded rem font sizes for scaled text",
  !/\.timiq-(title-xl|title-lg|title-md|body|caption|label)\s*\{[^}]*font-size:\s*\d/.test(typography),
);

const button = read("components/ui/button.tsx");
check("Button sizing comes from the token", /text-\[length:var\(--text-button\)]/.test(button));
check("Button no longer hard-codes a mobile text size", !/text-base md:text-sm/.test(button));
check("Button never overflows its row", /max-w-full/.test(button));
check("Button keeps a coarse-pointer touch region", /timiq-touch-extend/.test(button));

const globals = read("styles/globals.css");
check(
  "the touch-region helper only applies to coarse pointers",
  /@media \(pointer: coarse\)[\s\S]{0,120}\.timiq-touch-extend/.test(globals),
);
check(
  "the touch region reaches the declared minimum",
  /height: var\(--control-touch-min\)/.test(globals),
);
check("the touch region does not change layout height", /min-height: 100%/.test(globals));
check("focus rings are still visible", /:focus-visible \{[\s\S]{0,120}var\(--focus-ring\)/.test(globals));
check("body text follows the responsive scale", /body \{[\s\S]{0,320}font-size: var\(--text-body\)/.test(globals));
check("inputs follow the form-control scale", /font-size: var\(--text-form-control\)/.test(globals));

const table = read("components/ui/table.tsx");
check("table cells use the density tokens", /px-\[var\(--space-table-cell-x\)] py-\[var\(--space-table-cell-y\)]/.test(table));
check("table cell text uses the token", /text-\[length:var\(--text-table-cell\)]/.test(table));
check("table head text uses the token", /text-\[length:var\(--text-table-head\)]/.test(table));
check("the table scrolls inside its own container", /overflow-x-auto/.test(table));
check("the table container cannot widen the document", /max-w-full min-w-0 w-full/.test(table));
check("iOS momentum scrolling is kept", /\[-webkit-overflow-scrolling:touch]/.test(table));

const uiClasses = read("lib/ui-classes.ts");
check("the shared table wrapper contains its scroll", /tableWrap:[\s\S]{0,200}overflow-x-auto/.test(uiClasses));
check("the shared table wrapper cannot widen the document", /tableWrap:[\s\S]{0,200}max-w-full min-w-0/.test(uiClasses));
check("toolbars use the responsive gap token", /gap-\[var\(--space-toolbar-gap\)]/.test(uiClasses));
check("toolbars are tighter on mobile", /bg-\[var\(--color-toolbar-well\)] p-2 sm:p-3/.test(uiClasses));
check("page headers are tighter on mobile", /px-\[var\(--space-card\)] py-2\.5 sm:flex-row/.test(uiClasses));
check("drawer rows use the nav token", /navDrawerLinkBase:[\s\S]{0,220}text-\[length:var\(--text-nav-row\)]/.test(uiClasses));
check("drawer rows keep a compact touch target", /navDrawerLinkBase:[\s\S]{0,120}min-h-10/.test(uiClasses));
check("drawer labels truncate rather than overflow", /min-w-0 flex-1 truncate/.test(read("components/layout/nav-tree.tsx")));
check("drawer active state is not colour-only", /navDrawerLinkActive:[\s\S]{0,220}border-l-\[var\(--color-brand\)\]/.test(uiClasses));
check("drawer rows stay flat without oversized rounding", /navDrawerLinkBase:[\s\S]{0,160}rounded-none/.test(uiClasses));
check("bottom nav items keep a 44px touch target", /bottomNavItemBase:[\s\S]{0,160}min-h-\[44px]/.test(uiClasses));
check(
  "PAYE filter controls no longer force a sub-16px mobile font",
  !/payeFilterInput:[\s\S]{0,220}text-sm/.test(uiClasses) &&
    !/payeFilterSelect:[\s\S]{0,220}text-sm/.test(uiClasses),
);

const sheet = read("components/ui/sheet.tsx");
check("sheet body padding is tighter on mobile", /px-2\.5 py-3 sm:px-5/.test(sheet));
check("sheet body cannot widen the document", /w-full min-w-0/.test(sheet));

/* ------------------------------------------------------------------ *
 * 5. Shell breakpoints stay consistent
 * ------------------------------------------------------------------ */

check(
  "the mobile drawer desktop threshold is still 1024",
  /MOBILE_DRAWER_DESKTOP_MIN_WIDTH = 1024/.test(read("components/layout/mobile-drawer-state.ts")),
);
const shell = read("components/layout/app-shell.tsx");
check("the desktop shell still starts at lg", /lg:/.test(shell));
check("main content still cannot widen the document", /min-w-0/.test(shell));
check(
  "the mobile header is still hidden from lg upwards",
  /lg:hidden/.test(read("components/layout/mobile-header.tsx")),
);
check(
  "the bottom navigation is still hidden from lg upwards",
  /lg:hidden/.test(read("components/layout/mobile-bottom-nav.tsx")),
);

/* ------------------------------------------------------------------ *
 * 6. Wide-data pages contain their own horizontal scroll
 * ------------------------------------------------------------------ */

const widePages = [
  ["Employees", "app/(app)/employees/employees-client.tsx"],
  ["Live Attendance", "app/(app)/live-attendance/live-attendance-client.tsx"],
  ["Time Records", "app/(app)/time-records/time-records-client.tsx"],
  ["Timesheets", "app/(app)/timesheets/timesheets-client.tsx"],
  ["Site Progress", "app/(app)/site-progress/site-progress-client.tsx"],
  ["Work Progress Pictures", "app/(app)/work-progress-review/work-progress-review-client.tsx"],
  ["Monthly PAYE", "app/(app)/monthly-paye/monthly-paye-client.tsx"],
  ["Pay History", "app/(app)/pay-history/pay-history-client.tsx"],
  ["Forms", "app/(app)/forms/forms-client.tsx"],
  ["RAMS", "app/(app)/rams/[assessmentId]/employee-rams-detail-client.tsx"],
  ["Privacy Requests", "app/(app)/privacy/requests/privacy-requests-client.tsx"],
];

for (const [label, path] of widePages) {
  let source = "";
  try {
    source = read(path);
  } catch {
    check(`${label} page exists at ${path}`, false);
    continue;
  }

  const usesSharedTable = /<Table\b/.test(source) || /uiClasses\.tableWrap/.test(source);
  const hasOwnScroller = /overflow-x-auto/.test(source) || /timiq-scroll-x/.test(source);
  check(`${label} renders wide data in a contained scroller`, usesSharedTable || hasOwnScroller);

  // Any hand-rolled horizontal scroller must also be told it may shrink,
  // otherwise it widens the document instead of scrolling internally.
  for (const match of source.matchAll(/className=\{?["'`]([^"'`]*overflow-x-auto[^"'`]*)["'`]/g)) {
    const classes = match[1];
    check(
      `${label} scroller "${classes.slice(0, 48)}…" can shrink instead of widening the page`,
      /min-w-0/.test(classes) || /w-full/.test(classes),
    );
  }
}

check(
  "the shared horizontal scroll helper cannot widen its parent",
  /\.timiq-scroll-x \{[\s\S]{0,220}min-width: 0/.test(globals),
);

// Week Report is a card/definition-list layout rather than a table, so it must
// keep its columns shrinkable instead of introducing a scroller.
const weekReport = read("app/(app)/timesheets/week/timesheet-week-detail-client.tsx");
check("week report rows can shrink", /grid min-w-0 grid-cols-/.test(weekReport));
check("week report labels wrap instead of overflowing", /min-w-0 break-words font-bold/.test(weekReport));
check("week report body text follows the scale", /text-\[length:var\(--text-body\)]/.test(weekReport));

// Every admin clock dialog must let native date/time controls shrink.
const timeRecords = read("app/(app)/time-records/time-records-client.tsx");
const datetimeInputs = [...timeRecords.matchAll(/<input\b[\s\S]{0,320}?type="datetime-local"[\s\S]{0,120}?\/>/g)];
check("time-records datetime inputs were found", datetimeInputs.length >= 5);
for (const [index, match] of datetimeInputs.entries()) {
  check(`time-records datetime input ${index + 1} can shrink`, /min-w-0/.test(match[0]));
  check(
    `time-records datetime input ${index + 1} keeps the 16px mobile font`,
    /timiq-input/.test(match[0]) && !/text-sm/.test(match[0]),
  );
}

check("time-records filter uses DateRangeFields", /DateRangeFields/.test(timeRecords));
check("time-records filter actions use FilterActionRow", /FilterActionRow/.test(timeRecords));
check(
  "company selector no longer caps mobile width at 10rem",
  !/max-w-\[10rem\]/.test(read("features/companies/company-selector.tsx")),
);
check(
  "date-field filter controls use min-h-11 on mobile",
  /min-h-11/.test(read("components/ui/date-field.tsx")),
);
check(
  "filter action row uses min-h-11 on mobile",
  /min-h-11/.test(read("components/ui/filter-toolbar.tsx")),
);

/* ------------------------------------------------------------------ *
 * 7. Dialogs stay inside the viewport
 * ------------------------------------------------------------------ */

const modal = read("components/ui/modal.tsx");
check("the shared modal caps its height against dvh", /100dvh/.test(modal));
check("the shared modal scrolls its body, not the page", /overscroll-contain/.test(modal));
check("the shared modal cannot exceed the viewport width", /max-w-full/.test(modal));

// Belt-and-braces against iOS focus zoom: even raw inputs that set a Tailwind
// text size are forced back to 16px below the md breakpoint.
check(
  "form controls are forced to 16px below 768px",
  /@media \(max-width: 767px\)[\s\S]{0,400}font-size: 16px !important/.test(globals),
);
check(
  "the zoom guard skips controls that have no text",
  /:not\(\[type="checkbox"\]\)[\s\S]{0,160}:not\(\[type="file"\]\)/.test(globals),
);

// Overlay panels outside the shared modal must be viewport-constrained too.
const wpReview = read("app/(app)/work-progress-review/work-progress-review-client.tsx");
check(
  "the permanent-delete dialog is capped against dvh",
  /max-h-\[calc\(100dvh-1\.5rem\)][\s\S]{0,200}border-\[var\(--color-danger-700\)]/.test(wpReview),
);
check("the permanent-delete dialog scrolls internally", /overscroll-contain/.test(wpReview));
check(
  "the compact row-action select can shrink",
  /timiq-select h-8 w-full min-w-0 max-w-\[11rem]/.test(wpReview),
);

const topBar = read("components/layout/desktop-top-bar.tsx");
check("the account menu is width-capped to the viewport", /max-w-\[calc\(100vw-1rem\)]/.test(topBar));
check("the account menu is height-capped and scrolls", /max-h-\[min\(80dvh[\s\S]{0,80}overflow-y-auto/.test(topBar));
check(
  "the notification panel is viewport-capped",
  /w-\[min\(100vw-1rem,22rem\)][\s\S]{0,200}max-h-\[min\(85dvh/.test(read("components/layout/notification-bell.tsx")),
);

// Every inline dialog in the app must be viewport-constrained too.
const appDir = new URL("app/(app)/", root);
const dialogFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) walk(next);
    else if (entry.name.endsWith(".tsx")) dialogFiles.push(next);
  }
})(appDir);

let dialogsChecked = 0;
for (const file of dialogFiles) {
  const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (!/aria-modal="true"/.test(source)) continue;
  const name = decodeURIComponent(file.pathname.split("/app/(app)/").pop() ?? "");
  dialogsChecked += 1;
  const usesSharedModal = /<Modal\b/.test(source) || /from "\.\.\/\.\.\/components\/ui"/.test(source);
  check(
    `${name} constrains dialog height against the viewport`,
    /100dvh/.test(source) || usesSharedModal,
  );
  check(
    `${name} constrains dialog width against the viewport`,
    /max-w-\[calc\(100vw/.test(source) || /max-w-full/.test(source) || usesSharedModal,
  );
}
check("inline dialogs were actually found and checked", dialogsChecked > 0);

if (failures.length > 0) {
  console.error(`${failures.length} mobile density check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`${passed} mobile density and typography checks passed (${dialogsChecked} inline dialogs)`);
