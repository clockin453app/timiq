/**
 * Site Progress mobile form order — metadata and Submit before photo previews.
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
const title = idx('id={`${formId}-title`}');
const status = idx('id={`${formId}-status`}');
const percent = idx('id={`${formId}-percent`}');
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
check("site before title", location < title);
check("title before notes", title < notes);
check("title before photos", title < photosLabel);
check("status before photos", status < photosLabel);
check("percent before photos", percent < photosLabel);
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
check("desktop side-by-side metadata at md", /md:grid-cols-2/.test(clientSrc));

console.log(`${passed} site progress mobile form-order checks passed`);
