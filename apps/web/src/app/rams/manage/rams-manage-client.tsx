"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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
  createRamsHazard,
  deleteRamsHazard,
  downloadRamsCsv,
  getRams,
  getRamsPresets,
  listRamsAdmin,
  openRamsPrint,
  patchRams,
  publishRams,
  reviewRams,
  type RamsAssessmentDetail,
  type RamsAssessmentListItem,
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
      });
      setDetail(d);
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_save", "Could not save."));
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
                <Button type="button" variant="secondary" onClick={() => openRamsPrint(detail.id)}>
                  {t("rams.print_rams", "Print RAMS")}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void downloadRamsCsv(detail.id)}>
                  {t("rams.export_csv", "Export CSV")}
                </Button>
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
