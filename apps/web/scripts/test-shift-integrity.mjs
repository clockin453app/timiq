/**
 * Shift-integrity UI wiring: truthful save status, client_action_id, duplicate messaging.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, "..", "src");
const read = (relative) => fs.readFileSync(path.join(srcRoot, relative), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const api = read("features/time-records/api.ts");
const timeRecords = read("app/(app)/time-records/time-records-client.tsx");
const payroll = read("app/(app)/payroll-report/payroll-report-client.tsx");

check("create body requires client_action_id", /client_action_id: string/.test(api));
check("AdminShiftMutationError exports existingShiftId", /existingShiftId/.test(api));
check("create posts client_action_id", /JSON\.stringify\(body\)/.test(api) && /adminCreateCompletedShift/.test(api));

check("create intention generates client_action_id once", /setCreateClientActionId\(crypto\.randomUUID\(\)\)/.test(timeRecords));
check("create reuses createClientActionId", /client_action_id: actionId/.test(timeRecords));
check("create disables while busy", /disabled=\{modalBusy\}/.test(timeRecords));
check("create shows Saving…", /Saving…/.test(timeRecords));
check("create guards double submit", /if \(modalBusy\) \{\s*return;/.test(timeRecords));
check("success message Shift saved successfully", /Shift saved successfully\./.test(timeRecords));
check("idempotent message", /Shift was already saved successfully\./.test(timeRecords));
check("duplicate message", /A shift already exists for this employee on this date\./.test(timeRecords));
check("open existing shift affordance", /Open existing shift/.test(timeRecords));
check("refresh failure warning", /list could not be refreshed/.test(timeRecords));
check("edit uses patch only", /adminPatchCompletedShift\(editRow\.shift_id/.test(timeRecords));
check("create uses create only", /adminCreateCompletedShift\(\{/.test(timeRecords));
check("edit does not call create", !/adminCreateCompletedShift\(editRow/.test(timeRecords));

check("payroll save shift busy guard", /if \(!shiftEditRow \|\| shiftEditBusy\)/.test(payroll));
check("payroll Save shift shows Saving…", /shiftEditBusy \? "Saving…" : "Save shift"/.test(payroll));
check("payroll uses patch only", /adminPatchCompletedShift\(shiftEditRow\.shift_id/.test(payroll));
check("payroll success message", /Shift saved successfully\./.test(payroll));
check("payroll refresh failure warning", /list could not be refreshed/.test(payroll));
check("payroll duplicate message", /A shift already exists for this employee on this date\./.test(payroll));
check("payroll open existing", /Open existing shift/.test(payroll));
check("payroll handles AdminShiftMutationError", /AdminShiftMutationError/.test(payroll));

if (failures.length) {
  console.error(`FAILED (${failures.length}):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log(`OK ${passed} shift-integrity UI checks passed`);
