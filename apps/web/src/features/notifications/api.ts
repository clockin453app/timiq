import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

async function parseError(response: Response, fallback: string): Promise<never> {
  const detail = await response.json().catch(() => ({}));
  throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback));
}

export type NotificationSummaryItem = {
  kind: string;
  target_key?: string;
  title: string;
  description: string;
  href: string;
  count: number;
  unseen_count: number;
  priority: "normal" | "high";
  /** Preferred grouping key for the hub UI. */
  category?: string | null;
  /** @deprecated Use category */
  group?: string | null;
  is_seen?: boolean;
};

export type NotificationSummary = {
  total_count: number;
  items: NotificationSummaryItem[];
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

export async function fetchNotificationSummary(companyId: string | null): Promise<NotificationSummary> {
  const q = qs({ company_id: companyId ?? undefined });
  const response = await fetch(`${API_URL}/api/notifications/summary${q}`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load notifications.");
  }
  return response.json() as Promise<NotificationSummary>;
}

export type NotificationMarkSeenBody = {
  kind: string;
  target_key?: string;
  mark_all_for_kind?: boolean;
  company_id?: string | null;
};

export async function postNotificationMarkSeen(body: NotificationMarkSeenBody): Promise<{ ok: boolean }> {
  const response = await fetch(`${API_URL}/api/notifications/mark-seen`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: body.kind,
      target_key: body.target_key ?? "",
      mark_all_for_kind: body.mark_all_for_kind ?? false,
      company_id: body.company_id ?? null,
    }),
  });
  if (!response.ok) {
    await parseError(response, "Could not update notifications.");
  }
  return response.json() as Promise<{ ok: boolean }>;
}

export type NotificationMarkAllSeenBody = {
  kinds?: string[] | null;
  items?: Array<{ kind: string; target_key: string }>;
  company_id?: string | null;
};

export async function postNotificationMarkAllSeen(body: NotificationMarkAllSeenBody): Promise<{ ok: boolean }> {
  const response = await fetch(`${API_URL}/api/notifications/mark-all-seen`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kinds: body.kinds ?? null,
      items: body.items ?? null,
      company_id: body.company_id ?? null,
    }),
  });
  if (!response.ok) {
    await parseError(response, "Could not update notifications.");
  }
  return response.json() as Promise<{ ok: boolean }>;
}

export type PushPublicKeyResponse = {
  enabled: boolean;
  public_key: string;
};

export async function fetchPushPublicKey(): Promise<PushPublicKeyResponse> {
  const response = await fetch(`${API_URL}/api/push/public-key`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load push notification settings.");
  }
  return response.json() as Promise<PushPublicKeyResponse>;
}

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  user_agent?: string | null;
  device_label?: string | null;
};

export async function postPushSubscribe(body: PushSubscriptionPayload): Promise<{ ok: boolean; enabled: boolean }> {
  const response = await fetch(`${API_URL}/api/push/subscribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not enable push notifications.");
  }
  return response.json() as Promise<{ ok: boolean; enabled: boolean }>;
}

export async function postPushUnsubscribe(endpoint: string): Promise<{ ok: boolean; enabled: boolean }> {
  const response = await fetch(`${API_URL}/api/push/unsubscribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) {
    await parseError(response, "Could not disable push notifications.");
  }
  return response.json() as Promise<{ ok: boolean; enabled: boolean }>;
}

export async function postPushTest(): Promise<{ ok: boolean; sent: number; enabled: boolean }> {
  const response = await fetch(`${API_URL}/api/push/test`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not send a test push notification.");
  }
  return response.json() as Promise<{ ok: boolean; sent: number; enabled: boolean }>;
}
