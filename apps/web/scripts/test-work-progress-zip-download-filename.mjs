/**
 * Source + runtime checks for Work Progress ZIP download naming and gallery icons.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

const filenameSrcPath = path.join(webRoot, "src/features/work-progress/zip-download-filename.ts");
const filenameSrc = fs.readFileSync(filenameSrcPath, "utf8");
const clientSrc = fs.readFileSync(
  path.join(webRoot, "src/app/(app)/work-progress-review/work-progress-review-client.tsx"),
  "utf8",
);

assert.match(filenameSrc, /buildWorkProgressZipDownloadFilename/);
assert.match(filenameSrc, /Custom Elevation/);
assert.match(filenameSrc, /WORK_PROGRESS_ZIP_BASENAME_MAX = 180/);
assert.doesNotMatch(filenameSrc, /title_search|titleSearch|searchTerm/);

assert.match(clientSrc, /buildWorkProgressZipDownloadFilename/);
assert.doesNotMatch(clientSrc, /work-progress-pictures\.zip/);
assert.match(clientSrc, /CheckSquare/);
assert.match(clientSrc, /FileDown/);
assert.match(clientSrc, /Trash2/);
assert.match(clientSrc, /from \"lucide-react\"/);
assert.match(clientSrc, /aria-hidden=\"true\"/);
assert.match(clientSrc, /Select current page/);
assert.match(clientSrc, /Clear selection/);
assert.match(clientSrc, /Download ZIP/);
assert.match(clientSrc, /Delete selected/);
assert.match(clientSrc, /disabled=\{busy \|\| selectedIds\.size === 0/);

const stubPath = path.join(webRoot, ".tmp-zip-api-stub.cjs");
const outPath = path.join(webRoot, ".tmp-zip-filename.cjs");
fs.writeFileSync(
  stubPath,
  `
exports.WORK_CATEGORY_OPTIONS = [
  { value: "brickwork_level", label: "Brickwork level" },
  { value: "insulation", label: "Insulation" },
  { value: "foundation_foam_glass", label: "Foundation foam glass" },
];
exports.ELEVATION_OPTIONS = [
  { value: "south", label: "South" },
  { value: "north_east", label: "North-East" },
  { value: "custom", label: "Custom / site-defined" },
];
exports.ELEVATION_CUSTOM_VALUE = "custom";
exports.formatLevelDisplay = function formatLevelDisplay(level) {
  if (level == null || Number.isNaN(level)) return null;
  return String(level).padStart(2, "0");
};
`,
);

const transpiled = ts.transpileModule(filenameSrc, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
fs.writeFileSync(
  outPath,
  transpiled.replace(/require\(["']\.\/api["']\)/g, `require(${JSON.stringify(stubPath)})`),
);

const { buildWorkProgressZipDownloadFilename: build } = require(outPath);
const day = "2026-08-12";

assert.equal(build({ downloadDate: day }), "TimIQ_Work-Progress_All_2026-08-12.zip");
assert.equal(build({ siteLabel: "Kennington", downloadDate: day }), "TimIQ_Work-Progress_Kennington_2026-08-12.zip");
assert.equal(
  build({ workCategory: "brickwork_level", downloadDate: day }),
  "TimIQ_Work-Progress_Brickwork-Level_2026-08-12.zip",
);
assert.equal(build({ elevation: "south", downloadDate: day }), "TimIQ_Work-Progress_South_2026-08-12.zip");
assert.equal(build({ level: 0, downloadDate: day }), "TimIQ_Work-Progress_Level-00_2026-08-12.zip");
assert.equal(
  build({
    siteLabel: "Kennington",
    workCategory: "brickwork_level",
    elevation: "south",
    level: 0,
    downloadDate: day,
  }),
  "TimIQ_Work-Progress_Kennington_Brickwork-Level_South_Level-00_2026-08-12.zip",
);
assert.equal(build({ elevation: "custom", downloadDate: day }), "TimIQ_Work-Progress_Custom-Elevation_2026-08-12.zip");
assert.equal(
  build({
    siteLabel: "Kennington",
    workCategory: "insulation",
    elevation: "south",
    level: 3,
    employeeLabel: "Marius mrotaru",
    downloadDate: day,
  }),
  "TimIQ_Work-Progress_Kennington_Insulation_South_Level-03_Marius-Mrotaru_2026-08-12.zip",
);
assert.equal(
  build({
    siteLabel: "Kennington",
    workCategory: "brickwork_level",
    elevation: "south",
    level: 0,
    dateFrom: "2026-08-01",
    dateTo: "2026-08-12",
    downloadDate: day,
  }),
  "TimIQ_Work-Progress_Kennington_Brickwork-Level_South_Level-00_2026-08-01-to-2026-08-12_2026-08-12.zip",
);
assert.equal(
  build({ workCategory: "foundation_foam_glass", downloadDate: day }),
  "TimIQ_Work-Progress_Foundation-Foam-Glass_2026-08-12.zip",
);
assert.equal(build({ elevation: "north_east", downloadDate: day }), "TimIQ_Work-Progress_North-East_2026-08-12.zip");

const unsafe = build({ siteLabel: 'Ken/ning*ton:South?', downloadDate: day });
assert.ok(!/[\\/:*?"<>|]/.test(unsafe));
assert.ok(unsafe.endsWith(".zip"));
assert.ok(!unsafe.toLowerCase().endsWith(".zip.zip"));

const long = build({ siteLabel: "X".repeat(200), workCategory: "brickwork_level", downloadDate: day });
assert.ok(long.length <= 184);
assert.ok(long.startsWith("TimIQ_Work-Progress_"));
assert.ok(long.endsWith("_2026-08-12.zip"));

fs.unlinkSync(stubPath);
fs.unlinkSync(outPath);
console.log("test-work-progress-zip-download-filename: ok");
