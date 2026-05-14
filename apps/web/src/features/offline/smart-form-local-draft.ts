import { idbDeleteSmartFormDraft, idbGetSmartFormDraft, idbPutSmartFormDraft } from "./db";
import type { SmartFormLocalDraft } from "./types";

export async function saveSmartFormLocalDraft(
  userId: string,
  templateId: string,
  answersJson: Record<string, unknown>,
): Promise<void> {
  const draft: SmartFormLocalDraft = {
    draft_key: `${userId}::${templateId}`,
    user_id: userId,
    template_id: templateId,
    updated_at: new Date().toISOString(),
    answers_json: answersJson,
  };
  await idbPutSmartFormDraft(draft);
}

export async function loadSmartFormLocalDraft(
  userId: string,
  templateId: string,
): Promise<SmartFormLocalDraft | null> {
  return idbGetSmartFormDraft(userId, templateId);
}

export async function clearSmartFormLocalDraft(userId: string, templateId: string): Promise<void> {
  await idbDeleteSmartFormDraft(userId, templateId);
}
