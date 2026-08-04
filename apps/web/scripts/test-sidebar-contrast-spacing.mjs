/**
 * Focused checks for sidebar contrast (white/black only) and hierarchy spacing.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../src/", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

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

check("1. main section headers use white text", /font-semibold text-white/.test(navTree));
check("2. folder rows use black text", /font-medium text-black/.test(navTree));
check(
  "3. final page links use black text on white backgrounds",
  /font-normal text-black/.test(navTree) && /--color-sidebar-page-bg: #ffffff/.test(tokens),
);
check(
  "4. no sidebar navigation item uses blue text",
  !/text-\[#192f60\]/.test(navTree) &&
    !/text-\[#326da8\]/.test(navTree) &&
    !/text-\[var\(--color-brand/.test(navTree) &&
    !/navDrawerLinkActive/.test(navTree) &&
    /--color-sidebar-child-fg: #000000/.test(tokens) &&
    /navy: "text-white", light: "text-black"/.test(navIcons) &&
    !/text-\[#9cc8ff\]/.test(navIcons) &&
    !/text-\[#326da8\]/.test(navIcons),
);
check(
  "5. active page uses black text and a non-blue indicator",
  /border-l-black bg-\[var\(--color-sidebar-page-active-bg\)\] font-semibold text-black/.test(navTree) &&
    !/border-l-\[var\(--color-sidebar-active\)\]/.test(navTree) &&
    !/bg-\[#d5e1ee\]/.test(navTree) &&
    /--color-sidebar-page-active-bg: #f0f0f0/.test(tokens),
);
check(
  "6. hover state keeps black text",
  /hover:bg-\[var\(--color-sidebar-child-hover\)\] hover:text-black/.test(navTree) &&
    /--color-sidebar-child-hover: #eeeeee/.test(tokens),
);
check(
  "7. indentation increases consistently by hierarchy level",
  /SIDEBAR_SECTION_PAD_X = 12/.test(navTree) &&
    /SIDEBAR_FOLDER_PAD_X = 28/.test(navTree) &&
    /SIDEBAR_PAGE_PAD_X = 58/.test(navTree) &&
    /folderPadX\(depth\)/.test(navTree) &&
    /pagePadX\(depth\)/.test(navTree) &&
    SIDEBAR_SECTION_PAD_X_VALUE(navTree) < SIDEBAR_FOLDER_PAD_X_VALUE(navTree) &&
    SIDEBAR_FOLDER_PAD_X_VALUE(navTree) < SIDEBAR_PAGE_PAD_X_VALUE(navTree),
);
check(
  "8. row heights and icon alignment are consistent",
  /--layout-sidebar-row-height: 2\.375rem/.test(tokens) &&
    /--layout-sidebar-folder-row-height: 2\.25rem/.test(tokens) &&
    /--layout-sidebar-page-row-height: 2\.125rem/.test(tokens) &&
    /items-center gap-2/.test(navTree) &&
    /inline-flex h-\[18px\] w-\[18px\]/.test(navTree) &&
    /GUIDE_COLOR = "var\(--color-sidebar-guide\)"/.test(navTree) &&
    /--color-sidebar-guide: #c8c8c8/.test(tokens),
);
check("9. desktop sidebar remains usable", /<NavTree/.test(sidebar) && /desktop-sidebar-nav-scroll/.test(sidebar));
check(
  "10. mobile drawer remains usable",
  /<NavTree/.test(mobile) && /variant="drawer"/.test(mobile) && /timiq-mobile-drawer-scroll/.test(mobile),
);
check(
  "11. existing navigation and permissions remain unchanged",
  !/allowedRoles/.test(navTree) && /getMobileDrawerNavigationTree/.test(mobile),
);

function SIDEBAR_SECTION_PAD_X_VALUE(src) {
  return Number(/SIDEBAR_SECTION_PAD_X = (\d+)/.exec(src)?.[1] ?? 0);
}
function SIDEBAR_FOLDER_PAD_X_VALUE(src) {
  return Number(/SIDEBAR_FOLDER_PAD_X = (\d+)/.exec(src)?.[1] ?? 0);
}
function SIDEBAR_PAGE_PAD_X_VALUE(src) {
  return Number(/SIDEBAR_PAGE_PAD_X = (\d+)/.exec(src)?.[1] ?? 0);
}

console.log(`${passed} sidebar contrast/spacing checks passed`);
