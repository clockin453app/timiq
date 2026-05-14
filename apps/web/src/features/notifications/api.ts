import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

async function parseError(response: Response, fallback: string): Promise<never> {
  const detail = await response.json().catch(() => ({}));
  throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback));
}

export type NotificationSummaryItem = {
  kind: string;
  title: string;
  description: string;
  href: string;
  count: number;
  priority: "normal" | "high";
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
