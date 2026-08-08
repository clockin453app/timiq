/**
 * Onboarding Download PDF button + print regression (source checks).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = fs.readFileSync(path.join(webRoot, "src/features/onboarding/api.ts"), "utf8");
const review = fs.readFileSync(
  path.join(webRoot, "src/app/(app)/onboarding-review/onboarding-review-client.tsx"),
  "utf8",
);
const starter = fs.readFileSync(
  path.join(webRoot, "src/app/(app)/starter-form/starter-form-client.tsx"),
  "utf8",
);

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

check("API helper downloadOnboardingSubmissionPdf exists", /downloadOnboardingSubmissionPdf/.test(api));
check("PDF hits /submissions/{id}/pdf", /\/api\/onboarding\/submissions\/\$\{encodeURIComponent\(submissionId\)\}\/pdf/.test(api));
check("download uses credentials include", /credentials:\s*"include"/.test(api));
check("print window helper retained", /openOnboardingSubmissionPrintWindow/.test(api));
check("print hits /print", /\/print`/.test(api) || /\/print"/.test(api) || /\/print\$\{/.test(api) || /\/print`/.test(api) || /\/print/.test(api));

check("review imports download helper", /downloadOnboardingSubmissionPdf/.test(review));
check("review shows Download PDF", /Download PDF/.test(review));
check("review Preparing PDF loading copy", /Preparing PDF…/.test(review));
check("review Print action retained", /openOnboardingSubmissionPrintWindow/.test(review));
check("review Download before Print in markup", review.indexOf("Download PDF") < review.indexOf("print_export") || review.indexOf("downloadPdf") < review.indexOf("openOnboardingSubmissionPrintWindow"));
check("review 44px touch target on PDF button", /min-h-\[44px\]/.test(review));
check("review blocks double PDF download", /pdfLockRef/.test(review));

check("starter form Download PDF", /Download PDF/.test(starter));
check("starter form Print retained", /Print my submitted form/.test(starter));
check("starter form Preparing PDF", /Preparing PDF…/.test(starter));

console.log(`${passed} onboarding PDF download UI checks passed`);
