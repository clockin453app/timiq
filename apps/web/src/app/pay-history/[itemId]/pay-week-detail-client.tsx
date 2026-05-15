"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PageHeader, Sheet, SheetBody, Button } from "../../../components/ui";
import { fetchPayrollItemSummary, payrollItemPayslipUrl, type PayrollItemSummaryResponse } from "../../../features/payroll/api";
import {
  formatHoursFromSeconds,
  formatMoneyGBP,
  formatPayrollWeekRangeLabel,
} from "../../../features/payroll/format";
import { payrollStatusLabel } from "../../../lib/i18n/display-labels";
import { useT } from "../../../lib/i18n";

function formatWhen(iso: string | null) {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function PayWeekDetailClient(props: { itemId: string }) {
  const { itemId } = props;
  const t = useT();
  const [detail, setDetail] = useState<PayrollItemSummaryResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchPayrollItemSummary(itemId);
        if (!cancelled) {
          setDetail(data);
        }
      } catch (e) {
        if (!cancelled) {
          setDetail(null);
          setError(
            e instanceof Error
              ? e.message
              : t("pay_history.detail_load_error", "Could not load this pay week."),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  function openPayslip() {
    if (!detail || detail.can_open_payslip === false) {
      return;
    }
    window.open(payrollItemPayslipUrl(detail.item_id), "_blank", "noopener,noreferrer");
  }

  const weekLabel =
    detail && detail.timezone_name
      ? formatPayrollWeekRangeLabel(detail.week_start, detail.timezone_name)
      : "—";

  const notProvided = t("pay_history.not_provided", "Not provided");

  return (
    <Sheet>
      <PageHeader
        title={t("pay_history.detail_title", "Pay week")}
        description={t(
          "pay_history.detail_description",
          "Details from the stored payroll record (server-calculated figures).",
        )}
        titleClassName="text-xl font-bold tracking-tight text-[#111827] md:text-2xl"
      />
      <SheetBody className="space-y-4">
        <div>
          <Link
            className="text-sm font-semibold text-[var(--color-text)] underline decoration-[var(--color-border-dark)] underline-offset-2 hover:text-[var(--color-text-muted)]"
            href="/pay-history"
          >
            ← {t("pay_history.back_to_list", "Back to pay history")}
          </Link>
        </div>

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t("common.loading", "Loading…")}</p>
        ) : null}

        {!loading && detail ? (
          <div className="space-y-5">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                {t("pay_history.detail_general", "General")}
              </p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.col_period", "Period")}
                  </dt>
                  <dd className="font-medium text-[var(--color-text)]">{weekLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.col_company", "Company")}
                  </dt>
                  <dd className="font-medium text-[var(--color-text)]">{detail.company.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.col_employee", "Employee")}
                  </dt>
                  <dd className="font-medium text-[var(--color-text)]">{detail.employee_display_name}</dd>
                </div>
                {detail.employee_email ? (
                  <div>
                    <dt className="text-xs text-[var(--color-text-muted)]">
                      {t("pay_history.col_email", "Email")}
                    </dt>
                    <dd className="break-all font-medium text-[var(--color-text)]">{detail.employee_email}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.col_status", "Status")}
                  </dt>
                  <dd className="font-medium text-[var(--color-text)]">
                    {payrollStatusLabel(t, detail.status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.payment_mode", "Payment mode")}
                  </dt>
                  <dd className="font-medium text-[var(--color-text)]">{detail.payment_mode_label}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.national_insurance", "National Insurance")}
                  </dt>
                  <dd className="font-medium text-[var(--color-text)]">
                    {detail.national_insurance_number?.trim()
                      ? detail.national_insurance_number
                      : notProvided}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">{t("pay_history.utr", "UTR")}</dt>
                  <dd className="font-medium text-[var(--color-text)]">
                    {detail.utr_number?.trim() ? detail.utr_number : notProvided}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.approved_label", "Approved")}
                  </dt>
                  <dd className="font-medium text-[var(--color-text)]">{formatWhen(detail.approved_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.paid_label", "Paid")}
                  </dt>
                  <dd className="font-medium text-[var(--color-text)]">{formatWhen(detail.paid_at)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                {t("pay_history.detail_earnings", "Earnings (from payroll)")}
              </p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.rounded_hours", "Rounded hours")}
                  </dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatHoursFromSeconds(detail.rounded_total_seconds)} h
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.regular_overtime", "Regular / overtime")}
                  </dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatHoursFromSeconds(detail.regular_seconds)} h /{" "}
                    {formatHoursFromSeconds(detail.overtime_seconds)} h
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.col_gross", "Gross pay")}
                  </dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {detail.rate_missing ? "—" : formatMoneyGBP(detail.gross_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.col_cis", "CIS tax")}
                  </dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatMoneyGBP(detail.cis_tax_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.net_take_home", "Net (take home)")}
                  </dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatMoneyGBP(detail.net_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.other_deductions", "Other deductions")}
                  </dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatMoneyGBP(detail.other_deductions_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.hourly_rate_snapshot", "Hourly rate (snapshot)")}
                  </dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {detail.hourly_rate_snapshot != null && detail.hourly_rate_snapshot !== ""
                      ? formatMoneyGBP(detail.hourly_rate_snapshot) + " / h"
                      : "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-[var(--color-text-muted)]">
                    {t("pay_history.ytd_same_company", "Year-to-date (same company)")}
                  </dt>
                  <dd className="mt-0.5 text-[var(--color-text)]">
                    {t("pay_history.ytd_taxable", "Taxable pay")} {formatMoneyGBP(detail.ytd_taxable_pay)} ·{" "}
                    {t("pay_history.ytd_cis", "CIS deducted")} {formatMoneyGBP(detail.ytd_cis_deducted)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={detail.can_open_payslip === false} onClick={openPayslip} type="button">
                {t("pay_history.open_payslip_print", "Open payslip / print")}
              </Button>
            </div>
            {detail.can_open_payslip === false ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                {t("pay_history.payslip_unavailable", "Payslip is not available for this row.")}
              </p>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
