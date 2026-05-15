"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, PageHeader } from "../../../../components/ui";
import { SignaturePad } from "../../../../components/signature/signature-pad";
import { useCurrentUser } from "../../../../features/auth";
import {
  clearSmartFormLocalDraft,
  loadSmartFormLocalDraft,
  saveSmartFormLocalDraft,
} from "../../../../features/offline";
import {
  downloadSmartFormSubmissionPdf,
  getSmartFormSubmission,
  getSmartFormTemplate,
  patchSmartFormSubmission,
  submitSmartFormSubmission,
  type SmartFormFieldDef,
  type SmartFormSubmissionWithTemplate,
  type SmartFormTemplate,
} from "../../../../features/smart-forms/api";
import { fetchWorkProgressMeOptions, type WorkProgressLocationOption } from "../../../../features/work-progress/api";
import { useT } from "../../../../lib/i18n";

function FieldEditor({
  field,
  value,
  disabled,
  onChange,
  t,
}: {
  field: SmartFormFieldDef;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
  t: (k: string, f?: string) => string;
}) {
  const id = `field-${field.id}`;
  switch (field.type) {
    case "text":
      return (
        <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
          <span>
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </span>
          <Input
            disabled={disabled}
            id={id}
            onChange={(e) => onChange(e.target.value)}
            value={typeof value === "string" ? value : ""}
          />
        </label>
      );
    case "textarea":
      return (
        <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
          <span>
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </span>
          <textarea
            className="timiq-input min-h-[96px] w-full rounded border border-[var(--color-border)] px-3 py-2 text-sm"
            disabled={disabled}
            id={id}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            value={typeof value === "string" ? value : ""}
          />
        </label>
      );
    case "yes_no":
      return (
        <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
          <span>
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </span>
          <select
            className="h-9 rounded border border-[var(--color-border)] bg-white px-2"
            disabled={disabled}
            id={id}
            onChange={(e) => onChange(e.target.value === "" ? "" : e.target.value)}
            value={typeof value === "string" ? value : ""}
          >
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      );
    case "number":
      return (
        <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
          <span>
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </span>
          <Input
            disabled={disabled}
            id={id}
            inputMode="decimal"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange("");
                return;
              }
              const n = Number(raw);
              onChange(Number.isNaN(n) ? raw : n);
            }}
            value={value === undefined || value === null ? "" : String(value)}
          />
        </label>
      );
    case "date":
      return (
        <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
          <span>
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </span>
          <Input
            disabled={disabled}
            id={id}
            onChange={(e) => onChange(e.target.value)}
            type="date"
            value={typeof value === "string" ? value.slice(0, 10) : ""}
          />
        </label>
      );
    case "select":
      return (
        <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
          <span>
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </span>
          <select
            className="h-9 rounded border border-[var(--color-border)] bg-white px-2"
            disabled={disabled}
            id={id}
            onChange={(e) => onChange(e.target.value)}
            value={typeof value === "string" ? value : ""}
          >
            <option value="">—</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm" htmlFor={id}>
          <input
            checked={Boolean(value)}
            disabled={disabled}
            id={id}
            onChange={(e) => onChange(e.target.checked)}
            type="checkbox"
          />
          <span>
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </span>
        </label>
      );
    default:
      return null;
  }
}

function FieldReadonly({ field, value }: { field: SmartFormFieldDef; value: unknown }) {
  let shown: string;
  if (field.type === "checkbox") {
    shown = value ? "Yes" : "No";
  } else if (value === null || value === undefined || value === "") {
    shown = "—";
  } else {
    shown = String(value);
  }
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
      <div className="font-medium text-[var(--color-text)]">{field.label}</div>
      <div className="mt-1 whitespace-pre-wrap text-[var(--color-text-soft)]">{shown}</div>
    </div>
  );
}

export function FormSubmissionClient({ submissionId }: { submissionId: string }) {
  const t = useT();
  const user = useCurrentUser();
  const [submission, setSubmission] = useState<SmartFormSubmissionWithTemplate | null>(null);
  const [template, setTemplate] = useState<SmartFormTemplate | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [locations, setLocations] = useState<WorkProgressLocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [navigatorOffline, setNavigatorOffline] = useState(false);

  useEffect(() => {
    setMounted(true);
    const sync = () => setNavigatorOffline(typeof navigator !== "undefined" && !navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const offlineBlock = mounted && navigatorOffline;

  const fields = useMemo(() => {
    const schema = template?.schema_json;
    if (!schema?.sections) {
      return [] as SmartFormFieldDef[];
    }
    return schema.sections.flatMap((s) => s.fields);
  }, [template]);

  const load = useCallback(async () => {
    setError("");
    try {
      const sub = await getSmartFormSubmission(submissionId);
      setSubmission(sub);
      setAnswers({ ...(sub.answers_json ?? {}) });
      setLocationId(sub.location_id ?? "");
      setSignatureName(sub.signature_name ?? "");
      setSignaturePng(null);
      const tpl = await getSmartFormTemplate(sub.template_id);
      setTemplate(tpl);
      if (tpl.requires_location) {
        const opt = await fetchWorkProgressMeOptions();
        setLocations(opt.locations);
      }
      if (user?.id && typeof navigator !== "undefined" && !navigator.onLine) {
        const local = await loadSmartFormLocalDraft(user.id, tpl.id);
        if (local && (!sub.answers_json || Object.keys(sub.answers_json).length === 0)) {
          setAnswers(local.answers_json);
          setNotice(t("forms.offline_local_saved"));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [submissionId, t, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const readOnly = submission ? submission.status !== "draft" : true;

  function setField(id: string, v: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  }

  async function saveDraft() {
    if (!submission || !template || readOnly || !user?.id) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (offlineBlock) {
        await saveSmartFormLocalDraft(user.id, template.id, answers);
        setNotice(t("forms.offline_local_saved"));
        return;
      }
      const updated = await patchSmartFormSubmission(submission.id, {
        answers_json: answers,
        location_id: template.requires_location ? locationId || null : null,
        signature_name: template.requires_signature ? signatureName || null : null,
        ...(template.requires_signature && signaturePng ? { signature_image_data: signaturePng } : {}),
      });
      setSubmission(updated);
      await clearSmartFormLocalDraft(user.id, template.id);
      setNotice(t("common.success"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!submission || !template || readOnly || !user?.id) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (offlineBlock) {
        setError(t("offline.banner"));
        return;
      }
      if (template.requires_signature && !submission.has_signature && !signaturePng) {
        setError(t("forms.signature_draw_required", "Draw your signature before submitting."));
        return;
      }
      await patchSmartFormSubmission(submission.id, {
        answers_json: answers,
        location_id: template.requires_location ? locationId || null : null,
        signature_name: template.requires_signature ? signatureName || null : null,
        ...(template.requires_signature && signaturePng ? { signature_image_data: signaturePng } : {}),
      });
      const done = await submitSmartFormSubmission(submission.id);
      setSubmission(done);
      await clearSmartFormLocalDraft(user.id, template.id);
      setNotice(t("common.success"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("forms.validation_errors"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link className="text-sm text-[var(--color-text-muted)] hover:underline" href="/forms">
          ← {t("forms.page_title")}
        </Link>
      </div>
      <PageHeader
        description={submission && submission.status !== "draft" ? t("forms.submitted_readonly") : undefined}
        title={submission?.template_name ?? "…"}
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="text-sm text-green-800">{notice}</p> : null}

      {template?.requires_location && !readOnly ? (
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("forms.location_label")}</span>
          <select
            className="h-9 rounded border border-[var(--color-border)] bg-white px-2"
            onChange={(e) => setLocationId(e.target.value)}
            value={locationId}
          >
            <option value="">{t("forms.select_location")}</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {template?.schema_json.sections.map((sec) => (
        <section
          className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
          key={sec.id}
        >
          <h2 className="border-b border-[var(--color-border)] pb-2 text-base font-semibold text-[var(--color-text)]">{sec.title}</h2>
          <div className="flex flex-col gap-4">
            {sec.fields.map((field) =>
              readOnly ? (
                <FieldReadonly field={field} key={field.id} value={answers[field.id]} />
              ) : (
                <FieldEditor
                  disabled={busy}
                  field={field}
                  key={field.id}
                  onChange={(v) => setField(field.id, v)}
                  t={t}
                  value={answers[field.id]}
                />
              ),
            )}
          </div>
        </section>
      ))}

      {template?.requires_signature ? (
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="border-b border-[var(--color-border)] pb-2 text-base font-semibold text-[var(--color-text)]">
            {t("forms.sign_off_section", "Sign-off")}
          </h2>
          {readOnly ? (
            <p className="text-sm text-[var(--color-text-soft)]">
              {submission?.signature_name ? (
                <>
                  {t("signature.printed_name_label", "Printed name")}:{" "}
                  <span className="font-medium text-[var(--color-text)]">{submission.signature_name}</span>
                </>
              ) : null}
              {submission?.has_signature ? (
                <span className="mt-1 block text-sm text-[var(--color-text)]">
                  {t("forms.signature_on_file", "Drawn signature on file.")}
                </span>
              ) : (
                <span className="mt-1 block text-sm text-amber-800">{t("forms.no_signature_recorded", "No drawn signature recorded.")}</span>
              )}
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span>{t("signature.printed_name_label", "Printed name")}</span>
                <Input onChange={(e) => setSignatureName(e.target.value)} value={signatureName} />
              </label>
              {submission?.has_signature ? (
                <p className="text-sm text-[var(--color-text-soft)]">{t("forms.signature_saved", "Signature saved. Submit to finalise or draw again to replace.")}</p>
              ) : null}
              <SignaturePad disabled={busy || offlineBlock} value={signaturePng} onChange={setSignaturePng} />
            </>
          )}
        </div>
      ) : null}

      {submission?.review_notes ? (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-header)] p-3 text-sm">
          <div className="font-medium">{t("forms.review_notes")}</div>
          <p className="mt-1 whitespace-pre-wrap text-[var(--color-text-soft)]">{submission.review_notes}</p>
        </div>
      ) : null}

      {submission && submission.status !== "draft" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void downloadSmartFormSubmissionPdf(submission.id).catch((e) =>
                setError(e instanceof Error ? e.message : t("forms.error_pdf", "Could not download PDF.")),
              )
            }
          >
            {t("forms.download_pdf", "Download PDF")}
          </Button>
        </div>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void saveDraft()} type="button" variant="secondary">
            {t("forms.save_draft")}
          </Button>
          <Button disabled={busy || offlineBlock} onClick={() => void submit()} type="button">
            {t("forms.submit_form")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
