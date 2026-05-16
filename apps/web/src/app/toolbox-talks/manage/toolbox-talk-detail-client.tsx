"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui";
import { listManagedUsers, type AuthUser } from "../../../features/auth";
import { listLocations, type Location } from "../../../features/locations/api";
import {
  addToolboxTalkAttendees,
  archiveToolboxTalk,
  completeToolboxTalk,
  deleteToolboxTalk,
  downloadToolboxTalkPdf,
  getToolboxTalk,
  manualSignToolboxTalkAttendee,
  openToolboxTalkPrint,
  publishToolboxTalk,
  removeToolboxTalkAttendee,
  type ToolboxTalkAttendee,
  type ToolboxTalkDetail,
} from "../../../features/toolbox-talks/api";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function signatureStatus(a: ToolboxTalkAttendee) {
  if (a.signature_method === "app_signature" || a.has_signature) return "Signed in app";
  if (a.signature_method === "manual_paper" || a.status === "signed") return "Manual/paper signed";
  return "Not signed";
}

function talkSections(body: string) {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function ToolboxTalkDetailClient({ talkId }: { talkId: string }) {
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [row, locs, managed] = await Promise.all([getToolboxTalk(talkId), listLocations(), listManagedUsers()]);
      setDetail(row);
      setLocations(locs);
      setUsers(managed);
    } catch (err) {
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
  const employeeUsers = scopedUsers.filter((u) => u.system_role === "employee");
  const locationName = detail?.location_id ? (locations.find((l) => l.id === detail.location_id)?.name ?? "—") : "—";
  const presenter = detail?.presenter_user_id
    ? (scopedUsers.find((u) => u.id === detail.presenter_user_id)?.email ?? "—")
    : "—";

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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">{detail.status}</p>
                  <h1 className="mt-1 text-2xl font-bold text-[var(--color-text)]">{detail.title}</h1>
                  <p className="mt-1 text-sm text-[var(--color-text-soft)]">{detail.topic_display}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link className="inline-flex h-9 items-center rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold" href={`/toolbox-talks/manage/${detail.id}/edit`}>
                    Edit
                  </Link>
                  {detail.status === "draft" ? <Button disabled={busy} onClick={() => void action(() => publishToolboxTalk(detail.id), "Talk published.")} type="button">Publish</Button> : null}
                  {detail.status === "published" ? <Button disabled={busy} onClick={() => void action(() => completeToolboxTalk(detail.id), "Talk completed.")} type="button" variant="secondary">Mark complete</Button> : null}
                  {detail.status !== "archived" && detail.status !== "draft" ? <Button disabled={busy} onClick={() => void action(() => archiveToolboxTalk(detail.id), "Talk archived.")} type="button" variant="secondary">Archive</Button> : null}
                  <Button disabled={busy} onClick={() => void downloadToolboxTalkPdf(detail.id).catch((err) => setError(err instanceof Error ? err.message : "PDF download failed."))} type="button" variant="secondary">Download PDF</Button>
                  <Button disabled={busy} onClick={() => void openToolboxTalkPrint(detail.id).catch((err) => setError(err instanceof Error ? err.message : "Print failed."))} type="button" variant="secondary">Print</Button>
                  {detail.status === "draft" ? (
                    <Button
                      disabled={busy || detail.attendees.some((a) => a.status === "signed")}
                      onClick={() => {
                        if (!window.confirm("Delete this draft talk? This cannot be undone.")) return;
                        void deleteToolboxTalk(detail.id).then(() => window.location.assign("/toolbox-talks/manage")).catch((err) => setError(err instanceof Error ? err.message : "Delete failed."));
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
                <div><dt className="font-semibold">Site</dt><dd>{locationName}</dd></div>
                <div><dt className="font-semibold">Presenter</dt><dd>{presenter}</dd></div>
                <div><dt className="font-semibold">Scheduled</dt><dd>{formatDate(detail.scheduled_date)}</dd></div>
                <div><dt className="font-semibold">Updated</dt><dd>{formatDate(detail.updated_at)}</dd></div>
              </dl>
            </section>

            <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-sm font-bold text-[var(--color-text)]">Talk content</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-[var(--color-text)]">
                {talkSections(detail.talk_body).map((block, idx) => (
                  <p key={`${idx}-${block.slice(0, 20)}`} className="whitespace-pre-wrap rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
                    {block}
                  </p>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-sm font-bold text-[var(--color-text)]">Attendee sign-off register</h2>
              <div className="flex flex-wrap gap-2">
                <select className="h-10 min-w-[14rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setPickUserId(e.target.value)} value={pickUserId}>
                  <option value="">Select employee</option>
                  {employeeUsers.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
                </select>
                <Button disabled={busy || !pickUserId || detail.status === "archived"} onClick={() => void action(() => addToolboxTalkAttendees(detail.id, { user_ids: [pickUserId] }), "Attendee added.").then(() => setPickUserId(""))} size="sm" type="button">Assign employees</Button>
                <Button disabled={busy || !detail.location_id || detail.status === "archived"} onClick={() => void action(() => addToolboxTalkAttendees(detail.id, { user_ids: [], all_site_users: true }), "Site users added.")} size="sm" type="button" variant="secondary">Add all site users</Button>
              </div>
              {manualUserId ? (
                <div className="grid gap-3 rounded border border-[var(--color-border)] bg-[var(--color-header)] p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <label className="text-xs font-semibold text-[var(--color-text)]">
                    Manual/paper printed name
                    <input className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setManualName(e.target.value)} value={manualName} />
                  </label>
                  <label className="text-xs font-semibold text-[var(--color-text)]">
                    Note
                    <input className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setManualNote(e.target.value)} value={manualNote} />
                  </label>
                  <div className="flex gap-2">
                    <Button disabled={busy || !manualName.trim()} onClick={() => void recordManual()} size="sm" type="button">Record manual signature</Button>
                    <Button disabled={busy} onClick={() => setManualUserId("")} size="sm" type="button" variant="secondary">Cancel</Button>
                  </div>
                </div>
              ) : null}
              <div className="overflow-x-auto rounded border border-[var(--color-border)]">
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
                        <TableCell>{signatureStatus(a)}</TableCell>
                        <TableCell className="space-x-2">
                          <span>{a.manual_signature_note ?? a.declined_reason ?? "—"}</span>
                          {a.status !== "signed" && detail.status !== "archived" ? <Button disabled={busy} onClick={() => startManual(a)} size="sm" type="button" variant="secondary">Record manual signature</Button> : null}
                          {a.status === "pending" ? <Button disabled={busy} onClick={() => void action(() => removeToolboxTalkAttendee(detail.id, a.user_id), "Attendee removed.")} size="sm" type="button" variant="secondary">Remove</Button> : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
