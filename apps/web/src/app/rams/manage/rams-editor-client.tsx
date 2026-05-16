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
  publishRams,
  RAMS_ATTACHMENT_SECTION_KEYS,
  ramsAttachmentUrl,
  uploadRamsAttachment,
  archiveRams,
  downloadRamsPdf,
  type RamsAssessmentDetail,
  type RamsDocumentSection,
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
  const [activeSectionId, setActiveSectionId] = useState("");

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
      setActiveSectionId(row.document_sections?.[0]?.id ?? "");
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
        document_sections: detail.document_sections ?? [],
      });
      setDetail(next);
      setNotice("RAMS saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save RAMS.");
    } finally {
      setBusy(false);
    }
  }

  const documentSections = detail?.document_sections ?? [];
  const activeSection = documentSections.find((section) => section.id === activeSectionId) ?? documentSections[0] ?? null;

  function updateDocumentSections(sections: RamsDocumentSection[]) {
    if (!detail) return;
    const ordered = sections.map((section, index) => ({ ...section, order: index + 1 }));
    setDetail({ ...detail, document_sections: ordered });
    if (!ordered.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(ordered[0]?.id ?? "");
    }
  }

  function updateSection(sectionId: string, patch: Partial<RamsDocumentSection>) {
    updateDocumentSections(documentSections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)));
  }

  function updateBlockText(sectionId: string, blockId: string, text: string) {
    updateDocumentSections(
      documentSections.map((section) =>
        section.id === sectionId
          ? { ...section, blocks: section.blocks.map((block) => (block.id === blockId ? { ...block, text } : block)) }
          : section,
      ),
    );
  }

  function updateBlockItems(sectionId: string, blockId: string, raw: string) {
    updateDocumentSections(
      documentSections.map((section) =>
        section.id === sectionId
          ? { ...section, blocks: section.blocks.map((block) => (block.id === blockId ? { ...block, items: raw.split("\n").map((item) => item.trim()).filter(Boolean) } : block)) }
          : section,
      ),
    );
  }

  function updateBlockRows(sectionId: string, blockId: string, raw: string) {
    updateDocumentSections(
      documentSections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id === blockId
                  ? {
                      ...block,
                      rows: raw.split("\n").map((line) => {
                        const cells = line.split("|").map((cell) => cell.trim());
                        return (block.columns ?? []).reduce<Record<string, string>>((row, col, index) => ({ ...row, [col]: cells[index] ?? "" }), {});
                      }),
                    }
                  : block,
              ),
            }
          : section,
      ),
    );
  }

  function addSection() {
    const id = `section-${Date.now()}`;
    updateDocumentSections([
      ...documentSections,
      { id, type: "content", title: "New RAMS section", order: documentSections.length + 1, visible_in_pdf: true, not_applicable: false, blocks: [{ id: `${id}-text`, type: "text", text: "" }] },
    ]);
    setActiveSectionId(id);
  }

  function removeSection(sectionId: string) {
    updateDocumentSections(documentSections.filter((section) => section.id !== sectionId));
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    const index = documentSections.findIndex((section) => section.id === sectionId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= documentSections.length) return;
    const next = [...documentSections];
    [next[index], next[target]] = [next[target], next[index]];
    updateDocumentSections(next);
  }

  async function publishCurrentRams() {
    if (!detail) return;
    await saveDetail();
    setDetail(await publishRams(detail.id));
    setNotice("RAMS published.");
  }

  async function archiveCurrentRams() {
    if (!detail) return;
    setDetail(await archiveRams(detail.id));
    setNotice("RAMS archived.");
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
            <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] p-4">
                <div>
                  <h2 className="text-sm font-bold">Document builder</h2>
                  <p className="text-xs text-[var(--color-text-soft)]">Edit the RAMS pack as document pages. Hazards, attachments, and signatures render inside this same model.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || detail.status === "archived"} onClick={() => void saveDetail()} type="button">Save draft</Button>
                  <Button disabled={busy} onClick={() => router.push(`/rams/manage/${detail.id}`)} type="button" variant="secondary">Preview</Button>
                  <Button disabled={busy || detail.status === "archived"} onClick={() => void publishCurrentRams().catch((err) => setError(err instanceof Error ? err.message : "Could not publish RAMS."))} type="button" variant="secondary">Publish</Button>
                  <Button disabled={busy} onClick={() => void downloadRamsPdf(detail.id, detail.reference ?? detail.id)} type="button" variant="secondary">Download PDF</Button>
                  <Button disabled={busy || detail.status === "archived"} onClick={() => void archiveCurrentRams().catch((err) => setError(err instanceof Error ? err.message : "Could not archive RAMS."))} type="button" variant="secondary">Archive</Button>
                </div>
              </div>
              <div className="grid gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
                <aside className="border-b border-[var(--color-border)] p-3 lg:border-b-0 lg:border-r">
                  <div className="mb-3 grid gap-2">
                    {documentSections.map((section) => (
                      <button key={section.id} className={`rounded border px-3 py-2 text-left text-xs ${activeSection?.id === section.id ? "border-[var(--color-text)] bg-[var(--color-header)]" : "border-[var(--color-border)] bg-white"}`} onClick={() => setActiveSectionId(section.id)} type="button">
                        <span className="font-semibold">{section.order}. {section.title}</span>
                        <span className="mt-1 block text-[var(--color-text-soft)]">{section.type.replace(/_/g, " ")}</span>
                      </button>
                    ))}
                  </div>
                  <Button disabled={detail.status === "archived"} onClick={addSection} size="sm" type="button" variant="secondary">Add section</Button>
                </aside>
                <div className="space-y-4 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input label="Title" value={detail.title} onChange={(e) => setDetail({ ...detail, title: e.target.value })} />
                    <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                    <Input label="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                    <Input label="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
                    <Input label="Principal contractor" value={principalContractor} onChange={(e) => setPrincipalContractor(e.target.value)} />
                    <Input label="Review date" type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} />
                  </div>
                  {activeSection ? (
                    <div className="space-y-3 rounded border border-[var(--color-border)] bg-white p-4">
                      <div className="flex flex-wrap items-end gap-2">
                        <Input label="Section title" value={activeSection.title} onChange={(e) => updateSection(activeSection.id, { title: e.target.value })} />
                        <label className="text-xs font-semibold text-[var(--color-text)]">Type
                          <select className="mt-1 block h-10 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm" value={activeSection.type} onChange={(e) => updateSection(activeSection.id, { type: e.target.value })}>
                            {["content", "risk_matrix", "hazard_table", "appendices", "signature_register"].map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-xs font-semibold"><input checked={activeSection.visible_in_pdf} onChange={(e) => updateSection(activeSection.id, { visible_in_pdf: e.target.checked })} type="checkbox" /> PDF</label>
                        <label className="flex items-center gap-2 text-xs font-semibold"><input checked={activeSection.not_applicable} onChange={(e) => updateSection(activeSection.id, { not_applicable: e.target.checked })} type="checkbox" /> N/A</label>
                        <Button disabled={activeSection.order <= 1} onClick={() => moveSection(activeSection.id, -1)} size="sm" type="button" variant="secondary">Up</Button>
                        <Button disabled={activeSection.order >= documentSections.length} onClick={() => moveSection(activeSection.id, 1)} size="sm" type="button" variant="secondary">Down</Button>
                        <Button disabled={documentSections.length <= 1} onClick={() => removeSection(activeSection.id)} size="sm" type="button" variant="secondary">Remove</Button>
                      </div>
                      {activeSection.blocks.map((block) => (
                        <div className="rounded border border-[var(--color-border)] p-3" key={block.id}>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">{block.type.replace(/_/g, " ")}</p>
                          {block.type === "text" ? <textarea className="min-h-28 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" value={block.text ?? ""} onChange={(e) => updateBlockText(activeSection.id, block.id, e.target.value)} /> : null}
                          {block.type === "list" ? <textarea className="min-h-28 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" value={(block.items ?? []).join("\n")} onChange={(e) => updateBlockItems(activeSection.id, block.id, e.target.value)} /> : null}
                          {block.type === "table" ? <textarea className="min-h-28 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 py-2 text-sm" value={(block.rows ?? []).map((row) => (block.columns ?? []).map((col) => String(row[col] ?? "")).join(" | ")).join("\n")} onChange={(e) => updateBlockRows(activeSection.id, block.id, e.target.value)} /> : null}
                          {block.type === "photo" ? <p className="text-sm text-[var(--color-text-soft)]">Photo section: {block.section_key ?? "other"}{block.caption ? ` · ${block.caption}` : ""}. Upload files in Photos and attachments below.</p> : null}
                          {block.type === "hazard_table" ? <p className="text-sm text-[var(--color-text-soft)]">Hazards are edited in the hazard table below and rendered here.</p> : null}
                          {block.type === "risk_matrix" ? <p className="text-sm text-[var(--color-text-soft)]">Risk matrix is generated from the standard 5x5 RAMS matrix.</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-[var(--color-text-soft)]">No document sections available.</p>}
                </div>
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
