"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  addToolboxTalkAttendees,
  archiveToolboxTalk,
  bulkAssignToolboxTalkAttendees,
  completeToolboxTalk,
  deleteToolboxTalk,
  downloadToolboxTalkPdf,
  getToolboxTalk,
  manualSignToolboxTalkAttendee,
  openToolboxTalkPrint,
  previewBulkToolboxTalkAttendees,
  publishToolboxTalk,
  removeToolboxTalkAttendee,
  toolboxTalkSignatureImageUrl,
  voidToolboxTalk,
  type ToolboxTalkAttendee,
  type ToolboxTalkBulkPreview,
  type ToolboxTalkBulkScope,
  type ToolboxTalkDetail,
} from "@/features/toolbox-talks/api";
import { ToolboxTalkStatusBadge } from "@/features/toolbox-talks/status";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function signatureStatus(a: ToolboxTalkAttendee) {
  if (a.signature_method === "app_signature" || a.has_signature) {
    if (a.signature_image_available === false) return "Signature image unavailable";
    return "Signed in app";
  }
  if (a.signature_method === "manual_paper" || a.status === "signed") return "Manual/paper signed";
  return "Not signed";
}

function SignatureCell({ a }: { a: ToolboxTalkAttendee }) {
  const src = toolboxTalkSignatureImageUrl(a.signature_image_href);
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

function talkSections(body: string) {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

type DialogState =
  | { kind: "delete" }
  | { kind: "void" }
  | { kind: "bulk"; scope: ToolboxTalkBulkScope; preview: ToolboxTalkBulkPreview }
  | { kind: "remove"; userId: string; label: string };

export function ToolboxTalkDetailClient({ talkId }: { talkId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<ToolboxTalkDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [manualUserId, setManualUserId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualNote, setManualNote] = useState("Signed on paper");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState<ToolboxTalkBulkScope | null>(null);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const row = await getToolboxTalk(talkId);
      setDetail(row);
      const [locsResult, usersResult] = await Promise.allSettled([
        listLocations(row.company_id),
        listManagedUsers(),
      ]);
      if (locsResult.status === "fulfilled") {
        setLocations(locsResult.value);
      } else {
        setLocations([]);
        setError(locsResult.reason instanceof Error ? locsResult.reason.message : "Could not load locations.");
      }
      if (usersResult.status === "fulfilled") {
        setUsers(usersResult.value);
      } else if (locsResult.status === "fulfilled") {
        setError(usersResult.reason instanceof Error ? usersResult.reason.message : "Could not load employees.");
      }
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : "Could not load toolbox talk.");
    } finally {
      setLoading(false);
    }
  }, [talkId]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopedUsers = useMemo(
    () => users.filter((u) => !detail?.company_id || u.company_id === detail.company_id),
    [detail?.company_id, users],
  );
  const assignedIds = useMemo(() => new Set(detail?.attendees.map((a) => a.user_id) ?? []), [detail?.attendees]);
  const employeeUsers = useMemo(
    () =>
      scopedUsers.filter(
        (u) => u.system_role === "employee" && u.is_active && !assignedIds.has(u.id),
      ),
    [assignedIds, scopedUsers],
  );
  const locationName = detail?.location_id ? (locations.find((l) => l.id === detail.location_id)?.name ?? "—") : "—";
  const presenter = detail?.presenter_user_id
    ? (scopedUsers.find((u) => u.id === detail.presenter_user_id)?.email ?? "—")
    : "—";
  const voidedBy = detail?.voided_by_user_id
    ? (scopedUsers.find((u) => u.id === detail.voided_by_user_id)?.email ?? detail.voided_by_user_id)
    : null;

  const canAssign = detail?.status === "draft" || detail?.status === "published";
  const canMutateAttendees = canAssign;
  const canManualSign = detail?.status === "published";
  const bulkBusy = bulkPreviewLoading !== null || (dialogSubmitting && dialog?.kind === "bulk");

  async function action(fn: () => Promise<ToolboxTalkDetail>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await fn();
      setDetail(next);
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  function closeDialog() {
    if (dialogSubmitting) return;
    setDialog(null);
    setDialogError("");
  }

  function openDeleteDialog() {
    setDialogError("");
    setDialog({ kind: "delete" });
  }

  function openVoidDialog() {
    setDialogError("");
    setVoidReason("");
    setDialog({ kind: "void" });
  }

  function openRemoveDialog(a: ToolboxTalkAttendee) {
    setDialogError("");
    setDialog({
      kind: "remove",
      userId: a.user_id,
      label: a.display_name || a.user_email || a.user_id,
    });
  }

  async function startBulkPreview(scope: ToolboxTalkBulkScope) {
    if (!detail || bulkBusy) return;
    if (scope === "site" && !detail.location_id) {
      setError("Assign a site to this Toolbox Talk before adding site employees.");
      return;
    }
    setBulkPreviewLoading(scope);
    setError("");
    setNotice("");
    setDialogError("");
    try {
      const preview = await previewBulkToolboxTalkAttendees(detail.id, scope);
      setDialog({ kind: "bulk", scope, preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview bulk assignment.");
    } finally {
      setBulkPreviewLoading(null);
    }
  }

  async function confirmDelete() {
    if (!detail || dialogSubmitting) return;
    setDialogSubmitting(true);
    setDialogError("");
    try {
      await deleteToolboxTalk(detail.id);
      router.push("/toolbox-talks/manage");
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Delete failed.");
      setDialogSubmitting(false);
    }
  }

  async function confirmVoid() {
    if (!detail || dialogSubmitting) return;
    const reason = voidReason.trim();
    if (!reason) {
      setDialogError("A void reason is required.");
      return;
    }
    setDialogSubmitting(true);
    setDialogError("");
    try {
      const next = await voidToolboxTalk(detail.id, reason);
      setDetail(next);
      setNotice("Toolbox talk voided.");
      setDialog(null);
      setVoidReason("");
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Could not void talk.");
    } finally {
      setDialogSubmitting(false);
    }
  }

  async function confirmBulk() {
    if (!detail || dialog?.kind !== "bulk" || dialogSubmitting) return;
    const { scope } = dialog;
    setDialogSubmitting(true);
    setDialogError("");
    try {
      const result = await bulkAssignToolboxTalkAttendees(detail.id, scope);
      const next = await getToolboxTalk(detail.id);
      setDetail(next);
      setNotice(
        `${result.added} employee${result.added === 1 ? "" : "s"} assigned. ${result.skipped_already_assigned} were already assigned.`,
      );
      setDialog(null);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Could not assign attendees.");
    } finally {
      setDialogSubmitting(false);
    }
  }

  async function confirmRemove() {
    if (!detail || dialog?.kind !== "remove" || dialogSubmitting) return;
    setDialogSubmitting(true);
    setDialogError("");
    try {
      const next = await removeToolboxTalkAttendee(detail.id, dialog.userId);
      setDetail(next);
      setNotice("Attendee removed.");
      setDialog(null);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Could not remove attendee.");
    } finally {
      setDialogSubmitting(false);
    }
  }

  function startManual(a: ToolboxTalkAttendee) {
    setManualUserId(a.user_id);
    setManualName(a.signature_name ?? a.display_name ?? "");
    setManualNote(a.manual_signature_note ?? "Signed on paper");
  }

  async function recordManual() {
    if (!detail || !manualUserId || !manualName.trim()) return;
    await action(
      () =>
        manualSignToolboxTalkAttendee(detail.id, manualUserId, {
          signature_name: manualName.trim(),
          manual_signature_note: manualNote.trim() || "Signed on paper",
        }),
      "Manual signature recorded.",
    );
    setManualUserId("");
    setManualName("");
    setManualNote("Signed on paper");
  }

  async function assignIndividual() {
    if (!detail || !pickUserId || busy) return;
    await action(() => addToolboxTalkAttendees(detail.id, { user_ids: [pickUserId] }), "Attendee added.");
    setPickUserId("");
  }

  const pendingCount = detail?.attendees.filter((a) => a.status === "pending").length ?? 0;

  return (
    <Sheet>
      <PageHeader title="Toolbox talk record" description="View the published record, sign-off progress, and export actions." />
      <SheetBody className="min-w-0 space-y-5">
        <Link className="text-sm text-[var(--color-text-muted)] underline" href="/toolbox-talks/manage">
          Back to toolbox talks
        </Link>
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        {notice ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div> : null}
        {loading ? <p className="text-sm text-[var(--color-text-soft)]">Loading...</p> : null}
        {detail ? (
          <>
            <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <ToolboxTalkStatusBadge status={detail.status} />
                  <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-text)]">{detail.title}</h1>
                  <p className="mt-1 text-sm text-[var(--color-text-soft)]">{detail.topic_display}</p>
                  {detail.status === "voided" ? (
                    <div className="mt-3 space-y-1 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                      <p className="font-semibold">This Toolbox Talk is voided.</p>
                      {detail.void_reason ? <p>Reason: {detail.void_reason}</p> : null}
                      <p>
                        Voided {formatDate(detail.voided_at)}
                        {voidedBy ? ` · by ${voidedBy}` : ""}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                  {detail.status === "draft" ? (
                    <Link
                      className="inline-flex h-9 items-center rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold"
                      href={`/toolbox-talks/manage/${detail.id}/edit`}
                    >
                      Edit
                    </Link>
                  ) : null}
                  {detail.status === "draft" ? (
                    <Button disabled={busy} onClick={() => void action(() => publishToolboxTalk(detail.id), "Talk published.")} type="button">
                      Publish
                    </Button>
                  ) : null}
                  {detail.status === "published" ? (
                    <Button
                      disabled={busy}
                      onClick={() => void action(() => completeToolboxTalk(detail.id), "Talk completed.")}
                      type="button"
                      variant="secondary"
                    >
                      Mark complete
                    </Button>
                  ) : null}
                  {detail.status === "published" ? (
                    <Button disabled={busy || dialogSubmitting} onClick={openVoidDialog} type="button" variant="danger">
                      Void
                    </Button>
                  ) : null}
                  {detail.status === "published" || detail.status === "completed" ? (
                    <Button
                      disabled={busy}
                      onClick={() => void action(() => archiveToolboxTalk(detail.id), "Talk archived.")}
                      type="button"
                      variant="secondary"
                    >
                      Archive
                    </Button>
                  ) : null}
                  {detail.status !== "draft" ? (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void downloadToolboxTalkPdf(detail.id).catch((err) =>
                            setError(err instanceof Error ? err.message : "PDF download failed."),
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        Download PDF
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void openToolboxTalkPrint(detail.id).catch((err) =>
                            setError(err instanceof Error ? err.message : "Print failed."),
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        Print
                      </Button>
                    </>
                  ) : null}
                  {detail.status === "draft" ? (
                    <Button disabled={busy || dialogSubmitting} onClick={openDeleteDialog} type="button" variant="danger">
                      Delete draft
                    </Button>
                  ) : null}
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 md:grid-cols-4">
                <div>
                  <dt className="font-semibold">Site</dt>
                  <dd>{locationName}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Presenter</dt>
                  <dd className="break-all">{presenter}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Scheduled</dt>
                  <dd>{formatDate(detail.scheduled_date)}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Updated</dt>
                  <dd>{formatDate(detail.updated_at)}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-sm font-bold text-[var(--color-text)]">Talk content</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-[var(--color-text)]">
                {talkSections(detail.talk_body).map((block, idx) => (
                  <p
                    key={`${idx}-${block.slice(0, 20)}`}
                    className="whitespace-pre-wrap rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
                  >
                    {block}
                  </p>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-sm font-bold text-[var(--color-text)]">Attendee sign-off register</h2>
              {canMutateAttendees ? (
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
                      disabled={busy || !pickUserId}
                      onClick={() => void assignIndividual()}
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
                      title={!detail.location_id ? "Assign a site to this Toolbox Talk before adding site employees." : undefined}
                      type="button"
                      variant="secondary"
                    >
                      {bulkPreviewLoading === "site" ? "Loading…" : "Add all site employees"}
                    </Button>
                  </div>
                  {!detail.location_id ? (
                    <p className="text-xs text-[var(--color-text-soft)]">
                      Assign a site to this Toolbox Talk before adding site employees.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-soft)]">
                  Attendee assignment is closed for {detail.status} talks.
                </p>
              )}
              {manualUserId && canManualSign ? (
                <div className="grid gap-3 rounded border border-[var(--color-border)] bg-[var(--color-header)] p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <label className="text-xs font-semibold text-[var(--color-text)]">
                    Manual/paper printed name
                    <input
                      className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(e) => setManualName(e.target.value)}
                      value={manualName}
                    />
                  </label>
                  <label className="text-xs font-semibold text-[var(--color-text)]">
                    Note
                    <input
                      className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(e) => setManualNote(e.target.value)}
                      value={manualNote}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy || !manualName.trim()} onClick={() => void recordManual()} size="sm" type="button">
                      Record manual signature
                    </Button>
                    <Button disabled={busy} onClick={() => setManualUserId("")} size="sm" type="button" variant="secondary">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
              {detail.attendees.some((a) => a.signature_evidence_warning) ? (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  <p className="font-semibold">Signature evidence warning</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {detail.attendees
                      .filter((a) => a.signature_evidence_warning)
                      .map((a) => (
                        <li key={a.user_id}>
                          {(a.display_name || a.user_email || "Employee") + ": " + a.signature_evidence_warning}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
              <div className="timiq-scroll-x w-full min-w-0 max-w-full overflow-x-auto rounded border border-[var(--color-border)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Signed at</TableHead>
                      <TableHead>Printed name</TableHead>
                      <TableHead>Signature</TableHead>
                      <TableHead>Notes/actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.attendees.map((a) => (
                      <TableRow key={a.user_id}>
                        <TableCell>{a.display_name || a.user_email || a.user_id}</TableCell>
                        <TableCell className="capitalize">{a.status}</TableCell>
                        <TableCell>{formatDate(a.signed_at)}</TableCell>
                        <TableCell>{a.signature_name ?? "—"}</TableCell>
                        <TableCell><SignatureCell a={a} /></TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{a.manual_signature_note ?? a.declined_reason ?? "—"}</span>
                            {a.status === "pending" && canManualSign ? (
                              <Button disabled={busy} onClick={() => startManual(a)} size="sm" type="button" variant="secondary">
                                Record manual signature
                              </Button>
                            ) : null}
                            {a.status === "pending" && canMutateAttendees ? (
                              <Button
                                disabled={busy || dialogSubmitting}
                                onClick={() => openRemoveDialog(a)}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        ) : null}

        {dialog?.kind === "delete" && detail ? (
          <Modal
            closeEnabled={!dialogSubmitting}
            footer={
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={dialogSubmitting} onClick={closeDialog} type="button" variant="secondary">
                  Cancel
                </Button>
                <Button disabled={dialogSubmitting} onClick={() => void confirmDelete()} type="button" variant="danger">
                  Permanently delete
                </Button>
              </div>
            }
            labelledById="tt-delete-title"
            onClose={closeDialog}
            title="Delete draft Toolbox Talk"
            widthClassName="max-w-[calc(100vw-24px)] sm:max-w-[min(28rem,calc(100vw-3rem))]"
          >
            <p className="text-sm text-[var(--color-text)]">
              Permanently delete &ldquo;{detail.title}&rdquo;? Pending attendee assignments will also be removed. This cannot be
              undone.
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-soft)]">
              Assigned attendees: {detail.attendees.length} ({pendingCount} pending)
            </p>
            {dialogError ? <p className="mt-3 text-sm text-red-800">{dialogError}</p> : null}
          </Modal>
        ) : null}

        {dialog?.kind === "void" && detail ? (
          <Modal
            closeEnabled={!dialogSubmitting}
            footer={
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={dialogSubmitting} onClick={closeDialog} type="button" variant="secondary">
                  Cancel
                </Button>
                <Button
                  disabled={dialogSubmitting || !voidReason.trim()}
                  onClick={() => void confirmVoid()}
                  type="button"
                  variant="danger"
                >
                  Void talk
                </Button>
              </div>
            }
            labelledById="tt-void-title"
            onClose={closeDialog}
            title="Void Toolbox Talk"
            widthClassName="max-w-[calc(100vw-24px)] sm:max-w-[min(28rem,calc(100vw-3rem))]"
          >
            <p className="text-sm text-[var(--color-text)]">
              Void this Toolbox Talk? Existing sign-offs will be preserved, but no further employees will be able to sign.
            </p>
            <label className="mt-3 block text-xs font-semibold text-[var(--color-text)]" htmlFor="tt-void-reason">
              Reason (required)
              <textarea
                className="mt-1 block min-h-[5rem] w-full resize-y border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-2 text-sm"
                disabled={dialogSubmitting}
                id="tt-void-reason"
                maxLength={500}
                onChange={(e) => setVoidReason(e.target.value)}
                value={voidReason}
              />
            </label>
            {dialogError ? <p className="mt-3 text-sm text-red-800">{dialogError}</p> : null}
          </Modal>
        ) : null}

        {dialog?.kind === "bulk" && detail ? (
          <Modal
            closeEnabled={!dialogSubmitting}
            footer={
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={dialogSubmitting} onClick={closeDialog} type="button" variant="secondary">
                  Cancel
                </Button>
                <Button
                  disabled={dialogSubmitting || dialog.preview.will_add === 0}
                  onClick={() => void confirmBulk()}
                  type="button"
                >
                  Assign employees
                </Button>
              </div>
            }
            labelledById="tt-bulk-title"
            onClose={closeDialog}
            title={dialog.scope === "company" ? "Add all active employees" : "Add all site employees"}
            widthClassName="max-w-[calc(100vw-24px)] sm:max-w-[min(28rem,calc(100vw-3rem))]"
          >
            <p className="text-sm text-[var(--color-text)]">
              Assign {dialog.preview.will_add} active employee{dialog.preview.will_add === 1 ? "" : "s"}?{" "}
              {dialog.preview.already_assigned} are already assigned. {dialog.preview.will_add} will be added.
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-soft)]">
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

        {dialog?.kind === "remove" ? (
          <Modal
            closeEnabled={!dialogSubmitting}
            footer={
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={dialogSubmitting} onClick={closeDialog} type="button" variant="secondary">
                  Cancel
                </Button>
                <Button disabled={dialogSubmitting} onClick={() => void confirmRemove()} type="button" variant="danger">
                  Remove attendee
                </Button>
              </div>
            }
            labelledById="tt-remove-title"
            onClose={closeDialog}
            title="Remove pending attendee"
            widthClassName="max-w-[calc(100vw-24px)] sm:max-w-[min(28rem,calc(100vw-3rem))]"
          >
            <p className="text-sm text-[var(--color-text)]">Remove this pending attendee from the Toolbox Talk?</p>
            <p className="mt-2 text-sm text-[var(--color-text-soft)]">{dialog.label}</p>
            {dialogError ? <p className="mt-3 text-sm text-red-800">{dialogError}</p> : null}
          </Modal>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
