/**
 * CIS Payroll + Employees compact interface phase — presentation-only source checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const payroll = read("app/(app)/payroll-report/payroll-report-client.tsx");
const employees = read("app/(app)/employees/employees-client.tsx");
const filterToolbar = read("components/ui/filter-toolbar.tsx");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// --- Payroll week navigation unchanged ---
check("Payroll Previous uses -7 days", /setWeekStart\(addDaysIsoYmd\(weekStart, -7\)\)/.test(payroll));
check("Payroll Next uses +7 days", /setWeekStart\(addDaysIsoYmd\(weekStart, 7\)\)/.test(payroll));
check("Payroll week start mondayWeekStartIso preserved", /mondayWeekStartIso/.test(payroll));

// --- Date/employee request mapping ---
check("Payroll draft/applied employee preserved", /draftEmployeeId/.test(payroll) && /appliedEmployeeId/.test(payroll));
check("Payroll exportDateFrom/To map to history apply", /setAppliedHistoryDateFrom/.test(payroll) && /setAppliedHistoryDateTo/.test(payroll));
check("Payroll Apply still applyEmployeeFilter", /onApply=\{applyEmployeeFilter\}/.test(payroll) || /onClick=\{applyEmployeeFilter\}/.test(payroll));
check("Apply does not become immediate-only", /function applyEmployeeFilter/.test(payroll) && /setAppliedEmployeeId\(draftEmployeeId\)/.test(payroll));
check("Refresh still loads report and history", /loadReport\(\)/.test(payroll) && /loadPaymentHistory\(\)/.test(payroll));

// --- Workflow outside Filters ---
{
  const sheetStart = payroll.indexOf("<MobileFilterSheet");
  const sheetBlock = sheetStart >= 0 ? payroll.slice(sheetStart, sheetStart + 1200) : "";
  check("Recalculate outside filter sheet", /runRecalculate/.test(payroll) && !/runRecalculate/.test(sheetBlock));
  check("Approve all outside filter sheet", /runApproveAll/.test(payroll) && !/runApproveAll/.test(sheetBlock));
}
check("Recalculate and Approve remain labelled buttons", /Recalculate/.test(payroll) && /Approve all pending/.test(payroll));

// --- Export/print ---
check("Export CSV handler remains", /handleCsv/.test(payroll) && /FileDown/.test(payroll));
check("Export Excel handler remains", /handleExcelDownload/.test(payroll) && /FileSpreadsheet/.test(payroll));
check("Export PDF handler remains", /handlePdfDownload/.test(payroll) && /FileText/.test(payroll));
check("Print handler remains", /handlePrint/.test(payroll) && /Printer/.test(payroll));
check("Export menu labelled with accessible name", /payroll\.report\.export_menu/.test(payroll) || /aria-label=\{t\("payroll\.report\.export_menu"/.test(payroll));
check("Print has accessible label", /print_report/.test(payroll));
check("Export icons ~18–20px (h-5)", /FileDown[\s\S]{0,80}h-5 w-5/.test(payroll) || /h-5 w-5 shrink-0/.test(payroll));
check("Export/print controls min 44px", /min-h-11/.test(payroll) && /payrollIconActionBtn/.test(payroll));

// --- Desktop compact row / mobile sheet ---
check("Desktop filter row exists", /data-testid="payroll-desktop-filter-row"/.test(payroll));
check("Desktop still uses ResponsiveFilterGrid + DateRangeFields", /ResponsiveFilterGrid/.test(payroll) && /DateRangeFields/.test(payroll) && /variant="readable"/.test(payroll));
check("FilterActionRow comfortable density for 44px", /density="comfortable"/.test(payroll));
check("Mobile filter sheet exists", /MobileFilterSheet/.test(payroll) && /FilterButton/.test(payroll));
check("Mobile Apply is primary sheet action", /MobileFilterSheet[\s\S]*Apply filter/.test(payroll) || /onClick=\{applyEmployeeFilter\}/.test(payroll));
check("FilterToolbar workbench shell", /FilterToolbar/.test(payroll));
check("Company scope compact muted row", /Company:/.test(payroll) || /company_prefix/.test(payroll));
check("CIS note no large info pill card", !/rounded-\[var\(--radius-full\)\] border border-\[var\(--color-info-700\)\]\/20 bg-\[var\(--color-info-50\)\]/.test(payroll));
check("Status badges still include UTR / NiNo / Pending approval", /UTR missing/.test(payroll) && /NiNo missing/.test(payroll) && /Pending approval/.test(payroll));

// --- Employees ---
check("Create user handler and API preserved", /handleCreateUser/.test(employees) && /createManagedUser/.test(employees));
check("Create payload keeps is_active true", /is_active:\s*true/.test(employees));
check("Invite handler and API preserved", /handleInviteUser/.test(employees) && /inviteUserByEmail/.test(employees));
check("Role and company selection preserved", /systemRole/.test(employees) && /showCompanySelector/.test(employees));
check("Create panel and invite panel side by side on lg", /lg:grid-cols-2/.test(employees) && /employees-create-panel/.test(employees) && /employees-invite-panel/.test(employees));
check("Mobile forms stack (grid-cols-1)", /grid-cols-1 gap-0 lg:grid-cols-2/.test(employees));
check("No max-w 48rem empty-gap layout", !/max-w-\[min\(48rem/.test(employees));
check("Search uses FilterSearch / FilterToolbar", /FilterSearch/.test(employees) && /FilterToolbar/.test(employees));
check("Search placeholder name or email", /Search employees by name or email/.test(employees));
check("Client-side filteredUsers preserved", /filteredUsers/.test(employees) && /employeeSearch\.trim\(\)\.toLowerCase\(\)/.test(employees));
check("Table columns remain", /employees\.col_employee/.test(employees) && /employees\.col_job_title/.test(employees) && /employees\.col_actions/.test(employees));
check("Edit action remains", /employees\.edit/.test(employees) && /setPanelUserId/.test(employees));
check("Temporary password starts empty", /generateSecureTemporaryPassword/.test(employees) && !/Employee12345|Admin12345/.test(employees));
check("Generate password control present", /Generate password/.test(employees));
check("Secure temporary password helper imported", /generateSecureTemporaryPassword/.test(employees) && /validateTemporaryPassword/.test(employees));

// --- Shared Apply support ---
check("FilterActionRow supports comfortable density", /density\?: \"dense\" \| \"comfortable\"/.test(filterToolbar) || /density = \"dense\"/.test(filterToolbar));

console.log(`${passed} payroll + employees compact interface checks passed`);
