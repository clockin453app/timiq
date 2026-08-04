/**
 * Confirm employee / mobile identity photos do not use CSS rotation workarounds.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const photoBtn = read("src/features/employees/employee-photo-button.tsx");
const viewer = read("src/features/employees/employee-photo-viewer.tsx");
const headerAvatar = read("src/components/layout/mobile-header-avatar.tsx");
const faceAvatar = read("src/features/face-check/face-reference-avatar.tsx");

for (const [name, source] of [
  ["employee-photo-button", photoBtn],
  ["employee-photo-viewer", viewer],
  ["mobile-header-avatar", headerAvatar],
  ["face-reference-avatar", faceAvatar],
]) {
  check(`${name} has no rotate() CSS`, !/rotate\s*\(/.test(source) && !/rotateZ/.test(source));
  check(`${name} does not hard-code 90deg`, !/90deg/.test(source));
}

check("employee button uses object-cover", photoBtn.includes("object-cover"));
check("mobile header uses object-cover", headerAvatar.includes("object-cover"));
check("payroll avatar uses object-cover", faceAvatar.includes("object-cover"));
check("employee thumb uses protected thumb variant", photoBtn.includes('variant: "thumb"'));
check("viewer uses protected full variant", viewer.includes('variant: "full"'));
check("mobile header uses protected thumb variant", headerAvatar.includes('variant: "thumb"'));
check("viewer zoom scale is not a photo-orientation rotate", /scale\(\$\{zoom\}\)/.test(viewer));
check("failed fetch falls back without broken-image icon", photoBtn.includes("catch") && headerAvatar.includes("catch"));

if (failures.length) {
  console.error("FAILED:");
  for (const item of failures) console.error("-", item);
  process.exit(1);
}
console.log(`${passed} employee photo orientation (no CSS rotate) checks passed`);
