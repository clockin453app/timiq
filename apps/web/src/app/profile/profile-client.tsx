"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  getMyEmployeeProfile,
  updateMyEmployeeProfile,
  type EmployeeProfile,
} from "../../features/employee-profiles/api";
import {
  formatSystemRole,
  isEmployee,
  sendVerificationEmail,
  useCurrentUser,
  useRefreshAuthUser,
} from "../../features/auth";
import {
  fetchOnboardingDocumentBlob,
  fetchOnboardingProfilePhotoBlob,
  fetchOnboardingSignatureBlob,
  getMyOnboarding,
  ONBOARDING_REQUIRED_DOC_SLOTS,
  type OnboardingSubmissionDetail,
} from "../../features/onboarding/api";
import {
  maskOnboardingFieldValue,
  ONBOARDING_SUMMARY_FIELD_ORDER,
  onboardingSummaryFieldLabel,
  SENSITIVE_ONBOARDING_FIELD_KEYS,
} from "../../features/onboarding/profile-summary";
import { useT } from "../../lib/i18n";

export function ProfileClient() {
  const user = useCurrentUser();
  const t = useT();
  const refreshAuthUser = useRefreshAuthUser();

  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [verifySending, setVerifySending] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [verifyDevLink, setVerifyDevLink] = useState<string | null>(null);
  const [authRefreshBusy, setAuthRefreshBusy] = useState(false);

  const [onboarding, setOnboarding] = useState<OnboardingSubmissionDetail | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState("");
  const [showSensitiveOnboarding, setShowSensitiveOnboarding] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const profileAvatarRevokeRef = useRef<string | null>(null);

  async function loadProfile() {
    setIsLoadingProfile(true);
    setLoadError("");
    try {
      const data = await getMyEmployeeProfile();
      setProfile(data);
      setFirstName(data.first_name ?? "");
      setLastName(data.last_name ?? "");
      setPhone(data.phone ?? "");
      setJobTitle(data.job_title ?? "");
      setEmergencyContactName(data.emergency_contact_name ?? "");
      setEmergencyContactPhone(data.emergency_contact_phone ?? "");
    } catch {
      setProfile(null);
      setLoadError("Could not load profile details.");
    } finally {
      setIsLoadingProfile(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    if (!isEmployee(user)) {
      setOnboarding(null);
      setOnboardingError("");
      setOnboardingLoading(false);
      return;
    }

    let cancelled = false;
    async function loadOnboarding() {
      setOnboardingLoading(true);
      setOnboardingError("");
      try {
        const data = await getMyOnboarding();
        if (!cancelled) {
          setOnboarding(data);
        }
      } catch {
        if (!cancelled) {
          setOnboarding(null);
          setOnboardingError("Could not load starter form summary.");
        }
      } finally {
        if (!cancelled) {
          setOnboardingLoading(false);
        }
      }
    }

    void loadOnboarding();
    return () => {
      cancelled = true;
    };
  }, [user.id, user.system_role]);

  useEffect(() => {
    if (!isEmployee(user) || !onboarding?.has_profile_photo) {
      if (profileAvatarRevokeRef.current) {
        URL.revokeObjectURL(profileAvatarRevokeRef.current);
        profileAvatarRevokeRef.current = null;
      }
      setProfileAvatarUrl(null);
      return;
    }

    let cancelled = false;
    async function loadAvatar() {
      try {
        const blob = await fetchOnboardingProfilePhotoBlob(user.id);
        const url = URL.createObjectURL(blob);
        if (profileAvatarRevokeRef.current) {
          URL.revokeObjectURL(profileAvatarRevokeRef.current);
        }
        profileAvatarRevokeRef.current = url;
        if (!cancelled) {
          setProfileAvatarUrl(url);
        }
      } catch {
        if (!cancelled) {
          setProfileAvatarUrl(null);
        }
      }
    }

    void loadAvatar();
    return () => {
      cancelled = true;
    };
  }, [user.id, onboarding?.has_profile_photo, onboarding?.profile_photo_updated_at]);

  useEffect(() => {
    return () => {
      if (profileAvatarRevokeRef.current) {
        URL.revokeObjectURL(profileAvatarRevokeRef.current);
        profileAvatarRevokeRef.current = null;
      }
    };
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");
    setSuccessMessage("");
    setIsSaving(true);
    try {
      const updated = await updateMyEmployeeProfile({
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phone || null,
        job_title: jobTitle || null,
        emergency_contact_name: emergencyContactName || null,
        emergency_contact_phone: emergencyContactPhone || null,
      });
      setProfile(updated);
      setSuccessMessage("Profile updated.");
    } catch {
      setSaveError("Could not update profile.");
    } finally {
      setIsSaving(false);
    }
  }

  function formatOptionalDate(value: string | null) {
    if (!value) {
      return "—";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  async function handleSendVerificationEmail() {
    setVerifyError("");
    setVerifyMessage("");
    setVerifyDevLink(null);
    setVerifySending(true);
    try {
      const res = await sendVerificationEmail();
      setVerifyMessage(t("profile.verify_sent"));
      setVerifyDevLink(res.dev_verification_link ?? null);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Could not send verification email.");
    } finally {
      setVerifySending(false);
    }
  }

  async function handleRefreshAccountStatus() {
    setVerifyError("");
    setAuthRefreshBusy(true);
    try {
      await refreshAuthUser();
    } finally {
      setAuthRefreshBusy(false);
    }
  }

  const accountRows = useMemo(
    () => [
      { label: t("profile.row_email", "Email"), value: user.email },
      { label: t("profile.row_role", "Role"), value: formatSystemRole(user.system_role) },
      {
        label: t("profile.row_company", "Company"),
        value: isLoadingProfile
          ? t("common.loading", "Loading…")
          : loadError
            ? t("profile.value_dash", "—")
            : profile?.company_name || t("profile.value_not_assigned", "Not assigned"),
      },
      {
        label: t("profile.row_account_status", "Account status"),
        value: user.is_active ? t("profile.value_active", "Active") : t("profile.value_inactive", "Inactive"),
      },
      {
        label: t("profile.row_email_verified", "Email verified"),
        value: user.email_verified_at
          ? formatOptionalDate(user.email_verified_at)
          : t("profile.not_verified", "Not verified yet"),
      },
      {
        label: t("profile.row_early_clock", "Early clock-in access"),
        value: isLoadingProfile
          ? t("common.loading", "Loading…")
          : loadError
            ? t("profile.value_dash", "—")
            : profile
              ? profile.early_access_enabled
                ? t("profile.value_enabled", "Enabled")
                : t("profile.value_off", "Off")
              : t("profile.value_dash", "—"),
      },
    ],
    [t, user, isLoadingProfile, loadError, profile],
  );

  const starterNote = isEmployee(user)
    ? "The editable section below updates your live profile. Submitted starter form answers (including sensitive items) appear read-only in Onboarding record once you have submitted."
    : "These details will also be filled from your Starter Form once onboarding is submitted and approved.";

  const showOnboardingReadback =
    isEmployee(user) &&
    onboarding &&
    (onboarding.status === "submitted" ||
      onboarding.status === "approved" ||
      onboarding.status === "rejected");

  const hasSensitiveOnboardingValues =
    onboarding &&
    ONBOARDING_SUMMARY_FIELD_ORDER.some((key) => {
      if (!SENSITIVE_ONBOARDING_FIELD_KEYS.has(key)) {
        return false;
      }
      const v = onboarding.form_payload[key]?.trim();
      return Boolean(v);
    });

  async function handleDownloadOnboardingDoc(documentId: string, filename: string) {
    try {
      const blob = await fetchOnboardingDocumentBlob(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "document";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setOnboardingError("Could not download document.");
    }
  }

  function profileDisplayName(): string {
    const fn = profile?.first_name?.trim();
    const ln = profile?.last_name?.trim();
    if (fn || ln) {
      return [fn, ln].filter(Boolean).join(" ");
    }
    return user.email;
  }

  function profileInitials(): string {
    const fn = profile?.first_name?.trim();
    const ln = profile?.last_name?.trim();
    if (fn && ln) {
      return `${fn[0] ?? ""}${ln[0] ?? ""}`.toUpperCase();
    }
    if (fn && fn.length >= 2) {
      return fn.slice(0, 2).toUpperCase();
    }
    if (fn) {
      return fn.slice(0, 1).toUpperCase();
    }
    return user.email.slice(0, 2).toUpperCase();
  }

  async function handleViewOnboardingSignature(submissionId: string) {
    try {
      const blob = await fetchOnboardingSignatureBlob(submissionId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setOnboardingError("Could not open signature.");
    }
  }

  return (
    <Sheet>
      <PageHeader
        title={t("profile.page_title", "Profile")}
        description={t("profile.page_description", "Your TimIQ account and employee profile.")}
      />
      <SheetBody>
        <div className="space-y-3">
          {isEmployee(user) ? (
            <div className="flex items-center gap-4 border border-[var(--color-border)] bg-[var(--color-cell)] p-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-border-dark)] bg-[var(--color-header)] text-lg font-bold tracking-wide text-[var(--color-text-soft)]">
                {profileAvatarUrl ? (
                  <img
                    src={profileAvatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  profileInitials()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold leading-tight text-[var(--color-text)]">
                  {isLoadingProfile ? t("common.loading", "Loading…") : profileDisplayName()}
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{user.email}</p>
              </div>
            </div>
          ) : null}

          <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              {t("profile.account", "Account")}
            </p>
            <dl className="mt-2 grid gap-2 text-sm">
              {accountRows.map((row) => (
                <div
                  className="flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-2 first:border-t-0 first:pt-0 sm:flex-row sm:justify-between sm:gap-4"
                  key={row.label}
                >
                  <dt className="text-[var(--color-text-muted)]">{row.label}</dt>
                  <dd className="font-medium text-[var(--color-text)]">{row.value}</dd>
                </div>
              ))}
            </dl>
            {!user.email_verified_at ? (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                  {t("profile.verify_section", "Verify your email")}
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {t(
                    "profile.verify_hint",
                    "When you have opened the verification link, return to this tab or click Refresh status so your account shows as verified.",
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button disabled={verifySending} onClick={() => void handleSendVerificationEmail()} type="button">
                    {verifySending ? t("profile.sending", "Sending…") : t("profile.send_verify", "Send verification email")}
                  </Button>
                  <Button
                    disabled={authRefreshBusy}
                    onClick={() => void handleRefreshAccountStatus()}
                    type="button"
                    variant="secondary"
                  >
                    {authRefreshBusy ? t("profile.refreshing", "Refreshing…") : t("profile.refresh_status", "Refresh status")}
                  </Button>
                </div>
                {verifyError ? (
                  <p className="mt-2 text-sm text-[var(--color-danger-700)]">{verifyError}</p>
                ) : null}
                {verifyMessage ? (
                  <p className="mt-2 text-sm text-[var(--color-text)]">{verifyMessage}</p>
                ) : null}
                {process.env.NODE_ENV === "development" && verifyDevLink ? (
                  <div className="mt-2 rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2 text-xs">
                    <p className="font-bold text-[var(--color-text)]">{t("profile.dev_verify_link")}</p>
                    <p className="mt-1 break-all text-[var(--color-text-muted)]">{verifyDevLink}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {loadError ? (
            <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {loadError} You can still review your account information above.
            </div>
          ) : null}

          {isEmployee(user) ? (
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Starter form (onboarding)
              </p>
              {onboardingLoading ? (
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">Loading onboarding…</p>
              ) : null}
              {!onboardingLoading && onboardingError ? (
                <p className="mt-2 text-sm text-[var(--color-danger-700)]">{onboardingError}</p>
              ) : null}
              {!onboardingLoading && onboarding && !onboardingError ? (
                <div className="mt-2 space-y-3 text-sm text-[var(--color-text)]">
                  <p className="font-medium text-[var(--color-text)]">
                    {onboarding.status === "draft" ? "Draft — not submitted yet" : null}
                    {onboarding.status === "submitted" ? "Submitted — awaiting review" : null}
                    {onboarding.status === "approved" ? "Approved — onboarded" : null}
                    {onboarding.status === "rejected" ? "Rejected — action needed" : null}
                  </p>
                  {onboarding.status === "draft" ? (
                    <p className="text-[var(--color-text-muted)]">
                      Complete your starter form to provide documents, details, and your signature for payroll
                      setup.
                    </p>
                  ) : null}
                  {onboarding.status === "draft" ? (
                    <Link
                      href="/starter-form"
                      className="inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-primary-border)] bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-text)] no-underline hover:bg-[var(--color-primary-hover)]"
                    >
                      Go to Starter Form
                    </Link>
                  ) : null}
                  {onboarding.status === "rejected" && onboarding.review_note ? (
                    <div className="rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2 text-sm">
                      <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">Reviewer note</p>
                      <p className="mt-1 text-[var(--color-text)]">{onboarding.review_note}</p>
                    </div>
                  ) : null}
                  {onboarding.status === "rejected" ? (
                    <Link
                      href="/starter-form"
                      className="inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-4 text-sm font-semibold text-[var(--color-text)] no-underline hover:bg-[var(--color-primary-hover)]"
                    >
                      Update starter form & resubmit
                    </Link>
                  ) : null}
                  {showOnboardingReadback ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
                        <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">
                          Submitted details (read-only)
                        </p>
                        {hasSensitiveOnboardingValues ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSensitiveOnboarding((v) => !v)}
                          >
                            {showSensitiveOnboarding ? "Hide sensitive values" : "Show sensitive values"}
                          </Button>
                        ) : null}
                      </div>
                      <dl className="grid gap-2 text-sm">
                        {ONBOARDING_SUMMARY_FIELD_ORDER.map((key) => (
                          <div
                            key={key}
                            className="flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-2 first:border-t-0 first:pt-0 sm:flex-row sm:justify-between sm:gap-4"
                          >
                            <dt className="text-[var(--color-text-muted)]">{onboardingSummaryFieldLabel(key)}</dt>
                            <dd className="max-w-full break-words font-medium text-[var(--color-text)] sm:text-right">
                              {maskOnboardingFieldValue(
                                key,
                                onboarding.form_payload[key],
                                showSensitiveOnboarding,
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <div className="border-t border-[var(--color-border)] pt-3">
                        <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">
                          Required documents
                        </p>
                        <ul className="mt-2 space-y-2">
                          {ONBOARDING_REQUIRED_DOC_SLOTS.map(({ docType, label }) => {
                            const doc = onboarding.documents.find((d) => d.doc_type === docType);
                            return (
                              <li
                                key={docType}
                                className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-2 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div>
                                  <p className="font-medium text-[var(--color-text)]">{label}</p>
                                  <p className="text-xs text-[var(--color-text-muted)]">
                                    {doc ? `Uploaded — ${doc.original_filename}` : "Not on file for this submission"}
                                  </p>
                                </div>
                                {doc ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      void handleDownloadOnboardingDoc(doc.id, doc.original_filename)
                                    }
                                  >
                                    Download
                                  </Button>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                      <div className="border-t border-[var(--color-border)] pt-3">
                        <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">Signature</p>
                        {onboarding.form_payload.signature_name?.trim() ? (
                          <p className="mt-1 text-sm text-[var(--color-text)]">
                            <span className="text-[var(--color-text-muted)]">Signatory name: </span>
                            {onboarding.form_payload.signature_name}
                          </p>
                        ) : null}
                        {onboarding.signature_mode === "typed" && onboarding.signature_typed_text ? (
                          <p className="mt-1 text-[var(--color-text)]">{onboarding.signature_typed_text}</p>
                        ) : null}
                        {onboarding.signature_mode === "drawn" && onboarding.has_drawn_signature ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="mt-2"
                            onClick={() => void handleViewOnboardingSignature(onboarding.id)}
                          >
                            View drawn signature
                          </Button>
                        ) : null}
                        {!onboarding.signature_mode ? (
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">—</p>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
            {starterNote}
          </p>

          {!isLoadingProfile && profile ? (
            <>
              <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                  Employment snapshot
                </p>
                <dl className="mt-2 text-sm">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                    <dt className="text-[var(--color-text-muted)]">Start date</dt>
                    <dd className="font-medium text-[var(--color-text)]">
                      {formatOptionalDate(profile.start_date)}
                    </dd>
                  </div>
                </dl>
              </div>

              <form
                className="max-w-[min(42rem,calc(100vw-2rem))] border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
                onSubmit={handleSave}
              >
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                  Editable profile
                </p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    First name
                    <input
                      className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(event) => setFirstName(event.target.value)}
                      type="text"
                      value={firstName}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Last name
                    <input
                      className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(event) => setLastName(event.target.value)}
                      type="text"
                      value={lastName}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Phone
                    <input
                      className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(event) => setPhone(event.target.value)}
                      type="text"
                      value={phone}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Job title
                    <input
                      className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(event) => setJobTitle(event.target.value)}
                      type="text"
                      value={jobTitle}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)] md:col-span-2">
                    Emergency contact name
                    <input
                      className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(event) => setEmergencyContactName(event.target.value)}
                      type="text"
                      value={emergencyContactName}
                    />
                  </label>
                  <label className="block text-xs font-bold text-[var(--color-text)] md:col-span-2">
                    Emergency contact phone
                    <input
                      className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                      onChange={(event) => setEmergencyContactPhone(event.target.value)}
                      type="text"
                      value={emergencyContactPhone}
                    />
                  </label>
                </div>

                <div className="mt-3">
                  <Button disabled={isSaving} type="submit">
                    {isSaving ? "Saving..." : "Save profile"}
                  </Button>
                </div>
              </form>
            </>
          ) : null}

          {saveError ? (
            <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {saveError}
            </div>
          ) : null}
          {successMessage ? (
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
              {successMessage}
            </div>
          ) : null}
        </div>
      </SheetBody>
    </Sheet>
  );
}
