"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui";
import {
  canManageUser,
  clearManagedUserHistory,
  deleteManagedUser,
  isAdministrator,
  resetManagedUserPassword,
  updateManagedUser,
  updateManagedUserStatus,
  type AuthUser,
  type SystemRole,
} from "../../features/auth";
import {
  getManagedEmployeeProfile,
  patchManagedEmployeeProfile,
} from "../../features/employee-profiles/api";
import {
  getEmployeePayeSettings,
  patchEmployeePayeSettings,
  type PayrollType,
  type SalaryType,
  type PayeHourSource,
  type TaxBasis,
  type StudentLoanPlan,
  type PensionEnrolmentStatus,
  type PensionSchemeBasis,
  type PensionReliefMethod,
} from "../../features/paye-payroll/api";
import { type Company } from "../../features/companies/api";

function formatRole(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getRoleOptions(currentUser: AuthUser): SystemRole[] {
  if (isAdministrator(currentUser)) {
    return ["employee", "admin", "administrator"];
  }
  return ["employee"];
}

export type EmployeeDetailPanelProps = {
  user: AuthUser;
  companies: Company[];
  currentUser: AuthUser;
  onClose: () => void;
  onRefresh: () => Promise<void>;
};

export function EmployeeDetailPanel({
  user,
  companies,
  currentUser,
  onClose,
  onRefresh,
}: EmployeeDetailPanelProps) {
  const [email, setEmail] = useState(user.email);
  const [systemRole, setSystemRole] = useState<SystemRole>(user.system_role);
  const [companyId, setCompanyId] = useState(user.company_id ?? "");
  const [resetPassword, setResetPassword] = useState(
    user.system_role === "admin" ? "Admin12345" : "Employee12345",
  );
  const [localError, setLocalError] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [clearHistoryPhrase, setClearHistoryPhrase] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [earlyAccessEnabled, setEarlyAccessEnabled] = useState(false);
  const [hourlyRateStr, setHourlyRateStr] = useState("");
  const [taxRateStr, setTaxRateStr] = useState("");
  const [paymentMode, setPaymentMode] = useState<"net_payment" | "gross_payment">("net_payment");
  const [payrollType, setPayrollType] = useState<PayrollType>("cis_subcontractor");
  const [employeeProfileLoaded, setEmployeeProfileLoaded] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [isUpdatingEarlyAccess, setIsUpdatingEarlyAccess] = useState(false);
  const [isSavingPayrollRates, setIsSavingPayrollRates] = useState(false);
  const [jobTitleStr, setJobTitleStr] = useState("");
  const [niStr, setNiStr] = useState("");
  const [utrStr, setUtrStr] = useState("");
  const [isSavingEmployment, setIsSavingEmployment] = useState(false);
  const [isSavingPayeSettings, setIsSavingPayeSettings] = useState(false);
  const [payeSalaryType, setPayeSalaryType] = useState<SalaryType>("hourly");
  const [payeMonthlySalary, setPayeMonthlySalary] = useState("");
  const [payeHourlyRate, setPayeHourlyRate] = useState("");
  const [payeUsesTimeRecords, setPayeUsesTimeRecords] = useState(true);
  const [payeHourSource, setPayeHourSource] = useState<PayeHourSource>("completed_time_shifts");
  const [payeTaxCode, setPayeTaxCode] = useState("");
  const [payeTaxBasis, setPayeTaxBasis] = useState<TaxBasis>("cumulative");
  const [payeNiCategory, setPayeNiCategory] = useState("");
  const [payeStudentLoanPlan, setPayeStudentLoanPlan] = useState<StudentLoanPlan>("none");
  const [payePostgraduateLoan, setPayePostgraduateLoan] = useState(false);
  const [payePensionStatus, setPayePensionStatus] = useState<PensionEnrolmentStatus>("not_eligible");
  const [payeEmployeePensionPercent, setPayeEmployeePensionPercent] = useState("");
  const [payeEmployerPensionPercent, setPayeEmployerPensionPercent] = useState("");
  const [payePensionBasis, setPayePensionBasis] = useState<PensionSchemeBasis>("qualifying_earnings");
  const [payePensionReliefMethod, setPayePensionReliefMethod] = useState<PensionReliefMethod>("relief_at_source");

  const showEmployeeExtendedFields =
    canManageUser(currentUser, user) && user.system_role === "employee";

  const profileFetchGeneration = useRef(0);

  const reloadEmployeeProfile = useCallback(async () => {
    if (!showEmployeeExtendedFields) {
      return;
    }
    const generation = (() => {
      profileFetchGeneration.current += 1;
      return profileFetchGeneration.current;
    })();
    setProfileLoading(true);
    setProfileLoadError(null);
    setEmployeeProfileLoaded(false);
    try {
      const profile = await getManagedEmployeeProfile(user.id);
      if (generation !== profileFetchGeneration.current) {
        return;
      }
      setEarlyAccessEnabled(profile.early_access_enabled);
      setHourlyRateStr(profile.hourly_rate ?? "");
      setTaxRateStr(profile.tax_rate ?? "");
      setPaymentMode(profile.payment_mode === "gross_payment" ? "gross_payment" : "net_payment");
      setPayrollType(profile.payroll_type === "paye_employee" ? "paye_employee" : "cis_subcontractor");
      setJobTitleStr(profile.job_title ?? "");
      setNiStr(profile.national_insurance_number ?? "");
      setUtrStr(profile.utr_number ?? "");
      const payeSettings = await getEmployeePayeSettings(user.id);
      setPayeSalaryType(payeSettings.salary_type);
      setPayeMonthlySalary(payeSettings.monthly_salary ?? "");
      setPayeHourlyRate(payeSettings.paye_hourly_rate ?? "");
      setPayeUsesTimeRecords(payeSettings.paye_uses_time_records);
      setPayeHourSource(payeSettings.paye_hour_source);
      setPayeTaxCode(payeSettings.tax_code ?? "");
      setPayeTaxBasis(payeSettings.tax_basis);
      setPayeNiCategory(payeSettings.ni_category ?? "");
      setPayeStudentLoanPlan(payeSettings.student_loan_plan);
      setPayePostgraduateLoan(payeSettings.postgraduate_loan);
      setPayePensionStatus(payeSettings.pension_enrolment_status);
      setPayeEmployeePensionPercent(payeSettings.employee_pension_percent ?? "");
      setPayeEmployerPensionPercent(payeSettings.employer_pension_percent ?? "");
      setPayePensionBasis(payeSettings.pension_scheme_basis);
      setPayePensionReliefMethod(payeSettings.pension_relief_method);
      setEmployeeProfileLoaded(true);
    } catch {
      if (generation !== profileFetchGeneration.current) {
        return;
      }
      setEmployeeProfileLoaded(false);
      setProfileLoadError("Could not load employee profile.");
    } finally {
      if (generation === profileFetchGeneration.current) {
        setProfileLoading(false);
      }
    }
  }, [showEmployeeExtendedFields, user.id]);

  useEffect(() => {
    setEmail(user.email);
    setSystemRole(user.system_role);
    setCompanyId(user.company_id ?? "");
    setResetPassword(user.system_role === "admin" ? "Admin12345" : "Employee12345");
  }, [user]);

  useEffect(() => {
    setLocalError("");
    setLocalSuccess("");
    setClearHistoryPhrase("");
    setDeletePhrase("");
  }, [user.id]);

  useEffect(() => {
    if (!localSuccess) {
      return undefined;
    }
    const id = window.setTimeout(() => setLocalSuccess(""), 5000);
    return () => window.clearTimeout(id);
  }, [localSuccess]);

  useEffect(() => {
    if (!showEmployeeExtendedFields) {
      setProfileLoading(false);
      setProfileLoadError(null);
      setEmployeeProfileLoaded(false);
      return;
    }
    void reloadEmployeeProfile();
  }, [showEmployeeExtendedFields, user.id, reloadEmployeeProfile]);

  const showCompanyField =
    isAdministrator(currentUser) && systemRole !== "administrator";

  const targetIsAdministrator = user.system_role === "administrator";
  const showDangerZone =
    isAdministrator(currentUser) &&
    !targetIsAdministrator &&
    user.id !== currentUser.id;

  async function handleSaveEmployment() {
    setLocalError("");
    setLocalSuccess("");
    setIsSavingEmployment(true);
    try {
      await patchManagedEmployeeProfile(user.id, {
        job_title: jobTitleStr.trim() === "" ? null : jobTitleStr.trim(),
        national_insurance_number: niStr.trim() === "" ? null : niStr.trim(),
      });
      setLocalSuccess("Employment details saved.");
      await onRefresh();
      await reloadEmployeeProfile();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not save employment details.");
    } finally {
      setIsSavingEmployment(false);
    }
  }

  async function handleSavePayrollRates() {
    setLocalError("");
    setLocalSuccess("");
    setIsSavingPayrollRates(true);
    try {
      await patchManagedEmployeeProfile(user.id, {
        hourly_rate: hourlyRateStr.trim() === "" ? null : hourlyRateStr.trim(),
        tax_rate: taxRateStr.trim() === "" ? null : taxRateStr.trim(),
        payment_mode: paymentMode,
        utr_number: utrStr.trim() === "" ? null : utrStr.trim(),
      });
      setLocalSuccess("Payroll rates saved.");
      await onRefresh();
      await reloadEmployeeProfile();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not save payroll rates.");
    } finally {
      setIsSavingPayrollRates(false);
    }
  }

  async function handleSavePayeSettings() {
    setLocalError("");
    setLocalSuccess("");
    setIsSavingPayeSettings(true);
    try {
      await patchManagedEmployeeProfile(user.id, {
        payroll_type: payrollType,
      });
      await patchEmployeePayeSettings(user.id, {
        pay_frequency: "monthly",
        salary_type: payeSalaryType,
        monthly_salary: payeMonthlySalary.trim() === "" ? null : payeMonthlySalary.trim(),
        paye_hourly_rate: payeHourlyRate.trim() === "" ? null : payeHourlyRate.trim(),
        paye_uses_time_records: payeUsesTimeRecords,
        paye_hour_source: payeHourSource,
        tax_code: payeTaxCode.trim() === "" ? null : payeTaxCode.trim(),
        tax_basis: payeTaxBasis,
        ni_category: payeNiCategory.trim() === "" ? null : payeNiCategory.trim(),
        student_loan_plan: payeStudentLoanPlan,
        postgraduate_loan: payePostgraduateLoan,
        pension_enrolment_status: payePensionStatus,
        employee_pension_percent:
          payeEmployeePensionPercent.trim() === "" ? null : payeEmployeePensionPercent.trim(),
        employer_pension_percent:
          payeEmployerPensionPercent.trim() === "" ? null : payeEmployerPensionPercent.trim(),
        pension_scheme_basis: payePensionBasis,
        pension_relief_method: payePensionReliefMethod,
      });
      setLocalSuccess("PAYE monthly settings saved.");
      await onRefresh();
      await reloadEmployeeProfile();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not save PAYE settings.");
    } finally {
      setIsSavingPayeSettings(false);
    }
  }

  async function handleEarlyAccessChange(next: boolean) {
    const previous = earlyAccessEnabled;
    setEarlyAccessEnabled(next);
    setIsUpdatingEarlyAccess(true);
    setLocalError("");
    setLocalSuccess("");
    try {
      await patchManagedEmployeeProfile(user.id, { early_access_enabled: next });
      setLocalSuccess("Early access updated.");
      await onRefresh();
      await reloadEmployeeProfile();
    } catch (error) {
      setEarlyAccessEnabled(previous);
      setLocalError(
        error instanceof Error ? error.message : "Could not update early access.",
      );
    } finally {
      setIsUpdatingEarlyAccess(false);
    }
  }

  async function handleSaveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    setLocalSuccess("");
    setIsSavingUser(true);
    try {
      await updateManagedUser(user.id, {
        email,
        system_role: systemRole,
        company_id:
          isAdministrator(currentUser) && systemRole !== "administrator"
            ? companyId || null
            : null,
      });
      setLocalSuccess("User details saved.");
      await onRefresh();
      if (canManageUser(currentUser, user) && user.system_role === "employee") {
        await reloadEmployeeProfile();
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not save user.");
    } finally {
      setIsSavingUser(false);
    }
  }

  async function handleResetPassword() {
    setLocalError("");
    setLocalSuccess("");
    setIsResettingPassword(true);
    try {
      await resetManagedUserPassword(user.id, resetPassword);
      setLocalSuccess("Password reset.");
      await onRefresh();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not reset password.");
    } finally {
      setIsResettingPassword(false);
    }
  }

  async function handleToggleStatus() {
    if (user.id === currentUser.id) {
      setLocalError("You cannot change your own active status here.");
      return;
    }
    setLocalError("");
    setLocalSuccess("");
    setIsTogglingStatus(true);
    try {
      await updateManagedUserStatus(user.id, !user.is_active);
      setLocalSuccess(user.is_active ? "Employee deactivated." : "Employee activated.");
      await onRefresh();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not update status.");
    } finally {
      setIsTogglingStatus(false);
    }
  }

  async function handleClearHistory() {
    if (clearHistoryPhrase !== "CLEAR HISTORY") {
      setLocalError('Type CLEAR HISTORY to confirm.');
      return;
    }
    setLocalError("");
    setLocalSuccess("");
    setIsClearingHistory(true);
    try {
      await clearManagedUserHistory(user.id);
      setLocalSuccess("Operational history cleared.");
      setClearHistoryPhrase("");
      await onRefresh();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not clear history.");
    } finally {
      setIsClearingHistory(false);
    }
  }

  async function handleDeleteUser() {
    if (deletePhrase !== "DELETE") {
      setLocalError('Type DELETE to confirm.');
      return;
    }
    setLocalError("");
    setLocalSuccess("");
    setIsDeletingUser(true);
    try {
      await deleteManagedUser(user.id);
      await onRefresh();
      onClose();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not delete user.");
    } finally {
      setIsDeletingUser(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6"
      role="dialog"
    >
      <div className="timiq-sheet mx-auto my-4 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md sm:max-w-[min(56rem,calc(100vw-3rem))]">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--color-text)]">Edit employee</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{user.email}</p>
            {canManageUser(currentUser, user) ? (
              <div className="mt-2">
                <Link
                  className="text-xs font-semibold text-[var(--color-text)] underline"
                  href={`/employees/${user.id}/clock-selfies`}
                >
                  Clock selfies
                </Link>
              </div>
            ) : null}
          </div>
          <Button onClick={onClose} type="button">
            Close
          </Button>
        </div>

        {localError ? (
          <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {localError}
          </div>
        ) : null}

        {localSuccess ? (
          <div className="mt-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {localSuccess}
          </div>
        ) : null}

        <form className="mt-4 space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3" onSubmit={handleSaveUser}>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Account
          </p>

          <label className="block text-xs font-bold text-[var(--color-text)]">
            Email
            <input
              autoComplete="email"
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          <label className="block text-xs font-bold text-[var(--color-text)]">
            Role
            <select
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              disabled={!isAdministrator(currentUser)}
              onChange={(event) => {
                const nextRole = event.target.value as SystemRole;
                setSystemRole(nextRole);
                if (nextRole === "administrator") {
                  setCompanyId("");
                }
              }}
              value={systemRole}
            >
              {getRoleOptions(currentUser).map((role) => (
                <option key={role} value={role}>
                  {formatRole(role)}
                </option>
              ))}
            </select>
          </label>

          {showCompanyField ? (
            <label className="block text-xs font-bold text-[var(--color-text)]">
              Company
              <select
                className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(event) => setCompanyId(event.target.value)}
                value={companyId}
              >
                <option value="">Global</option>
                {companies
                  .filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}

          <Button disabled={isSavingUser} type="submit">
            {isSavingUser ? "Saving..." : "Save user edits"}
          </Button>
        </form>

        {showEmployeeExtendedFields ? (
          <div className="mt-4 space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              Employment / contract information
            </p>
            {profileLoadError ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Load profile above to edit employment fields.
              </p>
            ) : profileLoading ? (
              <p className="text-xs text-[var(--color-text-muted)]">Loading profile…</p>
            ) : employeeProfileLoaded ? (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[var(--color-text)]">
                  Job title
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    disabled={isSavingEmployment}
                    onChange={(event) => setJobTitleStr(event.target.value)}
                    placeholder="e.g. Site supervisor"
                    type="text"
                    value={jobTitleStr}
                  />
                </label>
                <label className="block text-xs font-bold text-[var(--color-text)]">
                  National Insurance number
                  <input
                    autoComplete="off"
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    disabled={isSavingEmployment}
                    onChange={(event) => setNiStr(event.target.value)}
                    placeholder="From starter form after approval, or set here"
                    type="text"
                    value={niStr}
                  />
                </label>
                <Button disabled={isSavingEmployment} onClick={() => void handleSaveEmployment()} type="button">
                  {isSavingEmployment ? "Saving…" : "Save employment details"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-[var(--color-text-muted)]">Loading profile…</p>
            )}

            <div className="border-t border-[var(--color-border)] pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Clock rules
              </p>
            {profileLoadError ? (
              <div className="space-y-2">
                <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
                  {profileLoadError}
                </div>
                <Button
                  onClick={() => {
                    setProfileLoadError(null);
                    void reloadEmployeeProfile();
                  }}
                  type="button"
                  variant="secondary"
                >
                  Retry loading profile
                </Button>
              </div>
            ) : profileLoading ? (
              <p className="text-xs text-[var(--color-text-muted)]">Loading profile…</p>
            ) : employeeProfileLoaded ? (
              <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                <input
                  checked={earlyAccessEnabled}
                  className="mt-1 h-4 w-4 shrink-0"
                  disabled={isUpdatingEarlyAccess || profileLoading}
                  onChange={(event) => handleEarlyAccessChange(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="font-semibold">Early clock-in access</span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    When off, clock-in before standard start counts from standard start unless policy
                    allows otherwise.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-[var(--color-text-muted)]">Loading profile…</p>
            )}
            </div>

            <div className="border-t border-[var(--color-border)] pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                CIS payroll settings
              </p>
              {profileLoadError ? (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Fix profile loading above to edit CIS payroll settings.
                </p>
              ) : profileLoading ? (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Loading profile…</p>
              ) : employeeProfileLoaded ? (
                <div className="mt-2 space-y-2">
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    CIS hourly rate
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={profileLoading || isSavingPayrollRates}
                      onChange={(event) => setHourlyRateStr(event.target.value)}
                      placeholder="Leave blank if not set"
                      type="text"
                      value={hourlyRateStr}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    CIS tax % (employee override)
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={profileLoading || isSavingPayrollRates}
                      onChange={(event) => setTaxRateStr(event.target.value)}
                      placeholder="Uses company default if blank"
                      type="text"
                      value={taxRateStr}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    UTR (Unique Taxpayer Reference)
                    <input
                      autoComplete="off"
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={profileLoading || isSavingPayrollRates}
                      onChange={(event) => setUtrStr(event.target.value)}
                      placeholder="Digits only"
                      type="text"
                      value={utrStr}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Payment mode
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={profileLoading || isSavingPayrollRates}
                      onChange={(event) =>
                        setPaymentMode(event.target.value === "gross_payment" ? "gross_payment" : "net_payment")
                      }
                      value={paymentMode}
                    >
                      <option value="gross_payment">Gross payment</option>
                      <option value="net_payment">Net payment</option>
                    </select>
                  </label>
                  <Button
                    disabled={isSavingPayrollRates || profileLoading}
                    onClick={handleSavePayrollRates}
                    type="button"
                  >
                    {isSavingPayrollRates ? "Saving…" : "Save CIS payroll settings"}
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Loading profile…</p>
              )}
            </div>

            <div className="border-t border-[var(--color-border)] pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                PAYE monthly settings
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Phase 2A supports fixed monthly salary, numeric L tax codes such as 1257L, NI category A,
                basic pensions, and student/postgraduate loans. Other PAYE cases show as not supported until activated.
              </p>
              {profileLoadError ? (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Fix profile loading above to edit PAYE settings.
                </p>
              ) : profileLoading ? (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Loading profile…</p>
              ) : employeeProfileLoaded ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Payroll type
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) =>
                        setPayrollType(event.target.value === "paye_employee" ? "paye_employee" : "cis_subcontractor")
                      }
                      value={payrollType}
                    >
                      <option value="cis_subcontractor">CIS subcontractor</option>
                      <option value="paye_employee">PAYE employee</option>
                    </select>
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Pay frequency
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled
                      value="Monthly"
                      readOnly
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Salary type
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) =>
                        setPayeSalaryType(event.target.value === "fixed_monthly_salary" ? "fixed_monthly_salary" : "hourly")
                      }
                      value={payeSalaryType}
                    >
                      <option value="hourly">Hourly — not supported yet</option>
                      <option value="fixed_monthly_salary">Fixed monthly salary — supported</option>
                    </select>
                    {payeSalaryType === "hourly" ? (
                      <p className="mt-1 text-[11px] font-medium text-amber-900">
                        Hourly PAYE is not calculated yet. This employee will remain not supported in Monthly PAYE Report until hourly calculation is enabled.
                      </p>
                    ) : null}
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Monthly salary
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeMonthlySalary(event.target.value)}
                      placeholder="Leave blank for hourly"
                      value={payeMonthlySalary}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    PAYE hourly rate
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeHourlyRate(event.target.value)}
                      placeholder="Stored for future hourly PAYE"
                      value={payeHourlyRate}
                    />
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      Hourly PAYE foundation is stored for future use. Hourly PAYE calculation is not enabled yet.
                    </p>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text)]">
                    <input
                      checked={payeUsesTimeRecords}
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeUsesTimeRecords(event.target.checked)}
                      type="checkbox"
                    />
                    Uses time records
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Hour source
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeHourSource(event.target.value as PayeHourSource)}
                      value={payeHourSource}
                    >
                      <option value="completed_time_shifts">Completed time shifts</option>
                      <option value="manual_hours_future">Manual hours — future</option>
                    </select>
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Tax code
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeTaxCode(event.target.value)}
                      placeholder="e.g. 1257L"
                      value={payeTaxCode}
                    />
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      Only numeric L tax codes such as 1257L are calculated in Phase 2A. BR, D0, K, NT, S and C codes are not supported yet.
                    </p>
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Tax basis
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeTaxBasis(event.target.value === "month1" ? "month1" : "cumulative")}
                      value={payeTaxBasis}
                    >
                      <option value="cumulative">Cumulative</option>
                      <option value="month1">Month 1</option>
                    </select>
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    NI category
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeNiCategory(event.target.value)}
                      placeholder="e.g. A"
                      value={payeNiCategory}
                    />
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      Only NI category A is calculated in Phase 2A. Other categories will be marked not supported.
                    </p>
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Student loan plan
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeStudentLoanPlan(event.target.value as StudentLoanPlan)}
                      value={payeStudentLoanPlan}
                    >
                      <option value="none">None</option>
                      <option value="plan_1">Plan 1</option>
                      <option value="plan_2">Plan 2</option>
                      <option value="plan_4">Plan 4</option>
                      <option value="plan_5">Plan 5</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text)]">
                    <input
                      checked={payePostgraduateLoan}
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayePostgraduateLoan(event.target.checked)}
                      type="checkbox"
                    />
                    Postgraduate loan
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Pension enrolment status
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayePensionStatus(event.target.value as PensionEnrolmentStatus)}
                      value={payePensionStatus}
                    >
                      <option value="eligible">Eligible</option>
                      <option value="enrolled">Enrolled</option>
                      <option value="opted_out">Opted out</option>
                      <option value="postponed">Postponed</option>
                      <option value="not_eligible">Not eligible</option>
                    </select>
                    {payePensionStatus !== "enrolled" ? (
                      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                        Pension contributions are calculated only when status is Enrolled.
                      </p>
                    ) : null}
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Employee pension %
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeEmployeePensionPercent(event.target.value)}
                      value={payeEmployeePensionPercent}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Employer pension %
                    <input
                      className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayeEmployerPensionPercent(event.target.value)}
                      value={payeEmployerPensionPercent}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Pension scheme basis
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayePensionBasis(event.target.value as PensionSchemeBasis)}
                      value={payePensionBasis}
                    >
                      <option value="qualifying_earnings">Qualifying earnings</option>
                      <option value="total_earnings">Total earnings</option>
                    </select>
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Pension relief method
                    <select
                      className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      disabled={isSavingPayeSettings}
                      onChange={(event) => setPayePensionReliefMethod(event.target.value as PensionReliefMethod)}
                      value={payePensionReliefMethod}
                    >
                      <option value="relief_at_source">Relief at source</option>
                      <option value="net_pay_arrangement">Net pay arrangement</option>
                      <option disabled={payePensionReliefMethod !== "salary_sacrifice"} value="salary_sacrifice">
                        Salary sacrifice — not supported yet
                      </option>
                    </select>
                    {payePensionReliefMethod === "salary_sacrifice" ? (
                      <p className="mt-1 text-[11px] font-medium text-amber-900">
                        Salary sacrifice is not supported in Phase 2A and will block calculation.
                      </p>
                    ) : null}
                  </label>
                  <div className="md:col-span-2">
                    <Button disabled={isSavingPayeSettings} onClick={() => void handleSavePayeSettings()} type="button">
                      {isSavingPayeSettings ? "Saving…" : "Save PAYE monthly settings"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Loading profile…</p>
              )}
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-2 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Password
          </p>
          <input
            autoComplete="new-password"
            className="h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
            onChange={(event) => setResetPassword(event.target.value)}
            type="text"
            value={resetPassword}
          />
          <Button disabled={isResettingPassword} onClick={handleResetPassword} type="button">
            {isResettingPassword ? "Applying..." : "Reset password"}
          </Button>
        </div>

        <div className="mt-4 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Status
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Currently {user.is_active ? "active" : "inactive"}.
          </p>
          <div className="mt-2">
            <Button
              disabled={user.id === currentUser.id || isTogglingStatus}
              onClick={handleToggleStatus}
              type="button"
            >
              {isTogglingStatus ? "Updating..." : user.is_active ? "Deactivate" : "Activate"}
            </Button>
          </div>
        </div>

        {showDangerZone ? (
          <div className="mt-4 space-y-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] p-3">
            <p className="text-xs font-bold uppercase text-[var(--color-danger-700)]">
              Danger zone
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Clearing history removes operational data for this user (shifts, selfies files on disk,
              site access, profile fields). Deleting removes the account only when no blocking history
              remains.
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-[var(--color-danger-700)]">
                Clear operational history
                <input
                  className="mt-1 h-9 w-full border border-[var(--color-danger-700)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setClearHistoryPhrase(event.target.value)}
                  placeholder="Type CLEAR HISTORY"
                  type="text"
                  value={clearHistoryPhrase}
                />
              </label>
              <Button
                className="border-[var(--color-danger-700)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)]"
                disabled={isClearingHistory || clearHistoryPhrase !== "CLEAR HISTORY"}
                onClick={handleClearHistory}
                type="button"
              >
                {isClearingHistory ? "Clearing..." : "Clear history"}
              </Button>
            </div>

            <div className="space-y-2 border-t border-[var(--color-danger-700)] pt-3">
              <label className="block text-xs font-bold text-[var(--color-danger-700)]">
                Hard delete user
                <input
                  className="mt-1 h-9 w-full border border-[var(--color-danger-700)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setDeletePhrase(event.target.value)}
                  placeholder="Type DELETE"
                  type="text"
                  value={deletePhrase}
                />
              </label>
              <Button
                disabled={isDeletingUser || deletePhrase !== "DELETE"}
                onClick={handleDeleteUser}
                type="button"
                variant="danger"
              >
                {isDeletingUser ? "Deleting..." : "Delete employee"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
