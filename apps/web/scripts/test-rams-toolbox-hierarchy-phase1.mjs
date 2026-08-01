import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const root = new URL("../src/", import.meta.url);

const card = read(new URL("../src/features/rams/uploaded-rams-document-card.tsx", import.meta.url));
const employeeRams = read(new URL("../src/app/(app)/rams/rams-client.tsx", import.meta.url));
const reader = read(new URL("../src/features/rams/rams-reader-client.tsx", import.meta.url));
const ramsManage = read(new URL("../src/app/(app)/rams/manage/rams-manage-client.tsx", import.meta.url));
const ramsDetail = read(new URL("../src/app/(app)/rams/manage/rams-detail-client.tsx", import.meta.url));
const ramsEditor = read(new URL("../src/app/(app)/rams/manage/rams-editor-client.tsx", import.meta.url));
const ttManage = read(new URL("../src/app/(app)/toolbox-talks/manage/toolbox-talks-manage-client.tsx", import.meta.url));
const ttDetail = read(new URL("../src/app/(app)/toolbox-talks/manage/toolbox-talk-detail-client.tsx", import.meta.url));
const ttEditor = read(new URL("../src/app/(app)/toolbox-talks/manage/toolbox-talk-editor-client.tsx", import.meta.url));
const ttEmployee = read(new URL("../src/app/(app)/toolbox-talks/toolbox-talks-client.tsx", import.meta.url));
const en = read(new URL("../src/lib/i18n/en.ts", import.meta.url));

const navigationSource = read(new URL("../src/config/navigation.ts", import.meta.url));
const compiledNavigation = ts.transpileModule(navigationSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiledNavigation, { module, exports: module.exports });
const {
  getDesktopSidebarNavigationTree,
  getMobileDrawerNavigationTree,
  collectNavigationLeaves,
} = module.exports;
const leafHrefs = (nodes) => collectNavigationLeaves(nodes).map((item) => item.href);
const leafLabels = (nodes) =>
  collectNavigationLeaves(nodes).map((item) => ({ href: item.href, labelKey: item.labelKey, label: item.label }));

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// Open RAMS button fix
check("Open RAMS text present on card", /Open RAMS/.test(card));
check("Open RAMS uses btn-primary-bg", /bg-\[var\(--color-btn-primary-bg\)\]/.test(card));
check("Open RAMS uses btn-primary-fg", /text-\[var\(--color-btn-primary-fg\)\]/.test(card));
check("Open RAMS not white-on-white primary", !/bg-\[var\(--color-primary\)\][\s\S]{0,120}text-white/.test(card));
check("Open RAMS min touch height", /min-h-\[44px\]/.test(card));
check("Open RAMS reader href", /\/rams\/\$\{assessmentId\}\/read/.test(card));
check("ack gate Open RAMS also uses primary tokens", /bg-\[var\(--color-btn-primary-bg\)\]/.test(employeeRams));
check("Return to acknowledgement uses primary tokens", /Return to acknowledgement/.test(reader) && /btn-primary-bg/.test(reader));

// Navigation labels + routes
const admin = getDesktopSidebarNavigationTree("admin");
const employee = getDesktopSidebarNavigationTree("employee");
const mobileAdmin = getMobileDrawerNavigationTree("admin");
const mobileEmployee = getMobileDrawerNavigationTree("employee");
const adminLeaves = leafLabels(admin);
const empLeaves = leafLabels(employee);

check("admin has Manage RAMS route", leafHrefs(admin).includes("/rams/manage"));
check("admin has Manage Toolbox Talks route", leafHrefs(admin).includes("/toolbox-talks/manage"));
check("admin has My RAMS route", leafHrefs(admin).includes("/rams"));
check("admin has My Toolbox Talks route", leafHrefs(admin).includes("/toolbox-talks"));
check("employee has My RAMS route", leafHrefs(employee).includes("/rams"));
check("employee has My Toolbox Talks route", leafHrefs(employee).includes("/toolbox-talks"));
check("employee lacks manage RAMS", !leafHrefs(employee).includes("/rams/manage"));
check("employee lacks manage toolbox", !leafHrefs(employee).includes("/toolbox-talks/manage"));
check("mobile admin mirrors manage routes", leafHrefs(mobileAdmin).includes("/rams/manage") && leafHrefs(mobileAdmin).includes("/toolbox-talks/manage"));
check("mobile employee lacks manage routes", !leafHrefs(mobileEmployee).includes("/rams/manage") && !leafHrefs(mobileEmployee).includes("/toolbox-talks/manage"));
check("en Manage Toolbox Talks label", /"nav\.toolbox_talks_manage": "Manage Toolbox Talks"/.test(en));
check("en My RAMS label", /"nav\.rams": "My RAMS"/.test(en));
check("en My Toolbox Talks label", /"nav\.toolbox_talks": "My Toolbox Talks"/.test(en));
check(
  "admin manage RAMS labelKey",
  adminLeaves.some((l) => l.href === "/rams/manage" && l.labelKey === "nav.rams_manage"),
);
check(
  "employee RAMS labelKey",
  empLeaves.some((l) => l.href === "/rams" && (l.labelKey === "nav.rams" || l.labelKey === "nav.my_rams")),
);

// List action wording
check("RAMS Create/Upload labels", /Create RAMS/.test(ramsManage) && /Upload RAMS/.test(ramsManage));
check("RAMS Continue Draft / Open record", /Continue Draft/.test(ramsManage) && /Open record/.test(ramsManage));
check("Talks Create Toolbox Talk", /Create Toolbox Talk/.test(ttManage));
check("Talks Continue Draft / Open record", /Continue Draft/.test(ttManage) && /Open record/.test(ttManage));
check("employee Open RAMS list cue", /Open RAMS/.test(employeeRams));
check("employee Open Toolbox Talk", /Open Toolbox Talk/.test(ttEmployee));
check("employee Sign Toolbox Talk", /Sign Toolbox Talk/.test(ttEmployee));

// Toolbox editor cleanup
check("editor has no Add all site users", !/Add all site users/.test(ttEditor));
check("editor has no all_site_users", !/all_site_users/.test(ttEditor));
check("editor has no Void", !/\bVoid\b/.test(ttEditor));
check("editor has no Archive lifecycle", !/\bArchive\b/.test(ttEditor));
check("editor has no Mark complete", !/Mark complete/.test(ttEditor));
check("editor has no Publish", !/\bPublish\b/.test(ttEditor));
check("editor has no Delete lifecycle", !/Delete draft/.test(ttEditor) && !/\bDelete\b/.test(ttEditor));
check("editor continues to assignment", /Continue to assignment and publishing/.test(ttEditor));
check("editor Save draft retained", /Save draft/.test(ttEditor));

// Canonical detail preserved
check("detail keeps Add all active employees", /Add all active employees/.test(ttDetail));
check("detail keeps Add all site employees", /Add all site employees/.test(ttDetail));
check("detail keeps Publish", /Publish/.test(ttDetail));
check("detail keeps Void", /Void/.test(ttDetail));
check("detail keeps Delete draft", /Delete draft/.test(ttDetail));
check("detail Edit only draft", /detail\.status === "draft"[\s\S]*?\/edit/.test(ttDetail));
check("published no Edit link block", !/detail\.status === "published"[\s\S]{0,200}\/edit/.test(ttDetail));

// RAMS status actions
check("RAMS Edit only draft template", /detail\.status === "draft" && !isUploaded/.test(ramsDetail));
check("RAMS Archive published or reviewed", /status === "published" \|\| detail\.status === "reviewed"/.test(ramsDetail));
check("RAMS no Open full PDF header duplicate", !/Open full PDF/.test(ramsDetail));
check("RAMS editor Preview renamed Open record", /Open record/.test(ramsEditor) && !/>Preview</.test(ramsEditor));
check("RAMS editor Archive only published/reviewed", /status === "published" \|\| detail\.status === "reviewed"/.test(ramsEditor));
check("RAMS assignment draft or published", /status === "draft" \|\| detail\.status === "published"/.test(ramsDetail));

// Mobile wrap safety on changed action groups
check("RAMS manage actions wrap", /flex-col gap-2 sm:w-auto sm:flex-row|flex-wrap/.test(ramsManage));
check("Talks editor actions stack", /flex-col gap-2 sm:flex-row/.test(ttEditor));
check("Open RAMS full width mobile", /w-full[\s\S]*Open RAMS|Open RAMS[\s\S]*w-full/.test(card));

// Dead nav file note: layouts/navigation-items.ts is unused by sidebar/drawer — not modified.

console.log(`${passed} RAMS/Toolbox hierarchy Phase 1 UI source checks passed`);
