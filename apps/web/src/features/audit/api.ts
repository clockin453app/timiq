import { API_URL } from "../../config/api";

export type AuditEvent = {
  id: string;
  actor_user_id: string | null;
  company_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export async function listAuditEvents(): Promise<AuditEvent[]> {
  const response = await fetch(`${API_URL}/api/audit`, {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 403) {
    throw new Error("Only an Administrator can view audit logs.");
  }

  if (!response.ok) {
    throw new Error("Could not load audit logs.");
  }

  return response.json() as Promise<AuditEvent[]>;
}
