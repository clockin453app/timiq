import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

async function parseError(response: Response, fallback: string): Promise<never> {
  const detail = await response.json().catch(() => ({}));
  throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback));
}

export type Colleague = {
  user_id: string;
  email: string;
  display_name: string;
};

export type AnnouncementListItem = {
  id: string;
  company_id: string | null;
  title: string;
  body: string;
  audience_type: string;
  priority: string;
  published_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  read_at: string | null;
  read_count: number | null;
};

export type AnnouncementDetail = AnnouncementListItem & {
  reads: { user_id: string; read_at: string }[] | null;
};

export type ConversationListItem = {
  id: string;
  company_id: string;
  updated_at: string;
  participant_user_ids: string[];
  last_message_preview: string | null;
  last_message_at: string | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
};

function qs(params: Record<string, string | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      s.set(k, v);
    }
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

export async function fetchColleagues(companyId: string | null): Promise<Colleague[]> {
  const q = qs({ company_id: companyId ?? undefined });
  const response = await fetch(`${API_URL}/api/messaging/colleagues${q}`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load colleagues.");
  }
  return response.json() as Promise<Colleague[]>;
}

export async function fetchAnnouncements(params: {
  companyId?: string | null;
  includeDrafts?: boolean;
}): Promise<AnnouncementListItem[]> {
  const q = qs({
    company_id: params.companyId ?? undefined,
    include_drafts: params.includeDrafts ? "true" : undefined,
  });
  const response = await fetch(`${API_URL}/api/messaging/announcements${q}`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load announcements.");
  }
  return response.json() as Promise<AnnouncementListItem[]>;
}

export async function fetchAnnouncementDetail(
  id: string,
  companyId: string | null,
): Promise<AnnouncementDetail> {
  const q = qs({ company_id: companyId ?? undefined });
  const response = await fetch(`${API_URL}/api/messaging/announcements/${encodeURIComponent(id)}${q}`, {
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load announcement.");
  }
  return response.json() as Promise<AnnouncementDetail>;
}

export type AnnouncementCreateBody = {
  company_id?: string | null;
  audience_type: string;
  priority: string;
  title: string;
  body: string;
  published_at?: string | null;
  expires_at?: string | null;
};

export async function createAnnouncement(body: AnnouncementCreateBody): Promise<AnnouncementDetail> {
  const response = await fetch(`${API_URL}/api/messaging/announcements`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not create announcement.");
  }
  return response.json() as Promise<AnnouncementDetail>;
}

export type AnnouncementPatchBody = {
  title?: string;
  body?: string;
  priority?: string;
  published_at?: string | null;
  expires_at?: string | null;
};

export async function patchAnnouncement(
  id: string,
  body: AnnouncementPatchBody,
  companyId: string | null,
): Promise<AnnouncementDetail> {
  const q = qs({ company_id: companyId ?? undefined });
  const response = await fetch(`${API_URL}/api/messaging/announcements/${encodeURIComponent(id)}${q}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not update announcement.");
  }
  return response.json() as Promise<AnnouncementDetail>;
}

export async function archiveAnnouncement(id: string, companyId: string | null): Promise<AnnouncementDetail> {
  const q = qs({ company_id: companyId ?? undefined });
  const response = await fetch(`${API_URL}/api/messaging/announcements/${encodeURIComponent(id)}/archive${q}`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not archive announcement.");
  }
  return response.json() as Promise<AnnouncementDetail>;
}

export async function markAnnouncementRead(id: string, companyId: string | null): Promise<void> {
  const q = qs({ company_id: companyId ?? undefined });
  const response = await fetch(`${API_URL}/api/messaging/announcements/${encodeURIComponent(id)}/mark-read${q}`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not mark announcement read.");
  }
}

export async function fetchConversations(): Promise<ConversationListItem[]> {
  const response = await fetch(`${API_URL}/api/messaging/conversations`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load conversations.");
  }
  return response.json() as Promise<ConversationListItem[]>;
}

export async function createConversation(body: {
  company_id?: string | null;
  participant_user_ids: string[];
  initial_message: string;
}): Promise<ConversationListItem> {
  const response = await fetch(`${API_URL}/api/messaging/conversations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not start conversation.");
  }
  return response.json() as Promise<ConversationListItem>;
}

export async function fetchConversationMessages(conversationId: string): Promise<MessageRow[]> {
  const response = await fetch(
    `${API_URL}/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages`,
    { credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load messages.");
  }
  return response.json() as Promise<MessageRow[]>;
}

export async function postConversationMessage(conversationId: string, body: string): Promise<MessageRow> {
  const response = await fetch(
    `${API_URL}/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not send message.");
  }
  return response.json() as Promise<MessageRow>;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/messaging/conversations/${encodeURIComponent(conversationId)}/mark-read`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not update read state.");
  }
}
