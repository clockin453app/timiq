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
const roles = read(srcRoot, "features/auth/roles.ts");
const schemas = read(apiRoot, "app/modules/timesheet_extra_hours/schemas.py");
const service = read(apiRoot, "app/modules/timesheet_extra_hours/service.py");
const repo = read(apiRoot, "app/modules/timesheet_extra_hours/repository.py");

const toolbarBlock = payroll.slice(
  payroll.indexOf('aria-label={t("payroll.report.actions"'),
  payroll.indexOf("payroll.report.total_hours") > 0
    ? payroll.indexOf('{paidRowCount > 0 ? (')
    : payroll.length,
);

check(
  "original lucide toolbar icon imports",
  /import \{ Calendar, FileDown, FileSpreadsheet, FileText, Printer \} from "lucide-react"/.test(
    payroll,
  ),
);
check("toolbar uses FileDown icon component", /<FileDown\b/.test(toolbarBlock));
check("toolbar uses FileSpreadsheet icon component", /<FileSpreadsheet\b/.test(toolbarBlock));
check("toolbar uses Printer icon component", /<Printer\b/.test(toolbarBlock));
check("toolbar uses FileText icon component", /<FileText\b/.test(toolbarBlock));
check(
  "no Unicode placeholder toolbar icons",
  !/[📥📄🖨📋📤]|\\u[0-9a-fA-F]{4}/.test(toolbarBlock) &&
    !/aria-label=\{t\("payroll\.report\.export_csv_short"[\s\S]{0,220}>\s*[A-Za-z📄📥]/.test(
      toolbarBlock,
    ),
);
check("CSV handler connected", /onClick=\{handleCsv\}/.test(toolbarBlock));
check("Excel handler connected", /onClick=\{handleExcelDownload\}/.test(toolbarBlock));
check("Print handler connected", /onClick=\{handlePrint\}/.test(toolbarBlock));
check("PDF handler connected", /onClick=\{handlePdfDownload\}/.test(toolbarBlock));
check(
  "toolbar icon buttons keep compact square sizing",
  /className="h-9 w-9 shrink-0 px-0"/.test(toolbarBlock) &&
    /<FileDown[^>]*className="h-4 w-4 shrink-0"/.test(toolbarBlock),
);
check("toolbar icons keep aria-labels", /aria-label=\{t\("payroll\.report\.export_csv_short"/.test(toolbarBlock));
check("toolbar icons keep title tooltips", /title=\{t\("payroll\.report\.export_csv_short"/.test(toolbarBlock));
check(
  "toolbar icons keep disabled/loading behaviour",
  /disabled=\{loading \|\| !activeCompanyId\}/.test(toolbarBlock),
);

check("canAccessManagement used for Extra hours gate", /canAccessManagement\(user\)/.test(payroll));
check(
  "canAccessManagement covers Admin and Administrator",
  /function canAccessManagement\(user: AuthUser\) \{\s*return isAdministrator\(user\) \|\| isAdmin\(user\);/.test(
    roles,
  ),
);
check(
  "Add extra hours gated for management roles only",
  /canManageExtraHours \? \([\s\S]*?data-testid="add-extra-hours-button"[\s\S]*?Add extra hours[\s\S]*?\) : null/.test(
    payroll,
  ),
);
check(
  "employees do not get ungated Add extra hours",
  !/data-testid="add-extra-hours-button"[\s\S]{0,80}Add extra hours/.test(
    payroll.replace(
      /canManageExtraHours \? \([\s\S]*?data-testid="add-extra-hours-button"[\s\S]*?\) : null/,
      "",
    ),
  ),
);
check(
  "Add extra hours beside SHIFT LINES heading",
  /Shift lines \(this week\)[\s\S]{0,400}data-testid="add-extra-hours-button"/.test(payroll) &&
    !/justify-between[\s\S]{0,120}Shift lines \(this week\)/.test(payroll),
);
check(
  "Add extra hours not gated on Extra hours array length",
  !/extraList\.length[\s\S]{0,80}add-extra-hours-button|add-extra-hours-button[\s\S]{0,80}extraList\.length/.test(
    payroll,
  ),
);
check(
  "Add extra hours visible while Extra hours loading",
  /canManageExtraHours \? \([\s\S]*?add-extra-hours-button[\s\S]*?\) : null[\s\S]*?extraRows === "loading"/.test(
    payroll,
  ),
);
check(
  "no malformed Unicode in Extra hours UI text",
  !/ÔÇ|â€|â |�|\uFFFD|Loading extra hours…/.test(payroll) &&
    /Loading extra hours\.\.\./.test(payroll) &&
    !/ÔÇ|â€|â |�|\uFFFD/.test(
      read(srcRoot, "app/(app)/timesheets/timesheets-client.tsx"),
    ),
);
check(
  "Add extra hours remains visible after list error",
  /extraRows === "error"/.test(payroll) &&
    /data-testid="extra-hours-load-error"/.test(payroll) &&
    /setExtraHoursByUser\(\(prev\) => \(\{ \.\.\.prev, \[userId\]: "error" \}\)\)/.test(payroll) &&
    /canManageExtraHours \? \([\s\S]*?add-extra-hours-button[\s\S]*?\) : null[\s\S]*?extraRows === "error"/.test(
      payroll,
    ),
);
check(
  "error state has Retry button",
  /data-testid="extra-hours-retry-button"/.test(payroll) &&
    /aria-label="Retry loading extra hours"/.test(payroll) &&
    /data-testid="extra-hours-retry-button"[\s\S]{0,500}type="button"[\s\S]{0,120}>\s*Retry/.test(
      payroll,
    ),
);
check(
  "Retry calls existing Extra hours loader only",
  /async function reloadExtraHoursForUser\(userId: string\)/.test(payroll) &&
    /onClick=\{\(\) => void reloadExtraHoursForUser\(row\.user_id\)\}/.test(payroll) &&
    /await reloadExtraHoursForUser\(userId\)/.test(payroll) &&
    !/onClick=\{\(\) => void reloadExtraHoursForUser\(row\.user_id\)\}[\s\S]{0,300}(?:loadReport|recalculatePayroll)/.test(
      payroll,
    ),
);
check(
  "clicking Add extra hours opens modal with user_id",
  /setExtraHoursModal\(\{[\s\S]*?mode: "create"[\s\S]*?userId: row\.user_id/.test(payroll),
);
check(
  "modal receives employee user_id not payroll item id",
  /employeeUserId=\{extraHoursModal\.userId\}/.test(payroll) &&
    !/employeeUserId=\{extraHoursModal\.id\}/.test(payroll) &&
    !/userId: row\.id/.test(payroll),
);
check(
  "modal receives current payroll week",
  /weekStart=\{weekStart\}/.test(payroll) && /weekEndInclusive=\{addDaysIsoYmd\(weekStart, 6\)\}/.test(payroll),
);
check("company context preserved on modal", /companyId=\{activeCompanyId\}/.test(payroll));
check(
  "Add extra hours does not trigger payroll recalculation",
  !/onSaved[\s\S]{0,500}recalculatePayroll|setExtraHoursModal[\s\S]{0,400}recalculatePayroll/.test(
    payroll,
  ),
);
check(
  "Add extra hours does not approve payroll",
  !/setExtraHoursModal[\s\S]{0,400}approvePayroll|onSaved[\s\S]{0,400}approvePayroll/.test(payroll),
);

check("EXTRA HOURS non-payroll section", /Extra hours - non-payroll/.test(payroll));
check("Non-payroll badge in admin rows", /Non-payroll/.test(payroll));
check("informational Extra recorded hours separate", /Extra recorded hours/.test(payroll));
check(
  "payroll totals remain from period rounded seconds / money fields",
  /total_rounded_seconds/.test(payroll) &&
    /period\.total_gross/.test(payroll) &&
    /period\.total_net/.test(payroll) &&
    !/extraTotal[\s\S]{0,80}total_rounded_seconds|formatHoursFromSeconds\(extra/.test(payroll),
);
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
