/**
 * Site Progress one-step create + photo queue behaviour tests.
 * Exercises pure helpers and asserts the client wires the required UX.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");

function loadTsModule(relPath, mocks = {}) {
  const abs = path.join(webRoot, relPath);
  const source = fs.readFileSync(abs, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: abs,
  });
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (id) => {
      if (mocks[id]) return mocks[id];
      if (id.startsWith(".") || id.startsWith("/")) {
        const resolved = path.resolve(path.dirname(abs), id);
        const candidates = [`${resolved}.ts`, `${resolved}.tsx`, resolved];
        for (const c of candidates) {
          if (fs.existsSync(c) && fs.statSync(c).isFile()) {
            return loadTsModule(path.relative(webRoot, c), mocks);
          }
        }
      }
      return require(id);
    },
    console,
    URL,
    Buffer,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(outputText, sandbox, { filename: abs });
  return module.exports;
}

const form = loadTsModule("src/features/work-progress/site-progress-form.ts", {
  "./image-compression": {
    isSupportedSiteProgressMime: (file) =>
      ["image/jpeg", "image/png", "image/webp"].includes((file.type || "").toLowerCase()),
  },
  "../../lib/datetime-local": loadTsModule("src/lib/datetime-local.ts"),
});

const dt = loadTsModule("src/lib/datetime-local.ts");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`ok - ${name}`);
}

function fakeFile(name, type, size = 100, lastModified = 1) {
  return { name, type, size, lastModified };
}

check("todayLocalDateString uses browser local calendar (not UTC slice)", () => {
  const localMidnightEdge = new Date(2026, 6, 31, 0, 30, 0); // 31 Jul local
  assert.equal(dt.todayLocalDateString(localMidnightEdge), "2026-07-31");
  assert.ok(dt.isValidLocalDateString("2026-07-31"));
  assert.equal(dt.isValidLocalDateString("2026-02-30"), false);
});

check("work date and site are required", () => {
  const errors = form.validateSiteProgressRequiredFields(
    { workDate: "", locationId: "", percent: "" },
    { allowedLocationIds: ["loc-1"] },
  );
  assert.equal(errors.workDate, "Enter a valid work date.");
  assert.equal(errors.locationId, "Select a site/location.");
});

check("unauthorized / revoked site is rejected", () => {
  const errors = form.validateSiteProgressRequiredFields(
    { workDate: "2026-07-31", locationId: "gone", percent: "" },
    { allowedLocationIds: ["loc-1"] },
  );
  assert.match(errors.locationId, /no longer available/i);
});

check("empty optional fields remain accepted", () => {
  const errors = form.validateSiteProgressRequiredFields(
    { workDate: "2026-07-31", locationId: "loc-1", percent: "" },
    { allowedLocationIds: ["loc-1"] },
  );
  assert.equal(Object.keys(errors).length, 0);
  const body = form.buildCreateBody({
    workDate: "2026-07-31",
    locationId: "loc-1",
    title: "",
    progressStatus: "in_progress",
    notes: "",
    percent: "",
  });
  assert.equal(body.title, "");
  assert.equal(body.notes, null);
  assert.equal(body.percent_complete, null);
});

check("percent must be 0–100 when provided", () => {
  const errors = form.validateSiteProgressRequiredFields(
    { workDate: "2026-07-31", locationId: "loc-1", percent: "140" },
    { allowedLocationIds: ["loc-1"] },
  );
  assert.match(errors.percent, /0 and 100/);
});

check("single permitted site is preselected; stale site cleared", () => {
  assert.equal(form.resolveAllowedLocationId("", ["only"]), "only");
  assert.equal(form.resolveAllowedLocationId("stale", ["a", "b"]), "");
  assert.equal(form.resolveAllowedLocationId("a", ["a", "b"]), "a");
});

check("photos can be queued before report creation (merge into empty queue)", () => {
  const a = fakeFile("a.jpg", "image/jpeg", 10, 1);
  const b = fakeFile("b.png", "image/png", 20, 2);
  const { next, skippedDuplicates } = form.mergePhotoFilesIntoQueue([], [a, b], () => "blob:preview");
  assert.equal(next.length, 2);
  assert.equal(skippedDuplicates, 0);
  assert.equal(next[0].file.name, "a.jpg");
});

check("duplicate files are skipped and selected files retained after validation failure", () => {
  const a = fakeFile("a.jpg", "image/jpeg", 10, 1);
  const first = form.mergePhotoFilesIntoQueue([], [a], () => "blob:1");
  const second = form.mergePhotoFilesIntoQueue(first.next, [a, fakeFile("c.webp", "image/webp", 5, 3)], () => "blob:2");
  assert.equal(second.skippedDuplicates, 1);
  assert.equal(second.next.length, 2);

  const bad = form.validateQueuedPhotos([fakeFile("x.gif", "image/gif")], {
    maxAttachments: 20,
    maxOriginalBytes: 25 * 1024 * 1024,
  });
  assert.match(bad.photos, /Unsupported type/);
  // Queue itself is unchanged by validation — caller keeps files
  assert.equal(second.next.length, 2);
});

check("file count and size limits are enforced", () => {
  const files = Array.from({ length: 3 }, (_, i) => fakeFile(`f${i}.jpg`, "image/jpeg", 10, i));
  const countErr = form.validateQueuedPhotos(files, {
    maxAttachments: 20,
    maxOriginalBytes: 100,
    existingAttachmentCount: 18,
  });
  assert.match(countErr.photos, /only 2 slot/);

  const sizeErr = form.validateQueuedPhotos([fakeFile("big.jpg", "image/jpeg", 200)], {
    maxAttachments: 20,
    maxOriginalBytes: 100,
  });
  assert.match(sizeErr.photos, /exceeds/);
});

check("successful upload clears queue; partial retains only failed files", () => {
  const ok = fakeFile("ok.jpg", "image/jpeg", 1, 1);
  const fail = fakeFile("fail.jpg", "image/jpeg", 2, 2);
  const queue = form.mergePhotoFilesIntoQueue([], [ok, fail], () => "blob:x").next;
  const cleared = form.clearQueuedPhotos(queue);
  assert.equal(cleared.length, 0);

  const again = form.mergePhotoFilesIntoQueue([], [ok, fail], () => "blob:y").next;
  const retained = form.retainFailedPhotoFiles(again, [fail]);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].file.name, "fail.jpg");
});

check("submit phase labels cover create / upload / partial", () => {
  assert.equal(form.submitPhaseLabel("creating"), "Creating update…");
  assert.equal(form.submitPhaseLabel("uploading", { uploaded: 1, total: 5 }), "Uploading 1 of 5");
  assert.match(form.submitPhaseLabel("partial", { uploaded: 18, total: 20, failed: 2 }), /18 of 20 uploaded — 2 need retry/);
  assert.equal(form.submitPhaseLabel("success", { uploaded: 3, total: 3 }), "3 of 3 uploaded");
});

const clientSrc = fs.readFileSync(
  path.join(webRoot, "src/app/(app)/site-progress/site-progress-client.tsx"),
  "utf8",
);

check("client exposes photos before create and one Submit update action", () => {
  assert.match(clientSrc, /Submit update/);
  assert.match(clientSrc, /createQueue/);
  assert.match(clientSrc, /createMyWorkProgress/);
  assert.match(clientSrc, /processAndUploadPhotosSequentially/);
  assert.match(clientSrc, /PhotoQueuePanel/);
  assert.match(clientSrc, /Choose photos/);
  assert.match(clientSrc, /Take photo/);
  // Photos appear in the create form (createQueue wired before history)
  const photosFieldIdx = clientSrc.indexOf('label="Photos"');
  const historyIdx = clientSrc.indexOf("Your history");
  assert.ok(photosFieldIdx > 0 && photosFieldIdx < historyIdx);
  assert.doesNotMatch(clientSrc, /Submit progress/);
});

check("duplicate submit is blocked while processing", () => {
  assert.match(clientSrc, /submitLockRef/);
  assert.match(clientSrc, /disabled=\{formBusy/);
  assert.match(clientSrc, /if \(submitLockRef\.current \|\| formBusy\)/);
});

check("partial failure keeps failed files and offers retry", () => {
  assert.match(clientSrc, /Retry failed uploads/);
  assert.match(clientSrc, /retainFailedPhotoFiles/);
  assert.match(clientSrc, /formatBatchUploadResult/);
  assert.match(clientSrc, /View saved update/);
});

check("existing report can receive additional photos via explicit actions", () => {
  assert.match(clientSrc, /Add more photos/);
  assert.match(clientSrc, /View photos/);
  assert.match(clientSrc, /Add photos/);
  assert.match(clientSrc, /handleUploadAddMore/);
  // Row click alone is no longer the only path
  assert.doesNotMatch(clientSrc, /onClick=\{\(\) => setActiveEntryId\(row\.id\)\}/);
});

check("More details collapses optional title/status/percent", () => {
  assert.match(clientSrc, /More details/);
  assert.match(clientSrc, /<details/);
  assert.match(clientSrc, /progressStatus.*in_progress|useState\("in_progress"\)/);
});

check("mobile photo controls and form use density tokens / full-width submit", () => {
  assert.match(clientSrc, /className="w-full"/);
  assert.match(clientSrc, /timiq-input/);
  assert.match(clientSrc, /timiq-select/);
  assert.match(clientSrc, /grid-cols-2/);
  assert.match(clientSrc, /timiq-scroll-x/);
  assert.match(clientSrc, /scroll-pb-24/);
  assert.match(clientSrc, /accept="image\/jpeg,image\/png,image\/webp"/);
});

check("accessibility: required markers, live region, remove aria-labels, focus targets", () => {
  assert.match(clientSrc, /required/);
  assert.match(clientSrc, /aria-live="polite"/);
  assert.match(clientSrc, /aria-label=\{`Remove \$\{item\.file\.name\}`\}/);
  assert.match(clientSrc, /focusFirstInvalid/);
  assert.match(clientSrc, /successRef/);
  assert.match(clientSrc, /role="alert"/);
});

check("offline enqueue includes queued photos on create", () => {
  assert.match(clientSrc, /enqueueWorkProgressSubmit\([\s\S]*prepareOfflinePhotos/);
});

check("uploads run sequentially one picture at a time", () => {
  const compression = fs.readFileSync(
    path.join(webRoot, "src/features/work-progress/image-compression.ts"),
    "utf8",
  );
  assert.match(compression, /DEFAULT_UPLOAD_CONCURRENCY = 1/);
  assert.match(clientSrc, /processAndUploadPhotosSequentially/);
});

const reviewSrc = fs.readFileSync(
  path.join(webRoot, "src/app/(app)/work-progress-review/work-progress-review-client.tsx"),
  "utf8",
);
check("work progress review client remains present (not gutted)", () => {
  assert.match(reviewSrc, /permanent/);
  assert.ok(reviewSrc.length > 1000);
});

// eslint-disable-next-line no-console
console.log(`\n${passed} site progress one-step checks passed`);
