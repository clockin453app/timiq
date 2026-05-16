"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui";
import { listManagedUsers, type AuthUser } from "../../../features/auth";
import { listLocations, type Location } from "../../../features/locations/api";
import {
  addRamsAcknowledgements,
  archiveRams,
  deleteRams,
  downloadRamsPdf,
  getRams,
  manualSignRamsAcknowledgement,
  openRamsPrint,
  publishRams,
  ramsAttachmentUrl,
  reviewRams,
  type RamsAcknowledgement,
  type RamsAssessmentDetail,
} from "../../../features/rams/api";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function signatureStatus(a: RamsAcknowledgement) {
  if (a.signature_method === "app_signature" || a.has_signature) return "Signed in app";
  if (a.signature_method === "manual_paper" || a.status === "acknowledged") return "Manual/paper signed";
  return "Not signed";
}

function renderAdminDocumentBlock(detail: RamsAssessmentDetail, block: NonNullable<RamsAssessmentDetail["document_sections"]>[number]["blocks"][number]) {
  if (block.type === "text" && block.text) return <p className="whitespace-pre-wrap text-sm">{block.text}</p>;
  if (block.type === "list" && block.items?.length) return <ul className="list-disc space-y-1 pl-5 text-sm">{block.items.map((item, idx) => <li key={`${block.id}-${idx}`}>{item}</li>)}</ul>;
  if (block.type === "table" && block.rows?.length) {
    const columns = block.columns?.length ? block.columns : Object.keys(block.rows[0] ?? {});
    return (
      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
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
  const [manualUserId, setManualUserId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualNote, setManualNote] = useState("Signed on paper");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [row, locs, managed] = await Promise.all([getRams(ramsId), listLocations(), listManagedUsers()]);
      setDetail(row);
      setLocations(locs);
      setUsers(managed);
    } catch (err) {
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
  const locationName = detail?.location_id ? (locations.find((l) => l.id === detail.location_id)?.name ?? "—") : "—";

  async function action(fn: () => Promise<RamsAssessmentDetail>, message: string) {
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
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">{detail.status}</p>
                  <h1 className="mt-1 text-2xl font-bold text-[var(--color-text)]">{detail.title}</h1>
                  <p className="mt-1 text-sm text-[var(--color-text-soft)]">{detail.work_activity}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link className="inline-flex h-9 items-center rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold" href={`/rams/manage/${detail.id}/edit`}>Edit</Link>
                  {detail.status === "draft" ? <Button disabled={busy} onClick={() => void action(() => publishRams(detail.id), "RAMS published.")} type="button">Publish</Button> : null}
                  {detail.status === "published" ? <Button disabled={busy} onClick={() => void action(() => reviewRams(detail.id), "RAMS marked reviewed.")} type="button" variant="secondary">Mark complete</Button> : null}
                  {detail.status !== "draft" && detail.status !== "archived" ? <Button disabled={busy} onClick={() => void action(() => archiveRams(detail.id), "RAMS archived.")} type="button" variant="secondary">Archive</Button> : null}
                  <Button disabled={busy} onClick={() => void downloadRamsPdf(detail.id, detail.reference ?? detail.id).catch((err) => setError(err instanceof Error ? err.message : "PDF download failed."))} type="button" variant="secondary">Download PDF</Button>
                  <Button disabled={busy} onClick={() => openRamsPrint(detail.id)} type="button" variant="secondary">Print</Button>
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
                <div><dt className="font-semibold">Site</dt><dd>{locationName}</dd></div>
                <div><dt className="font-semibold">Risk</dt><dd className="capitalize">{detail.risk_level}</dd></div>
                <div><dt className="font-semibold">Review date</dt><dd>{formatDate(detail.review_due_date)}</dd></div>
                <div><dt className="font-semibold">Project</dt><dd>{detail.project_name ?? "—"}</dd></div>
                <div><dt className="font-semibold">Responsible person</dt><dd>{detail.site_manager ?? detail.produced_by_name ?? "—"}</dd></div>
                <div><dt className="font-semibold">Prepared by</dt><dd>{detail.produced_by_name ?? "—"}</dd></div>
                <div><dt className="font-semibold">Competent review</dt><dd>{detail.checked_by_name ?? detail.approved_by_name ?? "—"}</dd></div>
              </dl>
              <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Professional template based on UK construction safety practice. A competent person must review and adapt it to the actual site and task.
              </p>
            </section>

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
              <div className="overflow-x-auto rounded border border-[var(--color-border)]">
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

            <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-sm font-bold">Employee sign-off register</h2>
              {detail.signoff_progress ? <p className="text-sm text-[var(--color-text-soft)]">Total {detail.signoff_progress.total_assigned} · Pending {detail.signoff_progress.pending} · Signed {detail.signoff_progress.acknowledged} · Declined {detail.signoff_progress.declined}</p> : null}
              <div className="flex flex-wrap gap-2">
                <select className="h-10 min-w-[14rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setPickUserId(e.target.value)} value={pickUserId}>
                  <option value="">Select employee</option>
                  {employeeUsers.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
                </select>
                <Button disabled={busy || !pickUserId || detail.status === "archived"} onClick={() => void action(() => addRamsAcknowledgements(detail.id, { user_ids: [pickUserId] }), "Employee assigned.").then(() => setPickUserId(""))} size="sm" type="button">Assign employees</Button>
                <Button disabled={busy || !detail.location_id || detail.status === "archived"} onClick={() => void action(() => addRamsAcknowledgements(detail.id, { user_ids: [], all_site_users: true }), "Site users assigned.")} size="sm" type="button" variant="secondary">Add all site users</Button>
              </div>
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
              <div className="overflow-x-auto rounded border border-[var(--color-border)]">
                <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Status</TableHead><TableHead>Signed at</TableHead><TableHead>Printed name</TableHead><TableHead>Signature</TableHead><TableHead>Notes/actions</TableHead></TableRow></TableHeader>
                  <TableBody>{detail.acknowledgements.map((a) => <TableRow key={a.user_id}><TableCell>{a.display_name || a.user_email || a.user_id}</TableCell><TableCell className="capitalize">{a.status}</TableCell><TableCell>{formatDate(a.acknowledged_at)}</TableCell><TableCell>{a.acknowledgement_name ?? "—"}</TableCell><TableCell>{signatureStatus(a)}</TableCell><TableCell className="space-x-2"><span>{a.manual_signature_note ?? a.declined_reason ?? "—"}</span>{a.status !== "acknowledged" && detail.status !== "archived" ? <Button disabled={busy} onClick={() => startManual(a)} size="sm" type="button" variant="secondary">Record manual signature</Button> : null}</TableCell></TableRow>)}</TableBody>
                </Table>
              </div>
            </section>
          </>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
