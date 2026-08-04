"use client";

import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui";
import {
  canManageUser,
  clearManagedUserHistory,
  deleteManagedUser,
  generateSecureTemporaryPassword,
  isAdministrator,
  resetManagedUserPassword,
  updateManagedUser,
  updateManagedUserStatus,
  validateTemporaryPassword,
  type AuthUser,
  type SystemRole,
} from "@/features/auth";
import {
  getManagedEmployeeProfile,
  patchManagedEmployeeProfile,
} from "@/features/employee-profiles/api";
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
} from "@/features/paye-payroll/api";
import { type Company } from "@/features/companies/api";
import { EmployeePhotoButton } from "@/features/employees/employee-photo-button";
import { EmployeePhotoViewer } from "@/features/employees/employee-photo-viewer";
import {
  employeeDisplayName,
  resolvePayrollTypeDisplay,
} from "@/features/employees/employee-identity";
import { PayrollTypeBadge } from "@/features/employees/payroll-type-badge";

type EmployeePanelTab = "profile" | "payroll" | "security" | "status";

const TABS: Array<{ id: EmployeePanelTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "payroll", label: "Employment & payroll" },
  { id: "security", label: "Security" },
  { id: "status", label: "Status" },
];

const fieldLabelClass = "block text-xs font-semibold text-[var(--color-text)]";
const fieldInputClass =
  "mt-1 h-11 w-full min-w-0 rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm";

function snapshot(value: object): string {
  return JSON.stringify(value);
}

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
  const [resetPassword, setResetPassword] = useState("");
  const [passwordCopyStatus, setPasswordCopyStatus] = useState("");
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
  const [payrollType, setPayrollType] = useState<PayrollType | "">("");
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
  const [activeTab, setActiveTab] = useState<EmployeePanelTab>("profile");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [profileBaseline, setProfileBaseline] = useState("");
  const [payrollBaseline, setPayrollBaseline] = useState("");
  const [securityBaseline, setSecurityBaseline] = useState("");
  const [statusBaseline, setStatusBaseline] = useState("");

  const showEmployeeExtendedFields =
    canManageUser(currentUser, user) && user.system_role === "employee";

  const profileFetchGeneration = useRef(0);
  const previousUserIdRef = useRef(user.id);
  const dirtyRef = useRef(false);
  const accountValuesRef = useRef({ email, systemRole, companyId });
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const photoButtonContainerRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const profileSnapshot = useMemo(
    () =>
      snapshot({
        account: { email, systemRole, companyId },
        employment: { jobTitleStr, niStr },
        earlyAccessEnabled,
      }),
    [companyId, earlyAccessEnabled, email, jobTitleStr, niStr, systemRole],
  );
  const payrollSnapshot = useMemo(
    () =>
      snapshot({
        payrollType,
        hourlyRateStr,
        taxRateStr,
        paymentMode,
        utrStr,
        payeSalaryType,
        payeMonthlySalary,
        payeHourlyRate,
        payeUsesTimeRecords,
        payeHourSource,
        payeTaxCode,
        payeTaxBasis,
        payeNiCategory,
        payeStudentLoanPlan,
        payePostgraduateLoan,
        payePensionStatus,
        payeEmployeePensionPercent,
        payeEmployerPensionPercent,
        payePensionBasis,
        payePensionReliefMethod,
      }),
    [
      hourlyRateStr,
      paymentMode,
      payeEmployeePensionPercent,
      payeEmployerPensionPercent,
      payeHourSource,
      payeHourlyRate,
      payeMonthlySalary,
      payeNiCategory,
      payePensionBasis,
      payePensionReliefMethod,
      payePensionStatus,
      payePostgraduateLoan,
      payeSalaryType,
      payeStudentLoanPlan,
      payeTaxBasis,
      payeTaxCode,
      payeUsesTimeRecords,
      payrollType,
      taxRateStr,
      utrStr,
    ],
  );
  const securitySnapshot = useMemo(
    () => snapshot({ resetPassword }),
    [resetPassword],
  );
  const statusSnapshot = useMemo(
    () => snapshot({ clearHistoryPhrase, deletePhrase }),
    [clearHistoryPhrase, deletePhrase],
  );
  const profileDirty = Boolean(profileBaseline && profileSnapshot !== profileBaseline);
  const payrollDirty = Boolean(payrollBaseline && payrollSnapshot !== payrollBaseline);
  const securityDirty = Boolean(securityBaseline && securitySnapshot !== securityBaseline);
  const statusDirty = Boolean(statusBaseline && statusSnapshot !== statusBaseline);
  const anyDirty = profileDirty || payrollDirty || securityDirty || statusDirty;
  accountValuesRef.current = { email, systemRole, companyId };

  useEffect(() => {
    dirtyRef.current = anyDirty;
  }, [anyDirty]);

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
      const loadedPayrollType: PayrollType | "" =
        profile.payroll_type === "paye_employee" ||
        profile.payroll_type === "cis_subcontractor"
          ? profile.payroll_type
          : "";
      setEarlyAccessEnabled(profile.early_access_enabled);
      setHourlyRateStr(profile.hourly_rate ?? "");
      setTaxRateStr(profile.tax_rate ?? "");
      setPaymentMode(profile.payment_mode === "gross_payment" ? "gross_payment" : "net_payment");
      setPayrollType(loadedPayrollType);
      setJobTitleStr(profile.job_title ?? "");
      setNiStr(profile.national_insurance_number ?? "");
      setUtrStr(profile.utr_number ?? "");
      const payeSettings = await getEmployeePayeSettings(user.id);
      if (generation !== profileFetchGeneration.current) {
        return;
      }
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
      setProfileBaseline(
        snapshot({
          account: accountValuesRef.current,
          employment: {
            jobTitleStr: profile.job_title ?? "",
            niStr: profile.national_insurance_number ?? "",
          },
          earlyAccessEnabled: profile.early_access_enabled,
        }),
      );
      setPayrollBaseline(
        snapshot({
          payrollType: loadedPayrollType,
          hourlyRateStr: profile.hourly_rate ?? "",
          taxRateStr: profile.tax_rate ?? "",
          paymentMode:
            profile.payment_mode === "gross_payment" ? "gross_payment" : "net_payment",
          utrStr: profile.utr_number ?? "",
          payeSalaryType: payeSettings.salary_type,
          payeMonthlySalary: payeSettings.monthly_salary ?? "",
          payeHourlyRate: payeSettings.paye_hourly_rate ?? "",
          payeUsesTimeRecords: payeSettings.paye_uses_time_records,
          payeHourSource: payeSettings.paye_hour_source,
          payeTaxCode: payeSettings.tax_code ?? "",
          payeTaxBasis: payeSettings.tax_basis,
          payeNiCategory: payeSettings.ni_category ?? "",
          payeStudentLoanPlan: payeSettings.student_loan_plan,
          payePostgraduateLoan: payeSettings.postgraduate_loan,
          payePensionStatus: payeSettings.pension_enrolment_status,
          payeEmployeePensionPercent: payeSettings.employee_pension_percent ?? "",
          payeEmployerPensionPercent: payeSettings.employer_pension_percent ?? "",
          payePensionBasis: payeSettings.pension_scheme_basis,
          payePensionReliefMethod: payeSettings.pension_relief_method,
        }),
      );
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
    if (previousUserIdRef.current !== user.id && dirtyRef.current) {
      window.confirm("Discard unsaved changes and open another employee?");
    }
    previousUserIdRef.current = user.id;
    setActiveTab("profile");
    setEmail(user.email);
    setSystemRole(user.system_role);
    setCompanyId(user.company_id ?? "");
    setResetPassword("");
    setPasswordVisible(false);
    setPasswordCopyStatus("");
    setProfileBaseline(
      snapshot({
        account: {
          email: user.email,
          systemRole: user.system_role,
          companyId: user.company_id ?? "",
        },
        employment: { jobTitleStr: "", niStr: "" },
        earlyAccessEnabled: false,
      }),
    );
    setSecurityBaseline(snapshot({ resetPassword: "" }));
    setStatusBaseline(snapshot({ clearHistoryPhrase: "", deletePhrase: "" }));
  }, [user.id]);

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

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    setLocalSuccess("");
    setIsSavingUser(true);
    setIsSavingEmployment(true);
    setIsUpdatingEarlyAccess(true);
    try {
      const baseline = profileBaseline
        ? (JSON.parse(profileBaseline) as {
            account: { email: string; systemRole: SystemRole; companyId: string };
            employment: { jobTitleStr: string; niStr: string };
            earlyAccessEnabled: boolean;
          })
        : null;
      const accountChanged =
        !baseline ||
        snapshot({ email, systemRole, companyId }) !== snapshot(baseline.account);
      const profileFieldsChanged =
        showEmployeeExtendedFields &&
        (!baseline ||
          snapshot({ jobTitleStr, niStr }) !== snapshot(baseline.employment) ||
          earlyAccessEnabled !== baseline.earlyAccessEnabled);

      if (accountChanged) {
        await updateManagedUser(user.id, {
          email,
          system_role: systemRole,
          company_id:
            isAdministrator(currentUser) && systemRole !== "administrator"
              ? companyId || null
              : null,
        });
      }
      if (profileFieldsChanged) {
        await patchManagedEmployeeProfile(user.id, {
          job_title: jobTitleStr.trim() === "" ? null : jobTitleStr.trim(),
          national_insurance_number: niStr.trim() === "" ? null : niStr.trim(),
          early_access_enabled: earlyAccessEnabled,
        });
      }
      await onRefresh();
      if (showEmployeeExtendedFields) {
        await reloadEmployeeProfile();
      } else {
        setProfileBaseline(profileSnapshot);
      }
      setLocalSuccess("Profile saved.");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not save profile.");
    } finally {
      setIsSavingUser(false);
      setIsSavingEmployment(false);
      setIsUpdatingEarlyAccess(false);
    }
  }

  async function handleSavePayrollSettings() {
    if (!showEmployeeExtendedFields || !employeeProfileLoaded) {
      return;
    }
    const baseline = payrollBaseline
      ? (JSON.parse(payrollBaseline) as { payrollType: PayrollType | "" })
      : null;
    if (
      baseline &&
      baseline.payrollType !== payrollType &&
      !window.confirm(
        "Changing payroll type affects future payroll calculations. Existing payroll history will not be changed. Continue?",
      )
    ) {
      return;
    }

    setLocalError("");
    setLocalSuccess("");
    setIsSavingPayrollRates(true);
    setIsSavingPayeSettings(true);
    try {
      if (payrollType === "cis_subcontractor") {
        await patchManagedEmployeeProfile(user.id, {
          payroll_type: payrollType,
          hourly_rate: hourlyRateStr.trim() === "" ? null : hourlyRateStr.trim(),
          tax_rate: taxRateStr.trim() === "" ? null : taxRateStr.trim(),
          payment_mode: paymentMode,
          utr_number: utrStr.trim() === "" ? null : utrStr.trim(),
        });
      } else if (payrollType === "paye_employee") {
        await patchManagedEmployeeProfile(user.id, { payroll_type: payrollType });
        await patchEmployeePayeSettings(user.id, {
          pay_frequency: "monthly",
          salary_type: payeSalaryType,
          monthly_salary:
            payeMonthlySalary.trim() === "" ? null : payeMonthlySalary.trim(),
          paye_hourly_rate:
            payeHourlyRate.trim() === "" ? null : payeHourlyRate.trim(),
          paye_uses_time_records: payeUsesTimeRecords,
          paye_hour_source: payeHourSource,
          tax_code: payeTaxCode.trim() === "" ? null : payeTaxCode.trim(),
          tax_basis: payeTaxBasis,
          ni_category:
            payeNiCategory.trim() === "" ? null : payeNiCategory.trim(),
          student_loan_plan: payeStudentLoanPlan,
          postgraduate_loan: payePostgraduateLoan,
          pension_enrolment_status: payePensionStatus,
          employee_pension_percent:
            payeEmployeePensionPercent.trim() === ""
              ? null
              : payeEmployeePensionPercent.trim(),
          employer_pension_percent:
            payeEmployerPensionPercent.trim() === ""
              ? null
              : payeEmployerPensionPercent.trim(),
          pension_scheme_basis: payePensionBasis,
          pension_relief_method: payePensionReliefMethod,
        });
      } else {
        await patchManagedEmployeeProfile(user.id, { payroll_type: null });
      }
      await onRefresh();
      await reloadEmployeeProfile();
      setLocalSuccess("Payroll settings saved.");
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Could not save payroll settings.",
      );
    } finally {
      setIsSavingPayrollRates(false);
      setIsSavingPayeSettings(false);
    }
  }

  async function handleResetPassword() {
    setLocalError("");
    setLocalSuccess("");
    const passwordCheck = validateTemporaryPassword(resetPassword);
    if (!passwordCheck.ok) {
      setLocalError(passwordCheck.message);
      return;
    }
    setIsResettingPassword(true);
    try {
      await resetManagedUserPassword(user.id, resetPassword);
      setLocalSuccess("Password reset.");
      setResetPassword("");
      setPasswordVisible(false);
      setPasswordCopyStatus("");
      setSecurityBaseline(snapshot({ resetPassword: "" }));
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
    if (
      !window.confirm(
        user.is_active
          ? "Deactivate this employee? They will no longer be able to sign in."
          : "Reactivate this employee and restore sign-in access?",
      )
    ) {
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

  function requestClose() {
    if (anyDirty && !window.confirm("Discard unsaved changes and close?")) {
      return;
    }
    onClose();
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (tabIndex + 1) % TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (tabIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TABS.length - 1;
    }
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    if (!nextTab) {
      return;
    }
    setActiveTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  }

  function closePhotoViewer() {
    setPhotoViewerOpen(false);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-black/45 p-2 sm:p-4"
      role="dialog"
    >
      <div className="timiq-sheet flex h-[100dvh] max-h-[100dvh] w-full min-w-0 max-w-full flex-col overflow-hidden border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-md [&_button]:min-h-11 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-[min(52rem,calc(100vw-2rem))] sm:rounded-[var(--radius-md)]">
        <header className="sticky top-0 z-10 shrink-0 border-b border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-4 py-3">
          <div className="flex items-start gap-3 pr-12">
            <div ref={photoButtonContainerRef}>
              <EmployeePhotoButton
                onOpen={() => {
                  returnFocusRef.current =
                    photoButtonContainerRef.current?.querySelector("button") ?? null;
                  setPhotoViewerOpen(true);
                }}
                sizeClassName="h-16 w-16"
                user={user}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-[var(--color-text)]">
                  {employeeDisplayName(user)}
                </h2>
                <span
                  className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold ${
                    user.is_active
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-[var(--color-border-dark)] bg-[var(--color-muted)] text-[var(--color-text-muted)]"
                  }`}
                >
                  {user.is_active ? "Active" : "Inactive"}
                </span>
                <PayrollTypeBadge kind={resolvePayrollTypeDisplay(payrollType)} />
              </div>
              <p className="mt-0.5 truncate text-sm text-[var(--color-text-muted)]">
                {user.email}
              </p>
              {(jobTitleStr || user.profile_job_title) ? (
                <p className="mt-0.5 truncate text-xs text-[var(--color-text-soft)]">
                  {jobTitleStr || user.profile_job_title}
                </p>
              ) : null}
              {showEmployeeExtendedFields ? (
                <Link
                  className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-text)] underline underline-offset-2"
                  href={`/employees/${user.id}/clock-selfies`}
                >
                  Clock selfies
                </Link>
              ) : null}
            </div>
          </div>
          <button
            aria-label="Close employee panel"
            className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] text-xl font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            onClick={requestClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div
          aria-label="Employee sections"
          className="flex shrink-0 overflow-x-auto border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-2"
          role="tablist"
        >
          {TABS.map((tab, index) => (
            <button
              aria-controls={`employee-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)] ${
                activeTab === tab.id
                  ? "border-[var(--color-text)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
              id={`employee-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              role="tab"
              tabIndex={activeTab === tab.id ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">

        {localError ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {localError}
          </div>
        ) : null}

        {localSuccess ? (
          <div className="mt-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {localSuccess}
          </div>
        ) : null}

        {activeTab === "profile" ? (
        <form
          aria-labelledby="employee-tab-profile"
          className="mt-4 space-y-4"
          id="employee-panel-profile"
          onSubmit={handleSaveProfile}
          role="tabpanel"
        >
          <section className="space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Account
          </p>

          <label className={fieldLabelClass}>
            Email
            <input
              autoComplete="email"
              className={fieldInputClass}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          <label className={fieldLabelClass}>
            Role
            <select
              className={fieldInputClass}
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
            <label className={fieldLabelClass}>
              Company
              <select
                className={fieldInputClass}
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

          </section>

        {showEmployeeExtendedFields ? (
          <section className="space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
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
                <label className={fieldLabelClass}>
                  Job title
                  <input
                    className={fieldInputClass}
                    disabled={isSavingEmployment}
                    onChange={(event) => setJobTitleStr(event.target.value)}
                    placeholder="e.g. Site supervisor"
                    type="text"
                    value={jobTitleStr}
                  />
                </label>
                <label className={fieldLabelClass}>
                  National Insurance number
                  <input
                    autoComplete="off"
                    className={fieldInputClass}
                    disabled={isSavingEmployment}
                    onChange={(event) => setNiStr(event.target.value)}
                    placeholder="From starter form after approval, or set here"
                    type="text"
                    value={niStr}
                  />
                </label>
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
                  className="mt-0.5 h-5 w-5 shrink-0"
                  disabled={isUpdatingEarlyAccess || profileLoading}
                  onChange={(event) => setEarlyAccessEnabled(event.target.checked)}
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
          </section>
        ) : null}
        </form>
        ) : null}

        {activeTab === "payroll" ? (
          <section
            aria-labelledby="employee-tab-payroll"
            className="mt-4 space-y-4"
            id="employee-panel-payroll"
            role="tabpanel"
          >
          {!showEmployeeExtendedFields ? (
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-4 text-sm text-[var(--color-text-muted)]">
              Payroll settings apply to employee accounts only.
            </div>
          ) : (
          <>
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
              <label className={fieldLabelClass}>
                Payroll type
                <select
                  className={`${fieldInputClass} timiq-select`}
                  disabled={profileLoading || isSavingPayrollRates || isSavingPayeSettings}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPayrollType(
                      value === "paye_employee"
                        ? "paye_employee"
                        : value === "cis_subcontractor"
                          ? "cis_subcontractor"
                          : "",
                    );
                  }}
                  value={payrollType}
                >
                  <option value="">Not configured</option>
                  <option value="cis_subcontractor">CIS subcontractor</option>
                  <option value="paye_employee">PAYE employee</option>
                </select>
              </label>
            </div>

            {payrollType === "cis_subcontractor" ? (
            <div className="border border-[var(--color-border)] border-l-2 border-l-amber-400 bg-[var(--color-cell)] p-3">
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
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Loading profile…</p>
              )}
            </div>
            ) : null}

            {payrollType === "paye_employee" ? (
            <div className="border border-[var(--color-border)] border-l-2 border-l-emerald-500 bg-[var(--color-cell)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                PAYE monthly settings
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Monthly PAYE supports fixed monthly salary, hourly PAYE from completed time shifts, monthly-threshold
                overtime, bonus and commission components, PAYE payslips, and employee PAYE Pay History. RTI/HMRC
                submission, P45/P60, statutory pay, auto-enrolment assessment, pension opt-out refunds, salary sacrifice,
                and HMRC submission are not enabled yet.
              </p>
              <p className="mt-1 text-xs font-medium text-amber-900">
                Open shifts in the PAYE tax month will block recalculation until closed.
              </p>
              {profileLoadError ? (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Fix profile loading above to edit PAYE settings.
                </p>
              ) : profileLoading ? (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Loading profile…</p>
              ) : employeeProfileLoaded ? (
                <div className="mt-2 grid gap-3 md:grid-cols-2">
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
                      <option value="hourly">Hourly</option>
                      <option value="fixed_monthly_salary">Fixed monthly salary</option>
                    </select>
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
                      placeholder="e.g. 18.50"
                      value={payeHourlyRate}
                    />
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      Hourly PAYE is calculated from completed time shifts when salary type is Hourly, uses time records
                      is enabled, and hour source is completed time shifts.
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
                      Only numeric L tax codes such as 1257L are calculated. BR, D0, K, NT, S and C codes are not supported yet.
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
                      Only NI category A is calculated. Other NI categories are not supported yet.
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
                        Salary sacrifice is not supported yet and will block calculation.
                      </p>
                    ) : null}
                  </label>
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Loading profile…</p>
              )}
            </div>
            ) : null}
          </>
          )}
          </section>
        ) : null}

        {activeTab === "security" ? (
        <section
          aria-labelledby="employee-tab-security"
          className="mt-4 space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
          id="employee-panel-security"
          role="tabpanel"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Password
          </p>
          <label className={fieldLabelClass}>
            Temporary password
            <div className="mt-1 flex gap-2">
              <input
                autoComplete="new-password"
                className="h-11 min-w-0 flex-1 rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm"
                onChange={(event) => {
                  setResetPassword(event.target.value);
                  setPasswordCopyStatus("");
                }}
                type={passwordVisible ? "text" : "password"}
                value={resetPassword}
              />
              <Button
                className="min-h-11"
                onClick={() => setPasswordVisible((visible) => !visible)}
                type="button"
                variant="secondary"
              >
                {passwordVisible ? "Hide" : "Show"}
              </Button>
            </div>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              onClick={() => {
                try {
                  const generated = generateSecureTemporaryPassword();
                  setResetPassword(generated);
                  setPasswordVisible(true);
                  setPasswordCopyStatus("");
                } catch (error) {
                  setLocalError(
                    error instanceof Error
                      ? error.message
                      : "Could not generate a temporary password.",
                  );
                }
              }}
              type="button"
              variant="secondary"
            >
              Generate password
            </Button>
            <Button
              className="min-h-11"
              disabled={!resetPassword}
              onClick={() => {
                void navigator.clipboard.writeText(resetPassword).then(
                  () => setPasswordCopyStatus("Copied"),
                  () => setPasswordCopyStatus("Copy failed"),
                );
              }}
              type="button"
              variant="secondary"
            >
              Copy
            </Button>
            {passwordCopyStatus ? (
              <span className="self-center text-xs text-[var(--color-text-muted)]">
                {passwordCopyStatus}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Enter or generate a new temporary password. The current password is never shown.
            Resetting replaces the employee&apos;s current sign-in password.
          </p>
        </section>
        ) : null}

        {activeTab === "status" ? (
        <section
          aria-labelledby="employee-tab-status"
          className="mt-4 space-y-4"
          id="employee-panel-status"
          role="tabpanel"
        >
        <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Status
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${
                user.is_active
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-[var(--color-border-dark)] bg-[var(--color-muted)] text-[var(--color-text-muted)]"
              }`}
            >
              {user.is_active ? "Active" : "Inactive"}
            </span>
            <p className="text-sm text-[var(--color-text-muted)]">
              {user.is_active
                ? "This employee can sign in and use assigned TimIQ features."
                : "This employee cannot sign in until the account is reactivated."}
            </p>
          </div>
        </div>

        {showDangerZone ? (
          <div className="space-y-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] p-3">
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
        </section>
        ) : null}
        </div>

        <footer className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-t border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-4 py-2.5">
          <Button className="min-h-11" onClick={requestClose} type="button" variant="secondary">
            Close
          </Button>
          {activeTab === "profile" ? (
            <Button
              className="min-h-11"
              disabled={isSavingUser || profileLoading || !profileDirty}
              form="employee-panel-profile"
              type="submit"
            >
              {isSavingUser ? "Saving…" : "Save profile"}
            </Button>
          ) : activeTab === "payroll" && showEmployeeExtendedFields ? (
            <Button
              className="min-h-11"
              disabled={
                isSavingPayrollRates ||
                isSavingPayeSettings ||
                profileLoading ||
                !employeeProfileLoaded ||
                !payrollDirty
              }
              onClick={() => void handleSavePayrollSettings()}
              type="button"
            >
              {isSavingPayrollRates || isSavingPayeSettings
                ? "Saving…"
                : "Save payroll settings"}
            </Button>
          ) : activeTab === "security" ? (
            <Button
              className="min-h-11"
              disabled={isResettingPassword || resetPassword.trim() === ""}
              onClick={() => void handleResetPassword()}
              type="button"
            >
              {isResettingPassword ? "Applying…" : "Reset password"}
            </Button>
          ) : activeTab === "status" ? (
            <Button
              className="min-h-11"
              disabled={user.id === currentUser.id || isTogglingStatus}
              onClick={() => void handleToggleStatus()}
              type="button"
              variant={user.is_active ? "danger" : undefined}
            >
              {isTogglingStatus
                ? "Updating…"
                : user.is_active
                  ? "Deactivate"
                  : "Reactivate"}
            </Button>
          ) : null}
        </footer>
      </div>
      <EmployeePhotoViewer
        onClose={closePhotoViewer}
        open={photoViewerOpen}
        user={user}
      />
    </div>
  );
}
