"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  Modal,
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { listManagedUsers, type AuthUser } from "@/features/auth";
import { listLocations, type Location } from "@/features/locations/api";
import {
  addRamsAcknowledgements,
  archiveRams,
  bulkAssignRamsAcknowledgements,
  deleteRams,
  downloadRamsAcknowledgementRegisterPdf,
  downloadRamsCsv,
  downloadRamsPdf,
  downloadRamsSignedRecord,
  downloadUploadedRamsPdf,
  getRams,
  manualSignRamsAcknowledgement,
  openRamsPrint,
  patchRams,
  previewBulkRamsAcknowledgements,
  publishRams,
  ramsAttachmentUrl,
  ramsSignatureImageUrl,
  replaceUploadedRamsPdf,
  reviewRams,
  type RamsAcknowledgement,
  type RamsAssessmentDetail,
  type RamsBulkPreview,
  type RamsBulkScope,
} from "@/features/rams/api";
import { UploadedRamsPdfPreview } from "@/features/rams/uploaded-pdf-preview";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function SignatureCell({ a }: { a: RamsAcknowledgement }) {
  const src = ramsSignatureImageUrl(a.signature_image_href);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin PNG
      <img
        alt={`Signature for ${a.display_name || a.user_email || "employee"}`}
        className="h-10 max-w-[9rem] object-contain object-left"
        src={src}
      />
    );
  }
  return <span>{signatureStatus(a)}</span>;
}

function signatureStatus(a: RamsAcknowledgement) {
  if (a.signature_method === "app_signature" || a.has_signature) return "Signed in app";  if (a.signature_method === "manual_paper" || a.status === "acknowledged") return "Manual/paper signed";
  return "Not signed";
}

function renderAdminDocumentBlock(detail: RamsAssessmentDetail, block: NonNullable<RamsAssessmentDetail["document_sections"]>[number]["blocks"][number]) {
  if (block.type === "text" && block.text) return <p className="whitespace-pre-wrap text-sm">{block.text}</p>;
  if (block.type === "list" && block.items?.length) return <ul className="list-disc space-y-1 pl-5 text-sm">{block.items.map((item, idx) => <li key={`${block.id}-${idx}`}>{item}</li>)}</ul>;
  if (block.type === "table" && block.rows?.length) {
    const columns = block.columns?.length ? block.columns : Object.keys(block.rows[0] ?? {});
    return (
      <div className="timiq-scroll-x w-full min-w-0 max-w-full overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-[var(--color-header)]"><tr>{columns.map((col) => <th className="px-3 py-2 font-semibold" key={col}>{col}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, idx) => <tr className="border-t border-[var(--color-border)]" key={`${block.id}-${idx}`}>{columns.map((col) => <td className="px-3 py-2 align-top" key={col}>{String(row[col] ?? "")}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (block.type === "photo") {
    const attachment = (detail.attachments ?? []).find((a) => a.section_key === block.section_key);
    return attachment ? <a className="text-sm font-semibold underline" href={ramsAttachmentUrl(attachment)} rel="noopener noreferrer" target="_blank">{block.caption ?? attachment.original_filename}</a> : <p className="text-xs text-[var(--color-text-soft)]">Photo: {block.caption ?? block.section_key}</p>;
  }
  if (block.type === "hazard_table") return <p className="text-sm text-[var(--color-text-soft)]">Hazard table renders from the controls below.</p>;
  if (block.type === "risk_matrix") return <p className="text-sm text-[var(--color-text-soft)]">Standard 5x5 risk matrix included in PDF/print pack.</p>;
  return null;
}

export function RamsDetailClient({ ramsId }: { ramsId: string }) {
  const [detail, setDetail] = useState<RamsAssessmentDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [manualUserId, setManualUserId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualNote, setManualNote] = useState("Signed on paper");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [siteBusy, setSiteBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState<RamsBulkScope | null>(null);
  const [dialog, setDialog] = useState<{ kind: "bulk"; scope: RamsBulkScope; preview: RamsBulkPreview } | null>(null);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const row = await getRams(ramsId);
      setDetail(row);
      setSiteId(row.location_id ?? "");
      const [locsResult, usersResult] = await Promise.allSettled([
        listLocations(row.company_id),
        listManagedUsers(),
      ]);
      if (locsResult.status === "fulfilled") {
        setLocations(locsResult.value);
      } else {
        setLocations([]);
      }
      if (usersResult.status === "fulfilled") {
        setUsers(usersResult.value);
      }
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : "Could not load RAMS.");
    } finally {
      setLoading(false);
    }
  }, [ramsId]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopedUsers = useMemo(() => users.filter((u) => !detail?.company_id || u.company_id === detail.company_id), [detail?.company_id, users]);
  const employeeUsers = scopedUsers.filter((u) => u.system_role === "employee");
  const companyLocations = useMemo(
    () =>
      locations.filter(
        (l) => l.is_active && (!detail?.company_id || l.company_id === detail.company_id),
      ),
    [detail?.company_id, locations],
  );
  const locationName = detail?.location_id ? (locations.find((l) => l.id === detail.location_id)?.name ?? "—") : "—";
  const isUploaded = detail?.source_type === "uploaded_pdf";
  const canAssign = detail != null && (detail.status === "draft" || detail.status === "published");
  const bulkBusy = bulkPreviewLoading !== null || (dialogSubmitting && dialog?.kind === "bulk");

  async function action(fn: () => Promise<RamsAssessmentDetail>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await fn();
      setDetail(next);
      setSiteId(next.location_id ?? "");
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSite(nextSiteId: string) {
    if (!detail || detail.status !== "draft") return;
    const previous = detail.location_id ?? "";
    setSiteId(nextSiteId);
    setSiteBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await patchRams(detail.id, { location_id: nextSiteId || null });
      setDetail(next);
      setSiteId(next.location_id ?? "");
      setNotice("Site updated.");
    } catch (err) {
      setSiteId(previous);
      setError(err instanceof Error ? err.message : "Could not update site.");
    } finally {
      setSiteBusy(false);
    }
  }

  function startManual(a: RamsAcknowledgement) {
    setManualUserId(a.user_id);
    setManualName(a.acknowledgement_name ?? a.display_name ?? "");
    setManualNote(a.manual_signature_note ?? "Signed on paper");
  }

  async function recordManual() {
    if (!detail || !manualUserId || !manualName.trim()) return;
    await action(
      () =>
        manualSignRamsAcknowledgement(detail.id, manualUserId, {
          acknowledgement_name: manualName.trim(),
          manual_signature_note: manualNote.trim() || "Signed on paper",
        }),
      "Manual signature recorded.",
    );
    setManualUserId("");
    setManualName("");
    setManualNote("Signed on paper");
  }

  async function startBulkPreview(scope: RamsBulkScope) {
    if (!detail || bulkBusy) return;
    if (scope === "site" && !detail.location_id) {
      setError("Select a site for this RAMS before adding site employees.");
      return;
    }
    setBulkPreviewLoading(scope);
    setError("");
    setNotice("");
    setDialogError("");
    try {
      const preview = await previewBulkRamsAcknowledgements(detail.id, scope);
      setDialog({ kind: "bulk", scope, preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview bulk assignment.");
    } finally {
      setBulkPreviewLoading(null);
    }
  }

  async function confirmBulk() {
    if (!detail || dialog?.kind !== "bulk" || dialogSubmitting) return;
    const { scope } = dialog;
    setDialogSubmitting(true);
    setDialogError("");
    try {
      const result = await bulkAssignRamsAcknowledgements(detail.id, scope);
      const next = await getRams(detail.id);
      setDetail(next);
      setSiteId(next.location_id ?? "");
      setNotice(
        `${result.added} employee${result.added === 1 ? "" : "s"} assigned. ${result.skipped_already_assigned} were already assigned.`,
      );
      setDialog(null);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Could not assign employees.");
    } finally {
      setDialogSubmitting(false);
    }
  }

  return (
    <Sheet>
      <PageHeader title="RAMS record" description="View the RAMS document, sign-off progress, assignments, and exports." />
      <SheetBody className="min-w-0 space-y-5">
        <Link className="text-sm text-[var(--color-text-muted)] underline" href="/rams/manage">Back to RAMS</Link>
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        {notice ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div> : null}
        {loading ? <p className="text-sm text-[var(--color-text-soft)]">Loading...</p> : null}
        {detail ? (
          <>
            <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">{detail.status}</p>
                    {isUploaded ? (
                      <span className="inline-flex rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-900">Uploaded RAMS</span>
                    ) : (
                      <span className="inline-flex rounded border border-[var(--color-border)] bg-[var(--color-header)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Template RAMS</span>
                    )}
                  </div>
                  <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-text)]">{detail.title}</h1>
                  <p className="mt-1 text-sm text-[var(--color-text-soft)]">{detail.work_activity}</p>
                </div>
                <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                  {detail.status === "draft" && !isUploaded ? (
                    <Link className="inline-flex h-9 items-center rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold" href={`/rams/manage/${detail.id}/edit`}>Edit</Link>
                  ) : null}
                  {detail.status === "draft" ? <Button disabled={busy} onClick={() => void action(() => publishRams(detail.id), "RAMS published.")} type="button">Publish</Button> : null}
                  {detail.status === "published" ? <Button disabled={busy} onClick={() => void action(() => reviewRams(detail.id), "RAMS marked reviewed.")} type="button" variant="secondary">Mark complete</Button> : null}
                  {detail.status === "published" || detail.status === "reviewed" ? (
                    <Button disabled={busy} onClick={() => void action(() => archiveRams(detail.id), "RAMS archived.")} type="button" variant="secondary">Archive</Button>
                  ) : null}
                  {isUploaded ? (
                    <Button
                      className="w-full min-w-0 sm:w-auto"
                      disabled={busy}
                      onClick={() =>
                        void downloadUploadedRamsPdf(detail.id, detail.uploaded_pdf?.original_filename).catch((err) =>
                          setError(err instanceof Error ? err.message : "Original PDF download failed."),
                        )
                      }
                      type="button"
                      variant="secondary"
                    >
                      Download original RAMS
                    </Button>
                  ) : (
                    <>
                      <Button className="w-full min-w-0 sm:w-auto" disabled={busy} onClick={() => void downloadRamsPdf(detail.id, detail.reference ?? detail.id).catch((err) => setError(err instanceof Error ? err.message : "PDF download failed."))} type="button" variant="secondary">Download original RAMS</Button>
                      <Button className="w-full min-w-0 sm:w-auto" disabled={busy} onClick={() => openRamsPrint(detail.id)} type="button" variant="secondary">Print</Button>
                    </>
                  )}
                  <Button
                    className="w-full min-w-0 sm:w-auto"
                    disabled={busy}
                    onClick={() =>
                      void downloadRamsAcknowledgementRegisterPdf(detail.id, detail.reference ?? detail.id).catch((err) =>
                        setError(err instanceof Error ? err.message : "Acknowledgement register PDF download failed."),
                      )
                    }
                    type="button"
                    variant="secondary"
                  >
                    Download acknowledgement register PDF
                  </Button>
                  <Button
                    className="w-full min-w-0 sm:w-auto"
                    disabled={busy}
                    onClick={() =>
                      void downloadRamsSignedRecord(detail.id, detail.reference ?? detail.id).catch((err) =>
                        setError(err instanceof Error ? err.message : "Signed record download failed."),
                      )
                    }
                    type="button"
                    variant="secondary"
                  >
                    Download complete signed record
                  </Button>
                  <Button
                    className="w-full min-w-0 sm:w-auto"
                    disabled={busy}
                    onClick={() =>
                      void downloadRamsCsv(detail.id).catch((err) =>
                        setError(err instanceof Error ? err.message : "CSV export failed."),
                      )
                    }
                    type="button"
                    variant="secondary"
                  >
                    Export register CSV
                  </Button>
                  {detail.status === "draft" ? (
                    <Button
                      disabled={busy || detail.acknowledgements.some((a) => a.status !== "pending")}
                      onClick={() => {
                        if (!window.confirm("Delete this draft RAMS? This cannot be undone.")) return;
                        void deleteRams(detail.id).then(() => window.location.assign("/rams/manage")).catch((err) => setError(err instanceof Error ? err.message : "Delete failed."));
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Delete draft
                    </Button>
                  ) : null}
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
                <div><dt className="font-semibold">Reference</dt><dd>{detail.reference ?? "—"}</dd></div>
                <div className="min-w-0 md:col-span-2">
                  <dt className="font-semibold">Site</dt>
                  {detail.status === "draft" ? (
                    <dd className="mt-1">
                      <select
                        className="block h-10 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                        disabled={busy || siteBusy}
                        onChange={(e) => void saveSite(e.target.value)}
                        value={siteId}
                      >
                        <option value="">No site selected</option>
                        {companyLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </dd>
                  ) : (
                    <dd>{locationName}</dd>
                  )}
                </div>
                <div><dt className="font-semibold">Risk</dt><dd className="capitalize">{detail.risk_level}</dd></div>
                <div><dt className="font-semibold">Review date</dt><dd>{formatDate(detail.review_due_date)}</dd></div>
                <div><dt className="font-semibold">Project</dt><dd>{detail.project_name ?? "—"}</dd></div>
                <div><dt className="font-semibold">Responsible person</dt><dd>{detail.site_manager ?? detail.produced_by_name ?? "—"}</dd></div>
                <div><dt className="font-semibold">Prepared by</dt><dd>{detail.produced_by_name ?? "—"}</dd></div>
                <div><dt className="font-semibold">Competent review</dt><dd>{detail.checked_by_name ?? detail.approved_by_name ?? "—"}</dd></div>
              </dl>
              {isUploaded && detail.uploaded_pdf ? (
                <div className="mt-4 space-y-2 rounded border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-950">
                  <p className="font-semibold">Uploaded document</p>
                  <p className="break-all">File: {detail.uploaded_pdf.original_filename}</p>
                  <p>Size: {Math.round(detail.uploaded_pdf.file_size_bytes / 1024)} KB · Version {detail.uploaded_pdf.version} · Uploaded {formatDate(detail.uploaded_pdf.uploaded_at)}</p>
                  {detail.status === "draft" ? (
                    <label className="block text-xs font-semibold">
                      Replace PDF (draft only)
                      <input
                        accept="application/pdf,.pdf"
                        className="mt-1 block w-full text-sm"
                        disabled={replaceBusy || busy}
                        onChange={(e) => {
                          const next = e.target.files?.[0];
                          if (!next) return;
                          setReplaceBusy(true);
                          setError("");
                          void replaceUploadedRamsPdf(detail.id, next)
                            .then((row) => {
                              setDetail(row);
                              setSiteId(row.location_id ?? "");
                              setNotice("PDF replaced.");
                            })
                            .catch((err) => setError(err instanceof Error ? err.message : "Could not replace PDF."))
                            .finally(() => setReplaceBusy(false));
                        }}
                        type="file"
                      />
                    </label>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  Professional template based on UK construction safety practice. A competent person must review and adapt it to the actual site and task.
                </p>
              )}
            </section>

            {isUploaded ? (
              <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <h2 className="text-sm font-bold">Uploaded RAMS PDF</h2>
                <UploadedRamsPdfPreview
                  assessmentId={detail.id}
                  fileSizeBytes={detail.uploaded_pdf?.file_size_bytes}
                  filenameHint={detail.uploaded_pdf?.original_filename}
                  forceEmbed
                  reloadKey={`${detail.uploaded_pdf?.version ?? 1}-${detail.uploaded_pdf?.checksum_sha256 ?? ""}`}
                />
              </section>
            ) : (
              <>
                <section className="space-y-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <h2 className="text-sm font-bold">RAMS document preview</h2>
                  {(detail.document_sections ?? []).filter((section) => section.visible_in_pdf).map((section) => (
                    <article className="rounded border border-[var(--color-border)] bg-white p-4" key={section.id}>
                      <h3 className="border-b border-[var(--color-border)] pb-2 font-semibold">{section.title}</h3>
                      {section.not_applicable ? <p className="mt-2 text-sm text-[var(--color-text-soft)]">Not applicable.</p> : null}
                      <div className="mt-3 space-y-3">{section.blocks.map((block) => <div key={block.id}>{renderAdminDocumentBlock(detail, block)}</div>)}</div>
                    </article>
                  ))}
                </section>

                <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <h2 className="text-sm font-bold">Hazards and controls</h2>
                  <div className="timiq-scroll-x w-full min-w-0 max-w-full overflow-x-auto rounded border border-[var(--color-border)]">
                    <Table><TableHeader><TableRow><TableHead>Hazard</TableHead><TableHead>Who may be harmed</TableHead><TableHead>Before</TableHead><TableHead>Controls</TableHead><TableHead>After</TableHead></TableRow></TableHeader>
                      <TableBody>{detail.hazards.map((h) => <TableRow key={h.id}><TableCell>{h.hazard}</TableCell><TableCell>{h.who_might_be_harmed ?? "—"}</TableCell><TableCell>{h.initial_risk_score} ({h.initial_risk_band})</TableCell><TableCell>{h.control_measures}</TableCell><TableCell>{h.residual_risk_score} ({h.residual_risk_band})</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </div>
                </section>

                {(detail.attachments ?? []).length ? (
                  <section className="space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h2 className="text-sm font-bold">Attachments</h2>
                    {(detail.attachments ?? []).map((a) => <a className="block text-sm font-semibold underline" href={ramsAttachmentUrl(a)} key={a.id} rel="noopener noreferrer" target="_blank">{a.original_filename} <span className="font-normal text-[var(--color-text-soft)]">({a.section_key})</span></a>)}
                  </section>
                ) : null}
              </>
            )}

            <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-sm font-bold">Employee sign-off register</h2>
              {detail.signoff_progress ? <p className="text-sm text-[var(--color-text-soft)]">Total {detail.signoff_progress.total_assigned} · Pending {detail.signoff_progress.pending} · Signed {detail.signoff_progress.acknowledged} · Declined {detail.signoff_progress.declined}</p> : null}
              {canAssign ? (
                <div className="flex w-full min-w-0 flex-col gap-2">
                  <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <select
                      className="h-10 w-full min-w-0 flex-1 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm sm:min-w-[12rem]"
                      onChange={(e) => setPickUserId(e.target.value)}
                      value={pickUserId}
                    >
                      <option value="">Select employee</option>
                      {employeeUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.email}
                        </option>
                      ))}
                    </select>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={busy || bulkBusy || !pickUserId}
                      onClick={() =>
                        void action(() => addRamsAcknowledgements(detail.id, { user_ids: [pickUserId] }), "Employee assigned.").then(() =>
                          setPickUserId(""),
                        )
                      }
                      size="sm"
                      type="button"
                    >
                      Assign employees
                    </Button>
                  </div>
                  <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button
                      className="w-full sm:w-auto"
                      disabled={busy || bulkBusy}
                      onClick={() => void startBulkPreview("company")}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {bulkPreviewLoading === "company" ? "Loading…" : "Add all active employees"}
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={busy || bulkBusy || !detail.location_id}
                      onClick={() => void startBulkPreview("site")}
                      size="sm"
                      title={!detail.location_id ? "Select a site for this RAMS before adding site employees." : undefined}
                      type="button"
                      variant="secondary"
                    >
                      {bulkPreviewLoading === "site" ? "Loading…" : "Add all site employees"}
                    </Button>
                  </div>
                  {!detail.location_id ? (
                    <p className="text-xs text-[var(--color-text-soft)]">
                      Select a site for this RAMS before adding site employees.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-soft)]">
                  Employee assignment is closed for {detail.status} RAMS.
                </p>
              )}
              {manualUserId ? (
                <div className="grid gap-3 rounded border border-[var(--color-border)] bg-[var(--color-header)] p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <label className="text-xs font-semibold text-[var(--color-text)]">Manual/paper printed name
                    <input className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setManualName(e.target.value)} value={manualName} />
                  </label>
                  <label className="text-xs font-semibold text-[var(--color-text)]">Note
                    <input className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setManualNote(e.target.value)} value={manualNote} />
                  </label>
                  <div className="flex gap-2">
                    <Button disabled={busy || !manualName.trim()} onClick={() => void recordManual()} size="sm" type="button">Record manual signature</Button>
                    <Button disabled={busy} onClick={() => setManualUserId("")} size="sm" type="button" variant="secondary">Cancel</Button>
                  </div>
                </div>
              ) : null}
              <div className="timiq-scroll-x w-full min-w-0 max-w-full overflow-x-auto rounded border border-[var(--color-border)]">
                <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Status</TableHead><TableHead>Signed at</TableHead><TableHead>Printed name</TableHead><TableHead>Signature</TableHead><TableHead>Notes/actions</TableHead></TableRow></TableHeader>
                  <TableBody>{detail.acknowledgements.map((a) => <TableRow key={a.user_id}><TableCell>{a.display_name || a.user_email || a.user_id}</TableCell><TableCell className="capitalize">{a.status}</TableCell><TableCell>{formatDate(a.acknowledged_at)}</TableCell><TableCell>{a.acknowledgement_name ?? "—"}</TableCell><TableCell><SignatureCell a={a} /></TableCell><TableCell className="space-x-2"><span>{a.manual_signature_note ?? a.declined_reason ?? "—"}</span>{a.status !== "acknowledged" && detail.status !== "archived" ? <Button disabled={busy} onClick={() => startManual(a)} size="sm" type="button" variant="secondary">Record manual signature</Button> : null}</TableCell></TableRow>)}</TableBody>
                </Table>
              </div>
            </section>

            {dialog?.kind === "bulk" ? (
              <Modal
                closeEnabled={!dialogSubmitting}
                footer={
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button disabled={dialogSubmitting} onClick={() => setDialog(null)} type="button" variant="secondary">
                      Cancel
                    </Button>
                    <Button
                      disabled={dialogSubmitting || dialog.preview.will_add === 0}
                      onClick={() => void confirmBulk()}
                      type="button"
                    >
                      {dialogSubmitting ? "Assigning…" : "Assign employees"}
                    </Button>
                  </div>
                }
                labelledById="rams-bulk-title"
                onClose={() => {
                  if (!dialogSubmitting) setDialog(null);
                }}
                title={dialog.scope === "company" ? "Add all active employees" : "Add all site employees"}
                widthClassName="max-w-[calc(100vw-24px)] sm:max-w-[min(28rem,calc(100vw-3rem))]"
              >
                <p className="text-sm text-[var(--color-text)]">
                  Assign {dialog.preview.will_add} active{" "}
                  {dialog.scope === "site" ? "site " : ""}
                  employee{dialog.preview.will_add === 1 ? "" : "s"}? {dialog.preview.already_assigned} are already
                  assigned. {dialog.preview.will_add} will be added.
                </p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-soft)]">
                  <dt>Scope</dt>
                  <dd>{dialog.scope === "company" ? "All active company employees" : "Active employees with site access"}</dd>
                  <dt>Eligible</dt>
                  <dd>{dialog.preview.total_eligible}</dd>
                  <dt>Already assigned</dt>
                  <dd>{dialog.preview.already_assigned}</dd>
                  <dt>Will add</dt>
                  <dd>{dialog.preview.will_add}</dd>
                </dl>
                {dialogError ? <p className="mt-3 text-sm text-red-800">{dialogError}</p> : null}
              </Modal>
            ) : null}
          </>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
