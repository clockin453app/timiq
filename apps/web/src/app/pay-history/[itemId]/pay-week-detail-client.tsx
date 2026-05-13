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

function statusLabel(status: string): string {
  if (status === "pending") {
    return "Pending";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function PayWeekDetailClient(props: { itemId: string }) {
  const { itemId } = props;
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
          setError(e instanceof Error ? e.message : "Could not load this pay week.");
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

  return (
    <Sheet>
      <PageHeader
        title="Pay week"
        description="Details from the stored payroll record (server-calculated figures)."
        titleClassName="text-xl font-bold tracking-tight text-[#111827] md:text-2xl"
      />
      <SheetBody className="space-y-4">
        <div>
          <Link
            className="text-sm font-semibold text-[var(--color-text)] underline decoration-[var(--color-border-dark)] underline-offset-2 hover:text-[var(--color-text-muted)]"
            href="/pay-history"
          >
            ← Back to pay history
          </Link>
        </div>

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}

        {!loading && detail ? (
          <div className="space-y-5">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">General</p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Period</dt>
                  <dd className="font-medium text-[var(--color-text)]">{weekLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Company</dt>
                  <dd className="font-medium text-[var(--color-text)]">{detail.company.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Employee</dt>
                  <dd className="font-medium text-[var(--color-text)]">{detail.employee_display_name}</dd>
                </div>
                {detail.employee_email ? (
                  <div>
                    <dt className="text-xs text-[var(--color-text-muted)]">Email</dt>
                    <dd className="break-all font-medium text-[var(--color-text)]">{detail.employee_email}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Status</dt>
                  <dd className="font-medium text-[var(--color-text)]">{statusLabel(detail.status)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Payment mode</dt>
                  <dd className="font-medium text-[var(--color-text)]">{detail.payment_mode_label}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">National Insurance</dt>
                  <dd className="font-medium text-[var(--color-text)]">
                    {detail.national_insurance_number?.trim()
                      ? detail.national_insurance_number
                      : "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">UTR</dt>
                  <dd className="font-medium text-[var(--color-text)]">
                    {detail.utr_number?.trim() ? detail.utr_number : "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Approved</dt>
                  <dd className="font-medium text-[var(--color-text)]">{formatWhen(detail.approved_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Paid</dt>
                  <dd className="font-medium text-[var(--color-text)]">{formatWhen(detail.paid_at)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Earnings (from payroll)</p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Rounded hours</dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatHoursFromSeconds(detail.rounded_total_seconds)} h
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Regular / overtime</dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatHoursFromSeconds(detail.regular_seconds)} h /{" "}
                    {formatHoursFromSeconds(detail.overtime_seconds)} h
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Gross</dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {detail.rate_missing ? "—" : formatMoneyGBP(detail.gross_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">CIS tax</dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatMoneyGBP(detail.cis_tax_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Net (take home)</dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatMoneyGBP(detail.net_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Other deductions</dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {formatMoneyGBP(detail.other_deductions_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Hourly rate (snapshot)</dt>
                  <dd className="tabular-nums font-medium text-[var(--color-text)]">
                    {detail.hourly_rate_snapshot != null && detail.hourly_rate_snapshot !== ""
                      ? formatMoneyGBP(detail.hourly_rate_snapshot) + " / h"
                      : "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-[var(--color-text-muted)]">Year-to-date (same company)</dt>
                  <dd className="mt-0.5 text-[var(--color-text)]">
                    Taxable pay {formatMoneyGBP(detail.ytd_taxable_pay)} · CIS deducted{" "}
                    {formatMoneyGBP(detail.ytd_cis_deducted)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={detail.can_open_payslip === false} onClick={openPayslip} type="button">
                Open payslip / print
              </Button>
            </div>
            {detail.can_open_payslip === false ? (
              <p className="text-xs text-[var(--color-text-muted)]">Payslip is not available for this row.</p>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
