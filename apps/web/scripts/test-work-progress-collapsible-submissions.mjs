/**
 * Work Progress Review — collapsible submissions panel source checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const client = fs
  .readFileSync(path.join(root, "app/(app)/work-progress-review/work-progress-review-client.tsx"), "utf8")
  .replace(/\r\n/g, "\n");
const api = fs
  .readFileSync(path.join(root, "features/work-progress/api.ts"), "utf8")
  .replace(/\r\n/g, "\n");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

check("submissions start collapsed by default", /useState\(false\)/.test(client) && /submissionsExpanded/.test(client));
{
  const start = client.indexOf("const [submissionsExpanded");
  const end = client.indexOf("\n", start);
  const line = client.slice(start, end);
  check("collapsed default is false", /useState\(false\)/.test(line));
}
check("compact submissions header exists", /data-testid="work-progress-submissions-section"/.test(client));
check("Show submissions toggle wording", /Show submissions/.test(client) && /Hide submissions/.test(client));
check("toggle has aria-expanded and aria-controls", /aria-expanded=\{submissionsExpanded\}/.test(client) && /aria-controls=\{submissionsPanelId\}/.test(client));
check("submission count shown in compact header", /data-testid="work-progress-submission-count"/.test(client));
check("chevron present for expand/collapse", /ChevronDown/.test(client) && /rotate-180/.test(client));
check("filters and table only render when expanded", /\{submissionsExpanded \? \(/.test(client) && /id=\{submissionsPanelId\}/.test(client));
check("FilterToolbar stays inside expanded panel", (() => {
  const panel = client.indexOf("id={submissionsPanelId}");
  const toolbar = client.indexOf("<FilterToolbar>", panel);
  const gallery = client.indexOf("Picture gallery", panel);
  return panel > 0 && toolbar > panel && toolbar < gallery;
})());
check("Picture Gallery heading follows submissions section", (() => {
  const submissions = client.indexOf('data-testid="work-progress-submissions-section"');
  const gallery = client.indexOf('data-testid="work-progress-gallery-heading"');
  return submissions > 0 && gallery > submissions;
})());
check("expanded table has bounded height and internal scroll",
  /data-testid="work-progress-submissions-table-scroll"/.test(client)
  && /max-h-\[55vh\]/.test(client)
  && /md:max-h-\[min\(50vh,520px\)\]/.test(client)
  && /overflow-auto/.test(client));
check("sticky table header where practical", /TableHeader className="sticky top-0/.test(client));
check("filters and pagination preserved across collapse",
  /setTitleSearch/.test(client)
  && /setSubmissionOffset/.test(client)
  && /SUBMISSION_PAGE_SIZE/.test(client)
  && !/localStorage/.test(client));
check("Pictures action collapses panel and scrolls to gallery",
  /function showPicturesFromSubmission/.test(client)
  && /setSubmissionsExpanded\(false\)/.test(client)
  && /scrollIntoView\(\{ behavior: "smooth"/.test(client)
  && /setShownSubmission\(row\)/.test(client)
  && /setPictureOffset\(0\)/.test(client));
check("Archive and Delete actions remain",
  /archiveSubmission\(row\)/.test(client)
  && /openPermanentDelete/.test(client)
  && /Archive/.test(client)
  && /Delete/.test(client));
check("gallery page size remains 48",
  /WORK_PROGRESS_GALLERY_PAGE_SIZE\s*=\s*48/.test(api)
  && /WORK_PROGRESS_GALLERY_PAGE_SIZE/.test(client));
check("mobile actions select remains", /md:hidden/.test(client) && /Actions…/.test(client));
check("no permanent expanded-state persistence", !/localStorage\.setItem/.test(client));

console.log(`${passed} work-progress collapsible submissions checks passed`);
