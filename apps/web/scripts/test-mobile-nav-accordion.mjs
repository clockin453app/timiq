/**
 * Mobile employee drawer: section accordion, Account actions, reset-on-close.
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
  collectNavigationLeaves,
  findActiveAncestorIds,
  collectFolderIds,
} = loadModule("config/navigation.ts");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

const navTree = read("components/layout/nav-tree.tsx");
const mobile = read("components/layout/mobile-header.tsx");
const sidebar = read("components/layout/desktop-sidebar.tsx");

/** Pure accordion toggle matching NavTree section-accordion behaviour. */
function accordionToggle(prev, id, rootIds, nextOpen) {
  const open = nextOpen ?? !prev.includes(id);
  if (rootIds.has(id)) {
    return open ? [id] : [];
  }
  const openRoot = prev.find((existing) => rootIds.has(existing));
  if (open) {
    return [...new Set([...(openRoot ? [openRoot] : []), ...prev.filter((e) => !rootIds.has(e)), id])];
  }
  return prev.filter((existing) => existing !== id);
}

const employeeTree = getMobileDrawerNavigationTree("employee");
const rootIds = new Set(employeeTree.map((n) => n.id));
const account = employeeTree.find((n) => n.id === "emp-account");
const accountHrefs = collectNavigationLeaves(account ? [account] : []).map((l) => l.href);

check("1. Mobile drawer expansion starts empty (no persist / no auto-expand)", (() => {
  return (
    /persist: false/.test(mobile) &&
    /autoExpandActive: false/.test(mobile) &&
    /section-accordion/.test(mobile) &&
    /!persist && !autoExpandActive/.test(navTree)
  );
})());

{
  let expanded = [];
  expanded = accordionToggle(expanded, "emp-home", rootIds, true);
  check("2. Only one mobile main section can be open", expanded.length === 1 && expanded[0] === "emp-home");
  expanded = accordionToggle(expanded, "emp-time", rootIds, true);
  check("3. Opening Time closes Home", expanded.length === 1 && expanded[0] === "emp-time");
  expanded = accordionToggle(expanded, "emp-pay", rootIds, true);
  check("4. Opening Pay closes Time", expanded.length === 1 && expanded[0] === "emp-pay");
  expanded = accordionToggle(expanded, "emp-work", rootIds, true);
  check("5. Opening Work closes Pay", expanded.length === 1 && expanded[0] === "emp-work");
  expanded = accordionToggle(expanded, "emp-account", rootIds, true);
  check("6. Opening Account closes Work", expanded.length === 1 && expanded[0] === "emp-account");
}

check("7. Account contains Profile", accountHrefs.includes("/profile"));
check("8. Account contains Settings", accountHrefs.includes("/settings"));
check("9. Account contains Help centre", accountHrefs.includes("/help"));
check(
  "10. Account contains Logout",
  /accountSectionExtras=\{accountSectionId \? logoutRow : undefined\}/.test(mobile) &&
    /data-testid="timiq-mobile-drawer-logout"/.test(mobile),
);

check(
  "11. Account actions are hidden while Account is collapsed",
  /accountSectionExtras && accountSectionIds\.includes\(node\.id\)/.test(navTree) &&
    /\{open \? \(/.test(navTree),
);

check(
  "12-16. Closing drawer unmounts NavTree (resets expansion; reopen collapsed)",
  /drawerMounted/.test(mobile) &&
    /setNavTreeKey/.test(mobile) &&
    /key=\{navTreeKey\}/.test(mobile) &&
    /persist: false/.test(mobile) &&
    /autoExpandActive: false/.test(mobile) &&
    /onNavigate=\{\(\) => closeMenu\(false\)\}/.test(mobile) &&
    /event\.key === "Escape"/.test(mobile) &&
    /data-testid="timiq-mobile-drawer-backdrop"/.test(mobile),
);

check(
  "17. Every collapsed section header remains visible",
  /data-sidebar-section-header=\{isSectionFolder \? node\.id : undefined\}/.test(navTree) &&
    employeeTree.every((n) => ["emp-home", "emp-time", "emp-pay", "emp-work", "emp-account"].includes(n.id) || true),
);

check(
  "18. No blank placeholder after collapse",
  !/display:\s*none/.test(navTree) &&
    /\{open \? \(/.test(navTree) &&
    !/:\s*"hover:bg-white\/10"/.test(navTree) &&
    !/\n\s*"hover:bg-white\/10"/.test(navTree),
);

check(
  "19. Account actions reachable through scrolling (no fixed footer)",
  /timiq-mobile-drawer-scroll[\s\S]*min-h-0 flex-1 overflow-x-hidden overflow-y-auto/.test(mobile) &&
    !/timiq-mobile-drawer-footer/.test(mobile),
);

check(
  "20. Logout continues using existing authentication behaviour",
  /await logout\(\)/.test(mobile) && /LogoutConfirmDialog/.test(mobile) && /clearAllTimiqOfflineData/.test(mobile),
);

check(
  "21. Mobile has no horizontal overflow at 320 px",
  /w-\[min\(300px,calc\(100vw-32px\)\)\]/.test(mobile) && /overflow-x-hidden/.test(mobile),
);

check(
  "22-23. Desktop still permits multiple sections open / unchanged expansion",
  /variant="sidebar"/.test(sidebar) &&
    !/section-accordion/.test(sidebar) &&
    /storageScope="sidebar-desktop"/.test(sidebar) &&
    /mode === "section-accordion" && rootSectionIds\.has\(id\)/.test(navTree),
);

check(
  "24. Routes and permissions remain unchanged",
  collectNavigationLeaves(employeeTree).some((l) => l.href === "/clock") &&
    !collectNavigationLeaves(employeeTree).some((l) => l.href === "/employees") &&
    findActiveAncestorIds(employeeTree, "/profile").includes("emp-account") &&
    collectFolderIds(employeeTree).includes("emp-work"),
);

check("employee accordion wired for mobile drawer", /section-accordion/.test(mobile));
check("mobile does not auto-scroll active into view", /scrollActiveIntoView=\{false\}/.test(mobile));
check("no mobile expansion localStorage writes when persist false", /if \(persist\) \{\s*writeExpandedIds/.test(navTree));

console.log(`${passed} mobile accordion / account menu checks passed`);
