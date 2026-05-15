import type { NotificationSummaryItem } from "./api";

/** Small nav dots for Messages / RAMS / Toolbox / Profile setup (subset of bell summary). */
export function navBadgesFromSummary(items: NotificationSummaryItem[]): Record<string, number> {
  let messages = 0;
  let rams = 0;
  let toolbox = 0;
  const out: Record<string, number> = {};
  for (const it of items) {
    if (it.kind === "message" || it.kind === "announcement") {
      messages += it.count;
    }
    if (it.kind === "rams_ack") {
      rams += it.count;
    }
    if (it.kind === "toolbox_sign") {
      toolbox += it.count;
    }
    if (it.kind === "face_check_setup") {
      out["/profile"] = (out["/profile"] ?? 0) + it.count;
    }
  }
  if (messages > 0) {
    out["/messages"] = messages;
  }
  if (rams > 0) {
    out["/rams"] = rams;
  }
  if (toolbox > 0) {
    out["/toolbox-talks"] = toolbox;
  }
  return out;
}
