import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type PresenceStatus = "online" | "idle" | "recent" | "offline";
export type LiveLogsStatusFilter = "online" | "idle" | "recent" | "all";

export type LiveLogSummary = {
  online_now: number;
  idle: number;
  recent_sessions: number;
  seen_today: number;
};

export type LiveLogSessionItem = {
  id: string;
  user_id: string;
  user_email: string;
  user_display: string | null;
  role: string;
  company_id: string | null;
  company_name: string | null;
  current_path: string | null;
  user_agent_summary: string | null;
  ip_address_masked: string | null;
  status: PresenceStatus;
  first_seen_at: string;
  last_seen_at: string;
  last_heartbeat_at: string;
};

export type LiveLogsResponse = {
  summary: LiveLogSummary;
  items: LiveLogSessionItem[];
  total: number;
  limit: number;
  offset: number;
  server_time_utc: string;
  heartbeat_interval_seconds: number;
};

export type PresenceHeartbeatPayload = {
  client_instance_id: string;
  current_path?: string | null;
  user_agent?: string | null;
};

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export async function postPresenceHeartbeat(payload: PresenceHeartbeatPayload): Promise<void> {
  const response = await fetch(`${API_URL}/api/presence/heartbeat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Could not record presence heartbeat.");
  }
}

export async function listLiveLogs(params: {
  search?: string;
  status?: LiveLogsStatusFilter;
  limit?: number;
  offset?: number;
}): Promise<LiveLogsResponse> {
  const response = await fetch(
    `${API_URL}/api/system/live-logs${qs({
      search: params.search,
      status: params.status,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      offset: params.offset !== undefined ? String(params.offset) : undefined,
    })}`,
    { credentials: "include" },
  );
  if (response.status === 403) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage((detail as { detail?: unknown }).detail, "Live logs are available to administrators only."),
    );
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, "Could not load live logs."));
  }
  return response.json() as Promise<LiveLogsResponse>;
}
