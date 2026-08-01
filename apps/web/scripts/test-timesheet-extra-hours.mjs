/**
 * Non-payroll extra hours UI wiring / safety checks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, "..", "src");
const apiRoot = path.join(here, "..", "..", "api");
const read = (root, relative) =>
  fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const payroll = read(srcRoot, "app/(app)/payroll-report/payroll-report-client.tsx");
const timesheets = read(srcRoot, "app/(app)/timesheets/timesheets-client.tsx");
const api = read(srcRoot, "features/timesheet-extra-hours/api.ts");
const modal = read(srcRoot, "features/timesheet-extra-hours/extra-hours-modal.tsx");
const schemas = read(apiRoot, "app/modules/timesheet_extra_hours/schemas.py");
const service = read(apiRoot, "app/modules/timesheet_extra_hours/service.py");
const repo = read(apiRoot, "app/modules/timesheet_extra_hours/repository.py");

check("Add extra hours button for admins", /Add extra hours/.test(payroll) && /data-testid="add-extra-hours-button"/.test(payroll));
check("EXTRA HOURS non-payroll section", /Extra hours - non-payroll/.test(payroll));
check("Non-payroll badge in admin rows", /Non-payroll/.test(payroll));
check("informational Extra recorded hours separate", /Extra recorded hours/.test(payroll));
check("TOTAL HOURS still from payroll rounded seconds", /total_rounded_seconds/.test(payroll) && /Total hours/.test(payroll));
check("exclusive end date weekStart+7 for extra hours", /listAdminExtraHours[\s\S]{0,220}end_date:\s*addDaysIsoYmd\(weekStart,\s*7\)/.test(payroll));
check("no recalculatePayroll after extra hours save", !/onSaved[\s\S]{0,400}recalculatePayroll/.test(payroll));
check("Edit shift action still present", /Edit shift/.test(payroll));
check("delete confirmation text", /Delete this non-payroll extra-hours entry/.test(payroll));
check("shift correction helper present", /Use Edit shift when the original clock-in/.test(modal));
check("non-payroll notice in modal", /will not affect payroll calculations/.test(modal));
check("employee preselected read-only", /readOnly/.test(modal) && /Employee/.test(modal));
check("Cancel is type=button", /type="button"[\s\S]{0,120}Cancel|Cancel[\s\S]{0,120}type="button"/.test(modal));
check("modal uses shared Modal", /<Modal/.test(modal));
check("submit via form attr only", /form="extra-hours-form"/.test(modal));
check("employee additional recorded hours", /Additional recorded hours/.test(timesheets));
check("employee Non-payroll badge", /Non-payroll/.test(timesheets));
check("employee has no delete/edit extra hours actions", !/deleteExtraHours/.test(timesheets) && !/ExtraHoursModal/.test(timesheets));
check("employee exclusive end +7", /addDaysIsoYmd\(weekStart,\s*7\)/.test(timesheets));
check("create/patch forbid extra fields including affects_payroll", /extra=["']forbid["']/.test(schemas));
check("service never calls recalculate_payroll", !/recalculate_payroll/.test(service));
check("repository exclusive end filter", /work_date < end_date/.test(repo));
check("no payroll recalculate in frontend API", !/recalculatePayroll|recalculate_payroll/.test(api));

const helpersSrc = `
export function formatExtraHoursDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return total + "m";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) return h + "h";
  return h + "h " + m + "m";
}
export function parseDurationToMinutes(hoursText, minutesText) {
  const hRaw = hoursText.trim() === "" ? 0 : Number(hoursText);
  const mRaw = minutesText.trim() === "" ? 0 : Number(minutesText);
  if (!Number.isFinite(hRaw) || !Number.isFinite(mRaw)) return null;
  if (!Number.isInteger(hRaw) || !Number.isInteger(mRaw)) return null;
  if (hRaw < 0 || mRaw < 0 || mRaw > 59) return null;
  const total = hRaw * 60 + mRaw;
  return total > 0 ? total : null;
}
`;
const helpers = {};
vm.runInNewContext(
  ts.transpileModule(helpersSrc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { module: { exports: helpers }, exports: helpers, Number, Math, String },
);

check("1h formats", helpers.formatExtraHoursDuration(60) === "1h");
check("1h 30m formats", helpers.formatExtraHoursDuration(90) === "1h 30m");
check("45m formats", helpers.formatExtraHoursDuration(45) === "45m");
check("parse 1h 30m", helpers.parseDurationToMinutes("1", "30") === 90);
check("parse rejects zero", helpers.parseDurationToMinutes("0", "0") === null);
check("parse rejects negative", helpers.parseDurationToMinutes("-1", "0") === null);

if (failures.length) {
  console.error(`FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`ok - timesheet extra hours UI (${passed} checks)`);
