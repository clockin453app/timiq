import type { SmartFormSchemaJson } from "./api";

/** Map field id → human label from template schema. */
export function buildSmartFormFieldLabelMap(schema: SmartFormSchemaJson | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!schema?.sections) {
    return map;
  }
  for (const sec of schema.sections) {
    for (const f of sec.fields ?? []) {
      if (f.id && f.label) {
        map.set(f.id, f.label);
      }
    }
  }
  return map;
}

/** Safe plain-text display for an answer value (no HTML). */
export function formatSmartFormAnswerPlain(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}
