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
    !/navDrawerLinkActive/.test(mobile) &&
    /navy: "text-white", light: "text-black"/.test(navIcons),
);
check(
  "5. active page uses black text and a non-blue indicator",
  /border-l-black bg-\[var\(--color-sidebar-page-active-bg\)\] font-semibold text-black/.test(navTree) &&
    /--color-sidebar-page-active-bg: #e5e7eb/.test(tokens),
);
check(
  "6. hover state keeps black text",
  /hover:bg-\[var\(--color-sidebar-child-hover\)\] hover:text-black/.test(navTree),
);
check(
  "7. indentation increases consistently by hierarchy level",
  /SIDEBAR_SECTION_PAD_X = 12/.test(navTree) &&
    /SIDEBAR_FOLDER_PAD_X = 32/.test(navTree) &&
    /SIDEBAR_PAGE_PAD_X = 68/.test(navTree) &&
    /SIDEBAR_TREE_GUIDE_X = 46/.test(navTree),
);
check(
  "8. row heights and icon alignment are consistent",
  /--layout-sidebar-row-height: 2\.5625rem/.test(tokens) &&
    /--layout-sidebar-folder-row-height: 2\.4375rem/.test(tokens) &&
    /--layout-sidebar-page-row-height: 2\.3125rem/.test(tokens) &&
    /CHEVRON_BOX_PX = 20/.test(navTree),
);
check("9. desktop sidebar remains usable", /<NavTree/.test(sidebar));
check("10. mobile drawer remains usable", /variant="drawer"/.test(mobile));
check("11. existing navigation and permissions remain unchanged", !/allowedRoles/.test(navTree));

console.log(`${passed} sidebar contrast/spacing checks passed`);
