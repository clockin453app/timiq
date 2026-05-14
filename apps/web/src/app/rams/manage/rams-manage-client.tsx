"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  Input,
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui";
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../../features/auth";
import { listCompanies, type Company } from "../../../features/companies/api";
import { listLocations, type Location } from "../../../features/locations/api";
import { useT } from "../../../lib/i18n";
import {
  addRamsAcknowledgements,
  archiveRams,
  createRams,
  createRamsFromPreset,
  createRamsHazard,
  deleteRams,
  deleteRamsAttachment,
  deleteRamsHazard,
  downloadRamsPdf,
  getRams,
  getRamsPresets,
  listRamsAdmin,
  openRamsPrint,
  patchRams,
  publishRams,
  RAMS_ATTACHMENT_SECTION_KEYS,
  reviewRams,
  ramsAttachmentUrl,
  uploadRamsAttachment,
  type RamsAssessmentDetail,
  type RamsAssessmentListItem,
  type RamsDocumentPreset,
  type RamsHazardCreateBody,
  type RamsPresets,
} from "../../../features/rams/api";

function formatDate(iso: string | null | undefined) {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function RamsManageClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const [presets, setPresets] = useState<RamsPresets | null>(null);
  const [items, setItems] = useState<RamsAssessmentListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RamsAssessmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [createCompanyId, setCreateCompanyId] = useState("");
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [workActivity, setWorkActivity] = useState("");
  const [description, setDescription] = useState("");
  const [locationId, setLocationId] = useState("");
  const [riskLevel, setRiskLevel] = useState("medium");
  const [reviewDue, setReviewDue] = useState("");
  const [newPpePick, setNewPpePick] = useState<string[]>([]);
  const [newNoSpecialPpe, setNewNoSpecialPpe] = useState(false);
  const [ppePick, setPpePick] = useState<string[]>([]);
  const [noSpecialPpe, setNoSpecialPpe] = useState(false);

  const [hazardForm, setHazardForm] = useState<RamsHazardCreateBody>({
    hazard: "",
    who_might_be_harmed: "",
    initial_likelihood: 3,
    initial_severity: 3,
    control_measures: "",
    residual_likelihood: 2,
    residual_severity: 2,
  });

  const [pickUserId, setPickUserId] = useState("");
  const [allSiteUsers, setAllSiteUsers] = useState(false);
  const [presetPickId, setPresetPickId] = useState("");
  const [presetRef, setPresetRef] = useState("");
  const [presetReviewDue, setPresetReviewDue] = useState("");
  const [presetProjectName, setPresetProjectName] = useState("");
  const [presetClientName, setPresetClientName] = useState("");
  const [presetSiteAddress, setPresetSiteAddress] = useState("");
  const [presetPrincipalContractor, setPresetPrincipalContractor] = useState("");
  const [attachmentSectionKey, setAttachmentSectionKey] = useState<(typeof RAMS_ATTACHMENT_SECTION_KEYS)[number]>("cover_image");
  const [attachmentCaption, setAttachmentCaption] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentFileInputKey, setAttachmentFileInputKey] = useState(0);
  const presetDefaultAppliedRef = useRef(false);

  const canHardDeleteRams = useMemo(() => {
    if (!detail) {
      return false;
    }
    if (detail.status === "archived") {
      return false;
    }
    if (detail.status !== "draft") {
      return false;
    }
    return detail.acknowledgements.every((a) => a.status === "pending");
  }, [detail]);

  const onCreateFromPreset = async () => {
    if (!presetPickId) {
      setError(t("rams.preset_pick_required", "Select a preset."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const company_id = isAdministrator(currentUser) ? createCompanyId || null : null;
      const d = await createRamsFromPreset({
        preset_id: presetPickId,
        company_id,
        location_id: locationId || null,
        review_due_date: presetReviewDue || null,
        reference: presetRef || null,
        project_name: presetProjectName.trim() || null,
        client_name: presetClientName.trim() || null,
        principal_contractor: presetPrincipalContractor.trim() || null,
        subcontractor_name: null,
        site_address: presetSiteAddress.trim() || null,
      });
      setSelectedId(d.id);
      setDetail(d);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_preset_create", "Could not create from preset."));
    } finally {
      setBusy(false);
    }
  };

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const companyIdParam = isAdministrator(currentUser) && filterCompanyId ? filterCompanyId : undefined;
      const [list, locs, ulist, presetData] = await Promise.all([
        listRamsAdmin({
          companyId: companyIdParam,
          status: filterStatus || undefined,
        }),
        listLocations(),
        listManagedUsers(),
        getRamsPresets().catch(() => null),
      ]);
      setItems(list);
      setLocations(locs);
      setUsers(ulist);
      if (presetData) {
        setPresets(presetData);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_load", "Could not load RAMS."));
    } finally {
      setLoading(false);
    }
  }, [currentUser, filterCompanyId, filterStatus, t]);

  useEffect(() => {
    if (!isAdministrator(currentUser)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const comps = await listCompanies();
        if (cancelled) {
          return;
        }
        setCompanies(comps);
        if (comps.length > 0) {
          const first = comps.find((c) => c.is_active) ?? comps[0];
          setFilterCompanyId((prev) => prev || first.id);
          setCreateCompanyId((prev) => prev || first.id);
        }
      } catch {
        if (!cancelled) {
          setError(t("rams.error_companies", "Could not load companies."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, t]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await getRams(id);
      setDetail(d);
      setPpePick([...d.ppe_json]);
      setNoSpecialPpe(d.no_special_ppe);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_load", "Could not load RAMS."));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [loadDetail, selectedId]);

  const templatePresets = useMemo(() => {
    const raw =
      presets?.assessment_presets && presets.assessment_presets.length > 0
        ? presets.assessment_presets
        : (presets?.document_presets ?? []);
    const score = (p: RamsDocumentPreset) => (/brick/i.test(p.title) || /brick/i.test(p.id) ? 0 : 1);
    return [...raw].sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title));
  }, [presets]);

  useEffect(() => {
    if (!presets || presetDefaultAppliedRef.current) {
      return;
    }
    const first = templatePresets[0];
    if (first) {
      setPresetPickId(first.id);
      presetDefaultAppliedRef.current = true;
    }
  }, [presets, templatePresets]);

  const locationName = useCallback(
    (id: string | null) => {
      if (!id) {
        return "—";
      }
      return locations.find((l) => l.id === id)?.name ?? "—";
    },
    [locations],
  );

  const toggleNewPpe = (name: string) => {
    setNewPpePick((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const togglePpe = (name: string) => {
    setPpePick((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        company_id: isAdministrator(currentUser) ? createCompanyId || undefined : undefined,
        title,
        reference: reference || null,
        work_activity: workActivity,
        description: description || null,
        location_id: locationId || null,
        risk_level: riskLevel,
        review_due_date: reviewDue || null,
        ppe_json: newPpePick,
        no_special_ppe: newNoSpecialPpe,
      };
      const d = await createRams(body);
      setTitle("");
      setReference("");
      setWorkActivity("");
      setDescription("");
      setLocationId("");
      setReviewDue("");
      setNewPpePick([]);
      setNewNoSpecialPpe(false);
      setSelectedId(d.id);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_create", "Could not create."));
    } finally {
      setBusy(false);
    }
  };

  const saveDetailMeta = async () => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await patchRams(detail.id, {
        title: detail.title,
        reference: detail.reference,
        work_activity: detail.work_activity,
        description: detail.description,
        location_id: detail.location_id,
        risk_level: detail.risk_level,
        review_due_date: detail.review_due_date,
        ppe_json: ppePick,
        no_special_ppe: noSpecialPpe,
        project_name: detail.project_name ?? null,
        client_name: detail.client_name ?? null,
        principal_contractor: detail.principal_contractor ?? null,
        subcontractor_name: detail.subcontractor_name ?? null,
        site_address: detail.site_address ?? null,
        revision: detail.revision ?? null,
        reason_for_issue: detail.reason_for_issue ?? null,
        produced_by_name: detail.produced_by_name ?? null,
        checked_by_name: detail.checked_by_name ?? null,
        approved_by_name: detail.approved_by_name ?? null,
        emergency_contact: detail.emergency_contact ?? null,
        site_manager: detail.site_manager ?? null,
        first_aider: detail.first_aider ?? null,
        fire_marshal: detail.fire_marshal ?? null,
        muster_point: detail.muster_point ?? null,
        nearest_hospital: detail.nearest_hospital ?? null,
        emergency_arrangements: detail.emergency_arrangements ?? null,
        site_security: detail.site_security ?? null,
        welfare_arrangements: detail.welfare_arrangements ?? null,
        public_protection: detail.public_protection ?? null,
        deliveries_storage: detail.deliveries_storage ?? null,
        scope_of_works: detail.scope_of_works ?? null,
        sequence_of_works: detail.sequence_of_works ?? null,
        pre_start_checklist: detail.pre_start_checklist ?? null,
        plant_tools: detail.plant_tools ?? null,
        training_requirements: detail.training_requirements ?? null,
        coshh_items: detail.coshh_items ?? null,
        glove_requirements: detail.glove_requirements ?? null,
        method_statement_sections: detail.method_statement_sections ?? null,
      });
      setDetail(d);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_save", "Could not save."));
    } finally {
      setBusy(false);
    }
  };

  const uploadRamsPhoto = async () => {
    if (!detail || !attachmentFile) {
      setError(t("rams.photo_pick_file", "Choose an image file."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await uploadRamsAttachment(detail.id, {
        file: attachmentFile,
        sectionKey: attachmentSectionKey,
        caption: attachmentCaption.trim() || null,
      });
      setDetail(d);
      setAttachmentFile(null);
      setAttachmentCaption("");
      setAttachmentFileInputKey((k) => k + 1);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.photo_upload_error", "Could not upload photo."));
    } finally {
      setBusy(false);
    }
  };

  const removeRamsPhoto = async (attachmentId: string) => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deleteRamsAttachment(detail.id, attachmentId);
      const d = await getRams(detail.id);
      setDetail(d);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.photo_delete_error", "Could not delete attachment."));
    } finally {
      setBusy(false);
    }
  };

  const runPublish = async () => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await publishRams(detail.id);
      setDetail(d);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_publish", "Could not publish."));
    } finally {
      setBusy(false);
    }
  };

  const runReview = async () => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await reviewRams(detail.id);
      setDetail(d);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_review", "Could not mark reviewed."));
    } finally {
      setBusy(false);
    }
  };

  const runArchive = async () => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await archiveRams(detail.id);
      setDetail(d);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_archive", "Could not archive."));
    } finally {
      setBusy(false);
    }
  };

  const onAddHazard = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!detail) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createRamsHazard(detail.id, {
        ...hazardForm,
        who_might_be_harmed: hazardForm.who_might_be_harmed || null,
      });
      await loadDetail(detail.id);
      setHazardForm({
        hazard: "",
        who_might_be_harmed: "",
        initial_likelihood: 3,
        initial_severity: 3,
        control_measures: "",
        residual_likelihood: 2,
        residual_severity: 2,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_hazard", "Could not add hazard."));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteHazard = async (hid: string) => {
    if (!detail) {
      return;
    }
    setBusy(true);
    try {
      await deleteRamsHazard(detail.id, hid);
      await loadDetail(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_hazard", "Could not delete hazard."));
    } finally {
      setBusy(false);
    }
  };

  const onAddAck = async () => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const ids = pickUserId ? [pickUserId] : [];
      await addRamsAcknowledgements(detail.id, { user_ids: ids, all_site_users: allSiteUsers });
      setPickUserId("");
      setAllSiteUsers(false);
      await loadDetail(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_ack_add", "Could not add acknowledgements."));
    } finally {
      setBusy(false);
    }
  };

  const ppeOptions = useMemo(() => presets?.ppe_options ?? [], [presets]);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("rams.manage_title", "Manage RAMS")}
        description={t(
          "rams.manage_intro",
          "Create risk assessments, hazards, PPE, publish, assign acknowledgements, export.",
        )}
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          {t("rams.create_from_preset_title", "Create from professional preset")}
        </h2>
        <p className="text-xs text-[var(--color-text-soft)]">
          {t(
            "rams.create_from_preset_intro",
            "Creates a draft RAMS with hazards and suggested PPE from a TimIQ template. You can edit before publishing.",
          )}
        </p>
        {(() => {
          const p = templatePresets.find((x) => x.id === presetPickId);
          return p ? (
            <div className="rounded border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-[var(--color-text)]">
              <p className="font-medium text-amber-900">{t("rams.preset_preview_title", "Template preview")}</p>
              <p className="mt-1 text-[var(--color-text-soft)]">
                {t("rams.preset_preview_ppe", "Suggested PPE")}: {p.ppe.length ? p.ppe.join(", ") : "—"}
              </p>
              <p className="mt-0.5 text-[var(--color-text-soft)]">
                {t("rams.preset_preview_hazards", "Hazards to generate")}: {p.hazard_count}
              </p>
            </div>
          ) : null;
        })()}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-[var(--color-text-soft)] md:col-span-2">
            {t("rams.preset_label", "Preset")}
            <select
              className="mt-1 block w-full rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
              value={presetPickId}
              onChange={(e) => setPresetPickId(e.target.value)}
            >
              <option value="">{t("rams.preset_placeholder", "Choose…")}</option>
              {templatePresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.hazard_count} hazards)
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--color-text-soft)]">
            {t("rams.col_site", "Site")}
            <select
              className="mt-1 block w-full rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">{t("rams.no_location", "— None —")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <Input
            label={t("rams.reference", "Reference")}
            value={presetRef}
            onChange={(e) => setPresetRef(e.target.value)}
          />
          <Input
            label={t("rams.review_due", "Review due")}
            type="date"
            value={presetReviewDue}
            onChange={(e) => setPresetReviewDue(e.target.value)}
          />
          <Input
            label={t("rams.project_name", "Project name")}
            value={presetProjectName}
            onChange={(e) => setPresetProjectName(e.target.value)}
          />
          <Input label={t("rams.client_name", "Client name")} value={presetClientName} onChange={(e) => setPresetClientName(e.target.value)} />
          <Input
            label={t("rams.principal_contractor", "Principal contractor")}
            value={presetPrincipalContractor}
            onChange={(e) => setPresetPrincipalContractor(e.target.value)}
          />
          <div className="md:col-span-2">
            <Input
              label={t("rams.site_address", "Site address")}
              value={presetSiteAddress}
              onChange={(e) => setPresetSiteAddress(e.target.value)}
            />
          </div>
        </div>
        <Button type="button" disabled={busy || !presetPickId || (isAdministrator(currentUser) && !createCompanyId)} onClick={() => void onCreateFromPreset()}>
          {t("rams.create_from_preset_action", "Create from preset")}
        </Button>
      </section>

      <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{t("rams.create_assessment", "Create assessment")}</h2>
        {isAdministrator(currentUser) ? (
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-[var(--color-text-soft)]">
              {t("rams.company", "Company")}
              <select
                className="mt-1 block w-full min-w-[200px] rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
                value={createCompanyId}
                onChange={(e) => setCreateCompanyId(e.target.value)}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <form className="grid gap-3 md:grid-cols-2" onSubmit={onCreate}>
          <Input label={t("rams.col_title", "Title")} value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Input label={t("rams.reference", "Reference")} value={reference} onChange={(e) => setReference(e.target.value)} />
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">{t("rams.work_activity", "Work activity")}</label>
            <textarea
              className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
              rows={2}
              value={workActivity}
              onChange={(e) => setWorkActivity(e.target.value)}
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">{t("rams.description", "Description")}</label>
            <textarea
              className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="text-xs text-[var(--color-text-soft)]">
            {t("rams.col_site", "Site")}
            <select
              className="mt-1 block w-full rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">{t("rams.no_location", "— None —")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--color-text-soft)]">
            {t("rams.col_risk", "Risk level")}
            <select
              className="mt-1 block w-full rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value)}
            >
              {["low", "medium", "high", "critical"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <Input label={t("rams.review_due", "Review due")} type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} />
          <div className="md:col-span-2">
            <p className="mb-2 text-xs font-medium text-[var(--color-text-soft)]">{t("rams.ppe", "PPE")}</p>
            <div className="flex flex-wrap gap-2">
              {ppeOptions.map((p) => (
                <label key={p} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={newPpePick.includes(p)} onChange={() => toggleNewPpe(p)} />
                  {p}
                </label>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newNoSpecialPpe} onChange={(e) => setNewNoSpecialPpe(e.target.checked)} />
              {t("rams.no_special_ppe_flag", "No special PPE required")}
            </label>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              {t("rams.create_assessment", "Create assessment")}
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          {isAdministrator(currentUser) ? (
            <label className="text-xs text-[var(--color-text-soft)]">
              {t("rams.filter_company", "Company")}
              <select
                className="mt-1 block min-w-[180px] rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
                value={filterCompanyId}
                onChange={(e) => setFilterCompanyId(e.target.value)}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-xs text-[var(--color-text-soft)]">
            {t("rams.filter_status", "Status")}
            <select
              className="mt-1 block rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">{t("rams.all_statuses", "All")}</option>
              {["draft", "published", "reviewed", "archived"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? (
          <p className="text-sm text-[var(--color-text-soft)]">{t("rams.loading", "Loading…")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rams.col_title", "Title")}</TableHead>
                  <TableHead>{t("rams.col_site", "Site")}</TableHead>
                  <TableHead>{t("rams.col_risk", "Risk")}</TableHead>
                  <TableHead>{t("rams.col_status", "Status")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell>{locationName(row.location_id)}</TableCell>
                    <TableCell>{row.risk_level}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedId(row.id)}>
                        {t("rams.open", "Open")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Sheet>
        <SheetBody className="space-y-4">
          {detailLoading && selectedId ? <p className="text-sm text-[var(--color-text-soft)]">{t("rams.loading", "Loading…")}</p> : null}
          {detail && selectedId === detail.id ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{detail.title}</h2>
                <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedId(null)}>
                  {t("rams.close_detail", "Close")}
                </Button>
              </div>
              <p className="text-xs text-[var(--color-text-soft)]">
                {t("rams.status", "Status")}: {detail.status} · {t("rams.archived_at", "Archived at")}:{" "}
                {detail.archived_at ? formatDate(detail.archived_at) : "—"}
              </p>
              {detail.signoff_progress ? (
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
                  <p className="font-medium text-[var(--color-text)]">
                    {t("rams.signoff_progress_title", "Employee sign-off progress")}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-soft)]">
                    {t("rams.signoff_total", "Total")}: {detail.signoff_progress.total_assigned} ·{" "}
                    {t("rams.signoff_pending", "Pending")}: {detail.signoff_progress.pending} ·{" "}
                    {t("rams.signoff_ack", "Acknowledged")}: {detail.signoff_progress.acknowledged} ·{" "}
                    {t("rams.signoff_declined", "Declined")}: {detail.signoff_progress.declined}
                  </p>
                </div>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                <Input label={t("rams.col_title", "Title")} value={detail.title} onChange={(e) => setDetail({ ...detail, title: e.target.value })} />
                <Input label={t("rams.reference", "Reference")} value={detail.reference ?? ""} onChange={(e) => setDetail({ ...detail, reference: e.target.value || null })} />
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">{t("rams.work_activity", "Work activity")}</label>
                  <textarea
                    className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                    rows={2}
                    value={detail.work_activity}
                    onChange={(e) => setDetail({ ...detail, work_activity: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">{t("rams.description", "Description")}</label>
                  <textarea
                    className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                    rows={2}
                    value={detail.description ?? ""}
                    onChange={(e) => setDetail({ ...detail, description: e.target.value || null })}
                  />
                </div>
                <label className="text-xs text-[var(--color-text-soft)]">
                  {t("rams.col_site", "Site")}
                  <select
                    className="mt-1 block w-full rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
                    value={detail.location_id ?? ""}
                    onChange={(e) => setDetail({ ...detail, location_id: e.target.value || null })}
                  >
                    <option value="">{t("rams.no_location", "— None —")}</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[var(--color-text-soft)]">
                  {t("rams.col_risk", "Risk level")}
                  <select
                    className="mt-1 block w-full rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
                    value={detail.risk_level}
                    onChange={(e) => setDetail({ ...detail, risk_level: e.target.value })}
                  >
                    {["low", "medium", "high", "critical"].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  label={t("rams.review_due", "Review due")}
                  type="date"
                  value={detail.review_due_date?.slice(0, 10) ?? ""}
                  onChange={(e) => setDetail({ ...detail, review_due_date: e.target.value || null })}
                />
              </div>
              <details className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
                <summary className="cursor-pointer font-medium text-[var(--color-text)]">
                  {t("rams.doc_project_section", "Project & document")}
                </summary>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <Input
                    label={t("rams.project_name", "Project name")}
                    value={detail.project_name ?? ""}
                    onChange={(e) => setDetail({ ...detail, project_name: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.client_name", "Client name")}
                    value={detail.client_name ?? ""}
                    onChange={(e) => setDetail({ ...detail, client_name: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.principal_contractor", "Principal contractor")}
                    value={detail.principal_contractor ?? ""}
                    onChange={(e) => setDetail({ ...detail, principal_contractor: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.subcontractor_name", "Subcontractor")}
                    value={detail.subcontractor_name ?? ""}
                    onChange={(e) => setDetail({ ...detail, subcontractor_name: e.target.value || null })}
                  />
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">
                      {t("rams.site_address", "Site address")}
                    </label>
                    <textarea
                      className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                      rows={2}
                      value={detail.site_address ?? ""}
                      onChange={(e) => setDetail({ ...detail, site_address: e.target.value || null })}
                    />
                  </div>
                  <Input
                    label={t("rams.revision", "Revision")}
                    value={detail.revision ?? ""}
                    onChange={(e) => setDetail({ ...detail, revision: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.reason_for_issue", "Reason for issue")}
                    value={detail.reason_for_issue ?? ""}
                    onChange={(e) => setDetail({ ...detail, reason_for_issue: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.produced_by", "Produced by")}
                    value={detail.produced_by_name ?? ""}
                    onChange={(e) => setDetail({ ...detail, produced_by_name: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.checked_by", "Checked by")}
                    value={detail.checked_by_name ?? ""}
                    onChange={(e) => setDetail({ ...detail, checked_by_name: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.approved_by", "Approved by")}
                    value={detail.approved_by_name ?? ""}
                    onChange={(e) => setDetail({ ...detail, approved_by_name: e.target.value || null })}
                  />
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">
                      {t("rams.scope_of_works", "Scope of works")}
                    </label>
                    <textarea
                      className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                      rows={4}
                      value={detail.scope_of_works ?? ""}
                      onChange={(e) => setDetail({ ...detail, scope_of_works: e.target.value || null })}
                    />
                  </div>
                </div>
              </details>
              <details className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
                <summary className="cursor-pointer font-medium text-[var(--color-text)]">
                  {t("rams.emergency_site_section", "Emergency & site controls")}
                </summary>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <Input
                    label={t("rams.emergency_contact", "Emergency contact")}
                    value={detail.emergency_contact ?? ""}
                    onChange={(e) => setDetail({ ...detail, emergency_contact: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.site_manager", "Site manager")}
                    value={detail.site_manager ?? ""}
                    onChange={(e) => setDetail({ ...detail, site_manager: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.first_aider", "First aider")}
                    value={detail.first_aider ?? ""}
                    onChange={(e) => setDetail({ ...detail, first_aider: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.fire_marshal", "Fire marshal")}
                    value={detail.fire_marshal ?? ""}
                    onChange={(e) => setDetail({ ...detail, fire_marshal: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.muster_point", "Muster point")}
                    value={detail.muster_point ?? ""}
                    onChange={(e) => setDetail({ ...detail, muster_point: e.target.value || null })}
                  />
                  <Input
                    label={t("rams.nearest_hospital", "Nearest hospital")}
                    value={detail.nearest_hospital ?? ""}
                    onChange={(e) => setDetail({ ...detail, nearest_hospital: e.target.value || null })}
                  />
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">
                      {t("rams.emergency_arrangements", "Emergency arrangements")}
                    </label>
                    <textarea
                      className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                      rows={3}
                      value={detail.emergency_arrangements ?? ""}
                      onChange={(e) => setDetail({ ...detail, emergency_arrangements: e.target.value || null })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">
                      {t("rams.site_security", "Site security")}
                    </label>
                    <textarea
                      className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                      rows={2}
                      value={detail.site_security ?? ""}
                      onChange={(e) => setDetail({ ...detail, site_security: e.target.value || null })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">
                      {t("rams.welfare_arrangements", "Welfare arrangements")}
                    </label>
                    <textarea
                      className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                      rows={2}
                      value={detail.welfare_arrangements ?? ""}
                      onChange={(e) => setDetail({ ...detail, welfare_arrangements: e.target.value || null })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">
                      {t("rams.public_protection", "Public protection")}
                    </label>
                    <textarea
                      className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                      rows={2}
                      value={detail.public_protection ?? ""}
                      onChange={(e) => setDetail({ ...detail, public_protection: e.target.value || null })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">
                      {t("rams.deliveries_storage", "Deliveries / storage")}
                    </label>
                    <textarea
                      className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                      rows={2}
                      value={detail.deliveries_storage ?? ""}
                      onChange={(e) => setDetail({ ...detail, deliveries_storage: e.target.value || null })}
                    />
                  </div>
                </div>
              </details>
              <div>
                <p className="mb-2 text-xs font-medium text-[var(--color-text-soft)]">{t("rams.ppe", "PPE")}</p>
                <div className="flex flex-wrap gap-2">
                  {ppeOptions.map((p) => (
                    <label key={p} className="flex items-center gap-1 text-sm">
                      <input type="checkbox" checked={ppePick.includes(p)} onChange={() => togglePpe(p)} />
                      {p}
                    </label>
                  ))}
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={noSpecialPpe} onChange={(e) => setNoSpecialPpe(e.target.checked)} />
                  {t("rams.no_special_ppe_flag", "No special PPE required")}
                </label>
              </div>
              {detail.status !== "archived" ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveDetailMeta()}>
                  {t("rams.save", "Save changes")}
                </Button>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
                {detail.status === "draft" ? (
                  <Button type="button" disabled={busy} onClick={() => void runPublish()}>
                    {t("rams.publish", "Publish")}
                  </Button>
                ) : null}
                {detail.status === "published" ? (
                  <>
                    <Button type="button" disabled={busy} onClick={() => void runReview()}>
                      {t("rams.reviewed", "Mark reviewed")}
                    </Button>
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => void runArchive()}>
                      {t("rams.archived_action", "Archive")}
                    </Button>
                  </>
                ) : null}
                {detail.status === "reviewed" ? (
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void runArchive()}>
                    {t("rams.archived_action", "Archive")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void downloadRamsPdf(detail.id, detail.reference ?? detail.id).catch((e) =>
                      setError(e instanceof Error ? e.message : "PDF failed"),
                    )
                  }
                >
                  {t("rams.download_rams_pdf", "Download RAMS PDF")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => openRamsPrint(detail.id)}>
                  {t("rams.print_rams_pack", "Print")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || !canHardDeleteRams}
                  onClick={() => {
                    if (!window.confirm(t("rams.delete_confirm", "Delete permanently? This cannot be undone."))) {
                      return;
                    }
                    void (async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await deleteRams(detail.id);
                        setSelectedId(null);
                        setDetail(null);
                        await loadLists();
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : t("rams.error_delete", "Could not delete.");
                        if (msg.toLowerCase().includes("acknowledgement") || msg.toLowerCase().includes("draft")) {
                          setError(
                            t("rams.delete_blocked_archive", "This record has compliance activity. Archive it instead."),
                          );
                        } else {
                          setError(msg);
                        }
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  {t("rams.delete", "Delete")}
                </Button>
              </div>

              <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{t("rams.photos_title", "Photos & attachments")}</h3>
                <p className="text-xs text-[var(--color-text-soft)]">
                  {t("rams.photos_intro", "Upload site photos for the print pack. Images only (JPEG, PNG, WebP).")}
                </p>
                {detail.status === "archived" ? (
                  <p className="text-xs text-[var(--color-text-soft)]">{t("rams.archived_readonly", "Archived — uploads disabled.")}</p>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-[var(--color-text-soft)]">
                      {t("rams.photo_section", "Section")}
                      <select
                        className="mt-1 block min-w-[160px] rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
                        value={attachmentSectionKey}
                        onChange={(e) => setAttachmentSectionKey(e.target.value as (typeof RAMS_ATTACHMENT_SECTION_KEYS)[number])}
                      >
                        {RAMS_ATTACHMENT_SECTION_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {k.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Input
                      label={t("rams.photo_caption", "Caption")}
                      value={attachmentCaption}
                      onChange={(e) => setAttachmentCaption(e.target.value)}
                      className="min-w-[180px]"
                    />
                    <label className="text-xs text-[var(--color-text-soft)]">
                      {t("rams.photo_file", "File")}
                      <input
                        key={attachmentFileInputKey}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="mt-1 block w-full max-w-[220px] text-sm"
                        onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void uploadRamsPhoto()}>
                      {t("rams.photo_upload", "Upload")}
                    </Button>
                  </div>
                )}
                {(detail.attachments ?? []).length === 0 ? (
                  <p className="text-xs text-[var(--color-text-soft)]">{t("rams.no_attachments", "No attachments yet.")}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {(detail.attachments ?? []).map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-white px-3 py-2"
                      >
                        <div>
                          <a
                            className="font-medium text-[var(--color-link)] underline"
                            href={ramsAttachmentUrl(a)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {a.original_filename}
                          </a>
                          <span className="ml-2 text-xs text-[var(--color-text-soft)]">
                            {a.section_key}
                            {a.caption ? ` · ${a.caption}` : ""}
                          </span>
                        </div>
                        {detail.status !== "archived" ? (
                          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void removeRamsPhoto(a.id)}>
                            {t("rams.delete", "Delete")}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {detail.status !== "archived" ? (
                <>
                  <h3 className="text-sm font-semibold">{t("rams.hazards", "Hazards")}</h3>
                  <div className="overflow-x-auto rounded border border-[var(--color-border)]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("rams.hazard", "Hazard")}</TableHead>
                          <TableHead>{t("rams.initial_risk", "Initial risk")}</TableHead>
                          <TableHead>{t("rams.residual_risk", "Residual risk")}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.hazards.map((h) => (
                          <TableRow key={h.id}>
                            <TableCell>{h.hazard}</TableCell>
                            <TableCell>
                              {h.initial_risk_score} ({h.initial_risk_band})
                            </TableCell>
                            <TableCell>
                              {h.residual_risk_score} ({h.residual_risk_band})
                            </TableCell>
                            <TableCell className="text-right">
                              <Button type="button" size="sm" variant="secondary" onClick={() => void onDeleteHazard(h.id)}>
                                {t("rams.delete", "Delete")}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <form className="grid gap-2 md:grid-cols-2" onSubmit={onAddHazard}>
                    <Input label={t("rams.hazard", "Hazard")} value={hazardForm.hazard} onChange={(e) => setHazardForm({ ...hazardForm, hazard: e.target.value })} />
                    <Input
                      label={t("rams.who_harmed", "Who might be harmed")}
                      value={hazardForm.who_might_be_harmed ?? ""}
                      onChange={(e) => setHazardForm({ ...hazardForm, who_might_be_harmed: e.target.value })}
                    />
                    <Input
                      label="L initial"
                      type="number"
                      min={1}
                      max={5}
                      value={String(hazardForm.initial_likelihood)}
                      onChange={(e) => setHazardForm({ ...hazardForm, initial_likelihood: Number(e.target.value) })}
                    />
                    <Input
                      label="S initial"
                      type="number"
                      min={1}
                      max={5}
                      value={String(hazardForm.initial_severity)}
                      onChange={(e) => setHazardForm({ ...hazardForm, initial_severity: Number(e.target.value) })}
                    />
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]">{t("rams.controls", "Controls")}</label>
                      <textarea
                        className="w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                        rows={2}
                        value={hazardForm.control_measures}
                        onChange={(e) => setHazardForm({ ...hazardForm, control_measures: e.target.value })}
                        required
                      />
                    </div>
                    <Input
                      label="L residual"
                      type="number"
                      min={1}
                      max={5}
                      value={String(hazardForm.residual_likelihood)}
                      onChange={(e) => setHazardForm({ ...hazardForm, residual_likelihood: Number(e.target.value) })}
                    />
                    <Input
                      label="S residual"
                      type="number"
                      min={1}
                      max={5}
                      value={String(hazardForm.residual_severity)}
                      onChange={(e) => setHazardForm({ ...hazardForm, residual_severity: Number(e.target.value) })}
                    />
                    <div className="md:col-span-2">
                      <Button type="submit" disabled={busy}>
                        {t("rams.add_hazard", "Add hazard")}
                      </Button>
                    </div>
                  </form>

                  <h3 className="text-sm font-semibold">{t("rams.assign_ack", "Assign acknowledgements")}</h3>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-[var(--color-text-soft)]">
                      {t("rams.employee", "Employee")}
                      <select
                        className="mt-1 block min-w-[200px] rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
                        value={pickUserId}
                        onChange={(e) => setPickUserId(e.target.value)}
                      >
                        <option value="">{t("rams.pick_user", "— Select —")}</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={allSiteUsers} onChange={(e) => setAllSiteUsers(e.target.checked)} />
                      {t("rams.all_site_users", "All site users at location")}
                    </label>
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => void onAddAck()}>
                      {t("rams.add_ack", "Add")}
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded border border-[var(--color-border)]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("rams.employee", "Employee")}</TableHead>
                          <TableHead>{t("rams.col_status", "Status")}</TableHead>
                          <TableHead>{t("rams.acknowledgement_name", "Name")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.acknowledgements.map((a) => (
                          <TableRow key={a.user_id}>
                            <TableCell>{a.display_name || a.user_email || a.user_id}</TableCell>
                            <TableCell>{a.status}</TableCell>
                            <TableCell>{a.acknowledgement_name ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </SheetBody>
      </Sheet>
    </div>
  );
}
