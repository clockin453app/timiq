/**
 * Ensure @/components/ui barrel exports all filter-toolbar symbols used by pages.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const index = fs.readFileSync(path.join(root, "components/ui/index.ts"), "utf8");
const toolbar = fs.readFileSync(path.join(root, "components/ui/filter-toolbar.tsx"), "utf8");

const required = [
  "FilterToolbar",
  "FilterSearch",
  "FilterButton",
  "FilterClearAction",
  "FilterPopover",
  "MobileFilterSheet",
  "FilterActionRow",
  "ResponsiveFilterGrid",
];

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

for (const name of required) {
  check(`${name} exists in filter-toolbar.tsx`, new RegExp(`export (function|const|type) ${name}|export \\{[^}]*\\b${name}\\b`).test(toolbar) || toolbar.includes(`export function ${name}`) || toolbar.includes(`export const ${name}`) || toolbar.includes(`export type ${name}`));
  check(`${name} re-exported from ui/index.ts`, new RegExp(`\\b${name}\\b`).test(index));
}

check("FilterButton forwardRef still exported", /export const FilterButton = forwardRef/.test(toolbar));
check("index imports from ./filter-toolbar", /from \"\.\/filter-toolbar\"/.test(index));

console.log(`${passed} UI filter barrel export checks passed`);
