/**
 * Mobile header profile avatar: order, photo source, drawer account expansion.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

const header = read("src/components/layout/mobile-header.tsx");
const avatar = read("src/components/layout/mobile-header-avatar.tsx");
const drawerState = read("src/components/layout/mobile-drawer-state.ts");
const desktopBar = read("src/components/layout/desktop-top-bar.tsx");

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
}

check("MobileHeaderAvatar is imported", header.includes('from "./mobile-header-avatar"'));
check("avatar sits in header actions", header.includes("timiq-mobile-header-actions"));
check(
  "header action order is bell then avatar then menu",
  /NotificationBell[\s\S]*MobileHeaderAvatar[\s\S]*timiq-mobile-header-menu/.test(header),
);
check("avatar opens account drawer", header.includes("openAccountFromAvatar"));
check("menu opens collapsed", header.includes("openCollapsedFromMenu") && header.includes('type: "open"'));
check("menu does not use generic toggle for open", !/onClick=\{toggleMenu\}/.test(header));
check("forceOpenIds passed to NavTree", header.includes("forceOpenIds={forceOpenIds}"));
check("account section ids include emp-account and mgmt-workspace", header.includes("emp-account") && header.includes("mgmt-workspace"));
check("drawer marks account expansion", header.includes('data-account-expanded='));
check("focus returns to avatar when avatar opened", header.includes('source === "avatar"') && header.includes("avatarButtonRef"));
check("desktop top bar unchanged by MobileHeaderAvatar", !desktopBar.includes("MobileHeaderAvatar"));
check("avatar uses face-reference thumb only", avatar.includes('variant: "thumb"') && avatar.includes("fetchFaceReferenceImage"));
check("avatar does not preload full image", !avatar.includes('variant: "full"'));
check("avatar does not use clock selfies", !avatar.includes("selfie") && !avatar.includes("clock"));
check("avatar does not use onboarding photo", !avatar.includes("onboarding") && !avatar.includes("fetchOnboarding"));
check("avatar has 44px touch target", avatar.includes("h-11 w-11") && avatar.includes("timiq-touch-target"));
check("visible circle is 36px", avatar.includes("h-9 w-9"));
check("object-fit cover", avatar.includes("object-cover"));
check("initials fallback", avatar.includes("employeeInitials") && avatar.includes("bg-slate-100"));
check("accessible account label", avatar.includes("Open account menu for"));
check("blob URLs revoked", avatar.includes("revokeObjectURL"));
check("skips fetch when not configured", avatar.includes("face_reference_configured") && /if \(!hasPhoto\)/.test(avatar));
check("drawer state supports open action", drawerState.includes('| { type: "open" }'));
check("gap between actions ~6-8px", header.includes("gap-1.5") && header.includes("gap-2"));

const rootUrl = new URL("../src/", import.meta.url);
function loadModule(relative) {
  const compiled = ts.transpileModule(fs.readFileSync(new URL(relative, rootUrl), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports });
  return module.exports;
}

const { createMobileDrawerState, mobileDrawerReducer } = loadModule(
  "components/layout/mobile-drawer-state.ts",
);
const { getMobileDrawerNavigationTree } = loadModule("config/navigation.ts");

let state = createMobileDrawerState("/dashboard");
state = mobileDrawerReducer(state, { type: "open" });
check("open action opens drawer", state.open === true);
const same = mobileDrawerReducer(state, { type: "open" });
check("open on already-open returns identical state", same === state);
state = mobileDrawerReducer(state, { type: "close" });
check("close after open leaves drawer closed", state.open === false);

const empTree = getMobileDrawerNavigationTree("employee");
const adminTree = getMobileDrawerNavigationTree("admin");
check("employee tree has Account section", empTree.some((n) => n.id === "emp-account"));
check("admin tree has My workspace section", adminTree.some((n) => n.id === "mgmt-workspace"));

console.log(`${passed} mobile header avatar checks passed`);
