import fs from "node:fs";

/** Parse `export const X: ... = { "k": "v", ... }` string maps from TS source. */
export function parseStringMap(tsSource, constName) {
  const start = tsSource.indexOf(`export const ${constName}`);
  if (start < 0) {
    throw new Error(`Could not find export const ${constName}`);
  }
  const brace = tsSource.indexOf("{", start);
  let depth = 0;
  let end = brace;
  for (let i = brace; i < tsSource.length; i++) {
    if (tsSource[i] === "{") depth++;
    if (tsSource[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const body = tsSource.slice(brace, end);
  const out = {};
  const re = /"((?:\\.|[^"\\])*)"\s*:\s*(?:"((?:\\.|[^"\\])*)"|([\s\S]*?)(?=,\s*"(?:[^"\\]|\\.)*"\s*:|$))/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    if (m[2] !== undefined) {
      out[key] = m[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  return out;
}

export function loadEnStrings(enPath) {
  return parseStringMap(fs.readFileSync(enPath, "utf8"), "EN_STRINGS");
}

export function writeLocaleTs(outPath, constName, strings) {
  const lines = [
    `/** Auto-generated — do not edit by hand; run: node scripts/generate-locales.mjs */`,
    `export const ${constName}: Record<string, string> = {`,
  ];
  for (const [k, v] of Object.entries(strings).sort(([a], [b]) => a.localeCompare(b))) {
    const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    lines.push(`  "${k.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}": "${esc}",`);
  }
  lines.push("};", "");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}
