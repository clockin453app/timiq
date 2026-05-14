"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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
} from "../../../components/ui";
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../../features/auth";
import { listCompanies, type Company } from "../../../features/companies/api";
import { listLocations, type Location } from "../../../features/locations/api";
import { useT } from "../../../lib/i18n";
import {
  addToolboxTalkAttendees,
  archiveToolboxTalk,
  completeToolboxTalk,
  createToolboxTalk,
  downloadToolboxTalkCsv,
  getToolboxTalk,
  listToolboxTalksAdmin,
  listToolboxTopics,
  openToolboxTalkPrint,
  patchToolboxTalk,
  publishToolboxTalk,
  removeToolboxTalkAttendee,
  type ToolboxTalkAttendee,
  type ToolboxTalkDetail,
  type ToolboxTalkSummary,
  type ToolboxTopicOption,
} from "../../../features/toolbox-talks/api";

function formatDate(iso: string | null | undefined) {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ToolboxTalksManageClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const [talks, setTalks] = useState<ToolboxTalkSummary[]>([]);
  const [topics, setTopics] = useState<ToolboxTopicOption[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ToolboxTalkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [createCompanyId, setCreateCompanyId] = useState("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("ppe");
  const [topicCustom, setTopicCustom] = useState("");
  const [locationId, setLocationId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [talkBody, setTalkBody] = useState("");
  const [presenterId, setPresenterId] = useState("");

  const [pickUserId, setPickUserId] = useState("");

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const companyIdParam = isAdministrator(currentUser) && filterCompanyId ? filterCompanyId : undefined;
      const [tlist, tops, locs, ulist] = await Promise.all([
        listToolboxTalksAdmin({
          companyId: companyIdParam,
          status: filterStatus || undefined,
        }),
        listToolboxTopics(),
        listLocations(),
        listManagedUsers(),
      ]);
      setTalks(tlist);
      setTopics(tops);
      setLocations(locs);
      setUsers(ulist);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_load", "Could not load talks."));
    } finally {
      setLoading(false);
    }
  }, [currentUser, filterCompanyId, filterStatus, t]);

  useEffect(() => {
    if (!isAdministrator(currentUser)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const comps = await listCompanies();
        if (cancelled) {
          return;
        }
        setCompanies(comps);
        if (comps.length > 0) {
          const first = comps.find((c) => c.is_active) ?? comps[0];
          setFilterCompanyId((prev) => prev || first.id);
          setCreateCompanyId((prev) => prev || first.id);
        }
      } catch {
        if (!cancelled) {
          setError(t("toolbox_talks.error_companies", "Could not load companies."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, t]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await getToolboxTalk(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_load", "Could not load talks."));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const companyScopedLocations = useMemo(() => {
    const cid = detail?.company_id ?? (isAdministrator(currentUser) ? createCompanyId : currentUser.company_id);
    if (!cid) {
      return locations;
    }
    return locations.filter((l) => l.company_id === cid);
  }, [locations, detail, currentUser, createCompanyId]);

  const companyEmployees = useMemo(() => {
    const cid = detail?.company_id ?? (isAdministrator(currentUser) ? createCompanyId : currentUser.company_id);
    return users.filter((u) => u.system_role === "employee" && (!cid || u.company_id === cid));
  }, [users, detail, currentUser, createCompanyId]);

  const locationName = (id: string | null) => {
    if (!id) {
      return "—";
    }
    return locations.find((l) => l.id === id)?.name ?? "—";
  };

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        company_id: isAdministrator(currentUser) ? createCompanyId : null,
        title: title.trim(),
        topic,
        topic_custom: topic === "custom" ? topicCustom.trim() : null,
        location_id: locationId || null,
        scheduled_date: scheduledDate || null,
        talk_body: talkBody.trim(),
        presenter_user_id: presenterId || null,
      };
      const created = await createToolboxTalk(body);
      setTitle("");
      setTalkBody("");
      setTopicCustom("");
      setScheduledDate("");
      setLocationId("");
      setPresenterId("");
      setSelectedId(created.id);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_create", "Could not create talk."));
    } finally {
      setBusy(false);
    }
  };

  const onSaveDraft = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!detail || detail.status !== "draft") {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await patchToolboxTalk(detail.id, {
        title: title.trim() || undefined,
        topic,
        topic_custom: topic === "custom" ? topicCustom.trim() : null,
        location_id: locationId || null,
        scheduled_date: scheduledDate || null,
        talk_body: talkBody.trim() || undefined,
        presenter_user_id: presenterId || null,
      });
      setDetail(next);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_save", "Could not save talk."));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (detail && detail.status === "draft") {
      setTitle(detail.title);
      setTopic(detail.topic);
      setTopicCustom(detail.topic_custom ?? "");
      setLocationId(detail.location_id ?? "");
      setScheduledDate(detail.scheduled_date ?? "");
      setTalkBody(detail.talk_body);
      setPresenterId(detail.presenter_user_id ?? "");
    }
  }, [detail]);

  const runAction = async (fn: () => Promise<ToolboxTalkDetail>) => {
    setBusy(true);
    setError("");
    try {
      const next = await fn();
      setDetail(next);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_action", "Action failed."));
    } finally {
      setBusy(false);
    }
  };

  const onAddAttendee = async () => {
    if (!detail || !pickUserId) {
      return;
    }
    await runAction(() => addToolboxTalkAttendees(detail.id, { user_ids: [pickUserId] }));
    setPickUserId("");
  };

  const onAddAllSite = async () => {
    if (!detail) {
      return;
    }
    await runAction(() => addToolboxTalkAttendees(detail.id, { user_ids: [], all_site_users: true }));
  };

  return (
    <Sheet>
      <PageHeader
        description={t(
          "toolbox_talks.manage_intro",
          "Create toolbox talks, assign attendees, publish, and export sign-off records.",
        )}
        title={t("toolbox_talks.manage_title", "Manage toolbox talks")}
      />
      <SheetBody className="min-w-0 space-y-6">
        {error ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 border border-[var(--color-border)] bg-[var(--color-header)] p-3">
          {isAdministrator(currentUser) ? (
            <label className="text-xs font-semibold text-[var(--color-text)]">
              {t("toolbox_talks.filter_company", "Company")}
              <select
                className="mt-1 block h-10 min-w-[12rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setFilterCompanyId(e.target.value)}
                value={filterCompanyId}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-xs font-semibold text-[var(--color-text)]">
            {t("toolbox_talks.filter_status", "Status")}
            <select
              className="mt-1 block h-10 min-w-[10rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              onChange={(e) => setFilterStatus(e.target.value)}
              value={filterStatus}
            >
              <option value="">{t("toolbox_talks.all_statuses", "All")}</option>
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="completed">completed</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <Button
            onClick={() => void loadLists()}
            size="sm"
            type="button"
            variant="secondary"
          >
            {t("common.refresh", "Refresh")}
          </Button>
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-bold text-[var(--color-text)]">{t("toolbox_talks.create_talk", "Create talk")}</h2>
          <form className="grid max-w-3xl gap-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3" onSubmit={onCreate}>
            {isAdministrator(currentUser) ? (
              <label className="text-xs font-semibold text-[var(--color-text)]">
                {t("toolbox_talks.company", "Company")}
                <select
                  className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(e) => setCreateCompanyId(e.target.value)}
                  required
                  value={createCompanyId}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="text-xs font-semibold text-[var(--color-text)]">
              {t("toolbox_talks.col_title", "Title")}
              <Input className="mt-1" onChange={(e) => setTitle(e.target.value)} required value={title} />
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              {t("toolbox_talks.topic", "Topic")}
              <select
                className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setTopic(e.target.value)}
                value={topic}
              >
                {topics.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {topic === "custom" ? (
              <label className="text-xs font-semibold text-[var(--color-text)]">
                {t("toolbox_talks.custom_topic", "Custom topic")}
                <Input className="mt-1" onChange={(e) => setTopicCustom(e.target.value)} required value={topicCustom} />
              </label>
            ) : null}
            <label className="text-xs font-semibold text-[var(--color-text)]">
              {t("toolbox_talks.col_site", "Site / location")}
              <select
                className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setLocationId(e.target.value)}
                value={locationId}
              >
                <option value="">{t("toolbox_talks.no_location", "No specific site")}</option>
                {companyScopedLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              {t("toolbox_talks.scheduled", "Scheduled date")}
              <Input className="mt-1" onChange={(e) => setScheduledDate(e.target.value)} type="date" value={scheduledDate} />
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              {t("toolbox_talks.body", "Talk content")}
              <textarea
                className="mt-1 min-h-[120px] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-2 text-sm"
                onChange={(e) => setTalkBody(e.target.value)}
                required
                value={talkBody}
              />
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              {t("toolbox_talks.presenter", "Presenter (optional)")}
              <select
                className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setPresenterId(e.target.value)}
                value={presenterId}
              >
                <option value="">{t("toolbox_talks.no_presenter", "None")}</option>
                {users
                  .filter((u) => {
                    const cid = isAdministrator(currentUser) ? createCompanyId : currentUser.company_id;
                    return !cid || u.company_id === cid;
                  })
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
              </select>
            </label>
            <Button disabled={busy} type="submit">
              {t("toolbox_talks.create_talk", "Create talk")}
            </Button>
          </form>
        </section>

        {loading ? (
          <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading", "Loading…")}</p>
        ) : (
          <div className="overflow-x-auto rounded border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("toolbox_talks.col_title", "Title")}</TableHead>
                  <TableHead>{t("toolbox_talks.topic", "Topic")}</TableHead>
                  <TableHead>{t("toolbox_talks.col_site", "Site")}</TableHead>
                  <TableHead>{t("toolbox_talks.col_status", "Status")}</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {talks.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell className="text-sm">{row.topic_display}</TableCell>
                    <TableCell className="text-sm text-[var(--color-text-soft)]">{locationName(row.location_id)}</TableCell>
                    <TableCell className="text-sm capitalize">{row.status}</TableCell>
                    <TableCell>
                      <Button
                        onClick={() => setSelectedId(row.id)}
                        size="sm"
                        type="button"
                        variant={selectedId === row.id ? "primary" : "secondary"}
                      >
                        {t("toolbox_talks.open", "Open")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {selectedId ? (
          <section className="space-y-4 border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {t("toolbox_talks.detail_heading", "Talk detail")}
              </h2>
              <Button onClick={() => setSelectedId(null)} size="sm" type="button" variant="secondary">
                {t("toolbox_talks.close_detail", "Close")}
              </Button>
            </div>
            {detailLoading ? (
              <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading", "Loading…")}</p>
            ) : detail ? (
              <>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Button
                    disabled={busy || detail.status !== "draft"}
                    onClick={() => void runAction(() => publishToolboxTalk(detail.id))}
                    size="sm"
                    type="button"
                  >
                    {t("toolbox_talks.publish", "Publish")}
                  </Button>
                  <Button
                    disabled={busy || detail.status !== "published"}
                    onClick={() => void runAction(() => completeToolboxTalk(detail.id))}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {t("toolbox_talks.mark_complete", "Mark complete")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void runAction(() => archiveToolboxTalk(detail.id))}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {t("toolbox_talks.archived_action", "Archive")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void openToolboxTalkPrint(detail.id).catch((e) => setError(e instanceof Error ? e.message : "Print failed"))}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {t("toolbox_talks.print_record", "Print talk record")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void downloadToolboxTalkCsv(detail.id).catch((e) =>
                        setError(e instanceof Error ? e.message : "Export failed"),
                      )
                    }
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {t("toolbox_talks.export_csv", "Export CSV")}
                  </Button>
                </div>

                {detail.status === "draft" ? (
                  <form className="grid max-w-3xl gap-3" onSubmit={onSaveDraft}>
                    <p className="text-xs text-[var(--color-text-soft)]">{t("toolbox_talks.draft_edit_hint", "Edit draft before publishing.")}</p>
                    <label className="text-xs font-semibold">
                      {t("toolbox_talks.col_title", "Title")}
                      <Input className="mt-1" onChange={(e) => setTitle(e.target.value)} value={title} />
                    </label>
                    <label className="text-xs font-semibold">
                      {t("toolbox_talks.topic", "Topic")}
                      <select
                        className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                        onChange={(e) => setTopic(e.target.value)}
                        value={topic}
                      >
                        {topics.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {topic === "custom" ? (
                      <label className="text-xs font-semibold">
                        {t("toolbox_talks.custom_topic", "Custom topic")}
                        <Input className="mt-1" onChange={(e) => setTopicCustom(e.target.value)} value={topicCustom} />
                      </label>
                    ) : null}
                    <label className="text-xs font-semibold">
                      {t("toolbox_talks.col_site", "Site / location")}
                      <select
                        className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                        onChange={(e) => setLocationId(e.target.value)}
                        value={locationId}
                      >
                        <option value="">{t("toolbox_talks.no_location", "No specific site")}</option>
                        {locations
                          .filter((l) => l.company_id === detail.company_id)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold">
                      {t("toolbox_talks.scheduled", "Scheduled date")}
                      <Input className="mt-1" onChange={(e) => setScheduledDate(e.target.value)} type="date" value={scheduledDate} />
                    </label>
                    <label className="text-xs font-semibold">
                      {t("toolbox_talks.body", "Talk content")}
                      <textarea
                        className="mt-1 min-h-[120px] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-2 text-sm"
                        onChange={(e) => setTalkBody(e.target.value)}
                        value={talkBody}
                      />
                    </label>
                    <Button disabled={busy} type="submit">
                      {t("common.save", "Save")}
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-2 text-sm text-[var(--color-text-soft)]">
                    <p>
                      <strong className="text-[var(--color-text)]">{detail.title}</strong> · {detail.topic_display} ·{" "}
                      {locationName(detail.location_id)}
                    </p>
                    <div className="whitespace-pre-wrap rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-2 text-[var(--color-text)]">
                      {detail.talk_body}
                    </div>
                  </div>
                )}

                <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
                  <h3 className="text-sm font-bold text-[var(--color-text)]">{t("toolbox_talks.attendees", "Attendees")}</h3>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="h-10 min-w-[12rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(e) => setPickUserId(e.target.value)}
                      value={pickUserId}
                    >
                      <option value="">{t("toolbox_talks.pick_employee", "Select employee")}</option>
                      {companyEmployees.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.email}
                        </option>
                      ))}
                    </select>
                    <Button disabled={busy || !pickUserId || detail.status === "archived"} onClick={() => void onAddAttendee()} size="sm" type="button">
                      {t("toolbox_talks.add_attendee", "Add")}
                    </Button>
                    <Button
                      disabled={busy || !detail.location_id || detail.status === "archived"}
                      onClick={() => void onAddAllSite()}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {t("toolbox_talks.add_all_site", "Add all site users")}
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded border border-[var(--color-border)]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("toolbox_talks.col_employee", "Employee")}</TableHead>
                          <TableHead>{t("toolbox_talks.col_status", "Status")}</TableHead>
                          <TableHead>{t("toolbox_talks.signed_at", "Signed at")}</TableHead>
                          <TableHead>{t("toolbox_talks.signature_name", "Signature name")}</TableHead>
                          <TableHead className="w-[80px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.attendees.map((a: ToolboxTalkAttendee) => (
                          <TableRow key={a.user_id}>
                            <TableCell className="text-sm">{a.display_name || a.user_email || a.user_id}</TableCell>
                            <TableCell className="text-sm capitalize">{a.status}</TableCell>
                            <TableCell className="text-sm">{formatDate(a.signed_at)}</TableCell>
                            <TableCell className="text-sm">{a.signature_name ?? (a.has_signature ? "—" : "—")}</TableCell>
                            <TableCell>
                              {a.status === "pending" ? (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(() => removeToolboxTalkAttendee(detail.id, a.user_id))
                                  }
                                  size="sm"
                                  type="button"
                                  variant="secondary"
                                >
                                  {t("common.delete", "Delete")}
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
