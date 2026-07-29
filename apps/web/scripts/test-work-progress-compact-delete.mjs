import assert from "node:assert/strict";
import fs from "node:fs";

const clientPath = new URL("../src/app/work-progress-review/work-progress-review-client.tsx", import.meta.url);
const tablePath = new URL("../src/components/ui/table.tsx", import.meta.url);
const buttonPath = new URL("../src/components/ui/button.tsx", import.meta.url);

const client = fs.readFileSync(clientPath, "utf8");
const table = fs.readFileSync(tablePath, "utf8");
const button = fs.readFileSync(buttonPath, "utf8");

assert.match(client, /const DENSE_HEAD = "px-2 py-1 text-\[11px]/);
assert.match(client, /const DENSE_CELL = "px-2 py-1 text-xs"/);
assert.match(client, /const COMPACT_ACTION_BTN =[\s\S]*h-7/);
assert.match(client, /flex flex-nowrap items-center gap-1/);
assert.match(client, /function TruncateText/);
assert.match(client, /tabIndex=\{0\}/);
assert.match(client, /title=\{value\}/);
assert.match(client, />Pictures</);
assert.match(client, />Archive</);
assert.match(client, />Delete</);
assert.doesNotMatch(client, />Show pictures</);
assert.doesNotMatch(client, />Archive submission</);
assert.match(client, /SUBMISSION_PAGE_SIZE = 25/);
assert.match(client, /deleteConfirmText\.trim\(\) !== "DELETE"/);
assert.match(client, /permanentDeleteWorkProgressSubmission/);
assert.match(client, /Permanently delete submission/);
assert.match(client, /inline-flex max-w-full items-center gap-1/);
assert.match(client, /submissionOffset - SUBMISSION_PAGE_SIZE/);

assert.match(table, /px-3 py-3 text-sm/);
assert.match(button, /sm: "h-8 px-3/);

const confirmDelete = client.slice(
  client.indexOf("async function confirmPermanentDelete()"),
  client.indexOf("useEffect(() => {\n    if (!deleteTarget) return;"),
);
assert.ok(confirmDelete.length > 0, "confirmPermanentDelete body not found");

const awaitIndex = confirmDelete.indexOf("await permanentDeleteWorkProgressSubmission");
const clearIndex = confirmDelete.indexOf("setSelectedIds(new Set())");
const catchIndex = confirmDelete.indexOf("} catch (error) {");

// Successful deletion clears the entire selection, unconditionally, after the server confirms.
assert.ok(awaitIndex >= 0 && clearIndex > awaitIndex, "selection must clear after server confirmation");
assert.ok(clearIndex < catchIndex, "selection clearing must be in the success path");
assert.equal(
  confirmDelete.split("setSelectedIds(").length - 1,
  1,
  "selection should be cleared exactly once, unconditionally",
);
// Failure path must not clear selection.
assert.doesNotMatch(confirmDelete.slice(catchIndex), /setSelectedIds/);
// Clearing must not be nested inside the active-filter branch.
assert.doesNotMatch(
  confirmDelete,
  /shownSubmission\?\.id === target\.id\) \{[\s\S]*?setSelectedIds/,
);
// Active gallery entry filter still clears when it pointed at the deleted submission.
assert.match(confirmDelete, /shownSubmission\?\.id === target\.id[\s\S]*?setShownSubmission\(null\)/);

console.log("20 compact table / permanent-delete UI source checks passed");
