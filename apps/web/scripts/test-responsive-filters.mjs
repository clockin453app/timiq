/**
 * Phase 1A: responsive date/filter toolbar wiring.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, "..", "src");
const read = (relative) =>
  fs.readFileSync(path.join(srcRoot, relative), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

const dateField = read("components/ui/date-field.tsx");
const filterToolbar = read("components/ui/filter-toolbar.tsx");
const uiIndex = read("components/ui/index.ts");
const globals = read("styles/globals.css");
const companySelector = read("features/companies/company-selector.tsx");
const payroll = read("app/(app)/payroll-report/payroll-report-client.tsx");
const timeRecords = read("app/(app)/time-records/time-records-client.tsx");

check("DateField export exists", /export function DateField/.test(dateField));
check("DateRangeFields export exists", /export function DateRangeFields/.test(dateField));
check("ReadableDateField preserves showPicker", /showPicker/.test(dateField));
check("DateRangeFields stacks below 360 and two columns from 360", /min-\[360px\]:grid-cols-2/.test(dateField));
check("DateField uses native type=date", /type="date"/.test(dateField));
check("DateField is full width with min-w-0", /w-full min-w-0 max-w-full/.test(dateField));
check("DateField mobile min height 44px", /min-h-11/.test(dateField));
check("no fixed 10rem width in DateField module", !/w-\[10rem\]/.test(dateField) && !/min-w-\[9\.75rem\]/.test(dateField));

check("FilterActionRow export exists", /export function FilterActionRow/.test(filterToolbar));
check("ResponsiveFilterGrid export exists", /export function ResponsiveFilterGrid/.test(filterToolbar));
check("FilterActionRow mobile touch height", /min-h-11/.test(filterToolbar));
check("FilterActionRow keeps labelled Refresh optional", /refreshLabel/.test(filterToolbar));
check("FilterActionRow compact densifies at md", /md:min-h-8/.test(filterToolbar) || /md:h-8/.test(filterToolbar));
check("ResponsiveFilterGrid uses md for desktop row", /md:flex-row/.test(filterToolbar));
check("ui index exports filter helpers", /DateRangeFields/.test(uiIndex) && /FilterActionRow/.test(uiIndex));

check("global timiq-date-input no longer forces 9.75rem min-width", !/min-width:\s*9\.75rem/.test(globals));
check("global timiq-date-input keeps min-width 0", /input\.timiq-input\.timiq-date-input[\s\S]*?min-width:\s*0/.test(globals));

check("CompanySelector full width on mobile", /w-full min-w-0 max-w-full/.test(companySelector));
check("CompanySelector no max-w-\[10rem\] on small screens", !/max-w-\[10rem\]/.test(companySelector));
check("CompanySelector desktop may use sm:max-w-md", /sm:max-w-md/.test(companySelector));
check("CompanySelector shows label on mobile by default", /showLabelOnMobile/.test(companySelector));

check("Payroll uses DateRangeFields", /DateRangeFields/.test(payroll));
check("Payroll uses ResponsiveFilterGrid", /ResponsiveFilterGrid/.test(payroll));
check("Payroll uses FilterActionRow", /FilterActionRow/.test(payroll));
check("Payroll readable date variant preserved", /variant="readable"/.test(payroll));
check("Payroll Apply still calls applyEmployeeFilter", /onApply=\{applyEmployeeFilter\}/.test(payroll));
check("Payroll Refresh still loads report and history", /loadReport\(\)/.test(payroll) && /loadPaymentHistory\(\)/.test(payroll));
check("Payroll filter area has no w-[10rem] date fields", !/(?:^|[\s"'`])w-\[10rem\]/.test(payroll));
check(
  "Payroll client has no min-w-[9.75rem] in filter path",
  !/min-w-\[9\.75rem\]/.test(payroll),
);
check("Payroll keeps export/print actions separate", /FileDown/.test(payroll) && /Printer/.test(payroll));
check("Payroll does not wait for 1280px for filter layout", !/min-\[1280px\]:grid-cols/.test(payroll));
check("Payroll still uses exportDateFrom/To state", /exportDateFrom/.test(payroll) && /setExportDateFrom/.test(payroll));

check("Time Records uses DateRangeFields", /DateRangeFields/.test(timeRecords));
check("Time Records uses ResponsiveFilterGrid", /ResponsiveFilterGrid/.test(timeRecords));
check("Time Records uses FilterActionRow", /FilterActionRow/.test(timeRecords));
check("Time Records Apply remains form submit", /applyType="submit"/.test(timeRecords));
check("Time Records still uses handleApplyFilters", /onSubmit=\{handleApplyFilters\}/.test(timeRecords));
check("Time Records datetime modals unchanged type", (timeRecords.match(/type="datetime-local"/g) || []).length >= 5);
check("Time Records employee select full width", /time-records-filter-employee[\s\S]*?w-full min-w-0/.test(timeRecords));

console.log(`${passed} responsive filter checks passed`);
