import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const employee = read(new URL("../src/app/(app)/rams/rams-client.tsx", import.meta.url));
const card = read(new URL("../src/features/rams/uploaded-rams-document-card.tsx", import.meta.url));
const reader = read(new URL("../src/features/rams/rams-reader-client.tsx", import.meta.url));
const page = read(new URL("../src/app/(app)/rams/[assessmentId]/read/page.tsx", import.meta.url));
const api = read(new URL("../src/features/rams/api.ts", import.meta.url));
const shell = read(new URL("../src/components/layout/app-shell.tsx", import.meta.url));
const pkg = read(new URL("../package.json", import.meta.url));

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

check("pdfjs-dist dependency present", /"pdfjs-dist"/.test(pkg));
check("embedded PDF removed from employee detail", !/UploadedRamsPdfPreview/.test(employee));
check("compact Open RAMS card appears", /UploadedRamsDocumentCard/.test(employee) && /Open RAMS/.test(card));
check("full-screen viewer route exists", /RamsReaderClient/.test(page) && /assessmentId/.test(page));
check("reader uses pdfjs getDocument", /getDocument/.test(reader) && /pdfjs-dist/.test(reader));
check("IntersectionObserver page visibility", /IntersectionObserver/.test(reader) && /VISIBLE_RATIO/.test(reader));
check("dwell duration gate", /DWELL_MS/.test(reader));
check("lazy render window", /RENDER_WINDOW/.test(reader));
check("progress bar and unread warning", /Some pages have not been viewed yet/.test(reader) && /Go to first unread page/.test(reader));
check("acknowledgement disabled before completion", /view all pages before acknowledging/.test(employee));
check("acknowledgement enabled copy after completion", /All pages viewed\. You can now acknowledge/.test(employee));
check("declaration wording", /progressed through all pages/.test(employee));
check("download does not unlock copy", /Downloading alone does not unlock/.test(card));
check("bottom nav hidden on reader", /hideMobileBottomNav/.test(shell) && /rams/.test(shell) && /\/read/.test(shell));
check("object URL cleanup", /revokeObjectURL/.test(reader) && /pdf\.destroy/.test(reader));
check("reading progress API", /reading-progress\/start/.test(api) && /reading-progress\/pages/.test(api));
check("client reports page_number only", /page_number:\s*pageNumber/.test(api) && /reportRamsReadingPage\(/.test(api));
check("start omits client total_pages", /export async function startRamsReadingProgress\(assessmentId: string\)/.test(api) && !/total_pages:\s*totalPages/.test(api));
check("reader uses server total_pages", /started\.total_pages/.test(reader) && /page count mismatch/.test(reader));
check("authenticated blob fetch", /fetchUploadedRamsPdfBlob/.test(reader) && /credentials:\s*"include"/.test(api));
check("no token query strings", !/access_token=/.test(reader) && !/token=/.test(api));
check("320px-safe controls", /min-h-\[44px\]/.test(reader) && /w-full min-w-0 flex-col/.test(card));

console.log(`${passed} RAMS full-screen reader UI source checks passed`);
