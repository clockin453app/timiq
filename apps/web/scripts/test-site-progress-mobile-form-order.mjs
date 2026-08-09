/**
 * Site Progress mobile form order + compact rhythm — metadata and Submit before photo previews.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = fs
  .readFileSync(path.join(webRoot, "src/app/(app)/site-progress/site-progress-client.tsx"), "utf8")
  .replace(/\r\n/g, "\n");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

function idx(needle) {
  const i = clientSrc.indexOf(needle);
  assert.ok(i >= 0, `missing marker: ${needle}`);
  return i;
}

// Markers inside the New update form (first occurrences in create form)
const workDate = idx('id={`${formId}-work-date`}');
const location = idx('id={`${formId}-location`}');
const workCategory = idx('id={`${formId}-work-category`}');
const elevation = idx('id={`${formId}-elevation`}');
const level = idx('id={`${formId}-level`}');
const notes = idx('id={`${formId}-notes`}');
const photosLabel = idx('label="Photos"');
const showGalleryFalse = idx("showGallery={false}");
const submitPictures = idx('"Submit pictures"');
const selectedPhotos = idx("Selected photos ({createQueue.length})");
const showGalleryTrue = clientSrc.indexOf("showGallery\n", selectedPhotos);
const showGalleryTrueAlt = clientSrc.indexOf("showGallery}", selectedPhotos);
const galleryAfterSubmit = Math.max(showGalleryTrue, showGalleryTrueAlt);
const history = idx("Your history");

check("work date before site", workDate < location);
check("site before work category", location < workCategory);
check("work category before elevation", workCategory < elevation);
check("elevation before level", elevation < level);
check("level before notes", level < notes);
check("work category before photos", workCategory < photosLabel);
check("elevation before photos", elevation < photosLabel);
check("level before photos", level < photosLabel);
check("notes before photos", notes < photosLabel);
check("photo controls before submit", photosLabel < submitPictures && showGalleryFalse < submitPictures);
check("submit before selected previews", submitPictures < selectedPhotos);
check("selected previews before history", selectedPhotos < history);
check("gallery after submit marker", galleryAfterSubmit > submitPictures);
check("no More details accordion", !/More details/.test(clientSrc) && !/<details[\s>]/.test(clientSrc));
check("no large PageHeader title block", !/PageHeader/.test(clientSrc));
check("sr-only page title retained", /<h1 className="sr-only">/.test(clientSrc));
check("Submit pictures label", /Submit pictures/.test(clientSrc));
check("Submitting ellipsis", /Submitting…/.test(clientSrc));
check("Submit appears once as primary create label", (clientSrc.match(/Submit pictures/g) || []).length === 1);
check("photo controls split from gallery", /showControls\??|showGallery/.test(clientSrc));
check("aspect-square thumbnails", /aspect-square/.test(clientSrc));
check("object-cover thumbnails", /object-cover/.test(clientSrc));
check("form order data attribute", /data-site-progress-form-order="metadata-photos-submit-previews"/.test(clientSrc));

// Viewport matrix: order must not depend on photo count (gallery gated by createQueue.length)
check("gallery only when photos selected", /createQueue\.length > 0[\s\S]*Selected photos/.test(clientSrc));
check("empty gallery section not forced", /createQueue\.length > 0 \? \(/.test(clientSrc));

for (const w of ["320", "360", "375", "390", "430"]) {
  check(
    `${w}px covered by stacked form + 2-col gallery`,
    /grid-cols-1/.test(clientSrc) && /grid-cols-2/.test(clientSrc) && /min-h-\[44px\]/.test(clientSrc),
  );
}
check("desktop date/site side-by-side at md only", /md:grid-cols-2/.test(clientSrc));
check("work date and site stay single-column below md", /grid min-w-0 grid-cols-1 gap-2\.5 md:grid-cols-2/.test(clientSrc));
check(
  "elevation/level share a row from 390px (~70/30)",
  /min-\[390px\]:grid-cols-\[minmax\(0,7fr\)_minmax\(0,3fr\)\]/.test(clientSrc),
);
check("custom elevation name is conditional", /elevation === ELEVATION_CUSTOM_VALUE/.test(clientSrc));
check("compact form row rhythm (~8–10px)", /space-y-2\.5/.test(clientSrc));
check("compact New update label (no tall header bar)", !/border-b border-\[var\(--color-border-dark\)\] bg-\[var\(--color-header\)\] px-3 py-2 md:px-\[var\(--space-card\)\]/.test(clientSrc));
check("notes start compact (~68px)", /min-h-\[68px\]/.test(clientSrc));
check("concise photo formats line", /JPEG, PNG or WebP · Up to \{maxAttachments\} photos · \{maxMb\} MB each/.test(clientSrc));
check("choose/take side-by-side from 360px", /min-\[360px\]:grid-cols-2/.test(clientSrc));
check("Clear selected photos text action", /Clear selected photos/.test(clientSrc));
check("no Clear all primary-style control", !/Clear all/.test(clientSrc));
check("gallery 3-col from 390px", /min-\[390px\]:grid-cols-3/.test(clientSrc));
check("44px touch targets retained", /min-h-\[44px\]/.test(clientSrc));
check("legacy title/status/percent fields removed from create form", !/formId\}-title`/.test(clientSrc) && !/formId\}-status`/.test(clientSrc) && !/formId\}-percent`/.test(clientSrc));
check("classification history helper wired", /formatClassificationSummary/.test(clientSrc));

console.log(`${passed} site progress mobile form-order checks passed`);
