"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { Button, Input, PageHeader, Sheet, SheetBody } from "@/components/ui";
import { isAdministrator, useCurrentUser } from "@/features/auth";
import { listCompanies, type Company } from "@/features/companies/api";
import { listLocations, type Location } from "@/features/locations/api";
import { uploadRamsPdf } from "@/features/rams/api";

export function RamsUploadClient() {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workActivity, setWorkActivity] = useState("");
  const [riskLevel, setRiskLevel] = useState("medium");
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [producedByName, setProducedByName] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listLocations(), isAdministrator(currentUser) ? listCompanies() : Promise.resolve([])])
      .then(([locs, cos]) => {
        if (cancelled) return;
        setLocations(locs);
        setCompanies(cos);
        const first = cos.find((c) => c.is_active) ?? cos[0];
        if (first) setCompanyId((prev) => prev || first.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const companyLocations = locations.filter((l) => {
    if (isAdministrator(currentUser)) {
      if (!companyId) return true;
      return l.company_id === companyId;
    }
    return !currentUser?.company_id || l.company_id === currentUser.company_id;
  });

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!file) {
      setError("Choose a PDF file to upload.");
      return;
    }
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are allowed.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are allowed.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await uploadRamsPdf(file, {
        title: title.trim(),
        company_id: isAdministrator(currentUser) ? companyId || null : null,
        location_id: locationId || null,
        description: description.trim() || null,
        work_activity: workActivity.trim() || null,
        risk_level: riskLevel,
        review_due_date: reviewDueDate || null,
        produced_by_name: producedByName.trim() || null,
        notes: notes.trim() || null,
      });
      router.push(`/rams/manage/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setBusy(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        description="Upload an existing RAMS PDF prepared outside TimIQ, then assign employees and collect acknowledgements."
        title="Upload RAMS"
      />
      <SheetBody className="min-w-0 space-y-4">
        <Link className="text-sm text-[var(--color-text-muted)] underline" href="/rams/manage">
          Back to RAMS
        </Link>
        <p className="rounded border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text)]">
          Upload an existing RAMS PDF. You can then assign employees and collect acknowledgements without rebuilding the
          document from a TimIQ template.
        </p>
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        <form className="space-y-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4" onSubmit={onSubmit}>
          {isAdministrator(currentUser) ? (
            <label className="block text-xs font-semibold text-[var(--color-text)]">
              Company
              <select
                className="mt-1 block h-10 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setCompanyId(e.target.value)}
                required
                value={companyId}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs font-semibold text-[var(--color-text)]">
            Title
            <Input className="mt-1 w-full" onChange={(e) => setTitle(e.target.value)} required value={title} />
          </label>
          <label className="block text-xs font-semibold text-[var(--color-text)]">
            Site / location
            <select
              className="mt-1 block h-10 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              onChange={(e) => setLocationId(e.target.value)}
              value={locationId}
            >
              <option value="">No specific site</option>
              {companyLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-[var(--color-text)]">
            Responsible person
            <Input className="mt-1 w-full" onChange={(e) => setProducedByName(e.target.value)} value={producedByName} />
          </label>
          <label className="block text-xs font-semibold text-[var(--color-text)]">
            Work / activity category
            <Input className="mt-1 w-full" onChange={(e) => setWorkActivity(e.target.value)} value={workActivity} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-[var(--color-text)]">
              Risk level
              <select
                className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setRiskLevel(e.target.value)}
                value={riskLevel}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-[var(--color-text)]">
              Review / effective date
              <Input className="mt-1 w-full" onChange={(e) => setReviewDueDate(e.target.value)} type="date" value={reviewDueDate} />
            </label>
          </div>
          <label className="block text-xs font-semibold text-[var(--color-text)]">
            Description
            <textarea
              className="mt-1 min-h-[5rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-2 text-sm"
              onChange={(e) => setDescription(e.target.value)}
              value={description}
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--color-text)]">
            Notes
            <textarea
              className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-2 text-sm"
              onChange={(e) => setNotes(e.target.value)}
              value={notes}
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--color-text)]">
            PDF file
            <input
              accept="application/pdf,.pdf"
              className="mt-1 block w-full min-w-0 text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
          {file ? <p className="break-all text-xs text-[var(--color-text-soft)]">Selected: {file.name} ({Math.round(file.size / 1024)} KB)</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button className="w-full sm:w-auto" disabled={busy} type="submit">
              {busy ? "Uploading…" : "Upload RAMS"}
            </Button>
            <Link
              className="inline-flex h-9 w-full items-center justify-center rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold sm:w-auto"
              href="/rams/manage"
            >
              Cancel
            </Link>
          </div>
        </form>
      </SheetBody>
    </Sheet>
  );
}
