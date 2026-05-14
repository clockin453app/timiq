import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

type ErrorBody = { detail?: unknown };

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as ErrorBody;
    if (parsed.detail != null) {
      return fastApiDetailToMessage(parsed.detail, fallback);
    }
  } catch {
    // ignore
  }
  return fallback;
}

export type ToolboxTopicOption = { value: string; label: string };

export type ToolboxTalkSummary = {
  id: string;
  company_id: string;
  location_id: string | null;
  title: string;
  topic: string;
  topic_display: string;
  scheduled_date: string | null;
  status: string;
  published_at: string | null;
  completed_at: string | null;
};

export type ToolboxTalkAttendee = {
  user_id: string;
  user_email: string | null;
  display_name: string | null;
  status: string;
  signed_at: string | null;
  signature_name: string | null;
  has_signature: boolean;
  declined_reason: string | null;
};

export type ToolboxTalkDetail = ToolboxTalkSummary & {
  topic_custom: string | null;
  topic_category: string | null;
  talk_body: string;
  presenter_user_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  attendees: ToolboxTalkAttendee[];
};

export type ToolboxTalkCreateBody = {
  company_id?: string | null;
  title: string;
  topic: string;
  topic_custom?: string | null;
  topic_category?: string | null;
  location_id?: string | null;
  talk_body: string;
  presenter_user_id?: string | null;
  scheduled_date?: string | null;
};

export type ToolboxTalkPatchBody = Partial<{
  title: string;
  topic: string;
  topic_custom: string | null;
  topic_category: string | null;
  location_id: string | null;
  talk_body: string;
  presenter_user_id: string | null;
  scheduled_date: string | null;
}>;

export type ToolboxTalkAttendeesAddBody = {
  user_ids: string[];
  all_site_users?: boolean;
};

export type ToolboxTalkSignBody = {
  attended_ack: boolean;
  signature_name: string;
};

export async function listToolboxTopics(): Promise<ToolboxTopicOption[]> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/topics`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load topics."));
  }
  return response.json() as Promise<ToolboxTopicOption[]>;
}

export async function listMyToolboxTalks(): Promise<ToolboxTalkSummary[]> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/me`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load toolbox talks."));
  }
  return response.json() as Promise<ToolboxTalkSummary[]>;
}

export type ListToolboxTalksAdminParams = {
  companyId?: string | null;
  status?: string | null;
  locationId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export async function listToolboxTalksAdmin(params: ListToolboxTalksAdminParams = {}): Promise<ToolboxTalkSummary[]> {
  const q = new URLSearchParams();
  if (params.companyId) {
    q.set("company_id", params.companyId);
  }
  if (params.status) {
    q.set("status", params.status);
  }
  if (params.locationId) {
    q.set("location_id", params.locationId);
  }
  if (params.dateFrom) {
    q.set("date_from", params.dateFrom);
  }
  if (params.dateTo) {
    q.set("date_to", params.dateTo);
  }
  const qs = q.toString();
  const response = await fetch(`${API_URL}/api/toolbox-talks${qs ? `?${qs}` : ""}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load talks."));
  }
  return response.json() as Promise<ToolboxTalkSummary[]>;
}

export async function createToolboxTalk(body: ToolboxTalkCreateBody): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not create talk."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function getToolboxTalk(talkId: string): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load talk."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function patchToolboxTalk(talkId: string, body: ToolboxTalkPatchBody): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not update talk."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function publishToolboxTalk(talkId: string): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/publish`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not publish talk."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function completeToolboxTalk(talkId: string): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/complete`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not complete talk."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function archiveToolboxTalk(talkId: string): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/archive`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not archive talk."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function addToolboxTalkAttendees(
  talkId: string,
  body: ToolboxTalkAttendeesAddBody,
): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/attendees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not update attendees."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function removeToolboxTalkAttendee(talkId: string, userId: string): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/attendees/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not remove attendee."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function signToolboxTalk(talkId: string, body: ToolboxTalkSignBody): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not sign talk."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function declineToolboxTalk(talkId: string, reason: string): Promise<ToolboxTalkDetail> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/decline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not decline talk."));
  }
  return response.json() as Promise<ToolboxTalkDetail>;
}

export async function openToolboxTalkPrint(talkId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/print`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load print view."));
  }
  const html = await response.text();
  const w = window.open("", "_blank");
  if (!w) {
    throw new Error("Your browser blocked the print window.");
  }
  w.document.write(html);
  w.document.close();
}

export async function downloadToolboxTalkCsv(talkId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/toolbox-talks/${talkId}/export.csv`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not export CSV."));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `toolbox-talk-${talkId}.csv`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
