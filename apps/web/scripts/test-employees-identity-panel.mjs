/**
 * Employees identity column, payroll badges, photo viewer, and tabbed edit panel.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const client = read("src/app/(app)/employees/employees-client.tsx");
const panel = read("src/app/(app)/employees/employee-detail-panel.tsx");
const identity = read("src/features/employees/employee-identity.ts");
const badge = read("src/features/employees/payroll-type-badge.tsx");
const photoBtn = read("src/features/employees/employee-photo-button.tsx");
const viewer = read("src/features/employees/employee-photo-viewer.tsx");
const faceApi = read("src/features/face-check/api.ts");
const authApi = read("src/features/auth/api.ts");

check("identity helpers exist", /resolvePayrollTypeDisplay|employeeDisplayName|employeeInitials/.test(identity));
check("CIS badge amber classes", badge.includes("#fef3c7") && badge.includes("#92400e"));
check("PAYE badge green classes", badge.includes("#dcfce7") && badge.includes("#166534"));
check("table has Employee column", client.includes('col_employee", "Employee"') || client.includes("Employee"));
check("separate Email column removed", !client.includes('col_email", "Email"'));
check("payroll type column present", client.includes("Payroll type") || client.includes("col_payroll_type"));
check("uses EmployeePhotoButton", client.includes("EmployeePhotoButton"));
check("uses PayrollTypeBadge", client.includes("PayrollTypeBadge"));
check("photo viewer wired", client.includes("EmployeePhotoViewer"));
check("thumb variant fetch", faceApi.includes('variant?: "full" | "thumb"') && photoBtn.includes('variant: "thumb"'));
check("lazy IntersectionObserver", photoBtn.includes("IntersectionObserver"));
check("viewer Escape closes", viewer.includes("Escape"));
check("viewer dialog role", viewer.includes('role="dialog"'));
check("viewer fetches full only", viewer.includes('variant: "full"'));
check("auth user has payroll_type", authApi.includes("payroll_type?"));
check("auth user has face_reference_configured", authApi.includes("face_reference_configured?"));
check("panel has tabs", panel.includes('role="tablist"') && panel.includes('role="tab"'));
check("panel Profile tab", panel.includes('"profile"') && panel.includes("Save profile"));
check("panel payroll tab", panel.includes("Employment & payroll") && panel.includes("Save payroll settings"));
check("panel security tab", panel.includes("Reset password"));
check("panel status tab", panel.includes("Deactivate") || panel.includes("Reactivate"));
check("CIS-only section", panel.includes("CIS") && panel.includes("border-l-") || panel.includes("amber"));
check("PAYE-only section", panel.includes("PAYE") && (panel.includes("paye") || panel.includes("green")));
check("payroll type selector", panel.includes("Payroll type") || panel.includes("payrollType"));
check("unsaved confirm", panel.includes("confirm") || panel.includes("unsaved"));
check("reset tab on user change", panel.includes('setActiveTab("profile")') || panel.includes("setActiveTab(\"profile\")"));
check("clock selfies link preserved", panel.includes("clock-selfies"));
check("mobile full panel height", panel.includes("100dvh") || panel.includes("h-[100dvh]"));

if (failures.length) {
  console.error("FAILED:");
  for (const item of failures) console.error("-", item);
  process.exit(1);
}
console.log(`${passed} employee identity / payroll settings checks passed`);
