"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button, Input, PageHeader, Sheet, SheetBody } from "../../components/ui";
import { canAccessManagement, useCurrentUser } from "../../features/auth";
import {
  fetchPrivacyInventory,
  fetchPrivacyMeSummary,
  fetchPrivacyMyAck,
  fetchPrivacyMyRequests,
  patchPrivacyMyRequestCancel,
  postPrivacyAck,
  postPrivacyMyRequest,
  type PrivacyInventory,
  type PrivacyMeSummary,
  type PrivacyAck,
  type PrivacyRequestRow,
} from "../../features/privacy/api";
import { employeeRoleLabel, genericStatusLabel, useT } from "../../lib/i18n";

const REQUEST_TYPE_VALUES = [
  "data_access",
  "correction",
  "deletion",
  "gps_tracking_info",
  "document_copy",
  "other",
] as const;

function privacyRequestTypeLabel(t: ReturnType<typeof useT>, code: string): string {
  const map: Record<string, string> = {
    data_access: "privacy.data_access",
    correction: "privacy.type_correction",
    deletion: "privacy.type_deletion",
    gps_tracking_info: "privacy.gps_info",
    document_copy: "privacy.document_copy",
    other: "privacy.other",
  };
  const key = map[code];
  return key ? t(key) : code.replace(/_/g, " ");
}

function cardClass() {
  return "rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 text-sm";
}

function labelClass() {
  return "text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]";
}

function boolLabel(t: ReturnType<typeof useT>, v: boolean): string {
  return v ? t("privacy.stored_hidden") : t("privacy.not_on_file");
}

function formatDt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function PrivacyClient() {
  const t = useT();
  const user = useCurrentUser();
  const mgmt = canAccessManagement(user);
  const [inventory, setInventory] = useState<PrivacyInventory | null>(null);
  const [summary, setSummary] = useState<PrivacyMeSummary | null>(null);
  const [ack, setAck] = useState<PrivacyAck | null>(null);
  const [myRequests, setMyRequests] = useState<PrivacyRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ackSaving, setAckSaving] = useState(false);
  const [reqSaving, setReqSaving] = useState(false);
  const [reqType, setReqType] = useState("data_access");
  const [reqSubject, setReqSubject] = useState("");
  const [reqMessage, setReqMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [inv, a, sum, reqs] = await Promise.all([
        fetchPrivacyInventory(),
        fetchPrivacyMyAck(),
        fetchPrivacyMeSummary(),
        fetchPrivacyMyRequests(),
      ]);
      setInventory(inv);
      setAck(a);
      setSummary(sum);
      setMyRequests(reqs);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("privacy.load_error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAck() {
    if (!inventory) {
      return;
    }
    setAckSaving(true);
    setError("");
    try {
      const next = await postPrivacyAck(inventory.version);
      setAck(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("privacy.save_error"));
    } finally {
      setAckSaving(false);
    }
  }

  async function onSubmitRequest(e: FormEvent) {
    e.preventDefault();
    if (!reqMessage.trim()) {
      return;
    }
    setReqSaving(true);
    setError("");
    try {
      await postPrivacyMyRequest({
        request_type: reqType,
        subject: reqSubject.trim() || null,
        message: reqMessage.trim(),
      });
      setReqSubject("");
      setReqMessage("");
      setReqType("data_access");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("privacy.submit_failed"));
    } finally {
      setReqSaving(false);
    }
  }

  async function onCancelRequest(id: string) {
    if (!window.confirm(t("privacy.cancel_confirm"))) {
      return;
    }
    try {
      await patchPrivacyMyRequestCancel(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("privacy.cancel_failed"));
    }
  }

  const ackCurrent = ack && inventory && ack.policy_version === inventory.version;

  return (
    <Sheet>
      <PageHeader description={t("privacy.page_description")} title={t("privacy.page_title")} />
      <SheetBody className="min-w-0 space-y-6 md:p-5">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {mgmt ? (
          <p className="text-sm">
            <Link className="font-semibold text-[var(--color-primary)] underline" href="/privacy/requests">
              {t("privacy.requests_link")}
            </Link>
          </p>
        ) : null}

        {loading ? <p className="text-sm text-[var(--color-text-muted)]">{t("common.loading")}</p> : null}

        {summary ? (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-[var(--color-text)]">{t("privacy.section_your_data")}</h2>
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              <div className={cardClass()}>
                <h3 className="font-semibold text-[var(--color-text)]">{t("privacy.section_account")}</h3>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  <li>
                    <span className={labelClass()}>{t("privacy.label_email")}</span> {summary.account.email}
                  </li>
                  <li>
                    <span className={labelClass()}>{t("privacy.label_role")}</span>{" "}
                    {employeeRoleLabel(t, summary.account.role)}
                  </li>
                  <li>
                    <span className={labelClass()}>{t("common.company")}</span>{" "}
                    {summary.account.company_name ?? "—"}
                  </li>
                </ul>
              </div>
              <div className={cardClass()}>
                <h3 className="font-semibold text-[var(--color-text)]">{t("privacy.section_profile")}</h3>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  <li>
                    {t("privacy.cat_name_contact")} {boolLabel(t, summary.profile_data_categories.name_contact_stored)}
                  </li>
                  <li>
                    {t("privacy.cat_job_title")} {boolLabel(t, summary.profile_data_categories.job_title_stored)}
                  </li>
                  <li>
                    {t("privacy.cat_emergency")} {boolLabel(t, summary.profile_data_categories.emergency_contact_stored)}
                  </li>
                  <li>
                    {t("privacy.cat_ni")} {boolLabel(t, summary.profile_data_categories.national_insurance_number_stored)}
                  </li>
                  <li>
                    {t("privacy.cat_utr")} {boolLabel(t, summary.profile_data_categories.utr_stored)}
                  </li>
                </ul>
              </div>
              <div className={cardClass()}>
                <h3 className="font-semibold text-[var(--color-text)]">{t("privacy.section_time_location")}</h3>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  <li>
                    {t("privacy.cat_clock_shifts")} {summary.tracking_categories.clock_shift_records_count}
                  </li>
                  <li>
                    {t("privacy.cat_gps_clock")}{" "}
                    {summary.tracking_categories.gps_may_be_recorded_at_clock_events ? t("common.yes") : t("common.no")}
                  </li>
                  <li>
                    {t("privacy.cat_clock_selfies")} {summary.tracking_categories.clock_selfie_records_count}
                  </li>
                  <li>
                    {t("privacy.cat_break_records")} {summary.tracking_categories.break_records_count}
                  </li>
                </ul>
              </div>
              <div className={cardClass()}>
                <h3 className="font-semibold text-[var(--color-text)]">{t("privacy.section_documents_payroll")}</h3>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  <li>
                    {t("privacy.cat_onboarding_docs")} {summary.documents_categories.onboarding_document_count}
                  </li>
                  <li>
                    {t("privacy.cat_work_progress")} {summary.documents_categories.work_progress_attachment_count}
                  </li>
                  <li>
                    {t("privacy.cat_payroll_history")} {summary.payroll_categories.payroll_history_item_count}
                  </li>
                  <li>{t("privacy.cat_paid_payroll")} {summary.payroll_categories.paid_payroll_records_count}</li>
                </ul>
              </div>
              <div className={`${cardClass()} md:col-span-2`}>
                <h3 className="font-semibold text-[var(--color-text)]">{t("privacy.section_audit")}</h3>
                <p className="mt-2 text-[var(--color-text-muted)]">{summary.audit_categories.description}</p>
                <p className="mt-3 text-[var(--color-text-muted)]">{summary.retention_notice}</p>
              </div>
            </div>
          </section>
        ) : null}

        <section className={cardClass()}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t("privacy.section_submit_request")}</h2>
          <p className="mt-2 text-[var(--color-text-muted)]">{t("privacy.submit_intro")}</p>
          <form className="mt-4 space-y-3" onSubmit={onSubmitRequest}>
            <div>
              <label className={labelClass()} htmlFor="pr-type">
                {t("privacy.request_type_label")}
              </label>
              <select
                className="mt-1.5 h-10 w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm"
                id="pr-type"
                value={reqType}
                onChange={(e) => setReqType(e.target.value)}
              >
                {REQUEST_TYPE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {privacyRequestTypeLabel(t, value)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass()} htmlFor="pr-subject">
                {t("privacy.subject_optional")}
              </label>
              <Input className="mt-1.5 max-w-md" id="pr-subject" value={reqSubject} onChange={(e) => setReqSubject(e.target.value)} />
            </div>
            <div>
              <label className={labelClass()} htmlFor="pr-msg">
                {t("privacy.label_message")}
              </label>
              <textarea
                className="mt-1.5 min-h-[100px] w-full max-w-xl rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2 text-sm"
                id="pr-msg"
                maxLength={8000}
                required
                value={reqMessage}
                onChange={(e) => setReqMessage(e.target.value)}
              />
            </div>
            <Button disabled={reqSaving} type="submit">
              {reqSaving ? t("privacy.submitting") : t("privacy.submit_request")}
            </Button>
          </form>
        </section>

        <section className={cardClass()}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t("privacy.my_requests")}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[640px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-dark)] text-[var(--color-text-soft)]">
                  <th className="py-2 pr-2">{t("privacy.request_type_label")}</th>
                  <th className="py-2 pr-2">{t("privacy.col_status")}</th>
                  <th className="py-2 pr-2">{t("privacy.col_submitted")}</th>
                  <th className="py-2 pr-2">{t("privacy.col_response")}</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {myRequests.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border-dark)]">
                    <td className="py-2 pr-2 align-top">{privacyRequestTypeLabel(t, r.request_type)}</td>
                    <td className="py-2 pr-2 align-top">{genericStatusLabel(t, r.status)}</td>
                    <td className="py-2 pr-2 align-top text-[var(--color-text-muted)]">{formatDt(r.submitted_at)}</td>
                    <td className="max-w-xs py-2 pr-2 align-top text-[var(--color-text-muted)]">
                      {r.admin_response ? <span className="line-clamp-3 whitespace-pre-wrap">{r.admin_response}</span> : "—"}
                    </td>
                    <td className="py-2 align-top">
                      {r.status === "submitted" ? (
                        <Button size="sm" type="button" variant="secondary" onClick={() => void onCancelRequest(r.id)}>
                          {t("common.cancel")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {myRequests.length === 0 ? <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t("privacy.no_requests")}</p> : null}
          </div>
        </section>

        <section className={cardClass()}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t("privacy.section_rights")}</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[var(--color-text-muted)]">
            <li>{t("privacy.right_access")}</li>
            <li>{t("privacy.right_rectification")}</li>
            <li>{t("privacy.right_erasure")}</li>
          </ul>
        </section>

        {inventory ? (
          <section className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                {t("privacy.policy_version", undefined, { version: String(inventory.version) })}
              </p>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{inventory.intro}</p>
              {ackCurrent ? (
                <p className="mt-2 text-sm font-semibold text-[var(--color-success-700)]">
                  {t("privacy.acknowledged_on", undefined, {
                    when: new Date(ack!.acknowledged_at).toLocaleString(),
                  })}
                </p>
              ) : (
                <div className="mt-3">
                  <Button disabled={ackSaving} type="button" onClick={() => void onAck()}>
                    {ackSaving ? t("privacy.ack_saving") : t("privacy.ack_save")}
                  </Button>
                </div>
              )}
            </div>
            {inventory.sections.map((sec) => (
              <div key={sec.title} className={cardClass()}>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{sec.title}</h3>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[var(--color-text-muted)]">
                  {sec.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : null}

        <section className={cardClass()}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t("privacy.section_processors")}</h2>
          <p className="mt-2 text-[var(--color-text-muted)]">{t("privacy.processors_body")}</p>
        </section>
      </SheetBody>
    </Sheet>
  );
}
