import { idbDeleteStarterDraft, idbGetStarterDraft, idbPutStarterDraft } from "./db";
import type { StarterFormLocalDraft } from "./types";

export async function saveStarterFormLocalDraft(
  userId: string,
  fields: Record<string, string>,
): Promise<void> {
  const draft: StarterFormLocalDraft = {
    user_id: userId,
    updated_at: new Date().toISOString(),
    fields,
  };
  await idbPutStarterDraft(draft);
}

export async function loadStarterFormLocalDraft(userId: string): Promise<StarterFormLocalDraft | null> {
  return idbGetStarterDraft(userId);
}

export async function clearStarterFormLocalDraft(userId: string): Promise<void> {
  await idbDeleteStarterDraft(userId);
}
