import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import wiring3 from "./locale-patches/wiring-3-en.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enPath = path.join(__dirname, "..", "src", "lib", "i18n", "en.ts");
let src = fs.readFileSync(enPath, "utf8").replace(/^\uFEFF/, "");

const marker = '"workplaces.cis_heading"';
const insertAt = src.indexOf(marker);
if (insertAt < 0) {
  throw new Error("Marker not found in en.ts");
}

const lines = [];
for (const [k, v] of Object.entries(wiring3).sort(([a], [b]) => a.localeCompare(b))) {
  if (src.includes(`"${k}"`)) {
    continue;
  }
  const esc = String(v)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  lines.push(`  "${k}": "${esc}",`);
}

if (lines.length === 0) {
  console.log("No new keys to merge.");
  process.exit(0);
}

src = `${src.slice(0, insertAt)}${lines.join("\n")}\n${src.slice(insertAt)}`;
fs.writeFileSync(enPath, src, "utf8");
console.log(`Merged ${lines.length} keys into en.ts`);
