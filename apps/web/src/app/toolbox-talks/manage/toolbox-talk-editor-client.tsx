"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, PageHeader, Sheet, SheetBody, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui";
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../../features/auth";
import { listCompanies, type Company } from "../../../features/companies/api";
import { listLocations, type Location } from "../../../features/locations/api";
import {
  addToolboxTalkAttendees,
  archiveToolboxTalk,
  completeToolboxTalk,
  createToolboxTalk,
  deleteToolboxTalk,
  downloadToolboxTalkPdf,
  getToolboxTalk,
  listToolboxTemplates,
  listToolboxTopics,
  manualSignToolboxTalkAttendee,
  openToolboxTalkPrint,
  patchToolboxTalk,
  publishToolboxTalk,
  removeToolboxTalkAttendee,
  type ToolboxTalkAttendee,
  type ToolboxTalkDetail,
  type ToolboxTopicOption,
  type ToolboxTopicTemplate,
} from "../../../features/toolbox-talks/api";
import { useT } from "../../../lib/i18n";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function signatureMethodLabel(method: string | null | undefined) {
  if (method === "app_signature") return "Signed in app";
  if (method === "manual_paper") return "Manual/paper signed";
  return "Not signed";
}

function templateBody(tpl: ToolboxTopicTemplate) {
  const blocks = [
    ["Purpose", tpl.default_body],
    ["Key hazards", tpl.key_points.join("\n")],
    ["Control measures", tpl.do_list.join("\n")],
    ["Do", tpl.do_list.join("\n")],
    ["Do not", tpl.dont_list.join("\n")],
    ["PPE reminders", (tpl.ppe_reminders.length ? tpl.ppe_reminders : tpl.required_ppe).join("\n")],
    ["Discussion questions", "What hazards are most likely on today's task?\nWhat should you do if conditions change?\nWho do you report concerns to?"],
    ["Sign-off declaration", "I confirm I have attended/read this toolbox talk and understand the controls discussed."],
    ["Additional notes", ""],
  ];
  return blocks.map(([title, body]) => `${title}\n${body || "—"}`).join("\n\n");
}

type Props = { talkId?: string };

export function ToolboxTalkEditorClient({ talkId }: Props) {
  const t = useT();
  const router = useRouter();
  const currentUser = useCurrentUser();
  const editing = Boolean(talkId);

  const [detail, setDetail] = useState<ToolboxTalkDetail | null>(null);
  const [topics, setTopics] = useState<ToolboxTopicOption[]>([]);
  const [templates, setTemplates] = useState<ToolboxTopicTemplate[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(talkId));

  const [companyId, setCompanyId] = useState("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("manual_handling");
  const [topicCustom, setTopicCustom] = useState("");
  const [topicCategory, setTopicCategory] = useState("");
  const [locationId, setLocationId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [presenterId, setPresenterId] = useState("");
  const [talkBody, setTalkBody] = useState("");
  const [pickUserId, setPickUserId] = useState("");
  const [manualUserId, setManualUserId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualNote, setManualNote] = useState("Signed on paper");

  const loadStatic = useCallback(async () => {
    const [tops, tpls, locs, people] = await Promise.all([listToolboxTopics(), listToolboxTemplates(), listLocations(), listManagedUsers()]);
    setTopics(tops);
    setTemplates(tpls);
    setLocations(locs);
    setUsers(people);
    if (isAdministrator(currentUser)) {
      const comps = await listCompanies();
      setCompanies(comps);
      const first = comps.find((c) => c.is_active) ?? comps[0];
      if (first) setCompanyId((prev) => prev || first.id);
    } else if (currentUser.company_id) {
      setCompanyId(currentUser.company_id);
    }
  }, [currentUser]);

  const loadDetail = useCallback(async () => {
    if (!talkId) return;
    setLoading(true);
    setError("");
    try {
      const row = await getToolboxTalk(talkId);
      setDetail(row);
      setCompanyId(row.company_id);
      setTitle(row.title);
      setTopic(row.topic);
      setTopicCustom(row.topic_custom ?? "");
      setTopicCategory(row.topic_category ?? "");
      setLocationId(row.location_id ?? "");
      setScheduledDate(row.scheduled_date ?? "");
      setPresenterId(row.presenter_user_id ?? "");
      setTalkBody(row.talk_body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("toolbox_talks.error_load", "Could not load talks."));
    } finally {
      setLoading(false);
    }
  }, [talkId, t]);

  useEffect(() => {
    void loadStatic().catch((err) => setError(err instanceof Error ? err.message : "Could not load setup data."));
  }, [loadStatic]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const scopedLocations = useMemo(() => locations.filter((l) => !companyId || l.company_id === companyId), [locations, companyId]);
  const scopedUsers = useMemo(() => users.filter((u) => !companyId || u.company_id === companyId), [users, companyId]);
  const employeeUsers = scopedUsers.filter((u) => u.system_role === "employee");

  function applyTemplate(tpl: ToolboxTopicTemplate) {
    setTitle(tpl.default_title);
    setTopic(tpl.topic);
    setTopicCustom("");
    setTopicCategory(tpl.category);
    setTalkBody(templateBody(tpl));
  }

  async function save(ev?: FormEvent) {
    ev?.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (editing && talkId) {
        const next = await patchToolboxTalk(talkId, {
          title: title.trim(),
          topic,
          topic_custom: topic === "custom" ? topicCustom.trim() : null,
          topic_category: topicCategory.trim() || null,
          location_id: locationId || null,
          scheduled_date: scheduledDate || null,
          presenter_user_id: presenterId || null,
          talk_body: talkBody.trim(),
        });
        setDetail(next);
        setNotice("Talk saved.");
      } else {
        const created = await createToolboxTalk({
          company_id: isAdministrator(currentUser) ? companyId : null,
          title: title.trim(),
          topic,
          topic_custom: topic === "custom" ? topicCustom.trim() : null,
          topic_category: topicCategory.trim() || null,
          location_id: locationId || null,
          scheduled_date: scheduledDate || null,
          presenter_user_id: presenterId || null,
          talk_body: talkBody.trim(),
        });
        router.replace(`/toolbox-talks/manage/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("toolbox_talks.error_save", "Could not save talk."));
    } finally {
      setBusy(false);
    }
  }

  async function action(fn: () => Promise<ToolboxTalkDetail>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await fn();
      setDetail(next);
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("toolbox_talks.error_action", "Action failed."));
    } finally {
      setBusy(false);
    }
  }

  async function addOneAttendee() {
    if (!detail || !pickUserId) return;
    await action(() => addToolboxTalkAttendees(detail.id, { user_ids: [pickUserId] }), "Attendee added.");
    setPickUserId("");
  }

  function startManualSign(a: ToolboxTalkAttendee) {
    setManualUserId(a.user_id);
    setManualName(a.signature_name ?? a.display_name ?? "");
    setManualNote(a.manual_signature_note ?? "Signed on paper");
  }

  async function manualSign() {
    if (!detail) return;
    if (!manualUserId || !manualName.trim()) return;
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

  const draftEditable = !editing || detail?.status === "draft";

  return (
    <Sheet>
      <PageHeader
        description="Build, assign, sign, and export professional toolbox talk records."
        title={editing ? "Edit toolbox talk" : "Create toolbox talk"}
      />
      <SheetBody className="min-w-0 space-y-5">
        <Link className="text-sm text-[var(--color-text-muted)] underline" href={detail ? `/toolbox-talks/manage/${detail.id}` : "/toolbox-talks/manage"}>
          {detail ? "Back to talk record" : "Back to toolbox talks"}
        </Link>
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        {notice ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div> : null}
        {loading ? <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading", "Loading…")}</p> : null}

        <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h2 className="text-sm font-bold text-[var(--color-text)]">Professional topics</h2>
          <p className="mt-1 text-sm text-[var(--color-text-soft)]">Choose a ready-made topic, then edit the content before publishing.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((tpl) => (
              <button
                className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-left transition hover:border-[var(--color-border-dark)]"
                disabled={!draftEditable || busy}
                key={tpl.topic}
                onClick={() => applyTemplate(tpl)}
                type="button"
              >
                <p className="font-semibold text-[var(--color-text)]">{tpl.default_title.replace("Toolbox talk: ", "")}</p>
                <p className="mt-1 text-xs text-[var(--color-text-soft)]">{tpl.category} · 10-15 minutes</p>
                <p className="mt-2 line-clamp-3 text-xs text-[var(--color-text-muted)]">{tpl.default_body}</p>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                  Includes key hazards, controls, questions, and attendee sign-off
                </p>
              </button>
            ))}
          </div>
        </section>

        <form className="grid gap-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4" onSubmit={save}>
          {isAdministrator(currentUser) && !editing ? (
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Company
              <select className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setCompanyId(e.target.value)} required value={companyId}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-xs font-semibold text-[var(--color-text)]">
            Title
            <Input className="mt-1" disabled={!draftEditable} onChange={(e) => setTitle(e.target.value)} required value={title} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Topic/category
              <select className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" disabled={!draftEditable} onChange={(e) => setTopic(e.target.value)} value={topic}>
                {topics.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Site
              <select className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" disabled={!draftEditable} onChange={(e) => setLocationId(e.target.value)} value={locationId}>
                <option value="">No specific site</option>
                {scopedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Scheduled date
              <Input className="mt-1" disabled={!draftEditable} onChange={(e) => setScheduledDate(e.target.value)} type="date" value={scheduledDate} />
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Presenter
              <select className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" disabled={!draftEditable} onChange={(e) => setPresenterId(e.target.value)} value={presenterId}>
                <option value="">None</option>
                {scopedUsers.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            </label>
          </div>
          {topic === "custom" ? (
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Custom topic
              <Input className="mt-1" disabled={!draftEditable} onChange={(e) => setTopicCustom(e.target.value)} value={topicCustom} />
            </label>
          ) : null}
          <label className="text-xs font-semibold text-[var(--color-text)]">
            Talk content
            <textarea className="mt-1 min-h-[420px] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" disabled={!draftEditable} onChange={(e) => setTalkBody(e.target.value)} required value={talkBody} />
          </label>
          <div className="flex flex-wrap gap-2">
            {draftEditable ? <Button disabled={busy || !title.trim() || !talkBody.trim()} type="submit">Save draft</Button> : null}
            {detail?.status === "draft" ? <Button disabled={busy} onClick={() => void action(() => publishToolboxTalk(detail.id), "Talk published.")} type="button" variant="secondary">Publish</Button> : null}
            {detail?.status === "published" ? <Button disabled={busy} onClick={() => void action(() => completeToolboxTalk(detail.id), "Talk completed.")} type="button" variant="secondary">Mark complete</Button> : null}
            {detail ? <Button disabled={busy} onClick={() => void action(() => archiveToolboxTalk(detail.id), "Talk archived.")} type="button" variant="secondary">Archive</Button> : null}
            {detail ? <Button disabled={busy} onClick={() => void downloadToolboxTalkPdf(detail.id).catch((err) => setError(err instanceof Error ? err.message : "PDF download failed."))} type="button" variant="secondary">Download PDF</Button> : null}
            {detail ? <Button disabled={busy} onClick={() => void openToolboxTalkPrint(detail.id).catch((err) => setError(err instanceof Error ? err.message : "Print failed."))} type="button" variant="secondary">Print</Button> : null}
            {detail?.status === "draft" ? (
              <Button
                disabled={busy || detail.attendees.some((a) => a.status === "signed")}
                onClick={() => {
                  if (!window.confirm("Delete this draft talk? This cannot be undone.")) return;
                  void deleteToolboxTalk(detail.id).then(() => router.replace("/toolbox-talks/manage")).catch((err) => setError(err instanceof Error ? err.message : "Delete failed."));
                }}
                type="button"
                variant="secondary"
              >
                Delete
              </Button>
            ) : null}
          </div>
        </form>

        {detail ? (
          <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="text-sm font-bold text-[var(--color-text)]">Attendees</h2>
            <div className="flex flex-wrap gap-2">
              <select className="h-10 min-w-[14rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setPickUserId(e.target.value)} value={pickUserId}>
                <option value="">Select employee</option>
                {employeeUsers.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
              <Button disabled={busy || !pickUserId || detail.status === "archived"} onClick={() => void addOneAttendee()} size="sm" type="button">Add employee</Button>
              <Button disabled={busy || !detail.location_id || detail.status === "archived"} onClick={() => void action(() => addToolboxTalkAttendees(detail.id, { user_ids: [], all_site_users: true }), "Site users added.")} size="sm" type="button" variant="secondary">Add all site users</Button>
            </div>
            {manualUserId ? (
              <div className="grid gap-3 rounded border border-[var(--color-border)] bg-[var(--color-header)] p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <label className="text-xs font-semibold text-[var(--color-text)]">
                  Manual/paper printed name
                  <Input className="mt-1" onChange={(e) => setManualName(e.target.value)} value={manualName} />
                </label>
                <label className="text-xs font-semibold text-[var(--color-text)]">
                  Note
                  <Input className="mt-1" onChange={(e) => setManualNote(e.target.value)} value={manualNote} />
                </label>
                <div className="flex gap-2">
                  <Button disabled={busy || !manualName.trim()} onClick={() => void manualSign()} size="sm" type="button">
                    Record manual signature
                  </Button>
                  <Button disabled={busy} onClick={() => setManualUserId("")} size="sm" type="button" variant="secondary">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded border border-[var(--color-border)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Signature method</TableHead>
                    <TableHead>Signed at</TableHead>
                    <TableHead>Printed name</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.attendees.map((a) => (
                    <TableRow key={a.user_id}>
                      <TableCell>{a.display_name || a.user_email || a.user_id}</TableCell>
                      <TableCell className="capitalize">{a.status}</TableCell>
                      <TableCell>{signatureMethodLabel(a.signature_method)}</TableCell>
                      <TableCell>{formatDate(a.signed_at)}</TableCell>
                      <TableCell>{a.signature_name ?? "—"}</TableCell>
                      <TableCell>{a.manual_signature_note ?? a.declined_reason ?? "—"}</TableCell>
                      <TableCell className="space-x-2 text-right">
                        {a.status !== "signed" && detail.status !== "archived" ? <Button disabled={busy} onClick={() => startManualSign(a)} size="sm" type="button" variant="secondary">Manual sign</Button> : null}
                        {a.status === "pending" ? <Button disabled={busy} onClick={() => void action(() => removeToolboxTalkAttendee(detail.id, a.user_id), "Attendee removed.")} size="sm" type="button" variant="secondary">Remove</Button> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
