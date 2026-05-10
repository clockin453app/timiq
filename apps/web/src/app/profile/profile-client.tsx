"use client";

import { FormEvent, useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  getMyEmployeeProfile,
  updateMyEmployeeProfile,
  type EmployeeProfile,
} from "../../features/employee-profiles/api";
import { formatSystemRole, useCurrentUser } from "../../features/auth";

export function ProfileClient() {
  const user = useCurrentUser();

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

  const accountRows = [
    { label: "Email", value: user.email },
    { label: "Role", value: formatSystemRole(user.system_role) },
    {
      label: "Company",
      value: isLoadingProfile
        ? "Loading…"
        : loadError
          ? "—"
          : profile?.company_name || "Not assigned",
    },
    {
      label: "Account status",
      value: user.is_active ? "Active" : "Inactive",
    },
  ];

  const starterNote =
    "These details will also be filled from your Starter Form once onboarding is submitted and approved.";

  return (
    <Sheet>
      <PageHeader
        title="Profile"
        description="Your TimIQ account and employee profile."
      />
      <SheetBody>
        <div className="space-y-3">
          <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              Account
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
          </div>

          {loadError ? (
            <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {loadError} You can still review your account information above.
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
                className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
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
