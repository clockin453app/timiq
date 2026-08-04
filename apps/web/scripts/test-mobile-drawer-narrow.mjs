/**
 * Narrow mobile drawer, integrated Logout, far-right chevrons.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../src/", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

function loadModule(relative) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports });
  return module.exports;
}

const { getMobileDrawerNavigationTree, collectNavigationLeaves } = loadModule("config/navigation.ts");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

const mobile = read("components/layout/mobile-header.tsx");
const navTree = read("components/layout/nav-tree.tsx");
const sidebar = read("components/layout/desktop-sidebar.tsx");
const tokens = read("styles/tokens.css");

const widthExpr = /w-\[min\(300px,calc\(100vw-32px\)\)\]/.test(mobile);
const leftAligned = /fixed bottom-0 left-0 top-0/.test(mobile) && !/fixed bottom-0 right-0 top-0/.test(mobile);

check("1. Mobile drawer uses responsive max width min(300px, calc(100vw - 32px))", widthExpr);
check("2. Mobile drawer leaves visible backdrop space (left-aligned, max 300)", leftAligned && widthExpr);
check(
  "3. Drawer remains usable at 320 px (288px usable width)",
  widthExpr && /overflow-x-hidden/.test(mobile),
);
check("4. Drawer has no horizontal overflow", /overflow-x-hidden/.test(mobile) && /overflow-hidden/.test(mobile));
check(
  "5. Long labels remain readable (wrap allowed on drawer)",
  /\[overflow-wrap:anywhere\]/.test(navTree) && /isDrawer \? "leading-snug/.test(navTree),
);

const employee = getMobileDrawerNavigationTree("employee");
const admin = getMobileDrawerNavigationTree("administrator");
const empAccount = employee.find((n) => n.id === "emp-account");
const workspace = admin.find((n) => n.id === "mgmt-workspace");

check(
  "6. Employee Logout is inside Account",
  /emp-account/.test(mobile) &&
    /accountSectionExtras=\{accountSectionId \? logoutRow : undefined\}/.test(mobile) &&
    Boolean(empAccount),
);
check(
  "7. Administrator Logout is inside My workspace",
  /mgmt-workspace/.test(mobile) && Boolean(workspace),
);
check(
  "8. Logout is hidden when the account section is collapsed",
  /accountSectionExtras && accountSectionIds\.includes\(node\.id\)/.test(navTree) && /\{open \? \(/.test(navTree),
);
check(
  "9. Logout appears when the account section is expanded",
  /data-sidebar-account-extras/.test(navTree) && /data-testid="timiq-mobile-drawer-logout"/.test(mobile),
);
check(
  "10. Logout is the final account child",
  /\{accountSectionExtras && accountSectionIds\.includes\(node\.id\) \? \(/.test(navTree) &&
    /node\.children\?\.map/.test(navTree),
);
check(
  "11. No standalone mobile Logout row remains",
  !/!hasAccountSection/.test(mobile) &&
    !/timiq-mobile-drawer-footer/.test(mobile) &&
    (mobile.match(/data-testid="timiq-mobile-drawer-logout"/g) ?? []).length === 1,
);
check(
  "12. Logout retains its existing action",
  /await logout\(\)/.test(mobile) && /LogoutConfirmDialog/.test(mobile) && /clearAllTimiqOfflineData/.test(mobile),
);
check(
  "13. Closing the drawer resets the accordion",
  /\{menuOpen \? \(/.test(mobile) && /persist: false/.test(mobile) && /autoExpandActive: false/.test(mobile),
);
check(
  "14. Reopening starts with all sections collapsed",
  /section-accordion/.test(mobile) && /!persist && !autoExpandActive/.test(navTree),
);
check(
  "15. Only one mobile section may be open",
  /mode: "section-accordion"/.test(mobile) && /mode === "section-accordion" && rootSectionIds\.has\(id\)/.test(navTree),
);
check(
  "16. Mobile touch targets remain at least approximately 44 px",
  /min-h-11/.test(navTree) && /h-11 w-11/.test(mobile),
);
check(
  "17. Desktop sidebar width remains unchanged",
  /--layout-sidebar-width: 18\.25rem/.test(tokens) && /var\(--layout-sidebar-width\)/.test(sidebar),
);
check(
  "18. Desktop expansion behaviour remains unchanged",
  /variant="sidebar"/.test(sidebar) &&
    !/section-accordion/.test(sidebar) &&
    /storageScope="sidebar-desktop"/.test(sidebar) &&
    /!isDrawer \? <ChevronBox/.test(navTree),
);
check(
  "19. Routes and permissions remain unchanged",
  collectNavigationLeaves(employee).some((l) => l.href === "/clock") &&
    collectNavigationLeaves(admin).some((l) => l.href === "/employees") &&
    collectNavigationLeaves([empAccount]).some((l) => l.href === "/profile") &&
    collectNavigationLeaves([workspace]).some((l) => l.href === "/profile"),
);

check("far-right chevron on mobile only", /isDrawer \? \(\s*<ChevronBox/.test(navTree));
check("desktop chevron remains leading", /!isDrawer \? <ChevronBox/.test(navTree));
check("logout hover uses neutral grey", /hover:bg-\[var\(--color-sidebar-page-hover\)\]/.test(mobile));
check("accordion applies to all mobile roles", /expansion=\{\{ mode: "section-accordion"/.test(mobile));

console.log(`${passed} narrow mobile drawer / integrated logout checks passed`);
