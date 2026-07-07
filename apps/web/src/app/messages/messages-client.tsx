"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button, Input, PageHeader, Sheet, SheetBody } from "../../components/ui";
import { UserAvatar } from "../../components/user-avatar";
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
  postConversationPresence,
  postConversationMessage,
  type AnnouncementListItem,
  type Colleague,
  type ConversationListItem,
  type MessageRow,
} from "../../features/messaging/api";
import {
  canAccessManagement,
  isAdministrator,
  useCurrentUser,
  type AuthUser,
} from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import {
  buildParticipantLookup,
  conversationListSubtitle,
  conversationListTitle,
  formatConversationTimestamp,
  participantEmail,
  senderLabel,
  threadHeaderSubtitle,
} from "../../features/messaging/display";
import { ConversationAvatar } from "../../features/messaging/conversation-avatar";
import { segmentBtnClass } from "../budgets/budget-ui";
import { useT } from "../../lib/i18n";

type TabId = "news" | "messages";

type ThreadScrollIntent = "open" | "reload" | "send" | "new-message-if-at-bottom" | "jump-to-latest";

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
  return "mt-1.5 h-11 w-full max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-base text-[var(--color-text)] md:h-10 md:text-sm";
}

function textareaClass() {
  return "mt-1.5 min-h-[88px] w-full max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2.5 text-base text-[var(--color-text)] md:text-sm";
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

function isNearBottom(el: HTMLElement, thresholdPx = 100): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx;
}

export function MessagesClient() {
  const user = useCurrentUser();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const [newConvMode, setNewConvMode] = useState<"direct" | "group">("direct");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupPick, setGroupPick] = useState<string[]>([]);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [newConvMessage, setNewConvMessage] = useState("");
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const scrollIntentRef = useRef<ThreadScrollIntent | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const prevMsgCountRef = useRef(0);

  const effectiveCompanyId = useMemo(() => resolveCompanyId(user, companyOverride), [user, companyOverride]);
  const activeConv = useMemo(
    () => conversations.find((c) => c.id === selectedConvId) ?? null,
    [conversations, selectedConvId],
  );
  const mgmt = canAccessManagement(user);

  const participantLookup = useMemo(
    () => buildParticipantLookup(colleagues, conversations),
    [colleagues, conversations],
  );

  const replaceMessagesQuery = useCallback(
    (nextTab: TabId, conversationId: string | null) => {
      const p = new URLSearchParams();
      if (nextTab === "messages") {
        p.set("tab", "messages");
        if (conversationId) {
          p.set("conversation", conversationId);
        }
      } else {
        p.set("tab", "news");
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

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
      void fetchColleagues(isAdministrator(user) ? effectiveCompanyId : null)
        .then(setColleagues)
        .catch(() => undefined);
    }
  }, [tab, loadConversations, user, effectiveCompanyId]);

  useEffect(() => {
    const c = searchParams.get("conversation");
    const t = searchParams.get("tab");
    if (c) {
      setTab("messages");
    } else if (t === "messages") {
      setTab("messages");
    } else if (t === "news" || t === "announcements") {
      setTab("news");
    }
  }, [searchParams]);

  useEffect(() => {
    const c = searchParams.get("conversation");
    if (!c || convLoading) {
      return;
    }
    if (conversations.some((row) => row.id === c)) {
      setSelectedConvId((prev) => (prev === c ? prev : c));
    }
  }, [searchParams, conversations, convLoading]);

  const applyThreadScrollIntent = useCallback((_intent: ThreadScrollIntent) => {
    const box = threadScrollRef.current;
    if (!box) {
      return;
    }
    box.scrollTop = box.scrollHeight;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const loadMessages = useCallback(
    async (
      conversationId: string,
      opts?: { silent?: boolean; intent?: ThreadScrollIntent },
    ) => {
      const boxBefore = threadScrollRef.current;
      const wasNearBottom = boxBefore ? isNearBottom(boxBefore) : true;

      if (!opts?.silent) {
        setMsgLoading(true);
        scrollIntentRef.current = opts?.intent ?? "open";
      } else if (opts.intent) {
        scrollIntentRef.current = opts.intent;
      }

      try {
        const rows = await fetchConversationMessages(conversationId);
        const prevCount = prevMsgCountRef.current;
        prevMsgCountRef.current = rows.length;
        setMessages(rows);
        await markConversationRead(conversationId);

        if (opts?.silent && !opts.intent) {
          if (rows.length > prevCount) {
            if (wasNearBottom) {
              scrollIntentRef.current = "new-message-if-at-bottom";
            } else {
              setShowJumpToLatest(true);
            }
          }
        }
      } catch (e) {
        setConvError(e instanceof Error ? e.message : "Failed to load messages.");
        scrollIntentRef.current = null;
      } finally {
        if (!opts?.silent) {
          setMsgLoading(false);
        }
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const intent = scrollIntentRef.current;
    if (!selectedConvId || msgLoading || !intent) {
      return;
    }
    scrollIntentRef.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyThreadScrollIntent(intent);
      });
    });
  }, [messages, msgLoading, selectedConvId, applyThreadScrollIntent]);

  useEffect(() => {
    if (tab === "messages" && selectedConvId) {
      prevMsgCountRef.current = 0;
      setShowJumpToLatest(false);
      stickToBottomRef.current = true;
      void loadMessages(selectedConvId, { intent: "open" });
    }
  }, [tab, selectedConvId, loadMessages]);

  useEffect(() => {
    if (tab !== "messages") {
      return undefined;
    }
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void loadConversations();
    }, 26_000);
    return () => window.clearInterval(id);
  }, [tab, loadConversations]);

  useEffect(() => {
    if (tab !== "messages" || !selectedConvId) {
      return undefined;
    }
    const heartbeat = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void postConversationPresence(selectedConvId).catch(() => undefined);
    };
    heartbeat();
    const id = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(id);
  }, [tab, selectedConvId]);

  useEffect(() => {
    if (tab !== "messages" || !selectedConvId) {
      return undefined;
    }
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void loadMessages(selectedConvId, { silent: true });
    }, 7_000);
    return () => window.clearInterval(id);
  }, [tab, selectedConvId, loadMessages]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (tab === "messages") {
        void loadConversations();
        if (selectedConvId) {
          void postConversationPresence(selectedConvId).catch(() => undefined);
          void loadMessages(selectedConvId, { silent: true });
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [tab, selectedConvId, loadConversations, loadMessages]);

  useEffect(() => {
    const onFocus = () => {
      if (tab === "messages") {
        void loadConversations();
        if (selectedConvId) {
          void postConversationPresence(selectedConvId).catch(() => undefined);
          void loadMessages(selectedConvId, { silent: true });
        }
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [tab, selectedConvId, loadConversations, loadMessages]);

  async function openNewConversation() {
    setNewConvOpen(true);
    setNewConvMode("direct");
    setGroupTitle("");
    setGroupPick([]);
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
    if (!newConvMessage.trim()) {
      return;
    }
    try {
      if (newConvMode === "direct") {
        if (!pickUserId) {
          return;
        }
        const conv = await createConversation({
          company_id: isAdministrator(user) ? effectiveCompanyId : null,
          conversation_type: "direct",
          participant_user_ids: [pickUserId],
          initial_message: newConvMessage.trim(),
        });
        setNewConvOpen(false);
        await loadConversations();
        setSelectedConvId(conv.id);
        replaceMessagesQuery("messages", conv.id);
        return;
      }
      const title = groupTitle.trim();
      if (!title || groupPick.length < 2) {
        setConvError("Group chats need a title and at least two colleagues.");
        return;
      }
      const conv = await createConversation({
        company_id: isAdministrator(user) ? effectiveCompanyId : null,
        conversation_type: "group",
        title,
        participant_user_ids: groupPick,
        initial_message: newConvMessage.trim(),
      });
      setNewConvOpen(false);
      await loadConversations();
      setSelectedConvId(conv.id);
      replaceMessagesQuery("messages", conv.id);
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
      await postConversationMessage(selectedConvId, msgInput.trim());
      setMsgInput("");
      await loadMessages(selectedConvId, { silent: true, intent: "send" });
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

  const messagesSheetHeightClass =
    "h-[calc(100dvh-var(--layout-mobile-bottom-nav-height)-4rem-(var(--space-page-y)*2))] max-h-[calc(100dvh-var(--layout-mobile-bottom-nav-height)-4rem-(var(--space-page-y)*2))] xl:h-[calc(100dvh-var(--layout-topbar-height)-(var(--space-page-y)*2)-1.75rem)] xl:max-h-[calc(100dvh-var(--layout-topbar-height)-(var(--space-page-y)*2)-1.75rem)]";

  const tabSwitcher = (
    <div className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-1">
      <button
        className={segmentBtnClass(tab === "news")}
        type="button"
        onClick={() => {
          setTab("news");
          setSelectedConvId(null);
          replaceMessagesQuery("news", null);
        }}
      >
        Newsfeed
      </button>
      <button
        className={segmentBtnClass(tab === "messages")}
        type="button"
        onClick={() => {
          setTab("messages");
          replaceMessagesQuery("messages", selectedConvId);
        }}
      >
        Messages
      </button>
    </div>
  );

  const companyScopeFilter = isAdministrator(user) ? (
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
  ) : null;

  return (
    <Sheet
      className={
        tab === "messages"
          ? `grid ${messagesSheetHeightClass} grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden`
          : undefined
      }
    >
      <PageHeader
        description="Company news and internal messages. Conversations refresh automatically while this page is open."
        title="Messages"
      />
      {tab === "messages" ? (
        <>
          <div className="timiq-mobile-form-pad flex min-h-0 flex-col gap-3 px-3 md:px-5">
            {tabSwitcher}
            {companyScopeFilter}
          </div>
          <div className="timiq-mobile-form-pad min-h-0 overflow-hidden px-3 pb-4 md:px-5 md:pb-5">
            <div className="grid h-full min-h-0 w-full min-w-0 grid-cols-1 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] md:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="flex max-h-[28vh] min-h-0 flex-col overflow-hidden border-b border-[var(--color-border-dark)] md:h-full md:max-h-none md:w-80 md:border-b-0 md:border-r">
              <div className="flex flex-wrap gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] p-3">
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
                <div className="mx-3 mt-2 rounded border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2 py-1 text-xs text-red-700">
                  {convError}
                </div>
              ) : null}
              {convLoading ? <p className="px-3 py-2 text-xs text-[var(--color-text-soft)]">Loading…</p> : null}
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 md:max-h-none">
                {conversations.map((c) => {
                  const selected = selectedConvId === c.id;
                  const title = conversationListTitle(c, user.id);
                  const subtitle = conversationListSubtitle(c, user.id);
                  return (
                    <li key={c.id}>
                      <button
                        className={`flex w-full items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors ${
                          selected
                            ? "border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] shadow-sm"
                            : "border-transparent hover:border-[var(--color-border-dark)] hover:bg-[var(--color-header)]"
                        }`}
                        type="button"
                        onClick={() => {
                          setSelectedConvId(c.id);
                          replaceMessagesQuery("messages", c.id);
                        }}
                      >
                        <ConversationAvatar conversation={c} sizeClassName="h-11 w-11" viewerId={user.id} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-[var(--color-text)]">{title}</p>
                            <span className="shrink-0 text-[11px] text-[var(--color-text-soft)]">
                              {formatConversationTimestamp(c.last_message_at || c.updated_at)}
                            </span>
                          </div>
                          {subtitle ? (
                            <p className="truncate text-xs text-[var(--color-text-muted)]">{subtitle}</p>
                          ) : null}
                          <p className="mt-0.5 truncate text-xs text-[var(--color-text-soft)]">
                            {c.last_message_preview?.trim() || "No messages yet"}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!convLoading && conversations.length === 0 ? (
                <p className="px-3 pb-3 text-sm text-[var(--color-text-soft)]">No conversations yet.</p>
              ) : null}
            </aside>

            <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
              {selectedConvId ? (
                <>
                  {activeConv ? (
                    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3">
                      <ConversationAvatar conversation={activeConv} sizeClassName="h-11 w-11" viewerId={user.id} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                          {conversationListTitle(activeConv, user.id)}
                        </p>
                        {threadHeaderSubtitle(activeConv, user.id) ? (
                          <p className="truncate text-xs text-[var(--color-text-muted)]">
                            {threadHeaderSubtitle(activeConv, user.id)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {showJumpToLatest ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              applyThreadScrollIntent("jump-to-latest");
                            }}
                          >
                            {t("messaging.new_messages_button", "New messages")}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            stickToBottomRef.current = true;
                            void loadMessages(selectedConvId, { intent: "reload" });
                          }}
                        >
                          Reload thread
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div
                    ref={threadScrollRef}
                    className="min-h-0 overflow-y-auto overscroll-contain bg-[var(--color-page)] px-3 py-4"
                    onScroll={() => {
                      const box = threadScrollRef.current;
                      if (!box) {
                        return;
                      }
                      const nearBottom = isNearBottom(box);
                      stickToBottomRef.current = nearBottom;
                      if (nearBottom) {
                        setShowJumpToLatest(false);
                      }
                    }}
                  >
                    {msgLoading ? (
                      <p className="text-xs text-[var(--color-text-soft)]">Loading messages…</p>
                    ) : null}
                    <div className="flex flex-col gap-3">
                      {messages.map((m) => {
                        const mine = m.sender_user_id === user.id;
                        const label = senderLabel(
                          m.sender_user_id,
                          user.id,
                          participantLookup,
                          m.sender_display_name,
                        );
                        return (
                          <div
                            key={m.id}
                            className={`flex max-w-full gap-2 ${mine ? "ml-auto flex-row-reverse" : "mr-auto"}`}
                          >
                            {!mine ? (
                              <UserAvatar
                                email={participantEmail(m.sender_user_id, participantLookup)}
                                name={label}
                                sizeClassName="h-8 w-8"
                                userId={m.sender_user_id}
                              />
                            ) : null}
                            <div className={`max-w-[min(88%,34rem)] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                              <div
                                className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${
                                  mine
                                    ? "rounded-br-md bg-[var(--color-btn-active-bg)] text-[var(--color-text)]"
                                    : "rounded-bl-md border border-[var(--color-border-dark)] bg-[var(--color-cell)] text-[var(--color-text)]"
                                }`}
                              >
                                {!mine ? (
                                  <p className="mb-1 text-[11px] font-semibold text-[var(--color-text-muted)]">{label}</p>
                                ) : null}
                                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                              </div>
                              <p className="mt-1 px-1 text-[10px] text-[var(--color-text-soft)]">
                                {mine ? "You" : label} · {formatConversationTimestamp(m.created_at)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <form
                    className="flex flex-col gap-2 border-t border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 max-md:pb-1 sm:flex-row sm:items-end"
                    onSubmit={sendMessage}
                  >
                    <textarea
                      className={`${textareaClass()} min-h-[72px] flex-1`}
                      maxLength={4000}
                      placeholder="Write a message…"
                      value={msgInput}
                      onChange={(ev) => setMsgInput(ev.target.value)}
                    />
                    <Button className="sm:mb-0.5" disabled={!msgInput.trim()} type="submit">
                      Send
                    </Button>
                  </form>
                </>
              ) : (
                <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
                  <p className="text-sm text-[var(--color-text-soft)]">Select a conversation or start a new chat.</p>
                </div>
              )}
            </div>
            </div>
          </div>
        </>
      ) : (
        <SheetBody className="timiq-mobile-form-pad min-w-0 max-w-full space-y-4 overflow-x-hidden md:p-5">
          {tabSwitcher}
          {companyScopeFilter}
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
        </SheetBody>
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
            <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg">
              <h3 className="text-sm font-semibold">{t("messaging.new_group", "Start conversation")}</h3>
              <form className="mt-3 space-y-3" onSubmit={submitNewConversation}>
                <div className="flex flex-wrap gap-2 rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-1">
                  <button
                    className={segmentBtnClass(newConvMode === "direct")}
                    type="button"
                    onClick={() => setNewConvMode("direct")}
                  >
                    {t("messaging.direct_message", "Direct message")}
                  </button>
                  <button
                    className={segmentBtnClass(newConvMode === "group")}
                    type="button"
                    onClick={() => setNewConvMode("group")}
                  >
                    {t("messaging.group_chat", "Group chat")}
                  </button>
                </div>
                {newConvMode === "direct" ? (
                  <div>
                    <label className={fieldLabel()} htmlFor="conv-peer">
                      {t("messaging.direct_peer", "Person")}
                    </label>
                    <select
                      className={inputClass()}
                      id="conv-peer"
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
                ) : (
                  <>
                    <div>
                      <label className={fieldLabel()} htmlFor="conv-group-title">
                        {t("messaging.group_title", "Group title")}
                      </label>
                      <Input
                        className="mt-1.5"
                        id="conv-group-title"
                        maxLength={200}
                        value={groupTitle}
                        onChange={(e) => setGroupTitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <p className={fieldLabel()}>{t("messaging.participants", "Participants")}</p>
                      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] p-2">
                        {colleagues.map((c) => {
                          const on = groupPick.includes(c.user_id);
                          return (
                            <li key={c.user_id}>
                              <label className="flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                  checked={on}
                                  type="checkbox"
                                  onChange={() => {
                                    setGroupPick((prev) =>
                                      on ? prev.filter((id) => id !== c.user_id) : [...prev, c.user_id],
                                    );
                                  }}
                                />
                                <span>{c.display_name}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </>
                )}
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
    </Sheet>
  );
}
