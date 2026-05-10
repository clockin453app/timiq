"use client";

import { FormEvent, useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  getMyEmployeeProfile,
  updateMyEmployeeProfile,
  type EmployeeProfile,
} from "../../features/employee-profiles/api";

export function ProfileClient() {
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function loadProfile() {
    setIsLoading(true);
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
      setErrorMessage("Could not load profile.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
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
      setErrorMessage("Could not update profile.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title="Profile"
        description="Review and maintain your employee profile details."
      />
      <SheetBody>
        {isLoading ? <div className="text-sm">Loading profile...</div> : null}

        {!isLoading && profile ? (
          <form
            className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
            onSubmit={handleSave}
          >
            <div className="grid gap-3 md:grid-cols-2">
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
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Emergency contact name
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setEmergencyContactName(event.target.value)}
                  type="text"
                  value={emergencyContactName}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
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
        ) : null}

        {errorMessage ? (
          <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="mt-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {successMessage}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
