import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../src/", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

const navigationSource = read("config/navigation.ts");
const compiledNavigation = ts.transpileModule(navigationSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiledNavigation, { module, exports: module.exports });

const {
  getDesktopSidebarNavigationTree,
  getMobileDrawerNavigationTree,
  collectNavigationLeaves,
  findActiveAncestorIds,
  filterNavigationTree,
  pathnameMatchesNavHref,
} = module.exports;

const leafHrefs = (nodes) => collectNavigationLeaves(nodes).map((item) => item.href);

const employee = getDesktopSidebarNavigationTree("employee");
const admin = getDesktopSidebarNavigationTree("admin");
const administrator = getDesktopSidebarNavigationTree("administrator");
const limited = getDesktopSidebarNavigationTree("employee", { limitedAccess: true });
const mobileLimited = getMobileDrawerNavigationTree("employee", { limitedAccess: true });
const mobileAdmin = getMobileDrawerNavigationTree("admin");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function maxDepth(nodes, depth = 1) {
  let max = depth;
  for (const node of nodes) {
    if (node.children?.length) {
      max = Math.max(max, maxDepth(node.children, depth + 1));
    }
  }
  return max;
}

function assertNoEmptyFolders(nodes) {
  for (const node of nodes) {
    if (node.children) {
      check(`folder ${node.id} not empty`, node.children.length > 0);
      assertNoEmptyFolders(node.children);
    }
  }
}

check("employee has dashboard", leafHrefs(employee).includes("/dashboard"));
check("employee lacks employees", !leafHrefs(employee).includes("/employees"));
check("admin lacks system health", !leafHrefs(admin).includes("/system/health"));
check("administrator has system health", leafHrefs(administrator).includes("/system/health"));
check("admin lacks live logs", !leafHrefs(admin).includes("/system/live-logs"));
check("administrator has live logs", leafHrefs(administrator).includes("/system/live-logs"));
check("administrator has admin guide", leafHrefs(administrator).includes("/admin-guide"));
check("admin lacks admin guide", !leafHrefs(admin).includes("/admin-guide"));
check("limited lacks dashboard", !leafHrefs(limited).includes("/dashboard"));
check("limited lacks paye history", !leafHrefs(limited).includes("/paye-pay-history"));
check("limited has timesheets", leafHrefs(limited).includes("/timesheets"));
check("limited has pay history", leafHrefs(limited).includes("/pay-history"));
check("limited has profile", leafHrefs(limited).includes("/profile"));
check("mobile limited lacks messages", !leafHrefs(mobileLimited).includes("/messages"));
check("no workplaces in admin", !leafHrefs(admin).includes("/workplaces"));
check("no workplaces in employee", !leafHrefs(employee).includes("/workplaces"));
check("work progress under sites", Boolean(findNode(admin, "mgmt-sites-progress")));
check("companies under system org", Boolean(findNode(admin, "companies")));
check("overview is root leaf", Boolean(admin.find((n) => n.id === "overview" && n.href === "/overview")));
check("my workspace present for admin", Boolean(findNode(admin, "mgmt-workspace")));
check("my workspace has messages", leafHrefs([findNode(admin, "mgmt-workspace")]).includes("/messages"));
check("my workspace has forms", leafHrefs([findNode(admin, "mgmt-workspace")]).includes("/forms"));
check("tree depth <= 3 for admin", maxDepth(admin) <= 3);
check("tree depth <= 3 for employee", maxDepth(employee) <= 3);
check("mobile admin mirrors desktop hierarchy", leafHrefs(mobileAdmin).includes("/work-progress-review"));
check("mobile admin has companies", leafHrefs(mobileAdmin).includes("/companies"));

const forbiddenDetail = [
  "/employees/",
  "/pay-history/",
  "/timesheets/week",
  "/forms/start/",
  "/forms/submissions/",
  "/rams/manage/",
  "/toolbox-talks/manage/",
  "/audit-log",
  "/system-health",
  "/clock-selfies",
  "/login",
  "/product",
];
for (const href of leafHrefs(administrator)) {
  check(
    `no detail/redirect leaf ${href}`,
    !forbiddenDetail.some((prefix) => href === prefix || (prefix.endsWith("/") && href.startsWith(prefix) && href !== prefix.slice(0, -1))),
  );
}
check("no exact manage new routes", !leafHrefs(administrator).some((h) => /\/(new)$/.test(h) || /\/edit$/.test(h)));

const allRoleTrees = [employee, admin, administrator, limited, mobileAdmin, mobileLimited];
const visibleRoutes = [...new Set(allRoleTrees.flatMap(leafHrefs))];
const pageExists = (href) =>
  fs.existsSync(new URL(`app/(app)${href}/page.tsx`, root)) ||
  fs.existsSync(new URL(`app${href}/page.tsx`, root));
const missingRoutes = visibleRoutes.filter((href) => !pageExists(href));
check("every leaf has page.tsx", missingRoutes.length === 0);

// Page → leaf orphan matrix for list/hub pages under (app).
const appGroupDir = path.join(fileURLToPath(root), "app", "(app)");
const intentionalOrphans = new Set([
  // Deliberately out of nav trees; still linked from admin-guide content.
  "/workplaces",
  // Gate/redirect; management leaf is /clock-selfie-review.
  "/clock-selfies",
]);
const skipDirNames = new Set(["new", "edit", "upload", "week", "start", "submissions"]);

function listHubPages(dir, prefix = "") {
  /** @type {string[]} */
  const hubs = [];
  if (!fs.existsSync(dir)) return hubs;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("[") || skipDirNames.has(entry.name)) continue;
    const href = `${prefix}/${entry.name}`;
    const childDir = path.join(dir, entry.name);
    if (fs.existsSync(path.join(childDir, "page.tsx"))) {
      hubs.push(href);
    }
    hubs.push(...listHubPages(childDir, href));
  }
  return hubs;
}

const hubPages = listHubPages(appGroupDir);
const allNavLeaves = new Set(visibleRoutes);
const orphanHubs = hubPages.filter((href) => !allNavLeaves.has(href) && !intentionalOrphans.has(href));
check(
  `no unexpected hub page orphans (${orphanHubs.join(", ") || "none"})`,
  orphanHubs.length === 0,
);
check("intentional orphan /workplaces exists as page", hubPages.includes("/workplaces"));
check("intentional orphan /clock-selfies exists as page", hubPages.includes("/clock-selfies"));
check("intentional orphans are not nav leaves", ![...intentionalOrphans].some((h) => allNavLeaves.has(h)));


for (const tree of [admin, administrator, employee, limited]) {
  const hrefs = leafHrefs(tree);
  check(`no duplicate hrefs ${hrefs.length}`, new Set(hrefs).size === hrefs.length);
  assertNoEmptyFolders(tree);
}

const adminOnly = ["/system/live-logs", "/system/health", "/admin-guide"];
for (const href of adminOnly) {
  check(`admin hides ${href}`, !leafHrefs(admin).includes(href));
  check(`administrator shows ${href}`, leafHrefs(administrator).includes(href));
}

for (const href of ["/employees", "/overview", "/companies"]) {
  check(`employee hides management ${href}`, !leafHrefs(employee).includes(href));
}

const ancestors = findActiveAncestorIds(admin, "/work-progress-review");
check("active ancestors include sites", ancestors.includes("mgmt-sites"));
check("active ancestors include progress", ancestors.includes("mgmt-sites-progress"));

const emptyFilter = filterNavigationTree(
  [
    {
      id: "empty-folder",
      label: "Empty",
      labelKey: "nav.folder.forms",
      iconKey: "mgmt-work-forms",
      allowedRoles: ["admin"],
      children: [
        {
          id: "admin-only-leaf",
          label: "Health",
          labelKey: "nav.system_health",
          iconKey: "nav.system_health",
          href: "/system/health",
          allowedRoles: ["administrator"],
        },
      ],
    },
  ],
  "admin",
);
check("empty folders removed after filter", emptyFilter.length === 0);

check("pathname match nested", pathnameMatchesNavHref("/forms", "/forms/start/1"));
check("dashboard exact", !pathnameMatchesNavHref("/dashboard", "/dashboard/extra"));

const shell = read("components/layout/app-shell.tsx");
const appLayout = read("app/(app)/layout.tsx");
const appLoading = read("app/(app)/loading.tsx");
const topBar = read("components/layout/desktop-top-bar.tsx");
const sidebar = read("components/layout/desktop-sidebar.tsx");
const sidebarState = read("components/layout/desktop-sidebar-state.ts");
const navTree = read("components/layout/nav-tree.tsx");
const navIcons = read("components/layout/nav-item-icon.tsx");
const mobile = read("components/layout/mobile-header.tsx");
const logoutDialog = read("features/auth/logout-confirm-dialog.tsx");
const logoutButton = read("features/auth/logout-button.tsx");
const publicShell = read("components/public/public-site-shell.tsx");
const globals = read("styles/globals.css");
const tokens = read("styles/tokens.css");

check("app layout owns AuthGuard", /<AuthGuard>/.test(appLayout));
check("app layout owns AppShell", /<AppShell>\{children\}<\/AppShell>/.test(appLayout));
check("app loading is main-content only", /data-timiq-main-loading/.test(appLoading));
check("shell uses pathname", /usePathname\(/.test(shell));
check("shell overflow fixed", !/overflow-x-clip/.test(shell) && /timiq-app-main/.test(shell));
check("top bar no mega nav", !/DesktopTopNav/.test(topBar));
check("top bar width tokens", /var\(--layout-sidebar-collapsed\)/.test(topBar) && /var\(--layout-sidebar-width\)/.test(topBar));
check("tokens width", /--layout-sidebar-width: 18\.25rem/.test(tokens));
check("tokens collapsed", /--layout-sidebar-collapsed: 4\.5rem/.test(tokens));
check("tokens row heights", /--layout-sidebar-folder-row-height/.test(tokens) && /--layout-sidebar-page-row-height/.test(tokens));
check("sidebar colours", /--color-sidebar-bg: #192f60/.test(tokens) && /--color-sidebar-child-bg: #e6edf6/.test(tokens));
check("collapse preference", /localStorage\.getItem\(SIDEBAR_COLLAPSED_KEY\)/.test(sidebarState));
check("sidebar uses NavTree", /<NavTree/.test(sidebar));
check("collapsed section expands", /setCollapsed\(false\)/.test(sidebar) && /forceOpenIds/.test(sidebar));
check("collapsed does not auto-navigate section", /onCollapsedSectionClick/.test(sidebar) && !/href=\{node\.href\}/.test(sidebar.split("collapsed")[1] ?? ""));
{
  const footerStart = sidebar.indexOf('data-testid="desktop-sidebar-account-footer"');
  const footer = footerStart >= 0 ? sidebar.slice(footerStart) : "";
  const scrollStart = sidebar.indexOf('data-testid="desktop-sidebar-nav-scroll"');
  const scroll = scrollStart >= 0 ? sidebar.slice(scrollStart, Math.min(sidebar.length, scrollStart + 4500)) : "";
  check("Profile is inside scrollable navigation (tree or account nav)",
    leafHrefs(employee).includes("/profile") && leafHrefs(admin).includes("/profile"));
  check("Settings is inside scrollable navigation tree",
    leafHrefs(employee).includes("/settings") && leafHrefs(admin).includes("/settings"));
  check("Help centre is inside scrollable navigation tree",
    leafHrefs(employee).includes("/help") && leafHrefs(admin).includes("/help"));
  check("collapsed rail keeps account links in scroll area",
    /data-testid="desktop-sidebar-account-nav"/.test(sidebar) && /href=\{link\.href\}/.test(sidebar));
  check("fixed footer does not duplicate Profile/Settings/Help links",
    !/href="\/profile"/.test(footer) && !/href="\/settings"/.test(footer) && !/href="\/help"/.test(footer));
  check("fixed footer contains account identity and Log out only",
    /formatAuthUserDisplayName/.test(sidebar) &&
      /displayName/.test(footer) &&
      /LogoutButton/.test(footer) &&
      !/signed_in_as/.test(footer) &&
      !/nav\.profile/.test(footer));
  check("name appears before Log out in expanded footer",
    /\{displayName\}[\s\S]*?<LogoutButton[\s\S]*?showIcon/.test(footer));
  check("email is de-emphasized via title/tooltip or secondary line",
    /title=\{user\.email\}/.test(footer));
  check("no SIGNED IN AS label in footer", !/Signed in as/.test(footer) && !/signed_in_as/.test(footer));
  check("footer uses compact padding", /space-y-1 px-2\.5 py-1\.5/.test(footer) || /py-1\.5/.test(footer));
  check("navigation keeps bottom clearance (pb on scroll)",
    /desktop-sidebar-nav-scroll[\s\S]*pb-4/.test(sidebar) || /pb-4 \[-webkit-overflow-scrolling:touch\]/.test(scroll) || /pb-3/.test(scroll));
  check("footer is compact (no max-h 50% nested scroll)",
    !/max-h-\[50%\]/.test(sidebar) && /desktop-sidebar-account-footer/.test(sidebar) && /shrink-0 border-t border-white\/15/.test(sidebar));
}
check("role permissions and routes unchanged for limited profile-only",
  leafHrefs(limited).includes("/profile") && !leafHrefs(limited).includes("/settings") && !leafHrefs(limited).includes("/help"));
check("multi expand persistence", /timiq-nav-tree:v1:/.test(navTree));
check("prunes invalid expanded ids", /validFolderIds/.test(navTree));
check("aria-expanded folders", /aria-expanded=\{open\}/.test(navTree));
check("aria-current leaves", /aria-current=\{activeLeaf \? "page" : undefined\}/.test(navTree));
check("keyboard left right", /ArrowRight/.test(navTree) && /ArrowLeft/.test(navTree));
check("guide lines", /GUIDE_COLOR/.test(navTree));
check("disclosure chevron", /<ChevronRight/.test(navTree));
check("active highlight", /bg-\[#d5e1ee\]/.test(navTree));
check("folder icons present", /"mgmt-people-employees": Folder/.test(navIcons));
check("mobile uses NavTree", /getMobileDrawerNavigationTree/.test(mobile) && /<NavTree/.test(mobile));
check("mobile omits footer leaves from tree", /omitMobileDrawerFooterLeaves/.test(mobile));
check("mobile escape", /event\.key === "Escape"/.test(mobile));
check("mobile focus trap", /event\.key !== "Tab"/.test(mobile));
check("mobile limited messages gate", /\{!limited \? \(\s*<>\s*<MessagesHeaderButton/.test(mobile));
check("mobile drawer scroll hosts Profile", /timiq-mobile-drawer-scroll[\s\S]*\/profile/.test(mobile));
check("mobile drawer logout is a menu row", /appearance="menuRow"/.test(mobile));
check("mobile drawer has no fixed footer nav", !/timiq-mobile-drawer-footer/.test(mobile));
check("logout a11y", /createPortal\(/.test(logoutDialog) && /returnFocusRef/.test(logoutButton));
check("logout menuRow appearance exists", /appearance === "menuRow"/.test(logoutButton));
check("public shell isolated", /uiClasses\.shellTopBar/.test(publicShell) && !/DesktopSidebar|color-utilitybar/.test(publicShell));
check("scrollbar css", /\.timiq-sidebar-scrollbar::-webkit-scrollbar/.test(globals));

console.log(`${passed} sidebar navigation checks passed`);
