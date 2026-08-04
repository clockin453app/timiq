/**
 * Focused checks: mobile Work (and peer) section headers stay visible when collapsed.
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
  getMobileDrawerNavigationTree,
  omitMobileDrawerFooterLeaves,
  collectNavigationLeaves,
} = loadModule("config/navigation.ts");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

const navTree = read("components/layout/nav-tree.tsx");
const mobile = read("components/layout/mobile-header.tsx");
const sidebar = read("components/layout/desktop-sidebar.tsx");

const employeeTree = omitMobileDrawerFooterLeaves(getMobileDrawerNavigationTree("employee"));
const sectionIds = employeeTree.map((n) => n.id);
const work = employeeTree.find((n) => n.id === "emp-work");
const pay = employeeTree.find((n) => n.id === "emp-pay");
const account = employeeTree.find((n) => n.id === "emp-account");
const workIndex = employeeTree.findIndex((n) => n.id === "emp-work");
const accountIndex = employeeTree.findIndex((n) => n.id === "emp-account");

check("1. Work header markup is outside the open children panel", (() => {
  const headerIdx = navTree.indexOf('data-sidebar-section-header={isSectionFolder ? node.id : undefined}');
  const openPanelIdx = navTree.indexOf("{open ? (");
  const panelAttrIdx = navTree.indexOf("data-sidebar-section-panel=");
  return headerIdx > 0 && openPanelIdx > headerIdx && panelAttrIdx > openPanelIdx;
})());

check("2. Work header remains rendered while collapsed (no hover:bg-white/10)", (() => {
  return (
    /bg-\[var\(--color-sidebar-bg\)\] font-semibold text-white/.test(navTree) &&
    /hover:bg-\[var\(--color-sidebar-active\)\]/.test(navTree) &&
    !/:\s*"hover:bg-white\/10"/.test(navTree) &&
    !/\n\s*"hover:bg-white\/10"/.test(navTree)
  );
})());

check("3. Work children are only in the open panel", /\{open \? \(/.test(navTree) && /data-sidebar-section-panel=/.test(navTree));

check("4. Work children return when expanded (panel gated on open)", /\{open \? \([\s\S]*data-sidebar-section-panel=/.test(navTree));

check(
  "5. Account follows directly after Work in employee drawer tree",
  workIndex >= 0 && accountIndex === workIndex + 1,
);

check(
  "6. No empty placeholder / display:none / zero-height collapse hacks",
  !/display:\s*none/.test(navTree) &&
    !/h-0\b/.test(navTree) &&
    !/invisible/.test(navTree) &&
    !/fixed blank|min-h-\[0\]/.test(navTree),
);

check(
  "7. Pay, Work and Account headers remain independently visible",
  sectionIds.includes("emp-pay") &&
    sectionIds.includes("emp-work") &&
    sectionIds.includes("emp-account") &&
    Boolean(pay?.children?.length) &&
    Boolean(work?.children?.length) &&
    Boolean(account?.children?.length),
);

check(
  "8. Chevron state matches aria-expanded",
  /aria-expanded=\{open\}/.test(navTree) &&
    /data-sidebar-chevron=\{open \? "expanded" : "collapsed"\}/.test(navTree) &&
    /open \? ChevronDown : ChevronRight/.test(navTree),
);

check(
  "9. Complete header row is tappable",
  /onClick=\{\(\) => toggleExpanded\(node\.id\)\}/.test(navTree) &&
    /type="button"/.test(navTree),
);

check(
  "10. Mobile drawer remains usable at 320 px",
  /w-\[min\(100vw-1\.25rem,360px\)\]/.test(mobile) &&
    /overflow-x-hidden/.test(mobile) &&
    /variant="drawer"/.test(mobile),
);

check("11. Desktop navigation remains unchanged (still uses NavTree)", /<NavTree/.test(sidebar));

check(
  "12. Routes and permissions remain unchanged",
  !/allowedRoles/.test(navTree) &&
    collectNavigationLeaves([work]).some((l) => l.href === "/site-progress") &&
    collectNavigationLeaves([work]).some((l) => l.href === "/forms") &&
    collectNavigationLeaves([work]).some((l) => l.href === "/toolbox-talks") &&
    collectNavigationLeaves([work]).some((l) => l.href === "/rams"),
);

check("Work section label", work?.label === "Work");
check("Work has four children when expanded in data", work?.children?.length === 4);
check(
  "section navy hover never translucent white class",
  !/\n\s*"hover:bg-white\/10"/.test(navTree) && !/:\s*"hover:bg-white\/10"/.test(navTree),
);
check("mobile onNavigate closes drawer", /onNavigate=\{\(\) => closeMenu\(false\)\}/.test(mobile));

console.log(`${passed} mobile Work section collapse checks passed`);
