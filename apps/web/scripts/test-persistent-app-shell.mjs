import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src");
const appRoot = path.join(root, "app");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(entry.name, full)) out.push(full);
  }
  return out;
}

const appGroup = path.join(appRoot, "(app)");
const layoutPath = path.join(appGroup, "layout.tsx");
const loadingPath = path.join(appGroup, "loading.tsx");
const layout = fs.readFileSync(layoutPath, "utf8");
const loading = fs.readFileSync(loadingPath, "utf8");
const shell = fs.readFileSync(path.join(root, "components/layout/app-shell.tsx"), "utf8");

check("(app)/layout.tsx exists", fs.existsSync(layoutPath));
check("(app)/loading.tsx exists", fs.existsSync(loadingPath));
check("layout renders AuthGuard", /<AuthGuard>/.test(layout));
check("layout renders AppShell once", (layout.match(/<AppShell[\s>]/g) || []).length === 1);
check("layout wraps children in AppShell", /<AppShell>\{children\}<\/AppShell>/.test(layout));
check("loading is main-content placeholder", /data-timiq-main-loading/.test(loading));
check("loading is not full-screen auth panel", !/timiq-loading-panel/.test(loading));
check("AppShell uses usePathname", /usePathname\(/.test(shell));
check("AppShell is a client component", /^"use client";/m.test(shell));

const pageFiles = walk(appGroup, (name) => name === "page.tsx");
check("authenticated pages exist under (app)", pageFiles.length > 40);

for (const file of pageFiles) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(appGroup, file);
  check(`${rel} does not import AppShell`, !/from\s+["'][^"']*components\/layout["']/.test(source) || !/AppShell/.test(source));
  check(`${rel} does not render AppShell`, !/<AppShell[\s>]/.test(source));
  check(`${rel} does not render AuthGuard`, !/<AuthGuard[\s>]/.test(source));
  check(`${rel} RoleGuard fallback is content-only`, !/fallback=\{[\s\S]*<AppShell/.test(source));
}

const outsidePages = walk(appRoot, (name, full) => {
  if (name !== "page.tsx") return false;
  return !full.includes(`${path.sep}(app)${path.sep}`);
});

for (const file of outsidePages) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(appRoot, file);
  if (rel.startsWith(`(public)${path.sep}`) || rel.startsWith(`(auth)${path.sep}`)) {
    check(`${rel} has no AppShell`, !/AppShell/.test(source));
  }
}

const publicLayout = fs.readFileSync(path.join(appRoot, "(public)/layout.tsx"), "utf8");
check("public layout has no AppShell", !/AppShell/.test(publicLayout));

const dynamicSamples = [
  "employees/[userId]/clock-selfies/page.tsx",
  "forms/start/[templateId]/page.tsx",
  "forms/submissions/[submissionId]/page.tsx",
  "pay-history/[itemId]/page.tsx",
  "rams/manage/[ramsId]/page.tsx",
  "rams/manage/[ramsId]/edit/page.tsx",
  "toolbox-talks/manage/[talkId]/page.tsx",
  "toolbox-talks/manage/[talkId]/edit/page.tsx",
  "timesheets/week/page.tsx",
];
for (const sample of dynamicSamples) {
  check(`dynamic route retained ${sample}`, fs.existsSync(path.join(appGroup, sample)));
}

const urlSamples = [
  "dashboard",
  "overview",
  "employees",
  "system/audit-log",
  "system/health",
  "system/live-logs",
  "messages",
  "workplaces",
];
for (const sample of urlSamples) {
  check(`URL path folder present ${sample}`, fs.existsSync(path.join(appGroup, sample, "page.tsx")));
  check(`old root path removed ${sample}`, !fs.existsSync(path.join(appRoot, sample, "page.tsx")));
}

check("legacy audit-log redirect outside (app)", fs.existsSync(path.join(appRoot, "audit-log/page.tsx")));
check("legacy system-health redirect outside (app)", fs.existsSync(path.join(appRoot, "system-health/page.tsx")));
check("root redirect outside (app)", fs.existsSync(path.join(appRoot, "page.tsx")));

const navSources = [
  "components/layout/nav-tree.tsx",
  "components/layout/desktop-sidebar.tsx",
  "components/layout/desktop-top-bar.tsx",
  "components/layout/mobile-header.tsx",
  "components/layout/mobile-bottom-nav.tsx",
  "components/layout/messages-header-button.tsx",
].map((rel) => fs.readFileSync(path.join(root, rel), "utf8"));

for (const [index, source] of navSources.entries()) {
  check(`shell nav ${index} uses next/link`, /from ["']next\/link["']/.test(source));
  check(`shell nav ${index} avoids location.assign`, !/location\.assign/.test(source));
  check(`shell nav ${index} avoids location.href assignment`, !/location\.href\s*=/.test(source));
}

console.log(`${passed} persistent app shell checks passed`);
