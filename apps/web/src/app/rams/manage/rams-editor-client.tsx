"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, PageHeader, Sheet, SheetBody, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui";
import { isAdministrator, useCurrentUser } from "../../../features/auth";
import { listCompanies, type Company } from "../../../features/companies/api";
import { listLocations, type Location } from "../../../features/locations/api";
import {
  createRamsFromPreset,
  createRamsHazard,
  deleteRamsAttachment,
  deleteRamsHazard,
  getRams,
  getRamsPresets,
  patchRams,
  RAMS_ATTACHMENT_SECTION_KEYS,
  ramsAttachmentUrl,
  uploadRamsAttachment,
  type RamsAssessmentDetail,
  type RamsDocumentPreset,
  type RamsHazardCreateBody,
} from "../../../features/rams/api";

type Props = { ramsId?: string };

const TEMPLATE_NOTE = "This is a template. A competent person must review and adapt it to the actual work, site conditions, and workforce before publishing.";

export function RamsEditorClient({ ramsId }: Props) {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const editing = Boolean(ramsId);
  const [detail, setDetail] = useState<RamsAssessmentDetail | null>(null);
  const [templates, setTemplates] = useState<RamsDocumentPreset[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [reference, setReference] = useState("");
  const [reviewDue, setReviewDue] = useState("");
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [principalContractor, setPrincipalContractor] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(ramsId));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hazardForm, setHazardForm] = useState<RamsHazardCreateBody>({
    hazard: "",
    who_might_be_harmed: "",
    initial_likelihood: 3,
    initial_severity: 3,
    control_measures: "",
    residual_likelihood: 2,
    residual_severity: 2,
  });
  const [sectionKey, setSectionKey] = useState<(typeof RAMS_ATTACHMENT_SECTION_KEYS)[number]>("cover_image");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const loadSetup = useCallback(async () => {
    const [presetData, locs] = await Promise.all([getRamsPresets(), listLocations()]);
    setTemplates(presetData.assessment_presets?.length ? presetData.assessment_presets : presetData.document_presets);
    setLocations(locs);
    if (isAdministrator(currentUser)) {
      const comps = await listCompanies();
      setCompanies(comps);
      const first = comps.find((c) => c.is_active) ?? comps[0];
      if (first) setCompanyId((prev) => prev || first.id);
    } else if (currentUser.company_id) {
      setCompanyId(currentUser.company_id);
    }
  }, [currentUser]);

  const loadDetail = useCallback(async () => {
    if (!ramsId) return;
    setLoading(true);
    setError("");
    try {
      const row = await getRams(ramsId);
      setDetail(row);
      setCompanyId(row.company_id);
      setReference(row.reference ?? "");
      setReviewDue(row.review_due_date?.slice(0, 10) ?? "");
      setProjectName(row.project_name ?? "");
      setClientName(row.client_name ?? "");
      setPrincipalContractor(row.principal_contractor ?? "");
      setSiteAddress(row.site_address ?? "");
      setLocationId(row.location_id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load RAMS.");
    } finally {
      setLoading(false);
    }
  }, [ramsId]);

  useEffect(() => {
    void loadSetup().catch((err) => setError(err instanceof Error ? err.message : "Could not load setup data."));
  }, [loadSetup]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const scopedLocations = useMemo(() => locations.filter((l) => !companyId || l.company_id === companyId), [companyId, locations]);

  async function createFromTemplate(ev: FormEvent) {
    ev.preventDefault();
    if (!selectedTemplate) return;
    setBusy(true);
    setError("");
    try {
      const created = await createRamsFromPreset({
        preset_id: selectedTemplate,
        company_id: isAdministrator(currentUser) ? companyId : null,
        location_id: locationId || null,
        review_due_date: reviewDue || null,
        reference: reference || null,
        project_name: projectName.trim() || null,
        client_name: clientName.trim() || null,
        principal_contractor: principalContractor.trim() || null,
        site_address: siteAddress.trim() || null,
      });
      router.replace(`/rams/manage/${created.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create RAMS.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDetail() {
    if (!detail) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await patchRams(detail.id, {
        title: detail.title,
        reference: reference || null,
        work_activity: detail.work_activity,
        description: detail.description,
        location_id: locationId || null,
        risk_level: detail.risk_level,
        review_due_date: reviewDue || null,
        ppe_json: detail.ppe_json,
        no_special_ppe: detail.no_special_ppe,
        project_name: projectName || null,
        client_name: clientName || null,
        principal_contractor: principalContractor || null,
        site_address: siteAddress || null,
        scope_of_works: detail.scope_of_works,
        emergency_arrangements: detail.emergency_arrangements,
        sequence_of_works: detail.sequence_of_works,
        pre_start_checklist: detail.pre_start_checklist,
        plant_tools: detail.plant_tools,
        training_requirements: detail.training_requirements,
        coshh_items: detail.coshh_items,
        glove_requirements: detail.glove_requirements,
        method_statement_sections: detail.method_statement_sections,
      });
      setDetail(next);
      setNotice("RAMS saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save RAMS.");
    } finally {
      setBusy(false);
    }
  }

  async function addHazard(ev: FormEvent) {
    ev.preventDefault();
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await createRamsHazard(detail.id, hazardForm);
      const next = await getRams(detail.id);
      setDetail(next);
      setHazardForm({ hazard: "", who_might_be_harmed: "", initial_likelihood: 3, initial_severity: 3, control_measures: "", residual_likelihood: 2, residual_severity: 2 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add hazard.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto() {
    if (!detail || !file) return;
    setBusy(true);
    setError("");
    try {
      const next = await uploadRamsAttachment(detail.id, { file, sectionKey, caption: caption || null });
      setDetail(next);
      setCaption("");
      setFile(null);
      setFileInputKey((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photo.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    const selected = templates.find((t) => t.id === selectedTemplate);
    return (
      <Sheet>
        <PageHeader title="Create RAMS" description="Choose a professional construction activity template, then adapt it to the site before publishing." />
        <SheetBody className="min-w-0 space-y-5">
          <Link className="text-sm text-[var(--color-text-muted)] underline" href="/rams/manage">Back to RAMS</Link>
          {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{TEMPLATE_NOTE}</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((tpl) => (
              <button key={tpl.id} className={`rounded border p-3 text-left ${selectedTemplate === tpl.id ? "border-[var(--color-text)] bg-[var(--color-header)]" : "border-[var(--color-border)] bg-[var(--color-cell)]"}`} onClick={() => setSelectedTemplate(tpl.id)} type="button">
                <p className="font-semibold text-[var(--color-text)]">{tpl.title.replace("RAMS — ", "")}</p>
                <p className="mt-1 text-xs capitalize text-[var(--color-text-soft)]">Risk: {tpl.risk_level} · Est. review: 20-30 min</p>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">Best for: {tpl.work_activity}</p>
                <p className="mt-2 text-xs text-[var(--color-text-soft)]">Includes: {tpl.hazard_count} hazards, PPE, method steps, emergency controls, sign-off register.</p>
              </button>
            ))}
          </div>
          <form className="grid gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2" onSubmit={createFromTemplate}>
            <h2 className="md:col-span-2 text-sm font-bold">Site-specific details</h2>
            {isAdministrator(currentUser) ? (
              <label className="text-xs font-semibold text-[var(--color-text)]">Company
                <select className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setCompanyId(e.target.value)} value={companyId}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ) : null}
            <label className="text-xs font-semibold text-[var(--color-text)]">Site
              <select className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setLocationId(e.target.value)} value={locationId}>
                <option value="">No specific site</option>
                {scopedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            <Input label="Review date" type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} />
            <Input label="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            <Input label="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            <Input label="Principal contractor" value={principalContractor} onChange={(e) => setPrincipalContractor(e.target.value)} />
            <label className="text-xs font-semibold text-[var(--color-text)] md:col-span-2">Site address
              <textarea className="mt-1 min-h-20 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" onChange={(e) => setSiteAddress(e.target.value)} value={siteAddress} />
            </label>
            <div className="md:col-span-2">
              <Button disabled={busy || !selectedTemplate || (isAdministrator(currentUser) && !companyId)} type="submit">Use template</Button>
              {selected ? <p className="mt-2 text-xs text-[var(--color-text-soft)]">Selected: {selected.title}</p> : null}
            </div>
          </form>
        </SheetBody>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <PageHeader title="Edit RAMS" description="Edit site-specific details, hazards, method content, PPE, and attachments before publishing." />
      <SheetBody className="min-w-0 space-y-5">
        <Link className="text-sm text-[var(--color-text-muted)] underline" href={detail ? `/rams/manage/${detail.id}` : "/rams/manage"}>Back to RAMS record</Link>
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        {notice ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div> : null}
        {loading ? <p className="text-sm text-[var(--color-text-soft)]">Loading...</p> : null}
        {detail ? (
          <>
            <section className="grid gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
              <Input label="Title" value={detail.title} onChange={(e) => setDetail({ ...detail, title: e.target.value })} />
              <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
              <label className="text-xs font-semibold text-[var(--color-text)]">Site
                <select className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" onChange={(e) => setLocationId(e.target.value)} value={locationId}>
                  <option value="">No specific site</option>
                  {scopedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <Input label="Review date" type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} />
              <label className="text-xs font-semibold text-[var(--color-text)] md:col-span-2">Work activity
                <textarea className="mt-1 min-h-20 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" value={detail.work_activity} onChange={(e) => setDetail({ ...detail, work_activity: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-[var(--color-text)] md:col-span-2">Description
                <textarea className="mt-1 min-h-20 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" value={detail.description ?? ""} onChange={(e) => setDetail({ ...detail, description: e.target.value || null })} />
              </label>
              <Input label="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              <Input label="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              <Input label="Principal contractor" value={principalContractor} onChange={(e) => setPrincipalContractor(e.target.value)} />
              <label className="text-xs font-semibold text-[var(--color-text)]">Risk level
                <select className="mt-1 block h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" value={detail.risk_level} onChange={(e) => setDetail({ ...detail, risk_level: e.target.value })}>
                  {["low", "medium", "high", "critical"].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--color-text)] md:col-span-2">Site address
                <textarea className="mt-1 min-h-20 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" onChange={(e) => setSiteAddress(e.target.value)} value={siteAddress} />
              </label>
              <label className="text-xs font-semibold text-[var(--color-text)] md:col-span-2">Scope of works
                <textarea className="mt-1 min-h-24 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" value={detail.scope_of_works ?? ""} onChange={(e) => setDetail({ ...detail, scope_of_works: e.target.value || null })} />
              </label>
              <label className="text-xs font-semibold text-[var(--color-text)] md:col-span-2">Emergency arrangements
                <textarea className="mt-1 min-h-24 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" value={detail.emergency_arrangements ?? ""} onChange={(e) => setDetail({ ...detail, emergency_arrangements: e.target.value || null })} />
              </label>
              <div className="md:col-span-2">
                <Button disabled={busy || detail.status === "archived"} onClick={() => void saveDetail()} type="button">Save changes</Button>
              </div>
            </section>

            <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-sm font-bold">Hazards and controls</h2>
              <div className="overflow-x-auto rounded border border-[var(--color-border)]">
                <Table><TableHeader><TableRow><TableHead>Hazard</TableHead><TableHead>Initial</TableHead><TableHead>Controls</TableHead><TableHead>Residual</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>{detail.hazards.map((h) => <TableRow key={h.id}><TableCell>{h.hazard}</TableCell><TableCell>{h.initial_risk_score} ({h.initial_risk_band})</TableCell><TableCell>{h.control_measures}</TableCell><TableCell>{h.residual_risk_score} ({h.residual_risk_band})</TableCell><TableCell><Button disabled={busy || detail.status === "archived"} onClick={() => void deleteRamsHazard(detail.id, h.id).then(() => getRams(detail.id).then(setDetail)).catch((err) => setError(err instanceof Error ? err.message : "Could not delete hazard."))} size="sm" type="button" variant="secondary">Delete</Button></TableCell></TableRow>)}</TableBody>
                </Table>
              </div>
              <form className="grid gap-2 md:grid-cols-2" onSubmit={addHazard}>
                <Input label="Hazard" value={hazardForm.hazard} onChange={(e) => setHazardForm({ ...hazardForm, hazard: e.target.value })} required />
                <Input label="Who may be harmed" value={hazardForm.who_might_be_harmed ?? ""} onChange={(e) => setHazardForm({ ...hazardForm, who_might_be_harmed: e.target.value })} />
                <label className="text-xs font-semibold text-[var(--color-text)] md:col-span-2">Controls
                  <textarea className="mt-1 min-h-20 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" value={hazardForm.control_measures} onChange={(e) => setHazardForm({ ...hazardForm, control_measures: e.target.value })} required />
                </label>
                <div className="md:col-span-2"><Button disabled={busy || detail.status === "archived"} type="submit">Add hazard</Button></div>
              </form>
            </section>

            <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-sm font-bold">Photos and attachments</h2>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold text-[var(--color-text)]">Section
                  <select className="mt-1 block h-10 min-w-[12rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" value={sectionKey} onChange={(e) => setSectionKey(e.target.value as (typeof RAMS_ATTACHMENT_SECTION_KEYS)[number])}>
                    {RAMS_ATTACHMENT_SECTION_KEYS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
                  </select>
                </label>
                <Input label="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
                <input key={fileInputKey} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <Button disabled={busy || !file || detail.status === "archived"} onClick={() => void uploadPhoto()} type="button" variant="secondary">Upload</Button>
              </div>
              {(detail.attachments ?? []).map((a) => (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm" key={a.id}>
                  <a className="font-semibold underline" href={ramsAttachmentUrl(a)} rel="noopener noreferrer" target="_blank">{a.original_filename}</a>
                  <span className="text-xs text-[var(--color-text-soft)]">{a.section_key}{a.caption ? ` · ${a.caption}` : ""}</span>
                  <Button disabled={busy || detail.status === "archived"} onClick={() => void deleteRamsAttachment(detail.id, a.id).then(() => getRams(detail.id).then(setDetail)).catch((err) => setError(err instanceof Error ? err.message : "Could not delete attachment."))} size="sm" type="button" variant="secondary">Delete</Button>
                </div>
              ))}
            </section>
          </>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
