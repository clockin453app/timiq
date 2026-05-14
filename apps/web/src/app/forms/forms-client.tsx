"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui";
import { isAdministrator, isAdmin, useCurrentUser } from "../../features/auth";
import { listMySmartFormSubmissions, listSmartFormTemplates, type SmartFormSubmissionWithTemplate, type SmartFormTemplate } from "../../features/smart-forms/api";
import { smartFormCategoryLabel } from "../../features/smart-forms/form-categories";
import { useI18n } from "../../lib/i18n";

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

function submissionStatusClass(status: string): string {
  switch (status) {
    case "draft":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "submitted":
      return "bg-sky-50 text-sky-900 border-sky-200";
    case "reviewed":
      return "bg-emerald-50 text-emerald-900 border-emerald-200";
    case "rejected":
      return "bg-red-50 text-red-900 border-red-200";
    default:
      return "bg-[var(--color-header)] text-[var(--color-text)] border-[var(--color-border)]";
  }
}

export function FormsClient() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const [templates, setTemplates] = useState<SmartFormTemplate[]>([]);
  const [submissions, setSubmissions] = useState<SmartFormSubmissionWithTemplate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [navigatorOffline, setNavigatorOffline] = useState(false);

  useEffect(() => {
    setMounted(true);
    const sync = () => setNavigatorOffline(typeof navigator !== "undefined" && !navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const offlineBlock = mounted && navigatorOffline;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [tpl, sub] = await Promise.all([listSmartFormTemplates(), listMySmartFormSubmissions()]);
      setTemplates(tpl);
      setSubmissions(sub);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error", "Something went wrong."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTemplates = templates.filter((x) => x.status === "active");
  const showManage = user != null && (isAdmin(user) || isAdministrator(user));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader description={t("forms.page_intro")} title={t("forms.page_title")} />
      {showManage ? (
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex h-9 items-center justify-center rounded border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-4 text-sm text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
            href="/forms/manage"
          >
            {t("forms.manage_title")}
          </Link>
          <Link
            className="inline-flex h-9 items-center justify-center rounded border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-4 text-sm text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
            href="/forms/review"
          >
            {t("forms.review_title")}
          </Link>
        </div>
      ) : null}

      {user && !user.company_id ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("forms.no_company")}</p>
      ) : null}

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
      ) : null}

      <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{t("forms.start_form")}</h2>
          <Button disabled={loading} onClick={() => void load()} type="button" variant="ghost">
            {t("common.refresh")}
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading")}</p>
        ) : activeTemplates.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-cell)] px-4 py-10 text-center">
            <p className="text-sm font-medium text-[var(--color-text)]">{t("forms.templates_empty_employee_title", "No forms available")}</p>
            <p className="mt-2 text-sm text-[var(--color-text-soft)]">{t("forms.no_templates")}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {activeTemplates.map((tpl) => (
              <li
                className="flex flex-col gap-3 rounded border border-[var(--color-border)] bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
                key={tpl.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-header)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text)]">
                      {smartFormCategoryLabel(tpl.category, t)}
                    </span>
                    <span className="font-semibold text-[var(--color-text)]">{tpl.name}</span>
                  </div>
                  {tpl.description ? <p className="mt-1 text-sm text-[var(--color-text-soft)]">{tpl.description}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tpl.requires_location ? (
                      <span className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                        {t("forms.requires_location")}
                      </span>
                    ) : null}
                    {tpl.requires_signature ? (
                      <span className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                        {t("forms.requires_signature")}
                      </span>
                    ) : null}
                    {tpl.allow_photos ? (
                      <span className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                        {t("forms.allow_photos")}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0">
                  <Link
                    className={`inline-flex h-9 items-center justify-center rounded border px-4 text-sm font-medium ${
                      !user?.company_id || offlineBlock
                        ? "pointer-events-none border-[var(--color-border)] bg-[var(--color-header)] text-[var(--color-text-muted)]"
                        : "border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
                    }`}
                    href={!user?.company_id || offlineBlock ? "#" : `/forms/start/${tpl.id}`}
                  >
                    {t("forms.start_form")}
                  </Link>
                  {offlineBlock ? (
                    <p className="mt-1 max-w-xs text-xs text-[var(--color-text-muted)]">{t("offline.banner")}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-[var(--color-text)]">{t("forms.my_submissions")}</h2>
        {loading ? (
          <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading")}</p>
        ) : submissions.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-cell)] px-4 py-10 text-center">
            <p className="text-sm font-medium text-[var(--color-text)]">{t("forms.submissions_empty_title", "No submissions yet")}</p>
            <p className="mt-2 text-sm text-[var(--color-text-soft)]">{t("forms.submissions_empty_body", "When you start a form, your drafts and sent forms will appear here.")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("forms.template_name")}</TableHead>
                  <TableHead>{t("forms.status")}</TableHead>
                  <TableHead>{t("forms.submitted_at")}</TableHead>
                  <TableHead className="text-right">{t("common.details")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-[var(--color-text)]">{s.template_name}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${submissionStatusClass(s.status)}`}
                      >
                        {s.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--color-text-soft)]">{formatWhen(s.submitted_at)}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        className="inline-flex h-8 items-center justify-center rounded border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-3 text-sm text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
                        href={`/forms/submissions/${s.id}`}
                      >
                        {s.status === "draft" ? t("forms.continue") : t("forms.view")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
