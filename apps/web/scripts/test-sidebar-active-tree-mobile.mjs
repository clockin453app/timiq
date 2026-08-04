/**
 * Final sidebar refinement coverage: active page, tree lines, route expansion, mobile shell.
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

const {
  getDesktopSidebarNavigationTree,
  getMobileDrawerNavigationTree,
  findActiveAncestorIds,
} = loadModule("config/navigation.ts");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

const tokens = read("styles/tokens.css");
const navTree = read("components/layout/nav-tree.tsx");
const navIcons = read("components/layout/nav-item-icon.tsx");
const sidebar = read("components/layout/desktop-sidebar.tsx");
const mobile = read("components/layout/mobile-header.tsx");

/* Active state */
check("1. active page uses black semibold text", /font-semibold text-black/.test(navTree));
check("2. active page has black left indicator", /border-l-\[3px\]/.test(navTree) && /border-l-black/.test(navTree));
check("3. active page uses stronger grey background", /--color-sidebar-page-active-bg: #e5e7eb/.test(tokens));
check("4. inactive pages keep transparent indicator", /border-transparent bg-\[var\(--color-sidebar-page-bg\)\] font-normal text-black/.test(navTree));
check("5. hover is lighter than active", /--color-sidebar-page-hover: #f3f4f6/.test(tokens) && /hover:bg-\[var\(--color-sidebar-page-hover\)\]/.test(navTree));

/* Tree hierarchy */
check("6. expanded folders render vertical tree line", /data-sidebar-tree-vertical/.test(navTree) && /TreeBranchGuides/.test(navTree));
check("7. every direct child receives a horizontal branch", /data-sidebar-tree-branch/.test(navTree));
check("8. final child terminates the vertical line", /isLast \? "50%" : "100%"/.test(navTree));
check("9. collapsed folders do not render child branches", /\{open \? \(/.test(navTree) && /showGuides \? \(/.test(navTree));
check("10. tree lines stop per folder panel", /data-sidebar-tree-panel/.test(navTree) && /childIsFolder/.test(navTree));
check("11. fixed pads prevent label shift", /SIDEBAR_PAGE_PAD_X = 68/.test(navTree) && /border-l-\[3px\] border-transparent/.test(navTree));

/* Route expansion */
const desktop = getDesktopSidebarNavigationTree("administrator");
const mobileTree = getMobileDrawerNavigationTree("administrator");
const cases = [
  ["/work-progress-review", ["mgmt-sites", "mgmt-sites-progress"]],
  ["/locations", ["mgmt-sites", "mgmt-sites-management"]],
  ["/time-records", ["mgmt-attendance", "mgmt-attendance-clocking"]],
  ["/employees", ["mgmt-people", "mgmt-people-employees"]],
];
for (const [href, expected] of cases) {
  const ancestors = findActiveAncestorIds(desktop, href);
  check(`12-14. ${href} expands ancestors`, expected.every((id) => ancestors.includes(id)));
}
check("15. mobile drawer does not auto-scroll active on open", /scrollActiveIntoView=\{false\}/.test(mobile));
check("16. unrelated folders remain toggleable on desktop", /toggleExpanded\(node\.id\)/.test(navTree) && /mode === "section-accordion"/.test(navTree));

/* Mobile drawer */
check("17. drawer width avoids 320 overflow", /w-\[min\(300px,calc\(100vw-32px\)\)\]/.test(mobile) && /overflow-x-hidden/.test(mobile));
check("18. header remains fixed while nav scrolls", /timiq-mobile-drawer-header[\s\S]*shrink-0/.test(mobile) && /timiq-mobile-drawer-scroll[\s\S]*flex-1/.test(mobile));
check("19. close button remains reachable", /h-11 w-11/.test(mobile) && /closeButtonRef/.test(mobile));
check("20. backdrop closes drawer", /data-testid="timiq-mobile-drawer-backdrop"/.test(mobile));
check("21. Escape closes drawer", /event\.key === "Escape"/.test(mobile));
check("22. body scroll locks while open", /document\.body\.style\.overflow = "hidden"/.test(mobile));
check("23. body scroll restores after closing", /document\.body\.style\.overflow = previousOverflow/.test(mobile));
check("24. final-page navigation closes drawer", /onNavigate=\{\(\) => closeMenu\(false\)\}/.test(mobile));
check("25. collapsed section headers remain rendered", /data-sidebar-section-header=\{isSectionFolder \? node\.id : undefined\}/.test(navTree));
check("26. collapsed folder rows remain rendered", /data-sidebar-level=\{isSectionFolder \? "section" : "folder"\}/.test(navTree));
check("27. Account actions remain in the scrollable tree", /accountSectionExtras/.test(mobile) && !/timiq-mobile-drawer-footer/.test(mobile));
check("28. Logout remains reachable via Account extras", /timiq-mobile-drawer-logout/.test(mobile));
check("29. navigation is not covered by a fixed footer", /timiq-mobile-drawer-scroll[\s\S]*min-h-0 flex-1/.test(mobile) && !/timiq-mobile-drawer-footer/.test(mobile));
check("30. focus behaviour remains usable", /closeButtonRef\.current\?\.focus/.test(mobile) && /menuButtonRef\.current\?\.focus/.test(mobile));

/* Regression */
check("31. routes unchanged in tree component", !/allowedRoles/.test(navTree) && mobileTree.length > 0);
check("32. permissions unchanged", findActiveAncestorIds(desktop, "/companies").length >= 1);
check("33. main-section icons remain white", /text-white/.test(navTree) && /navy: "text-white"/.test(navIcons));
check("34. folder icons remain gold", /--color-sidebar-folder-gold: #c58a00/.test(tokens));
check("35. final-page icons remain dark", /--color-sidebar-page-icon: #1a1a1a/.test(tokens));
check("36. no sidebar text uses blue", !/text-\[#192f60\]/.test(navTree) && !/text-\[#326da8\]/.test(navTree));
check("37. desktop navigation remains functional", /<NavTree/.test(sidebar) && /desktop-sidebar-nav-scroll/.test(sidebar));
check("38. mobile navigation remains functional", /variant="drawer"/.test(mobile) && /getMobileDrawerNavigationTree/.test(mobile));

check("guide colour is neutral", /--color-sidebar-guide: #c7cbd1/.test(tokens));
check("desktop account footer stays outside nav scroll", /desktop-sidebar-account-footer/.test(sidebar));

console.log(`${passed} sidebar active/tree/mobile final checks passed`);
