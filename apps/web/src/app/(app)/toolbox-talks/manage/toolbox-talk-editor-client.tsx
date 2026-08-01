"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, PageHeader, Sheet, SheetBody } from "@/components/ui";
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "@/features/auth";
import { listCompanies, type Company } from "@/features/companies/api";
import { listLocations, type Location } from "@/features/locations/api";
import {
  createToolboxTalk,
  getToolboxTalk,
  listToolboxTemplates,
  listToolboxTopics,
  patchToolboxTalk,
  type ToolboxTalkDetail,
  type ToolboxTopicOption,
  type ToolboxTopicTemplate,
} from "@/features/toolbox-talks/api";
import { useT } from "@/lib/i18n";

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

  const loadStatic = useCallback(async () => {
    const [tops, tpls, locs, people] = await Promise.all([
      listToolboxTopics(),
      listToolboxTemplates(),
      listLocations(),
      listManagedUsers(),
    ]);
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

  const scopedLocations = useMemo(
    () => locations.filter((l) => !companyId || l.company_id === companyId),
    [locations, companyId],
  );
  const scopedUsers = useMemo(
    () => users.filter((u) => !companyId || u.company_id === companyId),
    [users, companyId],
  );

  const draftEditable = !editing || detail?.status === "draft";
  const recordHref = detail ? `/toolbox-talks/manage/${detail.id}` : "/toolbox-talks/manage";

  function applyTemplate(tpl: ToolboxTopicTemplate) {
    if (!draftEditable) return;
    setTitle(tpl.default_title);
    setTopic(tpl.topic);
    setTopicCustom("");
    setTopicCategory(tpl.category);
    setTalkBody(templateBody(tpl));
  }

  async function save(ev?: FormEvent) {
    ev?.preventDefault();
    if (!draftEditable) return;
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
        router.push(`/toolbox-talks/manage/${next.id}`);
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

  return (
    <Sheet>
      <PageHeader
        description="Edit draft content and metadata. Assign employees and publish from the talk record."
        title={editing ? "Edit Toolbox Talk" : "Create Toolbox Talk"}
      />
      <SheetBody className="min-w-0 space-y-5">
        <Link className="text-sm text-[var(--color-text-muted)] underline" href={recordHref}>
          {detail ? "Back to talk record" : "Back to Manage Toolbox Talks"}
        </Link>
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        {notice ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div> : null}
        {loading ? <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading", "Loading…")}</p> : null}

        {editing && detail && detail.status !== "draft" ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            <p className="font-semibold">Only draft Toolbox Talks can be edited.</p>
            <p className="mt-1">Use the talk record for assignment, publishing, and evidence actions.</p>
            <Link
              className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded border border-[var(--color-btn-primary-border)] bg-[var(--color-btn-primary-bg)] px-3 text-sm font-semibold text-[var(--color-btn-primary-fg)]"
              href={`/toolbox-talks/manage/${detail.id}`}
            >
              Open record
            </Link>
          </div>
        ) : null}

        <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h2 className="text-sm font-bold text-[var(--color-text)]">Professional topics</h2>
          <p className="mt-1 text-sm text-[var(--color-text-soft)]">
            Choose a ready-made topic, then edit the content before returning to the record to assign and publish.
          </p>
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
              </button>
            ))}
          </div>
        </section>

        <form className="grid gap-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4" onSubmit={save}>
          {isAdministrator(currentUser) && !editing ? (
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Company
              <select
                className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setCompanyId(e.target.value)}
                required
                value={companyId}
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
            Title
            <Input className="mt-1" disabled={!draftEditable} onChange={(e) => setTitle(e.target.value)} required value={title} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Topic/category
              <select
                className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                disabled={!draftEditable}
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
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Site
              <select
                className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                disabled={!draftEditable}
                onChange={(e) => setLocationId(e.target.value)}
                value={locationId}
              >
                <option value="">No specific site</option>
                {scopedLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Scheduled date
              <Input
                className="mt-1"
                disabled={!draftEditable}
                onChange={(e) => setScheduledDate(e.target.value)}
                type="date"
                value={scheduledDate}
              />
            </label>
            <label className="text-xs font-semibold text-[var(--color-text)]">
              Presenter
              <select
                className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                disabled={!draftEditable}
                onChange={(e) => setPresenterId(e.target.value)}
                value={presenterId}
              >
                <option value="">None</option>
                {scopedUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
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
            <textarea
              className="mt-1 min-h-[420px] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm"
              disabled={!draftEditable}
              onChange={(e) => setTalkBody(e.target.value)}
              required
              value={talkBody}
            />
          </label>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
            {draftEditable ? (
              <Button className="w-full sm:w-auto" disabled={busy || !title.trim() || !talkBody.trim()} type="submit">
                Save draft
              </Button>
            ) : null}
            {detail ? (
              <Link
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 text-sm font-semibold text-[var(--color-text)] sm:w-auto"
                href={`/toolbox-talks/manage/${detail.id}`}
              >
                Continue to assignment and publishing
              </Link>
            ) : null}
          </div>
        </form>
      </SheetBody>
    </Sheet>
  );
}
