"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  Input,
  PageHeader,
  Sheet,
  SheetBody,
} from "../../components/ui";
import { LogoutButton } from "../../features/auth";
import {
  clearSignature,
  deleteOnboardingDocument,
  deleteOnboardingProfilePhoto,
  fetchOnboardingDocumentBlob,
  fetchOnboardingProfilePhotoBlob,
  fetchOnboardingSignatureBlob,
  getMyOnboarding,
  ONBOARDING_REQUIRED_DOC_SLOTS,
  patchOnboardingDraft,
  postOnboardingProfilePhoto,
  reopenOnboarding,
  setDrawnSignature,
  setTypedSignature,
  submitOnboarding,
  uploadOnboardingDocument,
  type OnboardingSubmissionDetail,
} from "../../features/onboarding/api";

const FORM_KEYS = [
  "first_name",
  "last_name",
  "phone",
  "job_title",
  "start_date",
  "emergency_contact_name",
  "emergency_contact_phone",
  "address_line1",
  "address_line2",
  "city",
  "postcode",
  "country",
  "national_insurance_number",
  "utr",
  "bank_account_holder",
  "bank_sort_code",
  "bank_account_number",
] as const;

function labelsFor(key: string): string {
  const map: Record<string, string> = {
    first_name: "First name",
    last_name: "Last name",
    phone: "Phone",
    job_title: "Job title",
    start_date: "Start date (YYYY-MM-DD)",
    emergency_contact_name: "Emergency contact name",
    emergency_contact_phone: "Emergency contact phone",
    address_line1: "Address line 1",
    address_line2: "Address line 2",
    city: "City",
    postcode: "Postcode",
    country: "Country",
    national_insurance_number: "National Insurance number",
    utr: "UTR (Unique Taxpayer Reference)",
    bank_account_holder: "Bank account holder",
    bank_sort_code: "Sort code",
    bank_account_number: "Account number",
  };
  return map[key] ?? key;
}

function statusMessage(status: string): string {
  if (status === "draft") {
    return "Draft — save your answers, upload required documents, add your signature, then submit.";
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
  const [detail, setDetail] = useState<OnboardingSubmissionDetail | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [typedSig, setTypedSig] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profilePhotoPreviewUrl, setProfilePhotoPreviewUrl] = useState<string | null>(null);
  const profilePhotoPreviewRevokeRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getMyOnboarding();
      setDetail(data);
      const next: Record<string, string> = {};
      for (const key of FORM_KEYS) {
        next[key] = data.form_payload[key] ?? "";
      }
      setForm(next);
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

  function docForSlot(docType: string) {
    return detail?.documents.find((d) => d.doc_type === docType);
  }

  async function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    if (!editable) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await patchOnboardingDraft(form);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDocUpload(docType: string, file: File | null) {
    if (!file || !editable) {
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
    setSaving(true);
    setError("");
    try {
      const data = await submitOnboarding();
      setDetail(data);
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
      const next: Record<string, string> = {};
      for (const key of FORM_KEYS) {
        next[key] = data.form_payload[key] ?? "";
      }
      setForm(next);
      setTypedSig(data.signature_typed_text ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reopen failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title="Starter form"
        description="Complete your onboarding information, upload required documents, and sign."
        action={<LogoutButton />}
      />
      <SheetBody className="space-y-6">
        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}
        {error ? (
          <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-cell)] p-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </p>
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

            {detail.status === "rejected" ? (
              <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleReopen()}>
                Reopen for editing
              </Button>
            ) : null}

            <form className="space-y-4" onSubmit={(e) => void handleSaveDraft(e)}>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Your details
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {FORM_KEYS.map((key) => (
                  <label key={key} className="flex flex-col gap-1 text-sm">
                    <span className="text-[var(--color-text-muted)]">{labelsFor(key)}</span>
                    <Input
                      value={form[key] ?? ""}
                      disabled={!editable}
                      onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              {editable ? (
                <Button type="submit" disabled={saving}>
                  Save draft
                </Button>
              ) : null}
            </form>

            <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Required documents (PDF, JPEG, PNG, or WebP — max 10 MB)
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
                          onClick={() =>
                            void handleDownloadOwnDocument(slotDoc.id, slotDoc.original_filename)
                          }
                        >
                          Download
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Profile photo
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Optional — add a clear head-and-shoulders photo for your TimIQ profile (JPEG, PNG, or WebP, max 5 MB).
                You can upload a file; use your device camera app to capture first if you prefer.
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
                <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleRemoveProfilePhoto()}>
                  Remove profile photo
                </Button>
              ) : null}
            </div>

            <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Signature
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Choose a typed name or upload a drawn signature image (JPEG or PNG, max 2 MB).
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
                  <span className="text-[var(--color-text-muted)]">Typed signature</span>
                  <Input
                    value={typedSig}
                    disabled={!editable}
                    onChange={(e) => setTypedSig(e.target.value)}
                    placeholder="Type your full name"
                  />
                </label>
                <Button type="button" disabled={!editable || saving} onClick={() => void handleTypedSignatureSave()}>
                  Save typed signature
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-[var(--color-text-muted)]">Drawn signature file</span>
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
            </div>

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
