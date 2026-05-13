import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type AuditEventListItem = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_display: string | null;
  subject_user_id: string | null;
  subject_email: string | null;
  subject_display: string | null;
  company_id: string | null;
  company_name: string | null;
  details_summary: string;
  details: Record<string, unknown>;
};

export type AuditEventListResponse = {
  items: AuditEventListItem[];
  total: number;
  limit: number;
  offset: number;
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

export type ListAuditEventsParams = {
  dateFrom?: string;
  dateTo?: string;
  actorUserId?: string;
  subjectUserId?: string;
  companyId?: string;
  action?: string;
  entityType?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listAuditEvents(params: ListAuditEventsParams = {}): Promise<AuditEventListResponse> {
  const response = await fetch(
    `${API_URL}/api/audit/events${qs({
      date_from: params.dateFrom,
      date_to: params.dateTo,
      actor_user_id: params.actorUserId,
      subject_user_id: params.subjectUserId,
      company_id: params.companyId,
      action: params.action,
      entity_type: params.entityType,
      search: params.search,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      offset: params.offset !== undefined ? String(params.offset) : undefined,
    })}`,
    { credentials: "include" },
  );

  if (response.status === 403) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage((detail as { detail?: unknown }).detail, "You cannot view audit logs."),
    );
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, "Could not load audit logs."));
  }

  return response.json() as Promise<AuditEventListResponse>;
}
