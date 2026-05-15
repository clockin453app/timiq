"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  Input,
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
import { isAdministrator, RoleGuard, useCurrentUser } from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import {
  approveOnboarding,
  fetchOnboardingDocumentBlob,
  fetchOnboardingProfilePhotoBlob,
  fetchOnboardingSignatureBlob,
  getOnboardingReviewDetail,
  listOnboardingReview,
  ONBOARDING_REQUIRED_DOC_SLOTS,
  openOnboardingSubmissionPrintWindow,
  rejectOnboarding,
  type OnboardingDocumentMeta,
  type OnboardingReviewListItem,
  type OnboardingSubmissionDetail,
} from "../../features/onboarding/api";
import {
  formatOnboardingFieldValue,
  ONBOARDING_REVIEW_SECTIONS,
  onboardingReviewFieldLabel,
} from "../../features/onboarding/review-form-sections";
import { genericStatusLabel, useT } from "../../lib/i18n";

const REQUIRED_DOC_TYPE_SET = new Set(ONBOARDING_REQUIRED_DOC_SLOTS.map((s) => s.docType));

function findDocForType(docs: OnboardingDocumentMeta[], docType: string) {
  return docs.find((d) => d.doc_type === docType);
}


function OnboardingReviewAdminBody() {
  const t = useT();
  const user = useCurrentUser();
  const adminAllCompanies = isAdministrator(user);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("submitted");
  const [items, setItems] = useState<OnboardingReviewListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OnboardingSubmissionDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const [reasonOpen, setReasonOpen] = useState<"approve" | "reject" | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const [detailPhotoUrl, setDetailPhotoUrl] = useState<string | null>(null);
  const detailPhotoRevokeRef = useRef<string | null>(null);

  const loadCompanies = useCallback(async () => {
    if (!adminAllCompanies) {
      return;
    }
    try {
      const data = await listCompanies();
      setCompanies(data);
    } catch {
      setCompanies([]);
    }
  }, [adminAllCompanies]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError("");
    try {
      const data = await listOnboardingReview({
        status: statusFilter || undefined,
        companyId: adminAllCompanies && companyFilter ? companyFilter : undefined,
        limit: 100,
        offset: 0,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setListError(err instanceof Error ? err.message : t("onboarding.list_error"));
      setItems([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [adminAllCompanies, companyFilter, statusFilter]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const row = detail;
    if (!row?.has_profile_photo || !row.user_id) {
      if (detailPhotoRevokeRef.current) {
        URL.revokeObjectURL(detailPhotoRevokeRef.current);
        detailPhotoRevokeRef.current = null;
      }
      setDetailPhotoUrl(null);
      return;
    }

    const subjectUserId = row.user_id;

    let cancelled = false;
    async function loadSubjectPhoto() {
      try {
        const blob = await fetchOnboardingProfilePhotoBlob(subjectUserId);
        const url = URL.createObjectURL(blob);
        if (detailPhotoRevokeRef.current) {
          URL.revokeObjectURL(detailPhotoRevokeRef.current);
        }
        detailPhotoRevokeRef.current = url;
        if (!cancelled) {
          setDetailPhotoUrl(url);
        }
      } catch {
        if (!cancelled) {
          setDetailPhotoUrl(null);
        }
      }
    }

    void loadSubjectPhoto();
    return () => {
      cancelled = true;
    };
  }, [detail?.user_id, detail?.has_profile_photo, detail?.profile_photo_updated_at]);

  useEffect(() => {
    return () => {
      if (detailPhotoRevokeRef.current) {
        URL.revokeObjectURL(detailPhotoRevokeRef.current);
        detailPhotoRevokeRef.current = null;
      }
    };
  }, []);

  const openDetail = useCallback(async (submissionId: string) => {
    setSelectedId(submissionId);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const data = await getOnboardingReviewDetail(submissionId);
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : t("onboarding.load_detail_error"));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function downloadDocument(documentId: string, filename: string) {
    try {
      const blob = await fetchOnboardingDocumentBlob(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "document";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : t("onboarding.download_failed"));
    }
  }

  async function viewSignature(submissionId: string) {
    try {
      const blob = await fetchOnboardingSignatureBlob(submissionId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : t("onboarding.signature_error"));
    }
  }

  function openReason(kind: "approve" | "reject") {
    setActionError("");
    setReasonText("");
    setReasonOpen(kind);
  }

  async function submitReason(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !reasonOpen) {
      return;
    }
    const trimmed = reasonText.trim();
    if (trimmed.length < 3) {
      setActionError(t("onboarding.reason_min"));
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      if (reasonOpen === "approve") {
        const data = await approveOnboarding(selectedId, trimmed);
        setDetail(data);
      } else {
        const data = await rejectOnboarding(selectedId, trimmed);
        setDetail(data);
      }
      setReasonOpen(null);
      await loadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("onboarding.action_failed"));
    } finally {
      setActionBusy(false);
    }
  }

  const detailTitle = useMemo(() => {
    if (!detail) {
      return "";
    }
    const row = items.find((i) => i.id === detail.id);
    return row?.user_email ?? detail.user_id;
  }, [detail, items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <label className="flex min-w-0 w-full flex-col gap-1 text-sm md:w-auto">
          <span className="text-[var(--color-text-muted)]">{t("onboarding.filter_status")}</span>
          <select
            className="h-9 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2 text-sm text-[var(--color-text)]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">{t("onboarding.status_all")}</option>
            <option value="submitted">{genericStatusLabel(t, "submitted")}</option>
            <option value="approved">{genericStatusLabel(t, "approved")}</option>
            <option value="rejected">{genericStatusLabel(t, "rejected")}</option>
            <option value="draft">{genericStatusLabel(t, "draft")}</option>
          </select>
        </label>
        {adminAllCompanies ? (
          <label className="flex min-w-0 w-full flex-col gap-1 text-sm md:w-auto">
            <span className="text-[var(--color-text-muted)]">{t("onboarding.filter_company")}</span>
            <select
              className="h-9 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2 text-sm text-[var(--color-text)] sm:min-w-[12rem]"
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
            >
              <option value="">{t("privacy.requests_all_companies")}</option>
            </select>
          </label>
        ) : null}
      </div>

      {listError ? <p className="text-sm text-[var(--color-danger-700)]">{listError}</p> : null}
      {listLoading ? <p className="text-sm text-[var(--color-text-muted)]">{t("onboarding.loading_list")}</p> : null}

      {!listLoading ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          {t("onboarding.showing_count", undefined, { shown: items.length, total })}
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("onboarding.col_employee")}</TableHead>
            <TableHead>{t("onboarding.col_company")}</TableHead>
            <TableHead>{t("onboarding.col_status")}</TableHead>
            <TableHead>{t("onboarding.col_submitted")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium text-[var(--color-text)]">
                    {row.employee_name ?? row.user_email}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">{row.user_email}</span>
                </div>
              </TableCell>
              <TableCell>{row.company_name ?? "—"}</TableCell>
              <TableCell className="capitalize">{genericStatusLabel(t, row.status)}</TableCell>
              <TableCell>{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "—"}</TableCell>
              <TableCell>
                <Button type="button" size="sm" variant="secondary" onClick={() => void openDetail(row.id)}>
                  {t("onboarding.open_detail")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {selectedId ? (
        <div className="space-y-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            {t("onboarding.selected_heading")}
          </p>
          {detailLoading ? <p className="text-sm text-[var(--color-text-muted)]">{t("onboarding.loading_detail")}</p> : null}
          {detailError ? <p className="text-sm text-[var(--color-danger-700)]">{detailError}</p> : null}
          {detail ? (
            <div className="space-y-3 text-sm text-[var(--color-text)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                {detailPhotoUrl ? (
                  <div className="shrink-0 overflow-hidden rounded-lg border border-[var(--color-border-dark)]">
                    <img
                      src={detailPhotoUrl}
                      alt={t("onboarding.profile_photo_alt")}
                      className="h-28 w-28 object-cover sm:h-32 sm:w-32"
                    />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{detailTitle}</p>
                </div>
              </div>
              <p className="text-[var(--color-text-muted)]">
                {t("onboarding.col_status")}{" "}
                <span className="capitalize text-[var(--color-text)]">{genericStatusLabel(t, detail.status)}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => openOnboardingSubmissionPrintWindow(detail.id)}>
                  {t("onboarding.print_export")}
                </Button>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                {t("onboarding.account_email", undefined, { email: detail.account_email })}
              </p>
              <div className="space-y-4">
                {ONBOARDING_REVIEW_SECTIONS.map((section) => (
                  <div key={section.title} className="rounded border border-[var(--color-border)] p-3">
                    <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">{section.title}</p>
                    <dl className="mt-2 grid gap-2 text-sm">
                      {section.keys.map((key) => (
                        <div
                          key={key}
                          className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4"
                        >
                          <dt className="text-[var(--color-text-muted)]">{onboardingReviewFieldLabel(key)}</dt>
                          <dd className="max-w-full break-words font-medium text-[var(--color-text)] sm:text-right">
                            {formatOnboardingFieldValue(key, detail.form_payload[key])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
              <details className="text-xs text-[var(--color-text-muted)]">
                <summary className="cursor-pointer text-[var(--color-text-soft)]">{t("onboarding.raw_json")}</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-sheet)] p-2 text-[11px] text-[var(--color-text)]">
                  {JSON.stringify(detail.form_payload, null, 2)}
                </pre>
              </details>
              {detail.signature_mode === "typed" && detail.signature_typed_text ? (
                <p>
                  <span className="text-[var(--color-text-muted)]">{t("onboarding.typed_signature")}</span>
                  {detail.signature_typed_text}
                </p>
              ) : null}
              {detail.signature_mode === "drawn" && detail.has_drawn_signature ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void viewSignature(detail.id)}
                >
                  {t("onboarding.view_drawn_signature")}
                </Button>
              ) : null}
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">
                  {t("onboarding.required_documents")}
                </p>
                <ul className="space-y-3">
                  {ONBOARDING_REQUIRED_DOC_SLOTS.map(({ docType, label }) => {
                    const doc = findDocForType(detail.documents, docType);
                    return (
                      <li
                        key={docType}
                        className="flex flex-col gap-1 rounded border border-[var(--color-border)] p-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-medium text-[var(--color-text)]">{label}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {doc ? (
                              <>
                                {t("onboarding.uploaded_kb", undefined, {
                                  filename: doc.original_filename,
                                  kb: Math.round(doc.file_size_bytes / 1024),
                                })}
                              </>
                            ) : (
                              <span className="text-[var(--color-danger-700)]">{t("onboarding.missing_document")}</span>
                            )}
                          </p>
                        </div>
                        {doc ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => void downloadDocument(doc.id, doc.original_filename)}
                          >
                            {t("onboarding.download")}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {detail.documents.some((d) => !REQUIRED_DOC_TYPE_SET.has(d.doc_type)) ? (
                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">
                      {t("onboarding.other_files")}
                    </p>
                    <ul className="space-y-2">
                      {detail.documents
                        .filter((d) => !REQUIRED_DOC_TYPE_SET.has(d.doc_type))
                        .map((doc) => (
                          <li key={doc.id} className="flex flex-wrap items-center gap-2">
                            <span className="text-[var(--color-text-muted)]">
                              {doc.doc_type.replace("_", " ")} — {doc.original_filename}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void downloadDocument(doc.id, doc.original_filename)}
                            >
                              {t("onboarding.download")}
                            </Button>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
                    {detail.status === "submitted" ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button type="button" variant="primary" onClick={() => openReason("approve")}>
                    {t("onboarding.approve_button")}
                  </Button>
                  <Button type="button" variant="danger" onClick={() => openReason("reject")}>
                    {t("onboarding.reject_button")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {reasonOpen ? (
        <form
          className="space-y-3 border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4"
          onSubmit={(e) => void submitReason(e)}
        >
          <p className="text-sm font-medium text-[var(--color-text)]">
            {reasonOpen === "approve" ? t("onboarding.approve_reason") : t("onboarding.reject_reason")}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--color-text-muted)]">{t("onboarding.reason_length_hint")}</span>
            <Input value={reasonText} onChange={(e) => setReasonText(e.target.value)} required minLength={3} />
          </label>
          {actionError ? <p className="text-sm text-[var(--color-danger-700)]">{actionError}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={actionBusy}>
              {t("common.confirm")}
            </Button>
            <Button type="button" variant="secondary" disabled={actionBusy} onClick={() => setReasonOpen(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function OnboardingReviewClient() {
  const t = useT();
  return (
    <Sheet>
      <PageHeader title={t("onboarding.page_title")} description={t("onboarding.page_description")} />
      <SheetBody className="min-w-0 space-y-6">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-[var(--color-text)]">
              {t("onboarding.permission_denied")}
            </div>
          }
        >
          <OnboardingReviewAdminBody />
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
