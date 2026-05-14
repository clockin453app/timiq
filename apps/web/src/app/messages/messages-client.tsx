"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  archiveAnnouncement,
  createAnnouncement,
  createConversation,
  fetchAnnouncements,
  fetchColleagues,
  fetchConversationMessages,
  fetchConversations,
  markAnnouncementRead,
  markConversationRead,
  postConversationMessage,
  type AnnouncementListItem,
  type Colleague,
  type ConversationListItem,
  type MessageRow,
} from "../../features/messaging/api";
import {
  canAccessManagement,
  isAdministrator,
  LogoutButton,
  useCurrentUser,
  type AuthUser,
} from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import { segmentBtnClass } from "../budgets/budget-ui";

type TabId = "news" | "messages";

function resolveCompanyId(user: AuthUser, override: string | null): string | null {
  if (isAdministrator(user)) {
    return override;
  }
  return user.company_id;
}

function priorityLabel(p: string): string {
  if (p === "urgent") {
    return "Urgent";
  }
  if (p === "important") {
    return "Important";
  }
  return "Normal";
}

function priorityClass(p: string): string {
  if (p === "urgent") {
    return "bg-red-100 text-red-900";
  }
  if (p === "important") {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-[var(--color-header)] text-[var(--color-text)]";
}

function fieldLabel() {
  return "block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]";
}

function inputClass() {
  return "mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]";
}

function textareaClass() {
  return "mt-1.5 min-h-[88px] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2 text-sm text-[var(--color-text)]";
}

function formatTs(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function MessagesClient() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<TabId>("news");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementListItem[]>([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [annError, setAnnError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cBody, setCBody] = useState("");
  const [cAudience, setCAudience] = useState("company");
  const [cPriority, setCPriority] = useState("normal");
  const [cPublishNow, setCPublishNow] = useState(true);
  const [cSaving, setCSaving] = useState(false);

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgInput, setMsgInput] = useState("");
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [newConvMessage, setNewConvMessage] = useState("");

  const effectiveCompanyId = useMemo(() => resolveCompanyId(user, companyOverride), [user, companyOverride]);
  const mgmt = canAccessManagement(user);

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listCompanies();
        if (!cancelled) {
          setCompanies(rows);
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadAnnouncements = useCallback(async () => {
    setAnnLoading(true);
    setAnnError(null);
    try {
      const rows = await fetchAnnouncements({
        companyId: isAdministrator(user) ? effectiveCompanyId : null,
        includeDrafts: mgmt,
      });
      setAnnouncements(rows);
    } catch (e) {
      setAnnError(e instanceof Error ? e.message : "Failed to load news.");
    } finally {
      setAnnLoading(false);
    }
  }, [user, effectiveCompanyId, mgmt]);

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    setConvError(null);
    try {
      const rows = await fetchConversations();
      setConversations(rows);
    } catch (e) {
      setConvError(e instanceof Error ? e.message : "Failed to load conversations.");
    } finally {
      setConvLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "messages") {
      void loadConversations();
    }
  }, [tab, loadConversations]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setMsgLoading(true);
    try {
      const rows = await fetchConversationMessages(conversationId);
      setMessages(rows);
      await markConversationRead(conversationId);
    } catch (e) {
      setConvError(e instanceof Error ? e.message : "Failed to load messages.");
    } finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "messages" && selectedConvId) {
      void loadMessages(selectedConvId);
    }
  }, [tab, selectedConvId, loadMessages]);

  async function openNewConversation() {
    setNewConvOpen(true);
    setPickUserId("");
    setNewConvMessage("");
    try {
      const rows = await fetchColleagues(isAdministrator(user) ? effectiveCompanyId : null);
      setColleagues(rows);
    } catch {
      setColleagues([]);
    }
  }

  async function submitNewConversation(e: FormEvent) {
    e.preventDefault();
    if (!pickUserId || !newConvMessage.trim()) {
      return;
    }
    try {
      const conv = await createConversation({
        company_id: isAdministrator(user) ? effectiveCompanyId : null,
        participant_user_ids: [pickUserId],
        initial_message: newConvMessage.trim(),
      });
      setNewConvOpen(false);
      await loadConversations();
      setSelectedConvId(conv.id);
    } catch (err) {
      setConvError(err instanceof Error ? err.message : "Could not start chat.");
    }
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!selectedConvId || !msgInput.trim()) {
      return;
    }
    try {
      const m = await postConversationMessage(selectedConvId, msgInput.trim());
      setMessages((prev) => [...prev, m]);
      setMsgInput("");
      await loadConversations();
    } catch (err) {
      setConvError(err instanceof Error ? err.message : "Send failed.");
    }
  }

  async function onMarkRead(a: AnnouncementListItem) {
    try {
      await markAnnouncementRead(a.id, isAdministrator(user) ? effectiveCompanyId : null);
      await loadAnnouncements();
    } catch {
      /* ignore */
    }
  }

  async function onArchive(a: AnnouncementListItem) {
    if (!window.confirm("Archive this announcement? It will disappear from the newsfeed.")) {
      return;
    }
    try {
      await archiveAnnouncement(a.id, isAdministrator(user) ? effectiveCompanyId : null);
      await loadAnnouncements();
    } catch (err) {
      setAnnError(err instanceof Error ? err.message : "Archive failed.");
    }
  }

  async function onCreateAnnouncement(e: FormEvent) {
    e.preventDefault();
    if (!cTitle.trim() || !cBody.trim()) {
      return;
    }
    let companyId: string | null = null;
    if (!isAdministrator(user)) {
      companyId = user.company_id;
    } else if (cAudience === "company") {
      companyId = effectiveCompanyId;
      if (!companyId) {
        setAnnError("Select a company for company-scoped announcements.");
        return;
      }
    } else {
      companyId = null;
    }
    setCSaving(true);
    setAnnError(null);
    try {
      await createAnnouncement({
        company_id: companyId,
        audience_type: isAdministrator(user) ? cAudience : "company",
        priority: cPriority,
        title: cTitle.trim(),
        body: cBody.trim(),
        published_at: cPublishNow ? new Date().toISOString() : null,
        expires_at: null,
      });
      setCreateOpen(false);
      setCTitle("");
      setCBody("");
      setCAudience("company");
      setCPriority("normal");
      setCPublishNow(true);
      await loadAnnouncements();
    } catch (err) {
      setAnnError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setCSaving(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        action={<LogoutButton />}
        description="Company news and internal messages. Refresh manually; there is no live push yet."
        title="Messages"
      />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <div className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-1">
          <button className={segmentBtnClass(tab === "news")} type="button" onClick={() => setTab("news")}>
            Newsfeed
          </button>
          <button className={segmentBtnClass(tab === "messages")} type="button" onClick={() => setTab("messages")}>
            Messages
          </button>
        </div>

        {isAdministrator(user) ? (
          <div className="max-w-md">
            <label className={fieldLabel()} htmlFor="msg-company">
              Company (news scope)
            </label>
            <select
              className={inputClass()}
              id="msg-company"
              value={companyOverride ?? ""}
              onChange={(ev) => setCompanyOverride(ev.target.value || null)}
            >
              <option value="">All / pick company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--color-text-soft)]">
              Select a company to post company news or start chats in that company&apos;s context.
            </p>
          </div>
        ) : null}

        {tab === "news" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => void loadAnnouncements()}>
                Refresh
              </Button>
              {mgmt ? (
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  New announcement
                </Button>
              ) : null}
            </div>
            {annError ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-red-700">
                {annError}
              </div>
            ) : null}
            {annLoading ? <p className="text-sm text-[var(--color-text-soft)]">Loading…</p> : null}
            <ul className="min-w-0 space-y-3">
              {announcements.map((a) => (
                <li
                  key={a.id}
                  className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${priorityClass(a.priority)}`}>
                          {priorityLabel(a.priority)}
                        </span>
                        {!a.read_at ? (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">
                            Unread
                          </span>
                        ) : null}
                        <span className="text-xs text-[var(--color-text-soft)]">{formatTs(a.published_at)}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-[var(--color-text)]">{a.title}</h3>
                      <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text)]">{a.body}</p>
                      {a.read_count !== null && mgmt ? (
                        <p className="text-xs text-[var(--color-text-soft)]">{a.read_count} reads recorded</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      {!a.read_at && a.is_active ? (
                        <Button type="button" variant="secondary" onClick={() => void onMarkRead(a)}>
                          Mark read
                        </Button>
                      ) : null}
                      {mgmt && a.is_active ? (
                        <Button type="button" variant="secondary" onClick={() => void onArchive(a)}>
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {!annLoading && announcements.length === 0 ? (
              <p className="text-sm text-[var(--color-text-soft)]">No announcements yet.</p>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-[320px] min-w-0 flex-col gap-3 md:flex-row">
            <div className="w-full shrink-0 border-b border-[var(--color-border-dark)] pb-3 md:w-64 md:border-b-0 md:border-r md:pb-0 md:pr-3">
              <div className="mb-2 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => void loadConversations()}>
                  Refresh
                </Button>
                <Button
                  type="button"
                  disabled={isAdministrator(user) && !effectiveCompanyId}
                  onClick={() => void openNewConversation()}
                >
                  New chat
                </Button>
              </div>
              {convError ? (
                <div className="mb-2 rounded border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2 py-1 text-xs text-red-700">
                  {convError}
                </div>
              ) : null}
              {convLoading ? <p className="text-xs text-[var(--color-text-soft)]">Loading…</p> : null}
              <ul className="max-h-[40vh] min-w-0 space-y-1 overflow-y-auto md:max-h-[60vh]">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      className={`w-full rounded px-2 py-2 text-left text-sm ${
                        selectedConvId === c.id
                          ? "bg-[var(--color-header)] font-semibold"
                          : "hover:bg-[var(--color-header)]"
                      }`}
                      type="button"
                      onClick={() => setSelectedConvId(c.id)}
                    >
                      <div className="truncate">{c.last_message_preview || "Conversation"}</div>
                      <div className="truncate text-xs text-[var(--color-text-soft)]">
                        {formatTs(c.last_message_at || c.updated_at)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {selectedConvId ? (
                <>
                  <div className="mb-2 flex justify-end">
                    <Button type="button" variant="secondary" onClick={() => void loadMessages(selectedConvId)}>
                      Reload thread
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2 md:max-h-[55vh]">
                    {msgLoading ? <p className="text-xs text-[var(--color-text-soft)]">Loading…</p> : null}
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={`max-w-[95%] rounded px-2 py-1.5 text-sm ${
                          m.sender_user_id === user.id ? "ml-auto bg-[var(--color-header)]" : "mr-auto bg-[var(--color-input)]"
                        }`}
                      >
                        <div className="mb-0.5 text-[10px] uppercase text-[var(--color-text-soft)]">
                          {m.sender_user_id === user.id ? "You" : "Colleague"} · {formatTs(m.created_at)}
                        </div>
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      </div>
                    ))}
                  </div>
                  <form className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end" onSubmit={sendMessage}>
                    <textarea
                      className={`${textareaClass()} min-h-[72px] flex-1`}
                      maxLength={4000}
                      placeholder="Write a message…"
                      value={msgInput}
                      onChange={(ev) => setMsgInput(ev.target.value)}
                    />
                    <Button disabled={!msgInput.trim()} type="submit">
                      Send
                    </Button>
                  </form>
                </>
              ) : (
                <p className="text-sm text-[var(--color-text-soft)]">Select a conversation or start a new chat.</p>
              )}
            </div>
          </div>
        )}

        {createOpen ? (
          <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg">
              <h3 className="text-sm font-semibold">New announcement</h3>
              <form className="mt-3 space-y-3" onSubmit={onCreateAnnouncement}>
                {isAdministrator(user) ? (
                  <div>
                    <label className={fieldLabel()} htmlFor="ann-aud">
                      Audience
                    </label>
                    <select
                      className={inputClass()}
                      id="ann-aud"
                      value={cAudience}
                      onChange={(ev) => setCAudience(ev.target.value)}
                    >
                      <option value="company">Company</option>
                      <option value="administrators">Administrators only</option>
                      <option value="all_companies">All companies</option>
                    </select>
                  </div>
                ) : null}
                <div>
                  <label className={fieldLabel()} htmlFor="ann-pri">
                    Priority
                  </label>
                  <select
                    className={inputClass()}
                    id="ann-pri"
                    value={cPriority}
                    onChange={(ev) => setCPriority(ev.target.value)}
                  >
                    <option value="normal">Normal</option>
                    <option value="important">Important</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className={fieldLabel()} htmlFor="ann-title">
                    Title
                  </label>
                  <Input className="mt-1.5" id="ann-title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} />
                </div>
                <div>
                  <label className={fieldLabel()} htmlFor="ann-body">
                    Body (plain text; HTML is stripped)
                  </label>
                  <textarea
                    className={textareaClass()}
                    id="ann-body"
                    value={cBody}
                    onChange={(e) => setCBody(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    checked={cPublishNow}
                    type="checkbox"
                    onChange={(e) => setCPublishNow(e.target.checked)}
                  />
                  Publish immediately
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={cSaving} type="submit">
                    {cSaving ? "Saving…" : "Publish"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {newConvOpen ? (
          <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center">
            <div className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg">
              <h3 className="text-sm font-semibold">Start conversation</h3>
              <form className="mt-3 space-y-3" onSubmit={submitNewConversation}>
                <div>
                  <label className={fieldLabel()} htmlFor="conv-peer">
                    Colleague
                  </label>
                  <select
                    className={inputClass()}
                    id="conv-peer"
                    required
                    value={pickUserId}
                    onChange={(ev) => setPickUserId(ev.target.value)}
                  >
                    <option value="">Select…</option>
                    {colleagues.map((c) => (
                      <option key={c.user_id} value={c.user_id}>
                        {c.display_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={fieldLabel()} htmlFor="conv-first">
                    First message
                  </label>
                  <textarea
                    className={textareaClass()}
                    id="conv-first"
                    maxLength={4000}
                    required
                    value={newConvMessage}
                    onChange={(ev) => setNewConvMessage(ev.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Start</Button>
                  <Button type="button" variant="secondary" onClick={() => setNewConvOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
