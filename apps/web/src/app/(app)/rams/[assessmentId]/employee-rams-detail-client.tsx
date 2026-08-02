"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Input } from "@/components/ui";
import { SignaturePad } from "@/components/signature/signature-pad";
import { isEmployee, useCurrentUser } from "@/features/auth";
import {
  acknowledgeRams,
  declineRams,
  downloadRamsPdf,
  downloadUploadedRamsPdf,
  getRams,
  ramsAttachmentUrl,
  ramsSignatureImageUrl,
  type RamsAssessmentDetail,
} from "@/features/rams/api";
import { listLocations, type Location } from "@/features/locations/api";
import { useT } from "@/lib/i18n";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function riskChipClass(level: string): string {
  switch (level) {
    case "low":
      return "border-emerald-400 bg-emerald-50 text-emerald-900";
    case "medium":
      return "border-amber-400 bg-amber-50 text-amber-950";
    case "high":
      return "border-orange-500 bg-orange-50 text-orange-950";
    case "critical":
      return "border-red-600 bg-red-50 text-red-950";
    default:
      return "border-[var(--color-border)] bg-[var(--color-cell)] text-[var(--color-text)]";
  }
}

const PRIMARY_LINK_CLASS =
  "inline-flex min-h-[52px] w-full items-center justify-center rounded border border-[var(--color-btn-primary-border)] bg-[var(--color-btn-primary-bg)] px-3 text-base font-semibold text-[var(--color-btn-primary-fg)] hover:border-[var(--color-btn-primary-hover-bg)] hover:bg-[var(--color-btn-primary-hover-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-btn-primary-border)] active:translate-y-[0.5px]";

function renderDocumentBlock(
  detail: RamsAssessmentDetail,
  block: NonNullable<RamsAssessmentDetail["document_sections"]>[number]["blocks"][number],
) {
  if (block.type === "text" && block.text) {
    return <p className="whitespace-pre-wrap text-[var(--color-text)]">{block.text}</p>;
  }
  if (block.type === "list" && block.items?.length) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {block.items.map((item, idx) => (
          <li key={`${block.id}-${idx}`}>{item}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "table" && block.rows?.length) {
    const columns = block.columns?.length ? block.columns : Object.keys(block.rows[0] ?? {});
    return (
      <div className="timiq-scroll-x w-full min-w-0 max-w-full overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-[var(--color-header)]">
            <tr>
              {columns.map((col) => (
                <th className="px-3 py-2 font-semibold" key={col}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, idx) => (
              <tr className="border-t border-[var(--color-border)]" key={`${block.id}-row-${idx}`}>
                {columns.map((col) => (
                  <td className="px-3 py-2 align-top" key={col}>
                    {String(row[col] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === "photo") {
    const attachment = (detail.attachments ?? []).find((a) => a.section_key === block.section_key);
    if (attachment && attachment.content_type.startsWith("image/")) {
      return (
        <figure className="rounded border border-[var(--color-border)] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={block.caption ?? attachment.original_filename}
            className="max-h-80 w-full object-contain"
            src={ramsAttachmentUrl(attachment)}
          />
          <figcaption className="mt-1 text-xs text-[var(--color-text-soft)]">
            {block.caption ?? attachment.original_filename}
          </figcaption>
        </figure>
      );
    }
    return block.caption ? <p className="text-xs text-[var(--color-text-soft)]">Photo: {block.caption}</p> : null;
  }
  if (block.type === "hazard_table") {
    return (
      <div className="space-y-2">
        {detail.hazards.map((h) => (
          <div className="rounded border border-[var(--color-border)] p-3" key={h.id}>
            <p className="font-medium">{h.hazard}</p>
            <p className="text-xs text-[var(--color-text-soft)]">
              Initial {h.initial_risk_score} ({h.initial_risk_band}) · Residual {h.residual_risk_score} (
              {h.residual_risk_band})
            </p>
            <p className="mt-2 whitespace-pre-wrap">{h.control_measures}</p>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "risk_matrix") {
    return (
      <p className="text-[var(--color-text-soft)]">
        Risk score is likelihood x severity using a 1-5 scale: low 1-5, medium 6-10, high 11-15, critical 16-25.
      </p>
    );
  }
  return null;
}

function readerOpenLabel(detail: RamsAssessmentDetail): string {
  const progress = detail.reading_progress;
  if (!progress || progress.status === "not_started") return "Open RAMS";
  if (progress.status === "completed") return "Review RAMS again";
  return "Continue reading RAMS";
}

type Props = {
  assessmentId: string;
};

export function EmployeeRamsDetailClient({ assessmentId }: Props) {
  const t = useT();
  const currentUser = useCurrentUser();
  const progressSectionRef = useRef<HTMLElement | null>(null);
  const ackSectionRef = useRef<HTMLElement | null>(null);

  const [detail, setDetail] = useState<RamsAssessmentDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ackName, setAckName] = useState("");
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [readAck, setReadAck] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
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

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [d, locs] = await Promise.all([getRams(assessmentId), listLocations().catch(() => [])]);
      setDetail(d);
      setLocations(locs);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_load", "Could not load RAMS."));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [assessmentId, t]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const myRow = useMemo(() => {
    if (!detail || !currentUser) return null;
    return detail.acknowledgements.find((a) => a.user_id === currentUser.id) ?? null;
  }, [detail, currentUser]);

  const readingComplete = !detail?.reading_required || detail.reading_progress?.status === "completed";
  const canAcknowledge =
    isEmployee(currentUser) &&
    myRow?.status === "pending" &&
    (detail?.status === "published" || detail?.status === "reviewed");
  const ackControlsEnabled = Boolean(canAcknowledge && readingComplete && !offlineBlock);
  const isAcknowledged = myRow?.status === "acknowledged";
  const isUploaded = detail?.source_type === "uploaded_pdf";

  useEffect(() => {
    if (!detail || loading) return;
    let shouldFocus = false;
    try {
      const focusId = sessionStorage.getItem("timiq_rams_focus_ack");
      if (focusId === assessmentId) {
        sessionStorage.removeItem("timiq_rams_focus_ack");
        shouldFocus = true;
      }
    } catch {
      // ignore
    }
    if (typeof window !== "undefined" && window.location.hash === "#rams-acknowledgement") {
      shouldFocus = true;
    }
    if (!shouldFocus) return;
    const target =
      readingComplete && canAcknowledge ? ackSectionRef.current : progressSectionRef.current ?? ackSectionRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.focus?.({ preventScroll: true });
  }, [assessmentId, canAcknowledge, detail, loading, readingComplete]);

  const siteName = useMemo(() => {
    if (!detail?.location_id) return "—";
    return locations.find((l) => l.id === detail.location_id)?.name ?? "—";
  }, [detail, locations]);

  const submitAck = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!detail) return;
    if (offlineBlock) {
      setError(t("rams.offline_ack", "Acknowledgement requires connection."));
      return;
    }
    setActionBusy(true);
    setError("");
    try {
      const d = await acknowledgeRams(assessmentId, {
        read_understood_ack: readAck,
        acknowledgement_name: ackName.trim(),
        signature_image_data: signaturePng ?? "",
      });
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_ack", "Could not acknowledge."));
    } finally {
      setActionBusy(false);
    }
  };

  const submitDecline = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!detail) return;
    if (offlineBlock) {
      setError(t("rams.offline_ack", "Acknowledgement requires connection."));
      return;
    }
    setActionBusy(true);
    setError("");
    try {
      const d = await declineRams(assessmentId, declineReason);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_decline", "Could not decline."));
    } finally {
      setActionBusy(false);
    }
  };

  const downloadPdf = () => {
    if (!detail) return;
    if (isUploaded) {
      void downloadUploadedRamsPdf(detail.id, detail.uploaded_pdf?.original_filename).catch((e) =>
        setError(e instanceof Error ? e.message : t("rams.error_pdf", "Could not download PDF.")),
      );
      return;
    }
    void downloadRamsPdf(detail.id, detail.reference ?? detail.id).catch((e) =>
      setError(e instanceof Error ? e.message : t("rams.error_pdf", "Could not download PDF.")),
    );
  };

  if (loading) {
    return (
      <div className="w-full min-w-0 space-y-3 pb-[max(1rem,calc(var(--layout-mobile-bottom-nav-height)+0.75rem))]">
        <div className="h-4 w-28 animate-pulse rounded bg-[var(--color-border)]" />
        <div className="h-7 w-3/4 animate-pulse rounded bg-[var(--color-border)]" />
        <div className="h-16 w-full animate-pulse rounded bg-[var(--color-border)]" />
        <div className="h-[52px] w-full animate-pulse rounded bg-[var(--color-border)]" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <Link className="text-sm font-semibold text-[var(--color-link)] underline" href="/rams">
          Back to My RAMS
        </Link>
        {error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-[var(--color-text-soft)]">RAMS not found.</p>}
      </div>
    );
  }

  const viewed = detail.reading_progress?.viewed_count ?? 0;
  const totalPages = detail.reading_progress?.total_pages ?? null;
  const progressPct = totalPages && totalPages > 0 ? Math.min(100, (viewed / totalPages) * 100) : 0;

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 pb-[max(1.25rem,calc(var(--layout-mobile-bottom-nav-height)+0.85rem))] md:pb-6">
      <Link className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--color-link)] underline" href="/rams">
        Back to My RAMS
      </Link>

      <header className="space-y-2">
        <h1 className="break-words text-2xl font-bold text-[var(--color-text)]">{detail.title}</h1>
        <dl className="grid gap-1 text-sm text-[var(--color-text-soft)] sm:grid-cols-2">
          <div>
            <dt className="inline font-medium text-[var(--color-text)]">Site: </dt>
            <dd className="inline">{siteName}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-[var(--color-text)]">Review date: </dt>
            <dd className="inline">{formatDate(detail.review_due_date)}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-[var(--color-text)]">Risk: </dt>
            <dd className="inline">
              <span className={`rounded border px-2 py-0.5 text-xs capitalize ${riskChipClass(detail.risk_level)}`}>
                {detail.risk_level}
              </span>
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-[var(--color-text)]">Status: </dt>
            <dd className="inline capitalize">{myRow?.status ?? "pending"}</dd>
          </div>
        </dl>
      </header>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {offlineBlock ? (
        <p className="text-sm text-[var(--color-text-soft)]">{t("rams.offline_ack", "Acknowledgement requires connection.")}</p>
      ) : null}

      {isAcknowledged ? (
        <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-sm font-semibold text-emerald-900">Acknowledged</p>
          {myRow?.acknowledgement_name ? (
            <p className="text-sm text-[var(--color-text)]">Printed name: {myRow.acknowledgement_name}</p>
          ) : null}
          {myRow?.acknowledged_at ? (
            <p className="text-sm text-[var(--color-text)]">Signed: {formatDate(myRow.acknowledged_at)}</p>
          ) : null}
          {detail.uploaded_pdf?.version != null ? (
            <p className="text-sm text-[var(--color-text)]">Document version {detail.uploaded_pdf.version}</p>
          ) : null}
          {myRow?.signature_image_href ? (
            <div className="rounded border border-[var(--color-border)] bg-white p-2">
              <p className="mb-1 text-xs font-medium text-[var(--color-text)]">Your signature</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Your RAMS signature"
                className="h-16 max-w-full object-contain object-left"
                src={ramsSignatureImageUrl(myRow.signature_image_href) ?? undefined}
              />
            </div>
          ) : null}
          <div className="flex w-full min-w-0 flex-col gap-2">
            {isUploaded ? (
              <Link className={PRIMARY_LINK_CLASS} href={`/rams/${detail.id}/read`}>
                View RAMS
              </Link>
            ) : (
              <Button className="min-h-[52px] w-full" onClick={downloadPdf} type="button">
                View RAMS
              </Button>
            )}
            <Button className="min-h-[44px] w-full" onClick={downloadPdf} type="button" variant="secondary">
              Download PDF
            </Button>
          </div>
        </section>
      ) : (
        <>
          <p className="text-sm text-[var(--color-text)]">
            Please open and review every page of this RAMS before acknowledging it.
          </p>

          <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Document</h2>
            {isUploaded ? (
              <div className="flex items-start gap-3 rounded border border-[var(--color-border)] bg-white p-3">
                <div
                  aria-hidden
                  className="flex h-16 w-12 shrink-0 items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-cell)] text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]"
                >
                  PDF
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm font-medium text-[var(--color-text)]">
                    {detail.uploaded_pdf?.original_filename ?? "RAMS PDF"}
                  </p>
                  {detail.uploaded_pdf?.version != null ? (
                    <p className="mt-1 text-xs text-[var(--color-text-soft)]">Version {detail.uploaded_pdf.version}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {isUploaded || detail.reading_required ? (
              <Link className={PRIMARY_LINK_CLASS} href={`/rams/${detail.id}/read`}>
                {readerOpenLabel(detail)}
              </Link>
            ) : (
              <p className="text-sm text-[var(--color-text-soft)]">Review the document sections below, then acknowledge.</p>
            )}
            <Button className="min-h-[44px] w-full" onClick={downloadPdf} type="button" variant="secondary">
              Download PDF
            </Button>
            <p className="text-xs text-[var(--color-text-soft)]">
              Downloading alone does not unlock acknowledgement.
            </p>
          </section>

          {detail.reading_required ? (
            <section
              className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              id="rams-reading-progress"
              ref={progressSectionRef}
              tabIndex={-1}
            >
              <h2 className="text-base font-semibold text-[var(--color-text)]">Reading progress</h2>
              <p className="text-sm text-[var(--color-text)]">
                {totalPages != null ? `${viewed} of ${totalPages} pages viewed` : "Open the RAMS to start tracking pages."}
              </p>
              {totalPages != null && totalPages > 0 ? (
                <div
                  aria-label="Reading progress"
                  aria-valuemax={totalPages}
                  aria-valuemin={0}
                  aria-valuenow={viewed}
                  className="h-2 w-full overflow-hidden rounded bg-[var(--color-border)]"
                  role="progressbar"
                >
                  <div className="h-full bg-[var(--color-btn-primary-bg)] transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              ) : null}
              {readingComplete ? (
                <p className="text-sm font-medium text-emerald-900">All pages viewed. You can now acknowledge this RAMS.</p>
              ) : (
                <>
                  <p className="text-sm text-amber-950">View all pages to unlock acknowledgement.</p>
                  <Link className={PRIMARY_LINK_CLASS} href={`/rams/${detail.id}/read`}>
                    Continue reading RAMS
                  </Link>
                </>
              )}
            </section>
          ) : null}

          {!isUploaded ? (
            <div className="space-y-4">
              {(detail.document_sections ?? [])
                .filter((section) => section.visible_in_pdf)
                .map((section) => (
                  <section className="rounded border border-[var(--color-border)] bg-white p-4" key={section.id}>
                    <h3 className="border-b border-[var(--color-border)] pb-2 text-base font-semibold text-[var(--color-text)]">
                      {section.title}
                    </h3>
                    {section.not_applicable ? (
                      <p className="mt-3 text-[var(--color-text-soft)]">Not applicable.</p>
                    ) : null}
                    <div className="mt-3 space-y-3">
                      {section.blocks.map((block) => (
                        <div key={block.id}>{renderDocumentBlock(detail, block)}</div>
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          ) : null}

          <section
            className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            id="rams-acknowledgement"
            ref={ackSectionRef}
            tabIndex={-1}
          >
            <h2 className="text-base font-semibold text-[var(--color-text)]">Final acknowledgement</h2>
            {canAcknowledge ? (
              detail.reading_required && !readingComplete ? (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--color-text-soft)]">Signature controls unlock after you view every page.</p>
                  <Link className={PRIMARY_LINK_CLASS} href={`/rams/${detail.id}/read`}>
                    Continue reading RAMS
                  </Link>
                </div>
              ) : (
                <form className="space-y-3" onSubmit={submitAck}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      checked={readAck}
                      className="mt-1 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                      disabled={!ackControlsEnabled}
                      onChange={(e) => setReadAck(e.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      I confirm that I have reviewed this RAMS and understand that I must follow the controls and method described.
                    </span>
                  </label>
                  <p className="text-xs text-[var(--color-text-soft)]">
                    Ask your supervisor before signing if anything is unclear.
                  </p>
                  <Input
                    disabled={!ackControlsEnabled}
                    label={t("signature.printed_name_label", "Printed name")}
                    onChange={(e) => setAckName(e.target.value)}
                    value={ackName}
                  />
                  <SignaturePad disabled={!ackControlsEnabled || actionBusy} onChange={setSignaturePng} value={signaturePng} />
                  <Button
                    className="min-h-[52px] w-full"
                    disabled={!ackControlsEnabled || actionBusy || !readAck || !ackName.trim() || !signaturePng}
                    type="submit"
                  >
                    Acknowledge RAMS
                  </Button>
                </form>
              )
            ) : (
              <p className="text-sm text-[var(--color-text-soft)]">
                {t("rams.signoff_unavailable", "Sign-off is not required or is not available for this RAMS.")}
              </p>
            )}
            {canAcknowledge ? (
              <form className="space-y-2 border-t border-[var(--color-border)] pt-3" onSubmit={submitDecline}>
                <Input
                  label={t("rams.decline_reason", "Decline reason")}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  value={declineReason}
                />
                <Button className="min-h-[44px] w-full sm:w-auto" disabled={actionBusy || offlineBlock} type="submit" variant="secondary">
                  {t("rams.decline", "Decline")}
                </Button>
              </form>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
