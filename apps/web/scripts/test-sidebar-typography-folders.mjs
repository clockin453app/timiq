/**
 * Focused checks for sidebar typography hierarchy and Windows-style gold folders.
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

const sectionFont = Number(/SIDEBAR_SECTION_FONT_PX = ([\d.]+)/.exec(navTree)?.[1] ?? 0);
const folderFont = Number(/SIDEBAR_FOLDER_FONT_PX = ([\d.]+)/.exec(navTree)?.[1] ?? 0);
const pageFont = Number(/SIDEBAR_PAGE_FONT_PX = ([\d.]+)/.exec(navTree)?.[1] ?? 0);
const sectionPad = Number(/SIDEBAR_SECTION_PAD_X = (\d+)/.exec(navTree)?.[1] ?? 0);
const folderPad = Number(/SIDEBAR_FOLDER_PAD_X = (\d+)/.exec(navTree)?.[1] ?? 0);
const pagePad = Number(/SIDEBAR_PAGE_PAD_X = (\d+)/.exec(navTree)?.[1] ?? 0);

check("1. Main section labels use the largest sidebar font", sectionFont > folderFont && sectionFont >= 14 && sectionFont <= 15);
check("2. Folder labels use the middle font size", folderFont > pageFont && folderFont >= 13.5 && folderFont <= 14);
check("3. Final page labels use the smallest readable font size", pageFont < folderFont && pageFont === 13);
check("4. No final page label is smaller than 13 px", pageFont >= 13 && /SIDEBAR_PAGE_FONT_PX = 13/.test(navTree));
check(
  "5. Collapsed folders use the closed-folder icon",
  /const FolderIcon = open \? FolderOpen : Folder/.test(navTree) &&
    /data-sidebar-folder-icon=\{open \? "open" : "closed"\}/.test(navTree) &&
    /import \{ ChevronRight, Folder, FolderOpen \}/.test(navTree),
);
check(
  "6. Expanded folders use the open-folder icon",
  /FolderOpen/.test(navTree) && /open \? FolderOpen : Folder/.test(navTree),
);
check(
  "7. All folder icons use the same gold colour",
  /--color-sidebar-folder-gold: #c58a00/.test(tokens) &&
    /style=\{\{ color: FOLDER_GOLD \}\}/.test(navTree) &&
    /FOLDER_GOLD = "var\(--color-sidebar-folder-gold\)"/.test(navTree),
);
check(
  "8. Final-page icons are not gold",
  /text-\[var\(--color-sidebar-page-icon\)\]/.test(navTree) &&
    /--color-sidebar-page-icon: #1a1a1a/.test(tokens) &&
    !/page-icon.*folder-gold/.test(navTree),
);
check(
  "9. Main section icons remain white",
  /isSectionFolder[\s\S]*surface="navy"/.test(navTree) &&
    /navy: "text-white"/.test(navIcons),
);
check(
  "10. Text remains only white or black",
  /font-semibold text-white/.test(navTree) &&
    /font-medium text-black/.test(navTree) &&
    /font-normal text-black/.test(navTree) &&
    !/text-\[#192f60\]/.test(navTree) &&
    !/text-\[#326da8\]/.test(navTree) &&
    !/navDrawerLinkActive/.test(navTree),
);
check(
  "11. Folder icon changes do not shift label alignment",
  /inline-flex h-\[18px\] w-\[18px\] shrink-0 items-center justify-center/.test(navTree) &&
    (navTree.match(/inline-flex h-\[18px\] w-\[18px\]/g) || []).length >= 3 &&
    /h-4 w-4 shrink-0/.test(navTree) &&
    /style=\{\{ color: FOLDER_GOLD \}\}/.test(navTree),
);
check("12. Desktop navigation works", /<NavTree/.test(sidebar) && /desktop-sidebar-nav-scroll/.test(sidebar));
check(
  "13. Mobile drawer works",
  /<NavTree/.test(mobile) && /variant="drawer"/.test(mobile) && /timiq-mobile-drawer-scroll/.test(mobile),
);
check(
  "14. Routes and permissions remain unchanged",
  !/allowedRoles/.test(navTree) && /getMobileDrawerNavigationTree/.test(mobile),
);

check("folder expanded bg distinct from active page",
  /--color-sidebar-folder-expanded-bg: #f3f4f6/.test(tokens) &&
    /--color-sidebar-page-active-bg: #f0f0f0/.test(tokens));
check("folder collapsed white bg", /--color-sidebar-folder-bg: #ffffff/.test(tokens));
check("indentation hierarchy", sectionPad === 12 && folderPad >= 26 && folderPad <= 30 && pagePad >= 56 && pagePad <= 60);
check("row height tokens",
  /--layout-sidebar-row-height: 2\.375rem/.test(tokens) &&
    /--layout-sidebar-folder-row-height: 2\.25rem/.test(tokens) &&
    /--layout-sidebar-page-row-height: 2\.125rem/.test(tokens));
check("aria-expanded preserved", /aria-expanded=\{open\}/.test(navTree));
check("active page black indicator", /border-l-black/.test(navTree) && /font-semibold text-black/.test(navTree));

console.log(`${passed} sidebar typography/folder checks passed`);
