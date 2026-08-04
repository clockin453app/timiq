import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helper = readFileSync(join(root, "src/features/auth/temporary-password.ts"), "utf8");
const employees = readFileSync(join(root, "src/app/(app)/employees/employees-client.tsx"), "utf8");
const detail = readFileSync(
  join(root, "src/app/(app)/employees/employee-detail-panel.tsx"),
  "utf8",
);

assert.match(helper, /crypto\.getRandomValues/);
assert.match(helper, /GENERATED_TEMPORARY_PASSWORD_LENGTH = 16/);
assert.match(helper, /FORBIDDEN_TEMPORARY_PASSWORDS/);
assert.doesNotMatch(employees, /Employee12345|Admin12345/);
assert.doesNotMatch(detail, /Employee12345|Admin12345/);
assert.match(employees, /useState\(""\)/);
assert.match(detail, /useState\(""\)/);
assert.match(employees, /generateSecureTemporaryPassword/);
assert.match(detail, /generateSecureTemporaryPassword/);
assert.match(employees, /validateTemporaryPassword/);
assert.match(detail, /validateTemporaryPassword/);
assert.match(employees, /Generate password/);
assert.match(detail, /Generate password/);

console.log("temporary password security checks passed");
