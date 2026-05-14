"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button, Input, PageHeader, Sheet, SheetBody } from "../../components/ui";
import { canAccessManagement, LogoutButton, useCurrentUser } from "../../features/auth";
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

const REQUEST_TYPES: { value: string; label: string }[] = [
  { value: "data_access", label: "Data access" },
  { value: "correction", label: "Correction" },
  { value: "deletion", label: "Deletion (request only)" },
  { value: "gps_tracking_info", label: "GPS / tracking information" },
  { value: "document_copy", label: "Document copy" },
  { value: "other", label: "Other" },
];

function cardClass() {
  return "rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 text-sm";
}

function labelClass() {
  return "text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]";
}

function boolLabel(v: boolean): string {
  return v ? "Stored (value not shown here)" : "Not on file";
}

function formatDt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function PrivacyClient() {
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
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(e instanceof Error ? e.message : "Could not save.");
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
      setError(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setReqSaving(false);
    }
  }

  async function onCancelRequest(id: string) {
    if (!window.confirm("Cancel this request?")) {
      return;
    }
    try {
      await patchPrivacyMyRequestCancel(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel.");
    }
  }

  const ackCurrent = ack && inventory && ack.policy_version === inventory.version;

  return (
    <Sheet>
      <PageHeader
        action={<LogoutButton />}
        description="Transparency about data TimIQ holds for you, policy acknowledgement, and privacy requests."
        title="Data & privacy"
      />
      <SheetBody className="min-w-0 space-y-6 md:p-5">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {mgmt ? (
          <p className="text-sm">
            <Link className="font-semibold text-[var(--color-primary)] underline" href="/privacy/requests">
              Open privacy requests (admin)
            </Link>
          </p>
        ) : null}

        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}

        {summary ? (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Your data (categories only)</h2>
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              <div className={cardClass()}>
                <h3 className="font-semibold text-[var(--color-text)]">Account</h3>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  <li>
                    <span className={labelClass()}>Email</span> {summary.account.email}
                  </li>
                  <li>
                    <span className={labelClass()}>Role</span> {summary.account.role}
                  </li>
                  <li>
                    <span className={labelClass()}>Company</span> {summary.account.company_name ?? "—"}
                  </li>
                </ul>
              </div>
              <div className={cardClass()}>
                <h3 className="font-semibold text-[var(--color-text)]">Profile & identifiers</h3>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  <li>Name / contact: {boolLabel(summary.profile_data_categories.name_contact_stored)}</li>
                  <li>Job title: {boolLabel(summary.profile_data_categories.job_title_stored)}</li>
                  <li>Emergency contact: {boolLabel(summary.profile_data_categories.emergency_contact_stored)}</li>
                  <li>NI number: {boolLabel(summary.profile_data_categories.national_insurance_number_stored)}</li>
                  <li>UTR: {boolLabel(summary.profile_data_categories.utr_stored)}</li>
                </ul>
              </div>
              <div className={cardClass()}>
                <h3 className="font-semibold text-[var(--color-text)]">Time & location</h3>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  <li>Clock shift records: {summary.tracking_categories.clock_shift_records_count}</li>
                  <li>GPS at clock events may exist: {summary.tracking_categories.gps_may_be_recorded_at_clock_events ? "Yes" : "No"}</li>
                  <li>Clock selfie records: {summary.tracking_categories.clock_selfie_records_count}</li>
                  <li>Break records: {summary.tracking_categories.break_records_count}</li>
                </ul>
              </div>
              <div className={cardClass()}>
                <h3 className="font-semibold text-[var(--color-text)]">Documents & payroll</h3>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  <li>Onboarding documents: {summary.documents_categories.onboarding_document_count}</li>
                  <li>Work progress attachments: {summary.documents_categories.work_progress_attachment_count}</li>
                  <li>Payroll history rows: {summary.payroll_categories.payroll_history_item_count}</li>
                  <li>Paid payroll records: {summary.payroll_categories.paid_payroll_records_count}</li>
                </ul>
              </div>
              <div className={`${cardClass()} md:col-span-2`}>
                <h3 className="font-semibold text-[var(--color-text)]">Audit</h3>
                <p className="mt-2 text-[var(--color-text-muted)]">{summary.audit_categories.description}</p>
                <p className="mt-3 text-[var(--color-text-muted)]">{summary.retention_notice}</p>
              </div>
            </div>
          </section>
        ) : null}

        <section className={cardClass()}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">Submit a privacy request</h2>
          <p className="mt-2 text-[var(--color-text-muted)]">
            This records your request for your company administrator (or TimIQ operator) to review. It does not
            automatically export or delete data.
          </p>
          <form className="mt-4 space-y-3" onSubmit={onSubmitRequest}>
            <div>
              <label className={labelClass()} htmlFor="pr-type">
                Type
              </label>
              <select
                className="mt-1.5 h-10 w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm"
                id="pr-type"
                value={reqType}
                onChange={(e) => setReqType(e.target.value)}
              >
                {REQUEST_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass()} htmlFor="pr-subject">
                Subject (optional)
              </label>
              <Input className="mt-1.5 max-w-md" id="pr-subject" value={reqSubject} onChange={(e) => setReqSubject(e.target.value)} />
            </div>
            <div>
              <label className={labelClass()} htmlFor="pr-msg">
                Message
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
              {reqSaving ? "Submitting…" : "Submit request"}
            </Button>
          </form>
        </section>

        <section className={cardClass()}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">My requests</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[640px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-dark)] text-[var(--color-text-soft)]">
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Submitted</th>
                  <th className="py-2 pr-2">Response</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {myRequests.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border-dark)]">
                    <td className="py-2 pr-2 align-top">{r.request_type}</td>
                    <td className="py-2 pr-2 align-top">{r.status}</td>
                    <td className="py-2 pr-2 align-top text-[var(--color-text-muted)]">{formatDt(r.submitted_at)}</td>
                    <td className="max-w-xs py-2 pr-2 align-top text-[var(--color-text-muted)]">
                      {r.admin_response ? <span className="line-clamp-3 whitespace-pre-wrap">{r.admin_response}</span> : "—"}
                    </td>
                    <td className="py-2 align-top">
                      {r.status === "submitted" ? (
                        <Button size="sm" type="button" variant="secondary" onClick={() => void onCancelRequest(r.id)}>
                          Cancel
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {myRequests.length === 0 ? <p className="mt-2 text-sm text-[var(--color-text-muted)]">No requests yet.</p> : null}
          </div>
        </section>

        <section className={cardClass()}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">Your rights (summary)</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[var(--color-text-muted)]">
            <li>
              <strong className="text-[var(--color-text)]">Access</strong> — use a data access request above; exports are
              not generated automatically from this form.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Rectification</strong> — update contact details in your
              profile where the product allows; sensitive payroll fields may require admin review.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Erasure & restriction</strong> — subject to legal retention;
              deletion is not executed automatically from this portal.
            </li>
          </ul>
        </section>

        {inventory ? (
          <section className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Policy version {inventory.version}
              </p>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{inventory.intro}</p>
              {ackCurrent ? (
                <p className="mt-2 text-sm font-semibold text-[var(--color-success-700)]">
                  You acknowledged this version on {new Date(ack!.acknowledged_at).toLocaleString()}.
                </p>
              ) : (
                <div className="mt-3">
                  <Button disabled={ackSaving} type="button" onClick={() => void onAck()}>
                    {ackSaving ? "Saving…" : "I have read this summary"}
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
          <h2 className="text-base font-semibold text-[var(--color-text)]">Processors & transfers</h2>
          <p className="mt-2 text-[var(--color-text-muted)]">
            Operational hosting and backups are configured by your TimIQ deployment operator. No public third-party
            advertising trackers are used in the product UI. If your organisation connects optional integrations (for
            example cloud storage), those are governed by your administrator&apos;s configuration.
          </p>
        </section>
      </SheetBody>
    </Sheet>
  );
}
