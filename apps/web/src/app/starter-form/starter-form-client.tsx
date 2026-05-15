"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  Input,
  PageHeader,
  Sheet,
  SheetBody,
} from "../../components/ui";
import { useCurrentUser } from "../../features/auth";
import { useT } from "../../lib/i18n";
import {
  clearStarterFormLocalDraft,
  isLikelyNetworkFailure,
  isNavigatorOffline,
  loadStarterFormLocalDraft,
  saveStarterFormLocalDraft,
} from "../../features/offline";
import {
  clearSignature,
  deleteOnboardingDocument,
  deleteOnboardingProfilePhoto,
  fetchOnboardingDocumentBlob,
  fetchOnboardingProfilePhotoBlob,
  fetchOnboardingSignatureBlob,
  getMyOnboarding,
  ONBOARDING_REQUIRED_DOC_SLOTS,
  openOnboardingSubmissionPrintWindow,
  patchOnboardingDraft,
  postOnboardingProfilePhoto,
  reopenOnboarding,
  setDrawnSignature,
  setTypedSignature,
  submitOnboarding,
  uploadOnboardingDocument,
  type OnboardingSubmissionDetail,
} from "../../features/onboarding/api";
import { CONTRACT_TEXT } from "../../features/onboarding/contract-text";
import {
  STARTER_EMPLOYMENT_TYPES,
  STARTER_FORM_DRAFT_KEYS,
  STARTER_POSITION_OPTIONS,
} from "../../features/onboarding/starter-form-constants";

const textareaClass =
  "min-h-[100px] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-[var(--color-text)]";

function initFormFromDetail(data: OnboardingSubmissionDetail): Record<string, string> {
  const next: Record<string, string> = {};
  for (const key of STARTER_FORM_DRAFT_KEYS) {
    next[key] = data.form_payload[key] ?? "";
  }
  if (!next.street_address?.trim()) {
    next.street_address = data.form_payload.address_line1 ?? "";
  }
  return next;
}

function statusMessage(status: string): string {
  if (status === "draft") {
    return "Draft — save your answers, upload required documents, add your drawn signature, then submit.";
  }
  if (status === "submitted") {
    return "Submitted — your employer will review your starter form.";
  }
  if (status === "approved") {
    return "Approved — thank you. Your profile has been updated with the information you provided.";
  }
  if (status === "rejected") {
    return "Rejected — read the reviewer note below. You can reopen the form to make changes and resubmit.";
  }
  return status;
}

export function StarterFormClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const [detail, setDetail] = useState<OnboardingSubmissionDetail | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [typedSig, setTypedSig] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profilePhotoPreviewUrl, setProfilePhotoPreviewUrl] = useState<string | null>(null);
  const profilePhotoPreviewRevokeRef = useRef<string | null>(null);
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [localDeviceMessage, setLocalDeviceMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getMyOnboarding();
      setDetail(data);
      setForm(initFormFromDetail(data));
      setTypedSig(data.signature_typed_text ?? "");
    } catch {
      setError("Could not load starter form.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const row = detail;
    if (!row?.has_profile_photo || !row.user_id) {
      if (profilePhotoPreviewRevokeRef.current) {
        URL.revokeObjectURL(profilePhotoPreviewRevokeRef.current);
        profilePhotoPreviewRevokeRef.current = null;
      }
      setProfilePhotoPreviewUrl(null);
      return;
    }

    const subjectUserId = row.user_id;

    let cancelled = false;
    async function loadPhotoPreview() {
      try {
        const blob = await fetchOnboardingProfilePhotoBlob(subjectUserId);
        const url = URL.createObjectURL(blob);
        if (profilePhotoPreviewRevokeRef.current) {
          URL.revokeObjectURL(profilePhotoPreviewRevokeRef.current);
        }
        profilePhotoPreviewRevokeRef.current = url;
        if (!cancelled) {
          setProfilePhotoPreviewUrl(url);
        }
      } catch {
        if (!cancelled) {
          setProfilePhotoPreviewUrl(null);
        }
      }
    }

    void loadPhotoPreview();
    return () => {
      cancelled = true;
    };
  }, [detail?.has_profile_photo, detail?.user_id, detail?.profile_photo_updated_at]);

  useEffect(() => {
    return () => {
      if (profilePhotoPreviewRevokeRef.current) {
        URL.revokeObjectURL(profilePhotoPreviewRevokeRef.current);
        profilePhotoPreviewRevokeRef.current = null;
      }
    };
  }, []);

  const editable = detail?.status === "draft";

  useEffect(() => {
    let cancelled = false;
    async function checkLocal() {
      if (!detail || detail.status !== "draft") {
        if (!cancelled) {
          setHasLocalDraft(false);
        }
        return;
      }
      try {
        const d = await loadStarterFormLocalDraft(currentUser.id);
        if (cancelled) {
          return;
        }
        if (!d?.fields) {
          setHasLocalDraft(false);
          return;
        }
        const has = Object.values(d.fields).some((v) => typeof v === "string" && v.trim().length > 0);
        setHasLocalDraft(has);
      } catch {
        if (!cancelled) {
          setHasLocalDraft(false);
        }
      }
    }
    void checkLocal();
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, detail?.id, detail?.status]);

  async function handleRestoreLocalDraft() {
    setError("");
    setLocalDeviceMessage("");
    const d = await loadStarterFormLocalDraft(currentUser.id);
    if (!d?.fields) {
      setLocalDeviceMessage("No local draft found.");
      return;
    }
    setForm((prev) => ({ ...prev, ...d.fields }));
    setLocalDeviceMessage("Restored text fields from this device’s saved draft.");
  }

  async function handleClearLocalDraft() {
    setError("");
    setLocalDeviceMessage("");
    await clearStarterFormLocalDraft(currentUser.id);
    setHasLocalDraft(false);
    setLocalDeviceMessage("Cleared text saved only on this device.");
  }

  async function handleSaveLocalDeviceOnly() {
    if (!editable) {
      return;
    }
    setSaving(true);
    setError("");
    setLocalDeviceMessage("");
    try {
      await saveStarterFormLocalDraft(currentUser.id, form);
      setHasLocalDraft(true);
      setLocalDeviceMessage("Saved on this device only. Connect and use Save draft to sync with TimIQ.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save local draft.");
    } finally {
      setSaving(false);
    }
  }

  function docForSlot(docType: string) {
    return detail?.documents.find((d) => d.doc_type === docType);
  }

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    if (!editable) {
      return;
    }
    setSaving(true);
    setError("");
    setLocalDeviceMessage("");
    try {
      const data = await patchOnboardingDraft(form);
      setDetail(data);
      setForm(initFormFromDetail(data));
      await clearStarterFormLocalDraft(currentUser.id);
      setHasLocalDraft(false);
    } catch (err) {
      if (isNavigatorOffline() || isLikelyNetworkFailure(err)) {
        try {
          await saveStarterFormLocalDraft(currentUser.id, form);
          setHasLocalDraft(true);
          setError("");
          setLocalDeviceMessage(
            "Could not reach TimIQ — text fields saved on this device only. Reconnect and tap Save draft to sync to the server.",
          );
        } catch {
          setError(err instanceof Error ? err.message : "Save failed.");
        }
      } else {
        setError(err instanceof Error ? err.message : "Save failed.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDocUpload(docType: string, file: File | null) {
    if (!file || !editable) {
      return;
    }
    if (isNavigatorOffline()) {
      setError("Document uploads require an internet connection.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await uploadOnboardingDocument(docType, file);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDocDelete(documentId: string) {
    if (!editable) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await deleteOnboardingDocument(documentId);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTypedSignatureSave() {
    if (!editable) {
      return;
    }
    if (isNavigatorOffline()) {
      setError("Saving a signature requires an internet connection.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await setTypedSignature(typedSig);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save signature.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDrawnSignature(file: File | null) {
    if (!file || !editable) {
      return;
    }
    if (isNavigatorOffline()) {
      setError("Saving a drawn signature requires an internet connection.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await setDrawnSignature(file);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save signature.");
    } finally {
      setSaving(false);
    }
  }

  async function handleProfilePhotoUpload(file: File | null) {
    if (!file || !editable) {
      return;
    }
    if (isNavigatorOffline()) {
      setError("Profile photo upload requires an internet connection.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await postOnboardingProfilePhoto(file);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload profile photo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveProfilePhoto() {
    if (!editable) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await deleteOnboardingProfilePhoto();
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove profile photo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearSignature() {
    if (!editable) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await clearSignature();
      setDetail(data);
      setTypedSig("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear signature.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!editable) {
      return;
    }
    if (isNavigatorOffline()) {
      setError(
        "Final submission requires an internet connection. While offline, save text on this device or wait until you are online to save the draft to TimIQ and submit.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await patchOnboardingDraft(form);
      const data = await submitOnboarding();
      setDetail(data);
      setForm(initFormFromDetail(data));
      await clearStarterFormLocalDraft(currentUser.id);
      setHasLocalDraft(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadOwnDocument(documentId: string, filename: string) {
    setError("");
    try {
      const blob = await fetchOnboardingDocumentBlob(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "document";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    }
  }

  async function handleViewOwnSignature(submissionId: string) {
    setError("");
    try {
      const blob = await fetchOnboardingSignatureBlob(submissionId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open signature.");
    }
  }

  async function handleReopen() {
    setSaving(true);
    setError("");
    try {
      const data = await reopenOnboarding();
      setDetail(data);
      setForm(initFormFromDetail(data));
      setTypedSig(data.signature_typed_text ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reopen failed.");
    } finally {
      setSaving(false);
    }
  }

  const accountEmail = detail?.account_email ?? currentUser.email;

  return (
    <Sheet>
      <PageHeader
        description={t(
          "starter_form.page_description",
          "Complete your onboarding information, upload required documents, and sign.",
        )}
        title={t("starter_form.page_title", "Starter form")}
      />
      <SheetBody className="space-y-6">
        {loading ? <p className="text-sm text-[var(--color-text-muted)]">{t("common.loading", "Loading…")}</p> : null}
        {error ? (
          <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-cell)] p-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </p>
        ) : null}

        {localDeviceMessage ? (
          <p className="rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2 text-sm text-[var(--color-text)]">
            {localDeviceMessage}
          </p>
        ) : null}

        {editable ? (
          <div className="rounded border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 text-sm text-[var(--color-text-muted)]">
            <p className="font-medium text-[var(--color-text)]">Local device text drafts</p>
            <p className="mt-1">
              When you are offline, text answers can be saved only on this browser. Payroll, tax, bank, National
              Insurance, and similar fields may be included — use only on a device you trust. Required documents,
              profile photo, signatures, and final submit still need a connection.
            </p>
          </div>
        ) : null}

        {editable && hasLocalDraft ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleRestoreLocalDraft()}>
              Restore local text
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleClearLocalDraft()}>
              Clear local text only
            </Button>
          </div>
        ) : null}

        {detail ? (
          <>
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm text-[var(--color-text)]">
              <p className="font-medium capitalize">Status: {detail.status.replace("_", " ")}</p>
              <p className="mt-1 text-[var(--color-text-muted)]">{statusMessage(detail.status)}</p>
              {detail.status === "rejected" && detail.review_note ? (
                <p className="mt-2 text-[var(--color-text)]">
                  <span className="font-medium">Reviewer note: </span>
                  {detail.review_note}
                </p>
              ) : null}
            </div>

            {detail.status !== "draft" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => openOnboardingSubmissionPrintWindow(detail.id)}>
                  Print my submitted form
                </Button>
              </div>
            ) : null}

            {detail.status === "rejected" ? (
              <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleReopen()}>
                Reopen for editing
              </Button>
            ) : null}

            <form className="space-y-8" onSubmit={(e) => void handleSaveDraft(e)}>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                1. Personal
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">First name *</span>
                  <Input
                    value={form.first_name ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("first_name", e.target.value)}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Last name *</span>
                  <Input
                    value={form.last_name ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("last_name", e.target.value)}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Date of birth *</span>
                  <Input
                    type="date"
                    value={form.birth_date ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("birth_date", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Phone *</span>
                  <Input
                    value={form.phone ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("phone", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Account email (read-only)</span>
                  <Input value={accountEmail} disabled readOnly />
                </label>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                2. Address
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Street address *</span>
                  <Input
                    value={form.street_address ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("street_address", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Address line 2</span>
                  <Input
                    value={form.address_line2 ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("address_line2", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">City</span>
                  <Input value={form.city ?? ""} disabled={!editable} onChange={(e) => setField("city", e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Postcode</span>
                  <Input
                    value={form.postcode ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("postcode", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Country</span>
                  <Input
                    value={form.country ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("country", e.target.value)}
                  />
                </label>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                3. Emergency contact
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Emergency contact name *</span>
                  <Input
                    value={form.emergency_contact_name ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("emergency_contact_name", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Emergency contact phone *</span>
                  <Input
                    value={form.emergency_contact_phone ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("emergency_contact_phone", e.target.value)}
                  />
                </label>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">4. Medical</p>
              <fieldset disabled={!editable} className="space-y-2">
                <legend className="text-sm text-[var(--color-text-muted)]">
                  Do you have a medical condition we should be aware of? *
                </legend>
                <div className="flex flex-wrap gap-4 text-sm text-[var(--color-text)]">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="medical_condition"
                      checked={form.medical_condition === "yes"}
                      onChange={() => setField("medical_condition", "yes")}
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="medical_condition"
                      checked={form.medical_condition === "no"}
                      onChange={() => setField("medical_condition", "no")}
                    />
                    No
                  </label>
                </div>
              </fieldset>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--color-text-muted)]">Medical details (optional)</span>
                <textarea
                  className={textareaClass}
                  value={form.medical_details ?? ""}
                  disabled={!editable}
                  onChange={(e) => setField("medical_details", e.target.value)}
                />
              </label>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                5. Position & CSCS
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Site role / position *</span>
                  <select
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2 text-sm text-[var(--color-text)]"
                    value={form.position ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("position", e.target.value)}
                  >
                    <option value="">Select…</option>
                    {STARTER_POSITION_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Additional job title (optional)</span>
                  <Input
                    value={form.job_title ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("job_title", e.target.value)}
                    placeholder="Free text if needed"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">CSCS card number *</span>
                  <Input
                    value={form.cscs_number ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("cscs_number", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">CSCS expiry *</span>
                  <Input
                    type="date"
                    value={form.cscs_expiry ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("cscs_expiry", e.target.value)}
                  />
                </label>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                6. Employment & tax
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Employment / tax status *</span>
                  <select
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2 text-sm text-[var(--color-text)]"
                    value={form.employment_type ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("employment_type", e.target.value)}
                  >
                    <option value="">Select…</option>
                    {STARTER_EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset disabled={!editable} className="md:col-span-2 space-y-2">
                  <legend className="text-sm text-[var(--color-text-muted)]">Right to work in the UK? *</legend>
                  <div className="flex flex-wrap gap-4 text-sm text-[var(--color-text)]">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="right_to_work_uk"
                        checked={form.right_to_work_uk === "yes"}
                        onChange={() => setField("right_to_work_uk", "yes")}
                      />
                      Yes
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="right_to_work_uk"
                        checked={form.right_to_work_uk === "no"}
                        onChange={() => setField("right_to_work_uk", "no")}
                      />
                      No
                    </label>
                  </div>
                </fieldset>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">National Insurance number *</span>
                  <Input
                    value={form.national_insurance_number ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("national_insurance_number", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">UTR *</span>
                  <Input value={form.utr ?? ""} disabled={!editable} onChange={(e) => setField("utr", e.target.value)} />
                </label>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">7. Bank details</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Used for payroll only within TimIQ. Never shown on payslips.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Account holder name *</span>
                  <Input
                    value={form.bank_account_holder ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("bank_account_holder", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Sort code *</span>
                  <Input
                    value={form.bank_sort_code ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("bank_sort_code", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Account number *</span>
                  <Input
                    value={form.bank_account_number ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("bank_account_number", e.target.value)}
                  />
                </label>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                8. Company / contractor
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Company trading name</span>
                  <Input
                    value={form.company_trading_name ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("company_trading_name", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Company registration number</span>
                  <Input
                    value={form.company_registration_number ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("company_registration_number", e.target.value)}
                  />
                </label>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                9. Contract & site
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Start date *</span>
                  <Input
                    type="date"
                    value={form.start_date ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("start_date", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Contract effective date *</span>
                  <Input
                    type="date"
                    value={form.contract_effective_date ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("contract_effective_date", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-[var(--color-text-muted)]">Site address *</span>
                  <textarea
                    className={textareaClass}
                    value={form.site_address ?? ""}
                    disabled={!editable}
                    onChange={(e) => setField("site_address", e.target.value)}
                  />
                </label>
              </div>

              <div className="rounded border border-[var(--color-border)] bg-[var(--color-sheet)] p-3">
                <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">Contract terms</p>
                <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs text-[var(--color-text)]">
                  {CONTRACT_TEXT}
                </div>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">10. Uploads</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                PDF, JPEG, PNG, or WebP — max 10 MB per file. CSCS front and back can be on a single scan in the CSCS
                slot.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {ONBOARDING_REQUIRED_DOC_SLOTS.map(({ docType, label }) => {
                  const slotDoc = docForSlot(docType);
                  return (
                    <div key={docType} className="space-y-2 rounded border border-[var(--color-border)] p-3">
                      <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
                      {slotDoc ? (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {slotDoc.original_filename} ({Math.round(slotDoc.file_size_bytes / 1024)} KB)
                        </p>
                      ) : (
                        <p className="text-xs text-[var(--color-text-muted)]">Not uploaded yet.</p>
                      )}
                      {editable ? (
                        <Input
                          type="file"
                          accept=".pdf,image/jpeg,image/png,image/webp"
                          disabled={saving}
                          onChange={(e) => void handleDocUpload(docType, e.target.files?.[0] ?? null)}
                        />
                      ) : null}
                      {slotDoc && editable ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={saving}
                          onClick={() => void handleDocDelete(slotDoc.id)}
                        >
                          Remove file
                        </Button>
                      ) : null}
                      {slotDoc && !editable ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleDownloadOwnDocument(slotDoc.id, slotDoc.original_filename)}
                        >
                          Download
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                11. Contract acceptance
              </p>
              <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={form.contract_accepted === "true"}
                  disabled={!editable}
                  onChange={(e) => setField("contract_accepted", e.target.checked ? "true" : "")}
                />
                <span>I have read and accept the contract terms above. *</span>
              </label>

              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">12. Signature</p>
              <label className="flex flex-col gap-1 text-sm md:max-w-md">
                <span className="text-[var(--color-text-muted)]">Signatory name (as on contract) *</span>
                <Input
                  value={form.signature_name ?? ""}
                  disabled={!editable}
                  onChange={(e) => setField("signature_name", e.target.value)}
                />
              </label>
              <p className="text-sm text-[var(--color-text-muted)]">
                Final submission requires a drawn signature image (JPEG or PNG, max 2 MB). Typed name above is
                optional and does not replace the drawn image.
              </p>
              {detail.signature_mode ? (
                <p className="text-sm text-[var(--color-text)]">
                  Current: <span className="font-medium">{detail.signature_mode}</span>
                  {detail.signature_mode === "typed" && detail.signature_typed_text
                    ? ` — “${detail.signature_typed_text}”`
                    : null}
                  {detail.signature_mode === "drawn" && detail.has_drawn_signature ? " — image on file" : null}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
                  <span className="text-[var(--color-text-muted)]">Typed name (optional)</span>
                  <Input
                    value={typedSig}
                    disabled={!editable}
                    onChange={(e) => setTypedSig(e.target.value)}
                    placeholder="Optional typed name"
                  />
                </label>
                <Button type="button" disabled={!editable || saving} onClick={() => void handleTypedSignatureSave()}>
                  Save typed name
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-[var(--color-text-muted)]">Drawn signature file *</span>
                <Input
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={!editable || saving}
                  onChange={(e) => void handleDrawnSignature(e.target.files?.[0] ?? null)}
                />
              </div>
              {editable ? (
                <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleClearSignature()}>
                  Clear signature
                </Button>
              ) : null}
              {!editable && detail.signature_mode === "drawn" && detail.has_drawn_signature ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleViewOwnSignature(detail.id)}
                >
                  View drawn signature
                </Button>
              ) : null}

              <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                  Profile photo
                </p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Optional — add a clear head-and-shoulders photo for your TimIQ profile (JPEG, PNG, or WebP, max 5 MB).
                </p>
                {profilePhotoPreviewUrl ? (
                  <div className="flex max-w-xs flex-col gap-2">
                    <img
                      src={profilePhotoPreviewUrl}
                      alt="Profile photo preview"
                      className="aspect-square w-full max-w-[220px] rounded-lg border border-[var(--color-border-dark)] object-cover"
                    />
                  </div>
                ) : detail?.has_profile_photo ? (
                  <p className="text-xs text-[var(--color-text-muted)]">Loading preview…</p>
                ) : null}
                {editable ? (
                  <Input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={saving}
                    onChange={(e) => void handleProfilePhotoUpload(e.target.files?.[0] ?? null)}
                  />
                ) : null}
                {editable && detail?.has_profile_photo ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => void handleRemoveProfilePhoto()}
                  >
                    Remove profile photo
                  </Button>
                ) : null}
              </div>

              {editable ? (
                <div className="flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-4">
                  <Button type="submit" disabled={saving}>
                    Save draft
                  </Button>
                  <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleSaveLocalDeviceOnly()}>
                    Save to this device
                  </Button>
                </div>
              ) : null}
            </form>

            {editable ? (
              <div className="border-t border-[var(--color-border)] pt-4">
                <Button type="button" disabled={saving} onClick={() => void handleSubmit()}>
                  Submit for review
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
