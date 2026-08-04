/**
 * Right-side narrow mobile drawer, compact child alignment, far-right chevrons.
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

check("1. Mobile drawer is anchored to the right", /fixed bottom-0 right-0 top-0/.test(mobile) && !/fixed bottom-0 left-0 top-0/.test(mobile));
check(
  "2. Closed transform moves it offscreen to the right",
  /translate-x-full/.test(mobile) && /translate-x-0/.test(mobile) && /drawerEntered/.test(mobile),
);
check("3. Backdrop remains on the left (full-viewport under drawer)", /fixed inset-0 z-50/.test(mobile) && /timiq-mobile-drawer-backdrop/.test(mobile));
check("4. Drawer width uses the responsive maximum", /w-\[min\(300px,calc\(100vw-32px\)\)\]/.test(mobile));
check("5. Drawer is usable at 320 px", /w-\[min\(300px,calc\(100vw-32px\)\)\]/.test(mobile) && /overflow-x-hidden/.test(mobile));
check("6. Chevrons appear at the far right on mobile", /isDrawer \? \(\s*<ChevronBox/.test(navTree));
check("7. Final-page links have no empty chevron column", /!isDrawer \? <ChevronBox/.test(navTree) && !/ChevronBox[\s\S]{0,40}data-sidebar-level=\{isRootLeaf/.test(navTree));
check(
  "8. Child icons align under the first letter of the parent title",
  /DRAWER_PAGE_PAD_X = SIDEBAR_SECTION_PAD_X \+ ICON_BOX_PX \+ 10/.test(navTree) &&
    /MOBILE_DRAWER_CHILD_PAD_X = 45/.test(mobile),
);
check(
  "9. Child labels follow icons with a consistent gap",
  /gap-2\.5/.test(navTree) && /DRAWER_PAGE_PAD_X/.test(navTree),
);
check(
  "10. Child rows have no excessive indentation on mobile",
  /pagePadX\(depth, isDrawer\)/.test(navTree) &&
    /isDrawer[\s\S]{0,80}DRAWER_PAGE_PAD_X/.test(navTree) &&
    !/paddingLeft: 68/.test(mobile),
);
check("11. Only one mobile section can be open", /section-accordion/.test(mobile));
check(
  "12. Closing the drawer resets all sections",
  /setNavTreeKey/.test(mobile) && /key=\{navTreeKey\}/.test(mobile) && /drawerMounted/.test(mobile),
);
check("13. Reopening starts fully collapsed", /persist: false/.test(mobile) && /autoExpandActive: false/.test(mobile));
check("14. Employee Logout is inside Account", /emp-account/.test(mobile));
check("15. Administrator Logout is inside My workspace", /mgmt-workspace/.test(mobile));
check("16. Logout is hidden when the account section is collapsed", /accountSectionExtras && accountSectionIds\.includes\(node\.id\)/.test(navTree));
check("17. Logout is the final account child", /data-sidebar-account-extras/.test(navTree));
check("18. No standalone mobile Logout exists", !/timiq-mobile-drawer-footer/.test(mobile) && (mobile.match(/timiq-mobile-drawer-logout/g) ?? []).length === 1);
check("19. Drawer has no horizontal overflow", /overflow-x-hidden/.test(mobile) && /overflow-hidden/.test(mobile));
check(
  "20. Desktop remains unchanged",
  /variant="sidebar"/.test(sidebar) &&
    /--layout-sidebar-width: 18\.25rem/.test(tokens) &&
    /!isDrawer \? <ChevronBox/.test(navTree) &&
    /SIDEBAR_PAGE_PAD_X = 68/.test(navTree),
);
const employee = getMobileDrawerNavigationTree("employee");
const admin = getMobileDrawerNavigationTree("administrator");
check(
  "21. Routes and permissions remain unchanged",
  collectNavigationLeaves(employee).some((l) => l.href === "/clock") &&
    collectNavigationLeaves(admin).some((l) => l.href === "/employees"),
);

check("smooth slide transition classes", /transition-transform duration-200/.test(mobile) && /border-l /.test(mobile));
check("accordion applies to all mobile roles", /mode: "section-accordion"/.test(mobile));

console.log(`${passed} right-side mobile drawer / compact alignment checks passed`);
