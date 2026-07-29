import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/api-error-detail.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { fastApiDetailToMessage } = module.exports;

assert.equal(fastApiDetailToMessage("Plain safe message", "fallback"), "Plain safe message");
assert.equal(
  fastApiDetailToMessage(
    { code: "work_progress_zip_too_many_files", message: "ZIP download is limited to 48 pictures." },
    "fallback",
  ),
  "ZIP download is limited to 48 pictures.",
);
assert.equal(
  fastApiDetailToMessage(
    { code: "work_progress_zip_too_large", message: "Selected pictures exceed the 64 MB ZIP limit." },
    "fallback",
  ),
  "Selected pictures exceed the 64 MB ZIP limit.",
);
assert.equal(
  fastApiDetailToMessage([{ msg: "Invalid request." }, { msg: "Select fewer pictures." }], "fallback"),
  "Invalid request. Select fewer pictures.",
);
assert.equal(fastApiDetailToMessage({ message: "Missing contract code" }, "fallback"), "fallback");
assert.equal(fastApiDetailToMessage({ code: "x", message: 42 }, "fallback"), "fallback");

console.log("6 API error-detail parser checks passed");
