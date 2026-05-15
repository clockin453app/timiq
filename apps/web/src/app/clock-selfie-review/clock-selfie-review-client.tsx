"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Button,
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
import { RoleGuard } from "../../features/auth";
import {
  fetchClockSelfieBlob,
  listClockSelfiesForReview,
  type ClockSelfieReviewItem,
} from "../../features/time-clock/selfies-api";
import { useT } from "../../lib/i18n";

function formatPhase(
  phase: string,
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string,
): string {
  if (phase === "clock_in") {
    return t("clock_selfie_review.phase_clock_in", "Clock in");
  }
  if (phase === "clock_out") {
    return t("clock_selfie_review.phase_clock_out", "Clock out");
  }
  return phase.replaceAll("_", " ");
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ClockSelfieReviewClient() {
  const t = useT();
  const [items, setItems] = useState<ClockSelfieReviewItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError("");
      try {
        const data = await listClockSelfiesForReview();
        if (!cancelled) {
          setItems(data);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : t("clock_selfie_review.load_list_error"),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (previewId === null) {
      setPreviewUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return null;
      });
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }

    const selfieId = previewId;
    let cancelled = false;

    async function loadPreview() {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const blob = await fetchClockSelfieBlob(selfieId);
        if (cancelled) {
          return;
        }
        const nextUrl = URL.createObjectURL(blob);
        setPreviewUrl((previous) => {
          if (previous) {
            URL.revokeObjectURL(previous);
          }
          return nextUrl;
        });
      } catch (error) {
        if (!cancelled) {
          setPreviewError(
            error instanceof Error ? error.message : t("clock_selfie_review.preview_error"),
          );
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [previewId, t]);

  useEffect(() => {
    return () => {
      setPreviewUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return null;
      });
    };
  }, []);

  function closePreview() {
    setPreviewId(null);
  }

  const fallback = (
    <Sheet>
      <PageHeader
        title={t("clock_selfie_review.permission_title")}
        description={t("clock_selfie_review.fallback_description")}
      />
      <SheetBody>
        <div className="border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
          {t("clock_selfie_review.fallback_hint")}
          <div className="mt-3">
            <Link className="font-semibold text-[var(--color-text)] underline" href="/dashboard">
              {t("clock_selfie_review.back_dashboard")}
            </Link>
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );

  return (
    <RoleGuard allowedRoles={["administrator", "admin"]} fallback={fallback}>
      <Sheet>
        <PageHeader
          title={t("clock_selfie_review.page_title")}
          description={t("clock_selfie_review.default_description")}
        />
        <SheetBody>
          {isLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t("clock_selfie_review.loading_list")}</p>
          ) : null}

          {loadError ? (
            <div className="mb-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {loadError}
            </div>
          ) : null}

          {!isLoading && !loadError && items.length === 0 ? (
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
              {t("clock_selfie_review.no_items_scope")}
            </div>
          ) : null}

          {!isLoading && items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("clock_selfie_review.col_employee")}</TableHead>
                  <TableHead>{t("clock_selfie_review.col_email")}</TableHead>
                  <TableHead>{t("clock_selfie_review.col_company")}</TableHead>
                  <TableHead>{t("clock_selfie_review.col_phase")}</TableHead>
                  <TableHead>{t("clock_selfie_review.col_captured")}</TableHead>
                  <TableHead>{t("clock_selfie_review.col_shift_start")}</TableHead>
                  <TableHead>{t("clock_selfie_review.col_shift_end")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.employee_name ?? "—"}</TableCell>
                    <TableCell>{item.user_email}</TableCell>
                    <TableCell>{item.company_name ?? "—"}</TableCell>
                    <TableCell>{formatPhase(item.phase, t)}</TableCell>
                    <TableCell>{formatWhen(item.captured_at)}</TableCell>
                    <TableCell>{formatWhen(item.clock_in_at)}</TableCell>
                    <TableCell>{item.clock_out_at ? formatWhen(item.clock_out_at) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button onClick={() => setPreviewId(item.id)} type="button">
                        {t("clock_selfie_review.preview_button")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          {previewId ? (
            <div
              aria-modal="true"
              className="fixed inset-0 z-40 flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3"
              role="dialog"
            >
              <div className="mx-auto w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-md sm:max-w-[min(36rem,calc(100vw-3rem))]">
                <p className="text-sm font-bold text-[var(--color-text)]">{t("clock_selfie_review.dialog_title")}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("clock_selfie_review.dialog_hint")}</p>

                {previewLoading ? (
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                    {t("clock_selfie_review.opening_image")}
                  </p>
                ) : null}

                {previewError ? (
                  <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
                    {previewError}
                  </div>
                ) : null}

                {!previewLoading && previewUrl ? (
                  <div className="mt-3 rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={t("clock_selfie_review.gallery_alt")}
                      className="mx-auto max-h-80 w-full object-contain"
                      src={previewUrl}
                    />
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={closePreview} type="button">
                    {t("common.close")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </SheetBody>
      </Sheet>
    </RoleGuard>
  );
}
