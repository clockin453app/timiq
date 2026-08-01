import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const detail = read(new URL("../src/app/(app)/rams/manage/rams-detail-client.tsx", import.meta.url));
const employee = read(new URL("../src/app/(app)/rams/rams-client.tsx", import.meta.url));
const api = read(new URL("../src/features/rams/api.ts", import.meta.url));
const preview = read(new URL("../src/features/rams/uploaded-pdf-preview.tsx", import.meta.url));

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

check("mobile does not rely only on iframe", /Open PDF/.test(preview) && /Download PDF/.test(preview));
check("Open PDF uses authenticated blob open", /openUploadedRamsPdfInNewTab/.test(preview) && /fetchUploadedRamsPdfBlob/.test(api));
check("Download remains authenticated", /downloadUploadedRamsPdf/.test(preview) && /credentials:\s*"include"/.test(api));
check("object URLs revoked on unmount", /URL\.revokeObjectURL/.test(preview) && /disposed/.test(preview));
check("open tab revokes object URL", /openUploadedRamsPdfInNewTab[\s\S]*revokeObjectURL/.test(api));
check("mobile skips embed by default", /matchMedia\("\(min-width: 768px\)"\)/.test(preview) && /embedDesktop/.test(preview));
check("PDF failure fallback keeps actions", /PDF unavailable/.test(preview) && /Download PDF/.test(preview));
check("employee uses document card", /UploadedRamsDocumentCard/.test(employee));
check("employee bottom nav clearance", /layout-mobile-bottom-nav-height/.test(employee));
check("employee acknowledgement section remains", /Final acknowledgement/.test(employee) && /Sign RAMS/.test(employee));
check("no public token URL", !/access_token=/.test(preview) && !/token=/.test(api));
check("320px-safe button stack", /w-full min-w-0 flex-col gap-2 sm:flex-row/.test(preview) || /w-full min-w-0 flex-col gap-2 sm:flex-row/.test(employee));

check("Add all active employees appears", /Add all active employees/.test(detail));
check("Add all site employees appears", /Add all site employees/.test(detail));
check("old Add all site users removed", !/Add all site users/.test(detail));
check("site action disabled explanation", /Select a site for this RAMS before adding site employees/.test(detail));
check("preview counts displayed", /will_add/.test(detail) && /already_assigned/.test(detail) && /Assign /.test(detail));
check("bulk refresh once via getRams", /bulkAssignRamsAcknowledgements[\s\S]*getRams\(detail\.id\)/.test(detail));
check("bulk errors visible", /dialogError/.test(detail) && /Could not assign employees/.test(detail));
check("site selector for draft", /No site selected/.test(detail) && /patchRams/.test(detail) && /saveSite/.test(detail));
check("bulk API endpoints", /acknowledgements\/bulk-preview/.test(api) && /acknowledgements\/bulk/.test(api));
check("individual assign retained", /Assign employees/.test(detail) && /addRamsAcknowledgements/.test(detail));

console.log(`${passed} RAMS mobile PDF + bulk assignment UI source checks passed`);
