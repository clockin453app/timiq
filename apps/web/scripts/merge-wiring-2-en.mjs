/** Merge wiring-2-en into en.ts EN_STRINGS export. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import wiring2En from "./locale-patches/wiring-2-en.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enPath = path.join(__dirname, "..", "src", "lib", "i18n", "en.ts");

function loadEn() {
  let src = fs.readFileSync(enPath, "utf8").replace(/^\uFEFF/, "");
  src = src.replace(/:\s*Record<string,\s*string>/g, "");
  src = src.replace("export const EN_STRINGS", "const EN_STRINGS");
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(`${src}\nmodule.exports = EN_STRINGS;`, sandbox);
  return sandbox.module.exports;
}

const en = loadEn();
const merged = { ...en, ...wiring2En };
const lines = [
  "/** English (default) UI strings — source of truth for keys. */",
  "export const EN_STRINGS: Record<string, string> = {",
];
for (const [k, v] of Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))) {
  const esc = String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const keyEsc = k.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  lines.push(`  "${keyEsc}": "${esc}",`);
}
lines.push("};", "");
fs.writeFileSync(enPath, lines.join("\n"), "utf8");
console.log(`en.ts updated: ${Object.keys(merged).length} keys (${Object.keys(wiring2En).length} from wiring-2)`);
