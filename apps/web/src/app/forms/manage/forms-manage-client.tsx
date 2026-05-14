"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui";
import { isAdministrator, isAdmin, useCurrentUser } from "../../../features/auth";
import { listCompanies, type Company } from "../../../features/companies/api";
import {
  archiveSmartFormTemplate,
  createSmartFormTemplate,
  deleteSmartFormTemplate,
  EXAMPLE_EQUIPMENT_PRESTART_SCHEMA,
  EXAMPLE_HS_INSPECTION_SCHEMA,
  EXAMPLE_SMART_FORM_SCHEMA,
  getSmartFormTemplate,
  listSmartFormTemplates,
  patchSmartFormTemplate,
  type SmartFormFieldDef,
  type SmartFormSchemaJson,
  type SmartFormSectionDef,
  type SmartFormTemplate,
  type SmartFormTemplateCreateBody,
} from "../../../features/smart-forms/api";
import {
  SMART_FORM_CATEGORY_VALUES,
  smartFormCategoryLabel,
  type SmartFormCategoryValue,
} from "../../../features/smart-forms/form-categories";
import { useI18n } from "../../../lib/i18n";

const FIELD_TYPES = ["text", "textarea", "yes_no", "number", "date", "select", "checkbox"] as const;

type ProfessionalFormPreset = {
  id: string;
  title: string;
  category: SmartFormCategoryValue;
  schema: SmartFormSchemaJson;
  requires_location?: boolean;
  requires_signature?: boolean;
  allow_photos?: boolean;
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function cloneSchema(s: SmartFormSchemaJson): SmartFormSchemaJson {
  return JSON.parse(JSON.stringify(s)) as SmartFormSchemaJson;
}

function professionalPresets(t: (k: string, f: string) => string): ProfessionalFormPreset[] {
  const yesNo = (id: string, label: string, required = true): SmartFormFieldDef => ({
    id,
    label,
    type: "yes_no",
    required,
  });
  const ta = (id: string, label: string, required = false): SmartFormFieldDef => ({
    id,
    label,
    type: "textarea",
    required,
  });
  return [
    {
      id: "daily_site",
      title: t("forms.preset_daily_site", "Daily site checklist"),
      category: "daily_checklist",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_section_site", "Site condition"),
            fields: [
              yesNo("access_clear", t("forms.preset_q_access_clear", "Access routes clear")),
              yesNo("housekeeping_ok", t("forms.preset_q_housekeeping", "Housekeeping acceptable")),
              ta("site_notes", t("forms.preset_q_site_notes", "Notes"), false),
            ],
          },
        ],
      },
      requires_location: true,
      requires_signature: true,
    },
    {
      id: "equipment_prestart",
      title: t("forms.preset_equipment_prestart", "Equipment pre-start"),
      category: "equipment_check",
      schema: cloneSchema(EXAMPLE_EQUIPMENT_PRESTART_SCHEMA),
      requires_signature: true,
    },
    {
      id: "hs_inspection",
      title: t("forms.preset_hs_inspection", "H&S inspection"),
      category: "hs_inspection",
      schema: cloneSchema(EXAMPLE_HS_INSPECTION_SCHEMA),
      requires_location: true,
      requires_signature: true,
    },
    {
      id: "scaffold",
      title: t("forms.preset_scaffold", "Scaffold / access inspection"),
      category: "general",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_section_scaffold", "Access / scaffold"),
            fields: [
              yesNo("guardrails", t("forms.preset_q_guardrails", "Guardrails and toe boards in place")),
              yesNo("ladder_ok", t("forms.preset_q_ladder", "Ladders / towers inspected")),
              ta("defects", t("forms.preset_q_defects", "Defects / actions"), false),
            ],
          },
        ],
      },
      requires_location: true,
      requires_signature: true,
    },
    {
      id: "ppe",
      title: t("forms.preset_ppe", "PPE compliance"),
      category: "hs_inspection",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_section_ppe", "PPE"),
            fields: [
              yesNo("head_foot", t("forms.preset_q_ppe_hf", "Head / foot / eye protection correct")),
              yesNo("hi_vis", t("forms.preset_q_hi_vis", "Hi-vis worn as required")),
              ta("ppe_notes", t("forms.preset_q_ppe_notes", "Notes"), false),
            ],
          },
        ],
      },
      requires_signature: true,
    },
    {
      id: "housekeeping",
      title: t("forms.preset_housekeeping", "Housekeeping inspection"),
      category: "daily_checklist",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_section_housekeeping", "Housekeeping"),
            fields: [
              yesNo("waste_contained", t("forms.preset_q_waste", "Waste contained and segregated")),
              yesNo("tripping", t("forms.preset_q_trips", "Walkways free of trip hazards")),
              ta("hk_notes", t("forms.preset_q_hk_notes", "Notes"), false),
            ],
          },
        ],
      },
      requires_location: true,
    },
    {
      id: "fire_point",
      title: t("forms.preset_fire_point", "Fire point inspection"),
      category: "hs_inspection",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_section_fire", "Fire safety"),
            fields: [
              yesNo("extinguisher", t("forms.preset_q_extinguisher", "Extinguishers / blankets available and signed")),
              yesNo("exits_clear", t("forms.preset_q_exits", "Exits and fire points clear")),
              ta("fire_notes", t("forms.preset_q_fire_notes", "Notes"), false),
            ],
          },
        ],
      },
      requires_location: true,
      requires_signature: true,
    },
    {
      id: "visitor_delivery",
      title: t("forms.preset_visitor_delivery", "Visitor / delivery checklist"),
      category: "general",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_section_visitor", "Visitor / delivery"),
            fields: [
              {
                id: newId("field"),
                label: t("forms.preset_q_visitor_name", "Visitor / company name"),
                type: "text",
                required: true,
              },
              yesNo("induction_done", t("forms.preset_q_induction", "Site induction / briefing completed")),
              ta("vehicle_reg", t("forms.preset_q_vehicle", "Vehicle registration / notes"), false),
            ],
          },
        ],
      },
      requires_location: true,
    },
    {
      id: "site_close",
      title: t("forms.preset_site_close", "End-of-day site close"),
      category: "daily_checklist",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_section_close", "Close-down"),
            fields: [
              yesNo("plant_off", t("forms.preset_q_plant_off", "Plant isolated and secure")),
              yesNo("perimeter", t("forms.preset_q_perimeter", "Perimeter secure")),
              ta("close_notes", t("forms.preset_q_close_notes", "Handover notes"), false),
            ],
          },
        ],
      },
      requires_location: true,
      requires_signature: true,
    },
    {
      id: "near_miss",
      title: t("forms.preset_near_miss", "Near miss report"),
      category: "near_miss",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_near_miss_section", "What happened"),
            fields: [
              ta("what_happened", t("forms.preset_nm_what", "Describe what nearly happened"), true),
              ta("where_when", t("forms.preset_nm_where", "Where and when"), true),
              yesNo("made_safe", t("forms.preset_nm_safe", "Made safe immediately?"), true),
            ],
          },
        ],
      },
      requires_location: true,
      requires_signature: true,
      allow_photos: true,
    },
    {
      id: "defect_snag",
      title: t("forms.preset_defect_snag", "Defect / snag report"),
      category: "defect_snag",
      schema: {
        sections: [
          {
            id: newId("section"),
            title: t("forms.preset_defect_section", "Defect"),
            fields: [
              {
                id: newId("field"),
                label: t("forms.preset_defect_title", "Short title"),
                type: "text",
                required: true,
              },
              ta("defect_detail", t("forms.preset_defect_detail", "Description and location"), true),
              yesNo("safety_impact", t("forms.preset_defect_safety", "Could affect safety if not corrected?"), true),
            ],
          },
        ],
      },
      requires_location: true,
      allow_photos: true,
    },
  ];
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-900 border-emerald-200";
    case "draft":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "archived":
      return "bg-[var(--color-header)] text-[var(--color-text-soft)] border-[var(--color-border)]";
    default:
      return "bg-[var(--color-header)] text-[var(--color-text)] border-[var(--color-border)]";
  }
}

export function FormsManageClient() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const [items, setItems] = useState<SmartFormTemplate[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Daily site checklist");
  const [category, setCategory] = useState<string>("daily_checklist");
  const [description, setDescription] = useState("");
  const [requiresLocation, setRequiresLocation] = useState(false);
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [allowPhotos, setAllowPhotos] = useState(false);
  const [companyId, setCompanyId] = useState("");

  const [schemaJson, setSchemaJson] = useState<SmartFormSchemaJson>(() => cloneSchema(EXAMPLE_SMART_FORM_SCHEMA));

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedText, setAdvancedText] = useState("");
  const [advancedError, setAdvancedError] = useState("");
  const [workspace, setWorkspace] = useState<"presets" | "builder" | "templates">("presets");
  const [showTechnicalIds, setShowTechnicalIds] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const rows = await listSmartFormTemplates();
      setItems(rows);
      if (user && isAdministrator(user)) {
        const comps = await listCompanies();
        setCompanies(comps);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [t, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdvanced = () => {
    setAdvancedText(JSON.stringify(schemaJson, null, 2));
    setAdvancedError("");
    setAdvancedOpen(true);
  };

  const applyAdvancedJson = () => {
    setAdvancedError("");
    try {
      const parsed = JSON.parse(advancedText) as SmartFormSchemaJson;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sections)) {
        setAdvancedError(t("forms.advanced_json_invalid", "JSON must be an object with a sections array."));
        return;
      }
      setSchemaJson(parsed);
      setAdvancedError("");
    } catch {
      setAdvancedError(t("forms.advanced_json_parse_error", "Could not parse JSON."));
    }
  };

  const loadExampleSchema = (preset: "daily" | "equipment" | "hs") => {
    const next =
      preset === "daily"
        ? cloneSchema(EXAMPLE_SMART_FORM_SCHEMA)
        : preset === "equipment"
          ? cloneSchema(EXAMPLE_EQUIPMENT_PRESTART_SCHEMA)
          : cloneSchema(EXAMPLE_HS_INSPECTION_SCHEMA);
    setSchemaJson(next);
    if (advancedOpen) {
      setAdvancedText(JSON.stringify(next, null, 2));
    }
    setAdvancedError("");
  };

  const resetFormForCreate = () => {
    setEditingId(null);
    setName(t("forms.default_new_name", "New checklist"));
    setCategory("daily_checklist");
    setDescription("");
    setRequiresLocation(false);
    setRequiresSignature(false);
    setAllowPhotos(false);
    setSchemaJson(cloneSchema(EXAMPLE_SMART_FORM_SCHEMA));
    setAdvancedOpen(false);
    setAdvancedText("");
    setAdvancedError("");
  };

  const beginEdit = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const tpl = await getSmartFormTemplate(id);
      setEditingId(tpl.id);
      setName(tpl.name);
      setCategory(tpl.category);
      setDescription(tpl.description ?? "");
      setRequiresLocation(tpl.requires_location);
      setRequiresSignature(tpl.requires_signature);
      setAllowPhotos(tpl.allow_photos);
      setSchemaJson(cloneSchema(tpl.schema_json));
      setAdvancedOpen(false);
      setAdvancedText("");
      setAdvancedError("");
      setWorkspace("builder");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const updateSection = (index: number, patch: Partial<SmartFormSectionDef>) => {
    setSchemaJson((prev) => {
      const sections = [...prev.sections];
      sections[index] = { ...sections[index], ...patch };
      return { sections };
    });
  };

  const addSection = () => {
    setSchemaJson((prev) => ({
      sections: [
        ...prev.sections,
        {
          id: newId("section"),
          title: t("forms.builder_new_section_title", "New section"),
          fields: [
            {
              id: newId("field"),
              label: t("forms.builder_new_field_label", "New field"),
              type: "text",
              required: false,
            },
          ],
        },
      ],
    }));
  };

  const removeSection = (index: number) => {
    setSchemaJson((prev) => {
      if (prev.sections.length <= 1) {
        return prev;
      }
      const sections = prev.sections.filter((_, i) => i !== index);
      return { sections };
    });
  };

  const updateField = (si: number, fi: number, patch: Partial<SmartFormFieldDef>) => {
    setSchemaJson((prev) => {
      const sections = prev.sections.map((s, i) => {
        if (i !== si) {
          return s;
        }
        const fields = s.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f));
        return { ...s, fields };
      });
      return { sections };
    });
  };

  const addField = (si: number) => {
    setSchemaJson((prev) => {
      const sections = prev.sections.map((s, i) => {
        if (i !== si) {
          return s;
        }
        return {
          ...s,
          fields: [
            ...s.fields,
            {
              id: newId("field"),
              label: t("forms.builder_new_field_label", "New field"),
              type: "text",
              required: false,
            },
          ],
        };
      });
      return { sections };
    });
  };

  const removeField = (si: number, fi: number) => {
    setSchemaJson((prev) => {
      const sections = prev.sections.map((s, i) => {
        if (i !== si) {
          return s;
        }
        if (s.fields.length <= 1) {
          return s;
        }
        return { ...s, fields: s.fields.filter((_, j) => j !== fi) };
      });
      return { sections };
    });
  };

  const setSelectOptionsFromText = (si: number, fi: number, text: string) => {
    const options = text
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    updateField(si, fi, { options: options.length ? options : undefined });
  };

  const selectOptionsText = (field: SmartFormFieldDef): string => (field.options ?? []).join("\n");

  async function saveTemplate() {
    setBusy(true);
    setError("");
    try {
      const body: SmartFormTemplateCreateBody = {
        name: name.trim(),
        category,
        description: description.trim() || null,
        schema_json: schemaJson,
        status: "draft",
        requires_location: requiresLocation,
        requires_signature: requiresSignature,
        allow_photos: allowPhotos,
      };
      if (user && isAdministrator(user)) {
        body.company_id = companyId.trim() ? companyId.trim() : null;
      }
      if (editingId) {
        await patchSmartFormTemplate(editingId, {
          name: body.name,
          description: body.description,
          category: body.category,
          schema_json: body.schema_json,
          requires_location: body.requires_location,
          requires_signature: body.requires_signature,
          allow_photos: body.allow_photos,
        });
      } else {
        await createSmartFormTemplate(body);
      }
      resetFormForCreate();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    setBusy(true);
    setError("");
    try {
      await patchSmartFormTemplate(id, { status: "active" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  function canManageRow(row: SmartFormTemplate): boolean {
    if (!user) {
      return false;
    }
    if (isAdministrator(user)) {
      return true;
    }
    if (isAdmin(user) && user.company_id && row.company_id === user.company_id) {
      return true;
    }
    return false;
  }

  async function archive(id: string) {
    setBusy(true);
    setError("");
    try {
      await archiveSmartFormTemplate(id);
      if (editingId === id) {
        resetFormForCreate();
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const companyLabel = useMemo(
    () => (cid: string | null) => {
      if (!cid) {
        return t("forms.company_global", "All companies");
      }
      return companies.find((c) => c.id === cid)?.name ?? cid;
    },
    [companies, t],
  );

  const presetList = useMemo(() => professionalPresets(t), [t]);

  const applyProfessionalPreset = (p: ProfessionalFormPreset) => {
    setEditingId(null);
    setName(p.title);
    setCategory(p.category);
    setSchemaJson(cloneSchema(p.schema));
    setRequiresLocation(p.requires_location ?? false);
    setRequiresSignature(p.requires_signature ?? false);
    setAllowPhotos(p.allow_photos ?? false);
    setAdvancedOpen(false);
    setAdvancedText("");
    setAdvancedError("");
    setWorkspace("builder");
  };

  async function hardDeleteTemplate(id: string) {
    if (!window.confirm(t("forms.delete_template_confirm", "Delete permanently? This cannot be undone."))) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deleteSmartFormTemplate(id);
      if (editingId === id) {
        resetFormForCreate();
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("common.error");
      if (msg.toLowerCase().includes("submission") || msg.toLowerCase().includes("active") || msg.toLowerCase().includes("draft")) {
        setError(t("forms.delete_template_blocked", "Cannot delete: use Archive if the template is active or has submissions."));
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap gap-2">
        <Link className="text-sm text-[var(--color-text-muted)] hover:underline" href="/forms">
          ← {t("forms.page_title")}
        </Link>
      </div>
      <PageHeader description={t("forms.manage_intro")} title={t("forms.manage_title")} />
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3">
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            workspace === "presets" ? "bg-[var(--color-text)] text-white" : "bg-[var(--color-cell)] text-[var(--color-text)]"
          }`}
          onClick={() => setWorkspace("presets")}
        >
          {t("forms.tab_professional_templates", "Professional templates")}
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            workspace === "builder" ? "bg-[var(--color-text)] text-white" : "bg-[var(--color-cell)] text-[var(--color-text)]"
          }`}
          onClick={() => setWorkspace("builder")}
        >
          {t("forms.tab_builder", "Builder")}
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            workspace === "templates" ? "bg-[var(--color-text)] text-white" : "bg-[var(--color-cell)] text-[var(--color-text)]"
          }`}
          onClick={() => setWorkspace("templates")}
        >
          {t("forms.tab_saved_templates", "Saved templates")}
        </button>
        <Link
          className="ml-auto inline-flex h-9 items-center rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
          href="/forms/review"
        >
          {t("forms.review_title")}
        </Link>
      </div>

      {workspace === "presets" ? (
        <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-[var(--color-text)]">
            {t("forms.presets_heading", "Start from a professional template")}
          </h2>
          <p className="mb-4 text-sm text-[var(--color-text-soft)]">
            {t("forms.presets_intro", "Pick a checklist — the builder opens with questions ready to edit.")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {presetList.map((p) => (
              <button
                key={p.id}
                type="button"
                className="rounded-lg border border-[var(--color-border)] bg-white p-4 text-left shadow-sm transition hover:border-[var(--color-primary)]"
                onClick={() => applyProfessionalPreset(p)}
              >
                <p className="font-semibold text-[var(--color-text)]">{p.title}</p>
                <p className="mt-2 text-xs text-[var(--color-text-soft)]">{smartFormCategoryLabel(p.category, t)}</p>
                <p className="mt-3 text-xs font-medium text-[var(--color-link)]">{t("forms.preset_use", "Use template →")}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {workspace === "builder" ? (
        <>
          {user && isAdministrator(user) ? (
            <label className="flex max-w-md flex-col gap-1 text-sm text-[var(--color-text)]">
              <span className="font-medium">{t("forms.company_scope", "Company")}</span>
              <select
                className="timiq-input h-10 w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setCompanyId(e.target.value)}
                value={companyId}
              >
                <option value="">{t("forms.company_global_option", "Global (all companies)")}</option>
                {companies
                  .filter((c) => c.is_active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}

          <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {editingId ? t("forms.edit_template", "Edit template") : t("forms.create_template", "Create template")}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <input checked={showTechnicalIds} onChange={(e) => setShowTechnicalIds(e.target.checked)} type="checkbox" />
              {t("forms.show_technical_ids", "Technical IDs")}
            </label>
            {editingId ? (
              <Button onClick={() => resetFormForCreate()} type="button" variant="ghost">
                {t("forms.cancel_edit", "Cancel edit")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
            <span className="font-medium">{t("forms.template_name")}</span>
            <Input onChange={(e) => setName(e.target.value)} value={name} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
            <span className="font-medium">{t("forms.category")}</span>
            <select
              className="timiq-input h-10 w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 text-sm"
              onChange={(e) => setCategory(e.target.value)}
              value={category}
            >
              {SMART_FORM_CATEGORY_VALUES.map((v) => (
                <option key={v} value={v}>
                  {smartFormCategoryLabel(v, t)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 flex flex-col gap-1 text-sm text-[var(--color-text)]">
          <span className="font-medium">{t("forms.description", "Description")}</span>
          <textarea
            className="timiq-input min-h-[72px] w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-2 text-sm"
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("forms.description_placeholder", "Optional — shown to employees before they start.")}
            value={description}
          />
        </label>

        <div className="mt-4 flex flex-col gap-3 rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
            {t("forms.template_options", "Template options")}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input checked={requiresLocation} onChange={(e) => setRequiresLocation(e.target.checked)} type="checkbox" />
            {t("forms.requires_location")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input checked={requiresSignature} onChange={(e) => setRequiresSignature(e.target.checked)} type="checkbox" />
            {t("forms.requires_signature")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input checked={allowPhotos} onChange={(e) => setAllowPhotos(e.target.checked)} type="checkbox" />
            {t("forms.allow_photos")}
          </label>
          {allowPhotos ? (
            <p className="text-xs text-[var(--color-text-muted)]">{t("forms.photos_coming_later", "Photo attachments coming later.")}</p>
          ) : null}
        </div>

        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">{t("forms.builder_title", "Form fields")}</h3>
            <Button onClick={() => addSection()} size="sm" type="button" variant="secondary">
              {t("forms.builder_add_section", "Add section")}
            </Button>
          </div>

          {schemaJson.sections.map((section, si) => (
            <div
              className="rounded border border-[var(--color-border)] bg-white p-3 shadow-sm"
              key={section.id}
            >
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 text-sm">
                  <span className="font-medium text-[var(--color-text)]">{t("forms.builder_section_title", "Section title")}</span>
                  <Input
                    className="mt-1"
                    onChange={(e) => updateSection(si, { title: e.target.value })}
                    value={section.title}
                  />
                </label>
                {showTechnicalIds ? <span className="text-xs text-[var(--color-text-muted)]">id: {section.id}</span> : null}
                <Button
                  disabled={schemaJson.sections.length <= 1}
                  onClick={() => removeSection(si)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("forms.builder_remove_section", "Remove section")}
                </Button>
              </div>

              <div className="space-y-3">
                {section.fields.map((field, fi) => (
                  <div
                    className="rounded border border-[var(--color-border)] bg-[var(--color-header)] p-3"
                    key={field.id}
                  >
                    {showTechnicalIds ? <div className="mb-2 text-xs text-[var(--color-text-muted)]">id: {field.id}</div> : null}
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="font-medium">{t("forms.builder_question_label", "Question")}</span>
                        <Input
                          className="mt-1"
                          onChange={(e) => updateField(si, fi, { label: e.target.value })}
                          value={field.label}
                        />
                      </label>
                      <label className="text-sm">
                        <span className="font-medium">{t("forms.builder_field_type", "Answer type")}</span>
                        <select
                          className="timiq-input mt-1 h-10 w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 text-sm"
                          onChange={(e) => {
                            const nextType = e.target.value;
                            const patch: Partial<SmartFormFieldDef> = { type: nextType };
                            if (nextType !== "select") {
                              patch.options = undefined;
                            } else if (!field.options?.length) {
                              patch.options = ["Option 1", "Option 2"];
                            }
                            updateField(si, fi, patch);
                          }}
                          value={field.type}
                        >
                          {FIELD_TYPES.map((ft) => (
                            <option key={ft} value={ft}>
                              {ft}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {field.type === "select" ? (
                      <label className="mt-2 block text-sm">
                        <span className="font-medium">{t("forms.builder_select_options", "Options (one per line)")}</span>
                        <textarea
                          className="timiq-input mt-1 min-h-[72px] w-full font-mono text-xs"
                          onChange={(e) => setSelectOptionsFromText(si, fi, e.target.value)}
                          value={selectOptionsText(field)}
                        />
                      </label>
                    ) : null}
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        checked={field.required}
                        onChange={(e) => updateField(si, fi, { required: e.target.checked })}
                        type="checkbox"
                      />
                      {t("forms.builder_required", "Required")}
                    </label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button disabled={section.fields.length <= 1} onClick={() => removeField(si, fi)} size="sm" type="button" variant="ghost">
                        {t("forms.builder_remove_field", "Remove field")}
                      </Button>
                    </div>
                  </div>
                ))}
                <Button onClick={() => addField(si)} size="sm" type="button" variant="secondary">
                  {t("forms.builder_add_field", "Add field")}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded border border-[var(--color-border)] bg-[var(--color-cell)]">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-header)]"
            onClick={() => {
              if (!advancedOpen) {
                openAdvanced();
              } else {
                setAdvancedOpen(false);
              }
            }}
            type="button"
          >
            <span>{t("forms.advanced_structure", "Advanced structure")}</span>
            <span className="text-[var(--color-text-muted)]">{advancedOpen ? "▾" : "▸"}</span>
          </button>
          {advancedOpen ? (
            <div className="space-y-2 border-t border-[var(--color-border)] p-3">
              <p className="text-xs text-[var(--color-text-muted)]">{t("forms.advanced_schema_hint", "For power users. Invalid JSON cannot be saved.")}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => loadExampleSchema("daily")} size="sm" type="button" variant="secondary">
                  {t("forms.example_daily", "Daily site checklist")}
                </Button>
                <Button onClick={() => loadExampleSchema("equipment")} size="sm" type="button" variant="secondary">
                  {t("forms.example_equipment", "Equipment pre-start")}
                </Button>
                <Button onClick={() => loadExampleSchema("hs")} size="sm" type="button" variant="secondary">
                  {t("forms.example_hs", "H&S inspection")}
                </Button>
                <Button
                  onClick={() => {
                    setAdvancedText(JSON.stringify(schemaJson, null, 2));
                    setAdvancedError("");
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("forms.refresh_advanced_json", "Refresh JSON from form")}
                </Button>
              </div>
              <textarea
                className="timiq-input min-h-[200px] w-full font-mono text-xs"
                onChange={(e) => setAdvancedText(e.target.value)}
                spellCheck={false}
                value={advancedText}
              />
              {advancedError ? <p className="text-sm text-red-700">{advancedError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => applyAdvancedJson()} size="sm" type="button" variant="secondary">
                  {t("forms.apply_advanced_json", "Apply JSON to form")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy || !name.trim()} onClick={() => void saveTemplate()} type="button">
            {editingId ? t("forms.save_template_changes", "Save changes") : t("forms.create_template")}
          </Button>
        </div>
      </section>
        </>
      ) : null}

      {workspace === "templates" ? (
      <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t("forms.templates_list_title", "Templates")}</h2>
          <Button disabled={busy} onClick={() => void load()} type="button" variant="ghost">
            {t("common.refresh")}
          </Button>
        </div>
        <div className="overflow-x-auto rounded border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("forms.template_name")}</TableHead>
                {user && isAdministrator(user) ? <TableHead>{t("forms.company_scope", "Company")}</TableHead> : null}
                <TableHead>{t("forms.category")}</TableHead>
                <TableHead>{t("forms.status")}</TableHead>
                <TableHead>{t("forms.template_indicators", "Requirements")}</TableHead>
                <TableHead className="text-right">{t("forms.actions", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={user && isAdministrator(user) ? 6 : 5}>
                    <div className="py-8 text-center">
                      <p className="text-sm font-medium text-[var(--color-text)]">{t("forms.templates_empty_title", "No templates yet")}</p>
                      <p className="mt-1 text-sm text-[var(--color-text-soft)]">
                        {t("forms.templates_empty_body", "Create your first checklist above. Activate it when you are ready for employees.")}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-[var(--color-text)]">{row.name}</TableCell>
                    {user && isAdministrator(user) ? (
                      <TableCell className="text-sm text-[var(--color-text-soft)]">{companyLabel(row.company_id)}</TableCell>
                    ) : null}
                    <TableCell>
                      <span className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-header)] px-2 py-0.5 text-xs font-medium text-[var(--color-text)]">
                        {smartFormCategoryLabel(row.category, t)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(row.status)}`}
                      >
                        {row.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.requires_location ? (
                          <span className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-soft)]">
                            {t("forms.badge_loc", "Loc")}
                          </span>
                        ) : null}
                        {row.requires_signature ? (
                          <span className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-soft)]">
                            {t("forms.badge_sig", "Sig")}
                          </span>
                        ) : null}
                        {row.allow_photos ? (
                          <span className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-soft)]">
                            {t("forms.badge_photos", "Photos")}
                          </span>
                        ) : null}
                        {!row.requires_location && !row.requires_signature && !row.allow_photos ? (
                          <span className="text-xs text-[var(--color-text-muted)]">—</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      {canManageRow(row) ? (
                        <Button disabled={busy} onClick={() => void beginEdit(row.id)} size="sm" type="button" variant="secondary">
                          {t("common.edit", "Edit")}
                        </Button>
                      ) : null}
                      {canManageRow(row) && row.status !== "active" ? (
                        <Button disabled={busy} onClick={() => void activate(row.id)} size="sm" type="button" variant="secondary">
                          {t("forms.activate")}
                        </Button>
                      ) : null}
                      {canManageRow(row) && row.status !== "archived" ? (
                        <Button disabled={busy} onClick={() => void archive(row.id)} size="sm" type="button" variant="danger">
                          {t("forms.archive")}
                        </Button>
                      ) : null}
                      {canManageRow(row) && row.status === "draft" ? (
                        <Button
                          disabled={busy}
                          onClick={() => void hardDeleteTemplate(row.id)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {t("forms.delete", "Delete")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
      ) : null}
    </div>
  );
}
