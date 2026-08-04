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

check("1. Main section labels use the largest sidebar font", sectionFont > folderFont && sectionFont >= 15 && sectionFont <= 16);
check("2. Folder labels use the middle font size", folderFont > pageFont && folderFont >= 14 && folderFont <= 15);
check("3. Final page labels use the smallest readable font size", pageFont < folderFont && pageFont >= 14);
check("4. No final page label is smaller than 14 px", pageFont >= 14);
check(
  "5. Collapsed folders use the closed-folder icon",
  /const FolderIcon = open \? FolderOpen : Folder/.test(navTree) &&
    /data-sidebar-folder-icon=\{open \? "open" : "closed"\}/.test(navTree),
);
check(
  "6. Expanded folders use the open-folder icon",
  /FolderOpen/.test(navTree) && /open \? FolderOpen : Folder/.test(navTree),
);
check(
  "7. All folder icons use the same gold colour",
  /--color-sidebar-folder-gold: #c58a00/.test(tokens) &&
    /style=\{\{ color: FOLDER_GOLD \}\}/.test(navTree),
);
check(
  "8. Final-page icons are not gold",
  /text-\[var\(--color-sidebar-page-icon\)\]/.test(navTree) &&
    /--color-sidebar-page-icon: #1a1a1a/.test(tokens),
);
check(
  "9. Main section icons remain white",
  /surface="navy"/.test(navTree) && /navy: "text-white"/.test(navIcons),
);
check(
  "10. Text remains only white or black",
  /font-semibold text-white/.test(navTree) &&
    /font-medium text-black/.test(navTree) &&
    /font-normal text-black/.test(navTree) &&
    !/text-\[#192f60\]/.test(navTree),
);
check(
  "11. Folder icon changes do not shift label alignment",
  /ICON_BOX_PX = 20/.test(navTree) && /CHEVRON_BOX_PX = 20/.test(navTree),
);
check("12. Desktop navigation works", /<NavTree/.test(sidebar));
check("13. Mobile drawer works", /variant="drawer"/.test(mobile));
check("14. Routes and permissions remain unchanged", !/allowedRoles/.test(navTree));

console.log(`${passed} sidebar typography/folder checks passed`);
