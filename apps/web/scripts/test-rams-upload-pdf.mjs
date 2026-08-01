import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const manage = read(new URL("../src/app/(app)/rams/manage/rams-manage-client.tsx", import.meta.url));
const upload = read(new URL("../src/app/(app)/rams/manage/rams-upload-client.tsx", import.meta.url));
const uploadPage = read(new URL("../src/app/(app)/rams/manage/upload/page.tsx", import.meta.url));
const detail = read(new URL("../src/app/(app)/rams/manage/rams-detail-client.tsx", import.meta.url));
const employee = read(new URL("../src/app/(app)/rams/rams-client.tsx", import.meta.url));
const api = read(new URL("../src/features/rams/api.ts", import.meta.url));
const preview = read(new URL("../src/features/rams/uploaded-pdf-preview.tsx", import.meta.url));
const editor = read(new URL("../src/app/(app)/rams/manage/rams-editor-client.tsx", import.meta.url));

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

check("Upload RAMS beside Create RAMS", /Upload RAMS/.test(manage) && /Create RAMS/.test(manage));
check("Create RAMS still opens /rams/manage/new", /href="\/rams\/manage\/new"/.test(manage));
check("Upload RAMS opens /rams/manage/upload", /href="\/rams\/manage\/upload"/.test(manage));
check("empty state shows both actions", /No RAMS records match[\s\S]*Upload RAMS[\s\S]*Create RAMS/.test(manage));
check("buttons stack on mobile", /flex-col gap-2 sm:w-auto sm:flex-row|flex-col gap-2 sm:flex-row/.test(manage));
check("source column labels", /Uploaded PDF/.test(manage) && /Template RAMS/.test(manage));

check("upload page RoleGuard", /allowedRoles=\{\["admin", "administrator"\]\}/.test(uploadPage));
check("upload helper text", /Upload an existing RAMS PDF[\s\S]*TimIQ template/.test(upload));
check("upload accepts pdf only", /accept="application\/pdf,\.pdf"/.test(upload));
check("upload requires title and file", /Title is required/.test(upload) && /Choose a PDF file/.test(upload));
check("upload preserves metadata on error", /setError\(err instanceof Error \? err\.message/.test(upload) && /setBusy\(false\)/.test(upload));
check("successful upload redirects to draft record", /router\.push\(`\/rams\/manage\/\$\{created\.id\}`\)/.test(upload));
check("file picker full width", /block w-full min-w-0/.test(upload));
check("filename wraps", /break-all/.test(upload));

check("api uploadRamsPdf", /export async function uploadRamsPdf/.test(api));
check("api replaceUploadedRamsPdf", /export async function replaceUploadedRamsPdf/.test(api));
check("api uses API_URL", /\$\{API_URL\}\/api\/rams\/upload-pdf/.test(api) && !/onrender\.com/.test(api));
check("preview fetch uses authenticated client", /export async function fetchUploadedRamsPdfBlob/.test(api) && /credentials:\s*"include"/.test(api) && /uploaded-pdf\/view/.test(api));
check("download still authenticated", /export async function downloadUploadedRamsPdf/.test(api) && /credentials:\s*"include"/.test(api));
check("no token query string for preview", !/uploaded-pdf\/view\?/.test(api) && !/access_token=/.test(api) && !/token=/.test(preview));

check("preview component fetches blob", /fetchUploadedRamsPdfBlob/.test(preview));
check("object URL created", /URL\.createObjectURL/.test(preview) || /createObjectURL/.test(api));
check("object URL revoked on cleanup", /URL\.revokeObjectURL/.test(preview) && /disposed/.test(preview));
check("preview failure fallback", /PDF unavailable|PDF preview unavailable/.test(preview) && /Download PDF/.test(preview));
check("detail uses UploadedRamsPdfPreview", /UploadedRamsPdfPreview/.test(detail) && !/<iframe[\s\S]*ramsUploadedPdfViewUrl/.test(detail));
check("preview Open PDF uses authenticated open", /openUploadedRamsPdfInNewTab/.test(preview) && /Open PDF/.test(preview));
check("employee uses compact document card", /UploadedRamsDocumentCard/.test(employee));
check("employee Open RAMS reader link", /\/rams\/\$\{.*\}\/read|Open RAMS/.test(employee) || /UploadedRamsDocumentCard/.test(employee));
check("detail uploaded badge", /Uploaded RAMS/.test(detail));
check("detail has single PDF action surface", /UploadedRamsPdfPreview/.test(detail) && !/Open full PDF/.test(detail));
check("template sections hidden for uploaded", /isUploaded \? \(/.test(detail) && /Uploaded RAMS PDF|Uploaded PDF preview/.test(detail));
check("employee uploaded flow", /Uploaded document/.test(employee));
check("mobile open PDF / Open RAMS actions", /Open RAMS/.test(employee) && /Open PDF/.test(preview));
check("no Add all site users label", !/Add all site users/.test(detail));
check("bulk active and site employees", /Add all active employees/.test(detail) && /Add all site employees/.test(detail));
check("template creator unchanged path", /Choose a professional construction activity template/.test(editor) || /document_presets/.test(editor) || /from-preset/.test(editor) || /Create RAMS/.test(editor) || /preset/.test(editor));

console.log(`${passed} RAMS upload PDF UI source checks passed`);
