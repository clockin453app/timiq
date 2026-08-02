/**
 * Employee RAMS access hierarchy — list → detail → full-screen reader.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => path.join(__dirname, "..", "src", rel);

const list = read(src("app/(app)/rams/rams-client.tsx"));
const detail = read(src("app/(app)/rams/[assessmentId]/employee-rams-detail-client.tsx"));
const detailPage = read(src("app/(app)/rams/[assessmentId]/page.tsx"));
const readPage = read(src("app/(app)/rams/[assessmentId]/read/page.tsx"));
const reader = read(src("features/rams/rams-reader-client.tsx"));
const api = read(src("features/rams/api.ts"));
const shell = read(src("components/layout/app-shell.tsx"));

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// List: no inline expand / empty Sheet shell
check("list does not use Sheet for inline detail", !/\bSheet\b/.test(list) && !/\bSheetBody\b/.test(list));
check("list does not call getRams for expand", !/getRams\(/.test(list));
check("list has no selectedId expand state", !/selectedId/.test(list) && !/openDetail/.test(list));
check("list has no empty detail card shell", !/detailLoading/.test(list));
check("list uses compact skeleton", /RamsListCardSkeleton/.test(list) && /animate-pulse/.test(list));
check("list cards link to employee detail", /href=\{`\/rams\/\$\{row\.id\}`\}/.test(list));
check("list sections Needs action / In progress / Acknowledged", /Needs action/.test(list) && /In progress/.test(list) && /Acknowledged/.test(list));
check("status labels Review / Continue / Sign / View", /Review RAMS/.test(list) && /Continue reading/.test(list) && /Sign RAMS/.test(list) && /View RAMS record/.test(list));
check("list has no small Open RAMS text cue", !/Open RAMS/.test(list));
check("list primary action min 52px full width", /min-h-\[52px\]/.test(list) && /w-full/.test(list));
check("list bottom-nav clearance", /layout-mobile-bottom-nav-height/.test(list));
check("list overflow safe", /min-w-0 max-w-full/.test(list));

// Detail route
check("employee detail page RoleGuard", /RoleGuard/.test(detailPage) && /EmployeeRamsDetailClient/.test(detailPage));
check("employee detail client exists", /export function EmployeeRamsDetailClient/.test(detail));
check("Back to My RAMS", /Back to My RAMS/.test(detail));
check("instruction near top", /Please open and review every page of this RAMS before acknowledging it/.test(detail));
check("primary Open/Continue/Review again labels", /Open RAMS/.test(detail) && /Continue reading RAMS/.test(detail) && /Review RAMS again/.test(detail));
check("primary open button full width 52px primary tokens", /min-h-\[52px\]/.test(detail) && /w-full/.test(detail) && /btn-primary-bg/.test(detail) && /btn-primary-fg/.test(detail));
check("no white-on-white primary", !/bg-\[var\(--color-primary\)\][\s\S]{0,80}text-white/.test(detail));
check("Download PDF secondary retained", /Download PDF/.test(detail));
check("download does not unlock copy", /Downloading alone does not unlock acknowledgement/.test(detail));
check("no large PDF iframe on detail", !/<iframe/.test(detail) && !/UploadedRamsPdfPreview/.test(detail));
check("progress section compact", /pages viewed/.test(detail) && /View all pages to unlock acknowledgement/.test(detail));
check("ack unlock copy", /All pages viewed\. You can now acknowledge this RAMS/.test(detail));
check("declaration wording", /I confirm that I have reviewed this RAMS and understand that I must follow the controls and method described/.test(detail));
check("supervisor note", /Ask your supervisor before signing if anything is unclear/.test(detail));
check("Acknowledge RAMS button", /Acknowledge RAMS/.test(detail));
check("ack locked before completion shows Continue reading", /Signature controls unlock after you view every page/.test(detail));
check("acknowledged evidence card", /Acknowledged/.test(detail) && /Your signature/.test(detail));
check("acknowledged View RAMS primary present", />Acknowledged<\/p>[\s\S]{0,2000}View RAMS/.test(detail));
check(
  "acknowledged evidence uses View RAMS not Open RAMS",
  />Acknowledged<\/p>[\s\S]{0,2000}View RAMS[\s\S]{0,400}Download PDF/.test(detail) &&
    !/>Acknowledged<\/p>[\s\S]{0,2000}Open RAMS/.test(detail),
);
check("detail bottom-nav clearance", /layout-mobile-bottom-nav-height/.test(detail));
check("signature pad present when unlocked path", /SignaturePad/.test(detail));

// Reader route preserved
check("reader route page unchanged path", /RamsReaderClient/.test(readPage));
check("reader returns to employee detail", /href=\{`\/rams\/\$\{assessmentId\}`\}/.test(reader) || /href=\{`\/rams\/\$\{assessmentId\}#rams-acknowledgement`\}/.test(reader));
check("reader sets focus ack key", /timiq_rams_focus_ack/.test(reader) && /timiq_rams_focus_ack/.test(detail));
check("reader still shell-free", /hideMobileBottomNav/.test(shell) && /\/read/.test(shell));
check("reading progress API preserved", /reading-progress\/start/.test(api) && /reading-progress\/pages/.test(api));

// List reading fields from API
check("list item reading fields typed", /reading_required\?:/.test(api) && /reading_status\?:/.test(api));

console.log(`${passed} employee RAMS hierarchy checks passed`);
