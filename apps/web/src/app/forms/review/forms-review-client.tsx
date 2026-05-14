"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, Input, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui";
import {
  getSmartFormSubmission,
  listSmartFormReviewQueue,
  reviewSmartFormSubmission,
  type SmartFormReviewQueueItem,
  type SmartFormSubmissionWithTemplate,
} from "../../../features/smart-forms/api";
import { useI18n } from "../../../lib/i18n";

export function FormsReviewClient() {
  const { t } = useI18n();
  const [items, setItems] = useState<SmartFormReviewQueueItem[]>([]);
  const [selected, setSelected] = useState<SmartFormSubmissionWithTemplate | null>(null);
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

  async function openRow(id: string) {
    setError("");
    try {
      const detail = await getSmartFormSubmission(id);
      setSelected(detail);
      setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }

  async function decide(decision: "reviewed" | "rejected") {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await reviewSmartFormSubmission(selected.id, { decision, review_notes: notes || null });
      setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap gap-2">
        <Link className="text-sm text-[var(--color-text-muted)] hover:underline" href="/forms">
          ← {t("forms.page_title")}
        </Link>
      </div>
      <PageHeader description={t("forms.review_intro")} title={t("forms.review_title")} />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-2 flex justify-between">
            <h2 className="text-base font-semibold">Queue</h2>
            <Button disabled={busy} onClick={() => void load()} type="button" variant="ghost">
              {t("common.refresh")}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>{t("forms.submitted_at")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <span className="text-sm text-[var(--color-text-soft)]">—</span>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow className={selected?.id === row.id ? "bg-[var(--color-header)]" : undefined} key={row.id}>
                    <TableCell>
                      <button
                        className="text-left text-sm text-[var(--color-primary)] hover:underline"
                        onClick={() => void openRow(row.id)}
                        type="button"
                      >
                        {row.submitter_display || row.submitter_email}
                      </button>
                    </TableCell>
                    <TableCell>{row.template_name}</TableCell>
                    <TableCell>{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t("common.details")}</h2>
          {!selected ? (
            <p className="text-sm text-[var(--color-text-soft)]">Select a submission.</p>
          ) : (
            <>
              <p className="text-sm text-[var(--color-text-soft)]">
                {selected.template_name} · {selected.template_category}
              </p>
              <div className="space-y-2 rounded border border-[var(--color-border)] bg-white p-3 text-sm">
                {Object.entries(selected.answers_json ?? {}).map(([k, v]) => (
                  <div key={k}>
                    <div className="font-medium">{k}</div>
                    <div className="whitespace-pre-wrap text-[var(--color-text-soft)]">
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </div>
                  </div>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-sm">
                {t("forms.review_notes")}
                <Input onChange={(e) => setNotes(e.target.value)} value={notes} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void decide("reviewed")} type="button" variant="secondary">
                  {t("forms.decision_reviewed")}
                </Button>
                <Button disabled={busy} onClick={() => void decide("rejected")} type="button" variant="danger">
                  {t("forms.decision_rejected")}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
