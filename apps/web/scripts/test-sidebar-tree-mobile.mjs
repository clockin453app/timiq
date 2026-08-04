/**
 * Focused checks for sidebar typography, tree guides, chevrons, contrast, and mobile drawer.
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
const guideX = Number(/SIDEBAR_TREE_GUIDE_X = (\d+)/.exec(navTree)?.[1] ?? 0);
const chevronBox = Number(/CHEVRON_BOX_PX = (\d+)/.exec(navTree)?.[1] ?? 0);

check("1. Main section text uses the largest size", sectionFont > folderFont && sectionFont >= 15 && sectionFont <= 16);
check("2. Folder text uses the middle size", folderFont > pageFont && folderFont >= 14 && folderFont <= 15);
check("3. Final page text is at least 14 px", pageFont >= 14 && pageFont === 14);
check(
  "4. Expanded folders show tree branch lines",
  /TreeBranchGuides/.test(navTree) &&
    /data-sidebar-tree-branch/.test(navTree) &&
    /data-sidebar-tree-vertical/.test(navTree) &&
    /showGuides/.test(navTree),
);
check(
  "5. Last-child tree lines terminate correctly",
  /data-sidebar-tree-vertical=\{isLast \? "last" : "continue"\}/.test(navTree) &&
    /height: isLast \? "50%" : "100%"/.test(navTree),
);
check(
  "6. Collapsed folders use closed-folder icons",
  /const FolderIcon = open \? FolderOpen : Folder/.test(navTree) &&
    /data-sidebar-folder-icon=\{open \? "open" : "closed"\}/.test(navTree),
);
check(
  "7. Expanded folders use open-folder icons",
  /FolderOpen/.test(navTree) && /open \? FolderOpen : Folder/.test(navTree),
);
check(
  "8. Folder icons remain gold",
  /--color-sidebar-folder-gold: #c58a00/.test(tokens) &&
    /style=\{\{ color: FOLDER_GOLD \}\}/.test(navTree),
);
check(
  "9. Main chevrons are white",
  /tone=\{isSectionFolder \? "white" : "black"\}/.test(navTree) &&
    /tone === "white" \? "text-white" : "text-black"/.test(navTree),
);
check(
  "10. Folder chevrons are black",
  /tone=\{isSectionFolder \? "white" : "black"\}/.test(navTree) &&
    /text-black/.test(navTree),
);
check(
  "11. Chevron containers have consistent dimensions",
  chevronBox >= 20 &&
    /CHEVRON_BOX_PX = 20/.test(navTree) &&
    /ChevronDown/.test(navTree) &&
    /ChevronRight/.test(navTree) &&
    /open \? ChevronDown : ChevronRight/.test(navTree),
);
check(
  "12. Active pages use black text and a black indicator",
  /border-l-black bg-\[var\(--color-sidebar-page-active-bg\)\] font-semibold text-black/.test(navTree) &&
    /--color-sidebar-page-active-bg: #e5e7eb/.test(tokens),
);
check(
  "13. No navigation text is blue",
  !/text-\[#192f60\]/.test(navTree) &&
    !/text-\[#326da8\]/.test(navTree) &&
    !/navDrawerLinkActive/.test(navTree) &&
    !/navDrawerLinkActive/.test(mobile) &&
    /font-semibold text-white/.test(navTree) &&
    /font-medium text-black/.test(navTree) &&
    /font-normal text-black/.test(navTree),
);
check(
  "14. Mobile final-page taps close the drawer",
  /onNavigate=\{\(\) => closeMenu\(false\)\}/.test(mobile),
);
check(
  "15. Mobile backdrop and Escape close the drawer",
  /data-testid="timiq-mobile-drawer-backdrop"/.test(mobile) &&
    /event\.key === "Escape"/.test(mobile) &&
    /onClick=\{\(\) => closeMenu\(\)\}/.test(mobile),
);
check(
  "16. Mobile body scroll locking works",
  /document\.body\.style\.overflow = "hidden"/.test(mobile) &&
    /overscrollBehavior = "none"/.test(mobile) &&
    /document\.body\.style\.overflow = previousOverflow/.test(mobile),
);
check(
  "17. Navigation and footer remain independently reachable",
  /timiq-mobile-drawer-scroll[\s\S]*min-h-0 flex-1 overflow-x-hidden overflow-y-auto/.test(mobile) &&
    /appearance="menuRow"/.test(mobile) &&
    /href="\/profile"/.test(mobile) &&
    !/timiq-mobile-drawer-footer/.test(mobile),
);
check(
  "18. No horizontal overflow occurs at 320 px",
  /w-\[min\(100vw-1\.25rem,360px\)\]/.test(mobile) &&
    !/min-w-\[min\(100%,300px\)\]/.test(mobile) &&
    /overflow-x-hidden/.test(mobile),
);
check(
  "19. Existing routes and permissions are unchanged",
  !/allowedRoles/.test(navTree) && /getMobileDrawerNavigationTree/.test(mobile),
);

check("tree geometry", folderPad >= 30 && folderPad <= 34 && guideX >= 44 && guideX <= 48 && pagePad >= 66 && pagePad <= 70);
check("section pad", sectionPad === 12);
check("desktop sidebar usable", /<NavTree/.test(sidebar));
check("mobile drawer usable", /variant="drawer"/.test(mobile) && /min-h-11/.test(navTree));
check("icons navy white / light black", /navy: "text-white", light: "text-black"/.test(navIcons));
check("Enter Space keyboard on folders", /event\.key === "Enter" \|\| event\.key === " "/.test(navTree));
check("aria-expanded preserved", /aria-expanded=\{open\}/.test(navTree));
check("tree guides always rendered", /showGuides\s+showIcons=\{showIcons\}/.test(navTree));

console.log(`${passed} sidebar tree/contrast/mobile checks passed`);
