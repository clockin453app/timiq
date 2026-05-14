"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, Input, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui";
import { buildSmartFormFieldLabelMap, formatSmartFormAnswerPlain } from "../../../features/smart-forms/answer-labels";
import {
  getSmartFormSubmission,
  getSmartFormTemplate,
  listSmartFormReviewQueue,
  reviewSmartFormSubmission,
  downloadSmartFormSubmissionPdf,
  type SmartFormReviewQueueItem,
  type SmartFormSchemaJson,
  type SmartFormSubmissionWithTemplate,
} from "../../../features/smart-forms/api";
import { smartFormCategoryLabel } from "../../../features/smart-forms/form-categories";
import { useI18n } from "../../../lib/i18n";

export function FormsReviewClient() {
  const { t } = useI18n();
  const [items, setItems] = useState<SmartFormReviewQueueItem[]>([]);
  const [selectedRow, setSelectedRow] = useState<SmartFormReviewQueueItem | null>(null);
  const [selected, setSelected] = useState<SmartFormSubmissionWithTemplate | null>(null);
  const [templateSchema, setTemplateSchema] = useState<SmartFormSchemaJson | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const rows = await listSmartFormReviewQueue({ status: "submitted" });
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openRow(row: SmartFormReviewQueueItem) {
    setError("");
    setSelectedRow(row);
    setNotes("");
    setTemplateSchema(null);
    try {
      const [detail, template] = await Promise.all([getSmartFormSubmission(row.id), getSmartFormTemplate(row.template_id)]);
      setSelected(detail);
      setTemplateSchema(template.schema_json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
      setSelected(null);
      setSelectedRow(null);
    }
  }

  async function decide(decision: "reviewed" | "rejected") {
    if (!selected) {
      return;
    }
    if (decision === "rejected" && !notes.trim()) {
      setError(t("forms.reject_notes_required", "Notes are required when rejecting."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await reviewSmartFormSubmission(selected.id, { decision, review_notes: notes.trim() || null });
      setSelected(null);
      setSelectedRow(null);
      setTemplateSchema(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const labelMap = templateSchema ? buildSmartFormFieldLabelMap(templateSchema) : new Map<string, string>();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap gap-2">
        <Link className="text-sm text-[var(--color-text-muted)] hover:underline" href="/forms">
          ← {t("forms.page_title")}
        </Link>
      </div>
      <PageHeader description={t("forms.review_intro")} title={t("forms.review_title")} />
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm lg:col-span-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{t("forms.review_queue_title", "Awaiting review")}</h2>
            <Button disabled={busy} onClick={() => void load()} type="button" variant="ghost">
              {t("common.refresh")}
            </Button>
          </div>
          {items.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-cell)] px-4 py-10 text-center">
              <p className="text-sm font-medium text-[var(--color-text)]">{t("forms.review_empty_title", "No form submissions waiting for review.")}</p>
              <p className="mt-2 text-sm text-[var(--color-text-soft)]">
                {t("forms.review_empty_body", "Submitted checklists will appear here.")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-[var(--color-border)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("forms.review_col_employee", "Employee")}</TableHead>
                    <TableHead>{t("forms.template_name")}</TableHead>
                    <TableHead>{t("forms.submitted_at")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow className={selectedRow?.id === row.id ? "bg-[var(--color-header)]" : undefined} key={row.id}>
                      <TableCell>
                        <button
                          className="text-left text-sm font-medium text-[var(--color-primary)] hover:underline"
                          onClick={() => void openRow(row)}
                          type="button"
                        >
                          {row.submitter_display || row.submitter_email}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-[10rem] truncate text-sm">{row.template_name}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-[var(--color-text-soft)]">
                        {row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm lg:col-span-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{t("forms.review_detail_title", "Submission detail")}</h2>
            {selected ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  void downloadSmartFormSubmissionPdf(selected.id).catch((e) =>
                    setError(e instanceof Error ? e.message : t("forms.error_pdf", "Could not download PDF.")),
                  )
                }
              >
                {t("forms.download_pdf", "Download PDF")}
              </Button>
            ) : null}
          </div>
          {!selected || !selectedRow ? (
            <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-cell)] px-4 py-12 text-center">
              <p className="text-sm text-[var(--color-text-soft)]">{t("forms.review_select_prompt", "Select a submission from the list to review it.")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2">
                  <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{t("forms.template_name")}</dt>
                  <dd className="mt-1 font-medium text-[var(--color-text)]">{selected.template_name}</dd>
                </div>
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2">
                  <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{t("forms.category")}</dt>
                  <dd className="mt-1 text-[var(--color-text)]">{smartFormCategoryLabel(selected.template_category, t)}</dd>
                </div>
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2">
                  <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{t("forms.review_col_employee", "Employee")}</dt>
                  <dd className="mt-1 text-[var(--color-text)]">{selectedRow.submitter_display || selectedRow.submitter_email}</dd>
                </div>
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2">
                  <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{t("forms.status")}</dt>
                  <dd className="mt-1 capitalize text-[var(--color-text)]">{selected.status}</dd>
                </div>
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2">
                  <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{t("forms.submitted_at")}</dt>
                  <dd className="mt-1 text-[var(--color-text)]">
                    {selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : "—"}
                  </dd>
                </div>
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{t("forms.location_label")}</dt>
                  <dd className="mt-1 text-[var(--color-text)]">{selectedRow.location_name ?? "—"}</dd>
                </div>
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                    {t("forms.signature_status", "Drawn signature")}
                  </dt>
                  <dd className="mt-1 text-[var(--color-text)]">
                    {selected.has_signature ? t("forms.signature_on_file_short", "On file") : t("forms.signature_missing_short", "Not on file")}
                  </dd>
                </div>
              </dl>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {t("forms.review_answers_heading", "Answers")}
                </h3>
                <div className="max-h-[min(24rem,50vh)] space-y-2 overflow-y-auto rounded border border-[var(--color-border)] bg-white p-3">
                  {Object.entries(selected.answers_json ?? {}).map(([k, v]) => (
                    <div className="border-b border-[var(--color-border)] pb-2 last:border-0 last:pb-0" key={k}>
                      <div className="text-sm font-medium text-[var(--color-text)]">{labelMap.get(k) ?? k}</div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-text-soft)]">{formatSmartFormAnswerPlain(v)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-[var(--color-text)]">{t("forms.review_notes")}</span>
                <Input onChange={(e) => setNotes(e.target.value)} value={notes} />
                <span className="text-xs text-[var(--color-text-muted)]">{t("forms.reject_notes_hint", "Required if you reject this submission.")}</span>
              </label>
              <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
                <Button disabled={busy} onClick={() => void decide("reviewed")} type="button">
                  {t("forms.decision_reviewed")}
                </Button>
                <Button disabled={busy || !notes.trim()} onClick={() => void decide("rejected")} type="button" variant="danger">
                  {t("forms.decision_rejected")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
