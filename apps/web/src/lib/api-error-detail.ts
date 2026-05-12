/**
 * FastAPI returns `{ "detail": "..." }` or a list of validation objects `{ msg, ... }`.
 * Empty / whitespace-only strings, or joins that trim to nothing, would become
 * `new Error("")` and show a blank Next.js dev overlay — always fall back.
 */
export function fastApiDetailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") {
    const trimmed = detail.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } else if (Array.isArray(detail)) {
    const parts: string[] = [];
    for (const item of detail) {
      if (typeof item === "string") {
        const t = item.trim();
        if (t.length > 0) {
          parts.push(t);
        }
        continue;
      }
      if (item && typeof item === "object" && "msg" in item) {
        const raw = (item as { msg: unknown }).msg;
        if (typeof raw === "string") {
          const t = raw.trim();
          if (t.length > 0) {
            parts.push(t);
          }
        }
      }
    }
    if (parts.length > 0) {
      const joined = parts.join(" ").trim();
      if (joined.length > 0) {
        return joined;
      }
    }
  }
  return fallback;
}
