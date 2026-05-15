/**
 * Browser API base. Empty → same-origin `/api/...` (Next.js rewrites proxy to FastAPI in dev and production).
 * Trims whitespace; unset or blank env is treated as empty.
 */
function normalizePublicApiBase(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) {
    return "";
  }
  return s.replace(/\/$/, "");
}

export const API_URL = normalizePublicApiBase(process.env.NEXT_PUBLIC_API_URL);