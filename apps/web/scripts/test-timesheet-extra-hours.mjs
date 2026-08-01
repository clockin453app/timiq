/**
 * Payable Extra hours UI wiring / safety checks.
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
const weekDetail = read(srcRoot, "app/(app)/timesheets/week/timesheet-week-detail-client.tsx");
const api = read(srcRoot, "features/timesheet-extra-hours/api.ts");
const modal = read(srcRoot, "features/timesheet-extra-hours/extra-hours-modal.tsx");
const roles = read(srcRoot, "features/auth/roles.ts");
const schemas = read(apiRoot, "app/modules/timesheet_extra_hours/schemas.py");
const service = read(apiRoot, "app/modules/timesheet_extra_hours/service.py");
const calc = read(apiRoot, "app/modules/payroll/calculation.py");
const repo = read(apiRoot, "app/modules/timesheet_extra_hours/repository.py");
const migrationNew = read(apiRoot, "migrations/versions/x7y8z9a0b1c2_payable_timesheet_extra_hours.py");
const migrationOld = read(apiRoot, "migrations/versions/w6x7y8z9a0b1_timesheet_extra_hours.py");

const toolbarBlock = payroll.slice(
  payroll.indexOf('aria-label={t("payroll.report.actions"'),
  payroll.indexOf("{paidRowCount > 0 ? ("),
);

check(
  "original lucide toolbar icon imports",
  /import \{ FileDown, FileSpreadsheet, FileText, Printer \} from "lucide-react"/.test(payroll),
);
check(
  "readable date field still uses Calendar affordance",
  /from "lucide-react"/.test(read(srcRoot, "components/ui/date-field.tsx")) &&
    /Calendar/.test(read(srcRoot, "components/ui/date-field.tsx")),
);
check("toolbar uses FileDown icon component", /<FileDown\b/.test(toolbarBlock));
check("toolbar uses FileSpreadsheet icon component", /<FileSpreadsheet\b/.test(toolbarBlock));
check("toolbar uses Printer icon component", /<Printer\b/.test(toolbarBlock));
check("toolbar uses FileText icon component", /<FileText\b/.test(toolbarBlock));
check("CSV handler connected", /onClick=\{handleCsv\}/.test(toolbarBlock));
check("Excel handler connected", /onClick=\{handleExcelDownload\}/.test(toolbarBlock));
check("Print handler connected", /onClick=\{handlePrint\}/.test(toolbarBlock));
check("PDF handler connected", /onClick=\{handlePdfDownload\}/.test(toolbarBlock));

check("canAccessManagement used for Extra hours gate", /canAccessManagement\(user\)/.test(payroll));
check(
  "canAccessManagement covers Admin and Administrator",
  /function canAccessManagement\(user: AuthUser\) \{\s*return isAdministrator\(user\) \|\| isAdmin\(user\);/.test(
    roles,
  ),
);
check(
  "Add payable hours gated for management roles",
  /canManageExtraHours \? \([\s\S]*?data-testid="add-extra-hours-button"[\s\S]*?Add payable hours[\s\S]*?\) : null/.test(
    payroll,
  ),
);
check(
  "modal notice says payable hours / recalculation",
  /added to payable hours and will trigger payroll recalculation/.test(modal) &&
    /It does\s+not change the employee/.test(modal) &&
    /clock-in or clock-out times/.test(modal),
);
check(
  "modal explains Edit shift vs payable hours",
  /Use Edit shift when the recorded clock times are wrong/.test(modal),
);
check(
  "expanded payroll shows Payable hours adjustments",
  /Payable hours adjustments/.test(payroll) &&
    /data-testid="payable-hours-adjustments-section"/.test(payroll),
);
check(
  "separate clocked / payable extra / total payable values",
  /Clocked hours:/.test(payroll) &&
    /Payable extra hours:/.test(payroll) &&
    /Total payable hours:/.test(payroll),
);
check(
  "Payable badge present",
  />Payable</.test(payroll) || /Payable\s*<\/span>/.test(payroll),
);
check(
  "historical non-payroll section retained separately",
  /Recorded hours - non-payroll/.test(payroll) &&
    /data-testid="extra-hours-non-payroll-section"/.test(payroll),
);
check(
  "save refreshes report for stale status without direct recalculatePayroll call in onSaved",
  /onSaved=\{\(saved\) => \{[\s\S]*?loadReport\(\{ silent: true \}\)[\s\S]*?\}/.test(payroll) &&
    !/onSaved=\{\(saved\) => \{[\s\S]{0,500}recalculatePayroll/.test(payroll),
);
check(
  "modal receives employee user_id and week",
  /employeeUserId=\{extraHoursModal\.userId\}/.test(payroll) &&
    /weekStart=\{weekStart\}/.test(payroll),
);
check(
  "employee timesheets show payable adjustment badge and plus duration",
  /Payable adjustment/.test(timesheets) &&
    /\+\{formatExtraHoursDuration\(row\.duration_minutes\)\}/.test(timesheets),
);
check(
  "employee has no delete/edit extra hours actions",
  !/deleteExtraHours/.test(timesheets) && !/ExtraHoursModal/.test(timesheets),
);
check(
  "Past Time logs week detail shows payable adjustments",
  /Past Time logs/.test(weekDetail) &&
    /data-testid="past-time-logs-day-cards"/.test(weekDetail) &&
    /Payable adjustment/.test(weekDetail) &&
    /listMyExtraHours/.test(weekDetail) &&
    !/deleteExtraHours/.test(weekDetail),
);
check(
  "service uses authoritative payroll_week_start_for_work_date and flush-only stale mark",
  /payroll_week_start_for_work_date/.test(service) &&
    /commit=False/.test(service) &&
    !/def _week_start_for_work_date/.test(service),
);
check(
  "service marks stale via existing invalidation, never recalculates money itself",
  /mark_payroll_period_needs_recalculation/.test(service) &&
    !/recalculate_payroll/.test(service) &&
    !/compute_money_bundle/.test(service),
);
check(
  "calculation merges payable extras without mutating shift seconds helper",
  /payable_extra_hours_seconds_by_work_date/.test(calc) &&
    /clocked_rounded_seconds_by_work_date_payroll_week/.test(calc) &&
    /_merge_daily_seconds/.test(calc),
);
check("create/patch forbid affects_payroll from clients", /extra=["']forbid["']/.test(schemas));
check("repository exclusive end filter", /work_date < end_date/.test(repo));
check(
  "new migration drops non-payroll check; old migration untouched",
  /ck_timesheet_extra_hours_non_payroll/.test(migrationNew) &&
    /down_revision[\s\S]*w6x7y8z9a0b1/.test(migrationNew) &&
    /affects_payroll = false/.test(migrationOld),
);
check(
  "no malformed Unicode in Extra hours UI text",
  !/ÔÇ|â€|â |�|\uFFFD|Loading extra hours…/.test(payroll) &&
    /Loading extra hours\.\.\./.test(payroll),
);
check(
  "error state has Retry calling Extra hours loader",
  /data-testid="extra-hours-retry-button"/.test(payroll) &&
    /reloadExtraHoursForUser\(row\.user_id\)/.test(payroll),
);
check("Edit shift action still present", /Edit shift/.test(payroll));
check("no payroll recalculate in frontend API", !/recalculatePayroll|recalculate_payroll/.test(api));
check("modal uses shared Modal", /<Modal/.test(modal));
check("submit via form attr only", /form="extra-hours-form"/.test(modal));
check("Cancel is type=button", /type="button"[\s\S]{0,120}Cancel|Cancel[\s\S]{0,120}type="button"/.test(modal));

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
