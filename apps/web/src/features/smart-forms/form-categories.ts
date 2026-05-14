/** Backend `category` keys — must match API `ALLOWED_CATEGORIES`. */

export const SMART_FORM_CATEGORY_VALUES = [
  "daily_checklist",
  "hs_inspection",
  "equipment_check",
  "general",
  "scaffold_inspection",
  "ppe_compliance",
  "housekeeping_inspection",
  "fire_point_inspection",
  "delivery_visitor",
  "site_close_checklist",
  "near_miss",
  "defect_snag",
] as const;

export type SmartFormCategoryValue = (typeof SMART_FORM_CATEGORY_VALUES)[number];

export function isSmartFormCategory(value: string): value is SmartFormCategoryValue {
  return (SMART_FORM_CATEGORY_VALUES as readonly string[]).includes(value);
}

/** English fallbacks when i18n key missing. */
const CATEGORY_FALLBACK: Record<string, string> = {
  daily_checklist: "Daily checklist",
  hs_inspection: "Health & safety inspection",
  equipment_check: "Equipment check",
  general: "General",
  scaffold_inspection: "Scaffold / access inspection",
  ppe_compliance: "PPE compliance",
  housekeeping_inspection: "Housekeeping inspection",
  fire_point_inspection: "Fire point inspection",
  delivery_visitor: "Delivery / visitor",
  site_close_checklist: "Site close checklist",
  near_miss: "Near miss",
  defect_snag: "Defect / snag",
};

export function smartFormCategoryLabel(category: string, t: (key: string, fallback: string) => string): string {
  const key = `forms.category.${category}`;
  return t(key, CATEGORY_FALLBACK[category] ?? category.replace(/_/g, " "));
}
