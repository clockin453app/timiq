import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../src/", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

const shell = read("components/layout/app-shell.tsx");
const sidebar = read("components/layout/desktop-sidebar.tsx");
const topBar = read("components/layout/desktop-top-bar.tsx");
const topNav = read("components/layout/desktop-top-nav.tsx");
const mobileHeader = read("components/layout/mobile-header.tsx");
const bottomNav = read("components/layout/mobile-bottom-nav.tsx");
const sidebarState = read("components/layout/desktop-sidebar-state.ts");
const sidebarPreference = read("components/layout/desktop-sidebar-preference.ts");
const tokens = read("styles/tokens.css");
const table = read("components/ui/table.tsx");
const appLayout = read("app/(app)/layout.tsx");
const publicLayout = read("app/(public)/layout.tsx");

check("desktop sidebar starts at lg", /lg:flex/.test(sidebar));
check("desktop top bar starts at lg", /lg:flex/.test(topBar));
check("mobile header ends at lg", /lg:hidden/.test(mobileHeader));
check("employee bottom nav ends at lg", /lg:hidden/.test(bottomNav));
for (const [name, source] of [
  ["sidebar", sidebar],
  ["top bar", topBar],
  ["mobile header", mobileHeader],
  ["bottom nav", bottomNav],
]) {
  check(`${name} has no xl visibility switch`, !/\bxl:(?:flex|hidden)\b/.test(source));
}
check("legacy top nav also uses lg geometry", /lg:flex-nowrap/.test(topNav) && !/xl:flex-nowrap/.test(topNav));
check("AppShell desktop geometry starts at lg", /lg:h-dvh/.test(shell) && /lg:overflow-hidden/.test(shell));
check("AppShell bottom spacing switches at lg", /lg:scroll-pb-/.test(shell) && /lg:pb-/.test(shell));
check("AppShell has no xl shell geometry", !/\bxl:(?:h-dvh|max-h-dvh|min-h-0|overflow-hidden|pb-)/.test(shell));

check("responsive sidebar token exists", /--layout-sidebar-responsive-default/.test(tokens));
check("laptop token range is 1024 through 1439", /@media \(min-width: 1024px\) and \(max-width: 1439px\)/.test(tokens));
check("laptop token defaults to collapsed rail", /--layout-sidebar-responsive-default: var\(--layout-sidebar-collapsed\)/.test(tokens));
check("hydration uses responsive width token", /var\(--layout-sidebar-responsive-default\)/.test(sidebar));
check("top bar hydration uses responsive width token", /var\(--layout-sidebar-responsive-default\)/.test(topBar));
check("sidebar wide query is 1440", /min-width: 1440px/.test(sidebarPreference));
check("state watches viewport only for missing preference", /readStoredSidebarValue\(\) === null/.test(sidebarState));

const compiledPreference = ts.transpileModule(sidebarPreference, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const preferenceModule = { exports: {} };
vm.runInNewContext(compiledPreference, {
  module: preferenceModule,
  exports: preferenceModule.exports,
});
const { resolveSidebarCollapsedState } = preferenceModule.exports;
check("wide desktop defaults expanded", resolveSidebarCollapsedState(null, true) === false);
check("laptop defaults collapsed", resolveSidebarCollapsedState(null, false) === true);
check("saved collapsed wins on wide desktop", resolveSidebarCollapsedState("1", true) === true);
check("saved expanded wins on laptop", resolveSidebarCollapsedState("0", false) === false);

check("management bottom nav returns null", /if \(canAccessManagement\(user\)\) \{\s*return null;/.test(bottomNav));
check("management bottom nav list removed", !/managementPrimaryLinks/.test(bottomNav));
check("employee bottom nav keeps dashboard", /employeePrimaryLinks[\s\S]*href: "\/dashboard"/.test(bottomNav));
check("employee bottom nav keeps clock", /employeePrimaryLinks[\s\S]*href: "\/clock"/.test(bottomNav));
check("limited bottom nav keeps timesheets", /limitedAccessPrimaryLinks[\s\S]*href: "\/timesheets"/.test(bottomNav));
check("limited bottom nav keeps CIS pay history", /limitedAccessPrimaryLinks[\s\S]*href: "\/pay-history"/.test(bottomNav));
check("limited bottom nav keeps profile", /limitedAccessPrimaryLinks[\s\S]*href: "\/profile"/.test(bottomNav));
const limitedBlock = bottomNav.match(/const limitedAccessPrimaryLinks[\s\S]*?\n\];/)?.[0] ?? "";
for (const blocked of ["/paye-pay-history", "/messages", "/settings"]) {
  check(`limited bottom nav excludes ${blocked}`, !limitedBlock.includes(blocked));
}

check("mobile header has no overflow clip", !/overflow-x-clip/.test(mobileHeader));
check("mobile header stays within viewport", /max-w-full/.test(mobileHeader));
check("mobile header uses compact menu icon", /<Menu aria-hidden/.test(mobileHeader));
check("menu button retains accessible text", /<span className="sr-only">\{menuLabel\}<\/span>/.test(mobileHeader));
check("mobile header compacts below 400", /min-\[400px\]/.test(mobileHeader));
check(
  "drawer reports viewport width to its state machine",
  /dispatch\(\{ type: "viewport", width: window\.innerWidth \}\)/.test(mobileHeader) &&
    /orientationchange/.test(mobileHeader),
);
check(
  "drawer desktop threshold matches the lg breakpoint",
  /MOBILE_DRAWER_DESKTOP_MIN_WIDTH = 1024/.test(read("components/layout/mobile-drawer-state.ts")),
);
check("drawer locks body scroll", /document\.body\.style\.overflow = "hidden"/.test(mobileHeader));
check("drawer has focus trap", /event\.key !== "Tab"/.test(mobileHeader));
check("drawer closes on Escape", /event\.key === "Escape"/.test(mobileHeader));
check("drawer width is viewport safe", /w-\[min\(92vw,360px\)\]/.test(mobileHeader));
check("drawer prevents horizontal scroll", /overflow-x-hidden overflow-y-auto/.test(mobileHeader));
check("drawer has no fixed footer navigation", !/timiq-mobile-drawer-footer/.test(mobileHeader));
check("drawer account actions scroll with the menu", /timiq-mobile-drawer-scroll[\s\S]*href="\/profile"/.test(mobileHeader));
check("main mobile header uses the large approved lockup", /MOBILE_HEADER_LOGO_HEIGHT = 46/.test(mobileHeader) && /surface="onDark"/.test(mobileHeader));
check("drawer header is account identity, not logo", /timiq-mobile-drawer-header/.test(mobileHeader) && (mobileHeader.match(/<TimIQBrandLockup/g) ?? []).length === 1);
check("drawer does not use compact mark-only branding", !/variant="compact"/.test(mobileHeader));
check("Logout uses menu row", /appearance="menuRow"/.test(mobileHeader));
check("drawer omits account leaves from tree", /omitMobileDrawerFooterLeaves/.test(mobileHeader));
check("top header keeps utilities without account avatar menu", !/UserAvatar[\s\S]*menuButtonRef|menuButtonRef[\s\S]*UserAvatar/.test(mobileHeader.split("menuOpen")[0] ?? ""));

check("shared Table contains width", /max-w-full min-w-0 w-full overflow-x-auto/.test(table));
check(
  "timiq-scroll-x sets min-width 0",
  /\.timiq-scroll-x\s*\{[\s\S]*min-width:\s*0;/.test(read("styles/globals.css")),
);
const wideAudits = [
  ["timesheets", read("app/(app)/timesheets/timesheets-client.tsx"), /timiq-scroll-x w-full min-w-0 max-w-full[\s\S]*min-w-\[960px\]/],
  ["CIS payroll", read("app/(app)/payroll-report/payroll-report-client.tsx"), /min-w-\[76rem\]/],
  ["monthly PAYE", read("app/(app)/monthly-paye/monthly-paye-client.tsx"), /min-w-\[96rem\]/],
  ["accounting", read("app/(app)/accounting/accounting-client.tsx"), /w-full min-w-0 max-w-full overflow-x-auto/],
  ["employees", read("app/(app)/employees/employees-client.tsx"), /w-full min-w-0 max-w-full overflow-x-auto/],
  ["week report", read("app/(app)/week-report/week-report-client.tsx"), /w-full min-w-0 max-w-full space-y-2 overflow-x-auto/],
  ["work progress", read("app/(app)/work-progress-review/work-progress-review-client.tsx"), /w-full min-w-0 max-w-full overflow-x-auto/],
  ["pay history", read("app/(app)/pay-history/pay-history-client.tsx"), /w-full min-w-0 max-w-full overflow-x-auto/],
  ["privacy", read("app/(app)/privacy/privacy-client.tsx"), /w-full min-w-0 max-w-full overflow-x-auto/],
  ["budgets calculator", read("app/(app)/budgets/budgets-calculator-tab.tsx"), /w-full min-w-0 max-w-full overflow-x-auto/],
  ["budgets saved", read("app/(app)/budgets/budgets-saved-tab.tsx"), /w-full min-w-0 max-w-full overflow-x-auto/],
];
for (const [name, source, expected] of wideAudits) {
  check(`${name} has explicit horizontal containment`, expected.test(source));
}

const payrollReport = read("app/(app)/payroll-report/payroll-report-client.tsx");
const workProgress = read("app/(app)/work-progress-review/work-progress-review-client.tsx");
const helpClient = read("app/(app)/help/help-client.tsx");
check("CIS payroll row actions wrap", /flex flex-wrap gap-1/.test(payrollReport));
check("work progress row actions wrap", /hidden flex-wrap items-center gap-1 md:flex/.test(workProgress));
check(
  "help sticky TOC uses desktop content height",
  /xl:max-h-\[calc\(var\(--layout-desktop-content-height\)-3rem\)\]/.test(helpClient),
);

check("AppShell root is width constrained", /w-full min-w-0 max-w-full/.test(shell));
check("AppShell main remains min-w-0", /timiq-app-main flex min-h-0 min-w-0/.test(shell));
check("main content owns overflow", /max-w-full flex-1 overflow-auto/.test(shell));
check("management receives no mobile bottom padding", /hasMobileBottomNav[\s\S]*: "pb-\[var\(--space-page-y\)\]"/.test(shell));
check("employee receives bottom-nav scroll padding", /scroll-pb-\[calc\(var\(--layout-mobile-bottom-nav-height\)/.test(shell));

const messages = read("app/(app)/messages/messages-client.tsx");
check("messages desktop height switches at lg", /lg:h-\[calc\(var\(--layout-desktop-content-height\)/.test(messages));
check("messages uses dynamic viewport height", /100dvh/.test(messages) && !/100vh/.test(messages));

check("persistent AppShell remains", /<AuthGuard>[\s\S]*<AppShell>\{children\}<\/AppShell>/.test(appLayout));
check("public layout remains isolated", !/AppShell|AuthGuard/.test(publicLayout));

const expectedMode = (width) => (width >= 1024 ? "desktop" : "mobile");
for (const [width, mode] of [
  [1440, "desktop"],
  [1366, "desktop"],
  [1280, "desktop"],
  [1024, "desktop"],
  [820, "mobile"],
  [768, "mobile"],
  [430, "mobile"],
  [390, "mobile"],
  [360, "mobile"],
]) {
  check(`${width}px resolves to ${mode}`, expectedMode(width) === mode);
}

console.log(`${passed} responsive shell checks passed`);
