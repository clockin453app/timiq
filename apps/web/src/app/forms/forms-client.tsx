"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui";
import { isAdministrator, isAdmin, useCurrentUser } from "../../features/auth";
import { isNavigatorOffline } from "../../features/offline";
import { listMySmartFormSubmissions, listSmartFormTemplates, type SmartFormSubmissionWithTemplate, type SmartFormTemplate } from "../../features/smart-forms/api";
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

export function FormsClient() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const [templates, setTemplates] = useState<SmartFormTemplate[]>([]);
  const [submissions, setSubmissions] = useState<SmartFormSubmissionWithTemplate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
      <PageHeader
        description={t("forms.page_intro")}
        title={t("forms.page_title")}
      />
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

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{t("forms.start_form")}</h2>
          <Button disabled={loading} onClick={() => void load()} type="button" variant="ghost">
            {t("common.refresh")}
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading")}</p>
        ) : activeTemplates.length === 0 ? (
          <p className="text-sm text-[var(--color-text-soft)]">{t("forms.no_templates")}</p>
        ) : (
          <ul className="space-y-2">
            {activeTemplates.map((tpl) => (
              <li
                className="flex flex-col gap-2 rounded border border-[var(--color-border)] bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
                key={tpl.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[var(--color-header)] px-2 py-0.5 text-xs font-medium uppercase text-[var(--color-text-soft)]">
                      {tpl.category.replace(/_/g, " ")}
                    </span>
                    <span className="font-medium text-[var(--color-text)]">{tpl.name}</span>
                  </div>
                  {tpl.description ? <p className="mt-1 text-sm text-[var(--color-text-soft)]">{tpl.description}</p> : null}
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {tpl.requires_location ? `· ${t("forms.requires_location")} ` : ""}
                    {tpl.requires_signature ? `· ${t("forms.requires_signature")} ` : ""}
                    {tpl.allow_photos ? `· ${t("forms.allow_photos")}` : ""}
                  </p>
                </div>
                <div className="shrink-0">
                  <Link
                    className={`inline-flex h-9 items-center justify-center rounded border px-4 text-sm ${
                      !user?.company_id || isNavigatorOffline()
                        ? "pointer-events-none border-[var(--color-border)] bg-[var(--color-header)] text-[var(--color-text-muted)]"
                        : "border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
                    }`}
                    href={!user?.company_id || isNavigatorOffline() ? "#" : `/forms/start/${tpl.id}`}
                  >
                    {t("forms.start_form")}
                  </Link>
                  {isNavigatorOffline() ? (
                    <p className="mt-1 max-w-xs text-xs text-[var(--color-text-muted)]">
                      {t("offline.banner")}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">{t("forms.my_submissions")}</h2>
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
            {submissions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <span className="text-sm text-[var(--color-text-soft)]">—</span>
                </TableCell>
              </TableRow>
            ) : (
              submissions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.template_name}</TableCell>
                  <TableCell className="capitalize">{s.status}</TableCell>
                  <TableCell>{formatWhen(s.submitted_at)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      className="inline-flex h-8 items-center justify-center rounded border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-3 text-sm text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
                      href={`/forms/submissions/${s.id}`}
                    >
                      {s.status === "draft" ? t("forms.continue") : t("forms.view")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
