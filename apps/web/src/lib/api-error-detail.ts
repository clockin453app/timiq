/**
 * FastAPI returns `{ "detail": "..." }` (or arrays). Empty or whitespace-only strings
 * become `new Error("")` and show a blank Next.js dev overlay — always fall back.
 */
export function fastApiDetailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") {
    const trimmed = detail.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback;
}
