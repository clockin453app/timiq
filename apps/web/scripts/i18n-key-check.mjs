import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, "..", "src", "lib", "i18n");

function loadTsConst(filePath, constName) {
  const full = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const start = full.indexOf(`export const ${constName}`);
  if (start < 0) throw new Error(`Missing ${constName} in ${filePath}`);
  const nextExport = full.indexOf("export const", start + 12);
  const slice = nextExport > start ? full.slice(start, nextExport) : full.slice(start);
  let src = slice
    .replace(/:\s*Record<string,\s*string>/g, "")
    .replace(`export const ${constName}`, `const ${constName}`);
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(`${src}\nmodule.exports = ${constName};`, sandbox);
  return sandbox.module.exports;
}

const en = loadTsConst(path.join(i18nDir, "en.ts"), "EN_STRINGS");
const enKeys = Object.keys(en);

for (const [file, constName] of [
  ["ro.ts", "RO_STRINGS"],
  ["pl.ts", "PL_STRINGS"],
  ["es.ts", "ES_STRINGS"],
  ["ru.ts", "RU_STRINGS"],
]) {
  const map = loadTsConst(path.join(i18nDir, file), constName);
  const missing = enKeys.filter((k) => !(k in map) || map[k] === "");
  const extra = Object.keys(map).filter((k) => !(k in en));
  console.log(`${file}: ${Object.keys(map).length} keys, missing ${missing.length}, extra ${extra.length}`);
  if (missing.length) {
    console.error("Missing keys:", missing.slice(0, 20).join(", "));
    process.exit(1);
  }
}
console.log(`Integrity OK — ${enKeys.length} keys in en.ts`);
