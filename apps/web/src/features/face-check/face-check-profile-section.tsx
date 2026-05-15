"use client";

import { useRef, useState } from "react";

import { Button } from "../../components/ui";
import {
  enrollMyFaceReference,
  removeMyFaceReference,
  type EmployeeProfile,
} from "../employee-profiles/api";
import { useT } from "../../lib/i18n";
import { FaceCheckBadge } from "./face-check-badge";

function formatWhen(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type Props = {
  profile: EmployeeProfile;
  onProfileUpdated: (profile: EmployeeProfile) => void;
};

export function FaceCheckProfileSection({ profile, onProfileUpdated }: Props) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const configured = Boolean(profile.face_reference_configured);

  async function handleEnroll() {
    setError("");
    setMessage("");
    const file = fileRef.current?.files?.[0];
    if (!consent) {
      setError(t("face_check.consent_required", "You must consent before uploading a reference photo."));
      return;
    }
    if (!file) {
      setError(t("face_check.choose_photo", "Choose a photo to upload."));
      return;
    }

    setBusy(true);
    try {
      const status = await enrollMyFaceReference(true, file);
      onProfileUpdated({
        ...profile,
        face_check_consent_at: status.face_check_consent_at,
        face_reference_enrolled_at: status.face_reference_enrolled_at,
        face_reference_updated_at: status.face_reference_updated_at,
        face_reference_configured: status.face_reference_configured,
      });
      setConsent(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
      setMessage(
        configured
          ? t("face_check.updated", "Reference photo updated.")
          : t("face_check.saved", "Reference photo saved."),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("face_check.save_error", "Could not save reference photo."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setError("");
    setMessage("");
    if (
      !window.confirm(
        t(
          "face_check.remove_confirm",
          "Remove your face reference photo? Clock in/out will not be blocked.",
        ),
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const status = await removeMyFaceReference();
      onProfileUpdated({
        ...profile,
        face_check_consent_at: status.face_check_consent_at,
        face_reference_enrolled_at: status.face_reference_enrolled_at,
        face_reference_updated_at: status.face_reference_updated_at,
        face_reference_configured: status.face_reference_configured,
      });
      setConsent(false);
      setMessage(t("face_check.removed", "Reference photo removed."));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("face_check.remove_error", "Could not remove reference photo."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="scroll-mt-4 border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
      id="face-check"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
          {t("face_check.setup_title", "Face check setup")}
        </p>
        {configured ? (
          <span className="text-xs font-medium text-[var(--color-text)]">
            {t("face_check.reference_enrolled", "Reference enrolled")}
          </span>
        ) : (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-950">
            {t("face_check.important_setup", "Important setup required")}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        {t(
          "face_check.upload_intro",
          "Upload a clear front-facing reference photo so clock selfies can be compared for attendance review. Clocking is not blocked, but shifts will show Not enrolled until this is completed.",
        )}
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        {t(
          "face_check.review_aid",
          "Face check is a review aid. It does not block clocking in this version.",
        )}
      </p>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-[var(--color-text-muted)]">
            {t("face_check.reference_on_file", "Reference on file")}
          </dt>
          <dd className="font-medium text-[var(--color-text)]">
            {configured ? t("face_check.yes", "Yes") : <FaceCheckBadge status="not_enrolled" />}
          </dd>
        </div>
        {configured ? (
          <>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-[var(--color-text-muted)]">{t("face_check.enrolled_at", "Enrolled")}</dt>
              <dd className="font-medium text-[var(--color-text)]">
                {formatWhen(profile.face_reference_enrolled_at)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-[var(--color-text-muted)]">
                {t("face_check.last_updated", "Last updated")}
              </dt>
              <dd className="font-medium text-[var(--color-text)]">
                {formatWhen(profile.face_reference_updated_at)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      <label className="mt-3 flex items-start gap-2 text-sm text-[var(--color-text)]">
        <input
          checked={consent}
          className="mt-1"
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
          type="checkbox"
        />
        <span>
          {t(
            "face_check.consent_label",
            "I consent to TimIQ storing a reference photo for optional face checks on my clock selfies. I can remove it at any time.",
          )}
        </span>
      </label>

      <div className="mt-3">
        <input
          ref={fileRef}
          accept="image/jpeg,image/png,image/webp"
          className="block w-full max-w-md text-sm"
          disabled={busy}
          type="file"
        />
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">JPEG, PNG, or WebP. Max 6 MB.</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void handleEnroll()} type="button">
          {busy
            ? t("face_check.saving", "Saving…")
            : configured
              ? t("face_check.replace_photo", "Replace photo")
              : t("face_check.save_reference", "Save reference photo")}
        </Button>
        {configured ? (
          <Button disabled={busy} onClick={() => void handleRemove()} type="button" variant="secondary">
            {t("face_check.remove_reference", "Remove reference")}
          </Button>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-sm text-[var(--color-danger-700)]">{error}</p> : null}
      {message ? <p className="mt-2 text-sm text-[var(--color-text)]">{message}</p> : null}
    </div>
  );
}