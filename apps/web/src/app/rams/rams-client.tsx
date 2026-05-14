"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  Input,
  PageHeader,
  Sheet,
  SheetBody,
} from "../../components/ui";
import { SignaturePad } from "../../components/signature/signature-pad";
import { isEmployee, useCurrentUser } from "../../features/auth";
import {
  declineRams,
  downloadRamsPdf,
  getRams,
  listMyRams,
  acknowledgeRams,
  openRamsPrint,
  ramsAttachmentUrl,
  type RamsAssessmentDetail,
  type RamsAssessmentListItem,
} from "../../features/rams/api";
import { listLocations, type Location } from "../../features/locations/api";
import { useT } from "../../lib/i18n";

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

type RamsEmployeeTab = "overview" | "ppe" | "hazards" | "method" | "photos" | "signoff";

function riskChipClass(level: string): string {
  switch (level) {
    case "low":
      return "border-emerald-400 bg-emerald-50 text-emerald-900";
    case "medium":
      return "border-amber-400 bg-amber-50 text-amber-950";
    case "high":
      return "border-orange-500 bg-orange-50 text-orange-950";
    case "critical":
      return "border-red-600 bg-red-50 text-red-950";
    default:
      return "border-[var(--color-border)] bg-[var(--color-cell)] text-[var(--color-text)]";
  }
}

export function RamsClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const [items, setItems] = useState<RamsAssessmentListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [detail, setDetail] = useState<RamsAssessmentDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [ackName, setAckName] = useState("");
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [readAck, setReadAck] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [navigatorOffline, setNavigatorOffline] = useState(false);
  const [detailTab, setDetailTab] = useState<RamsEmployeeTab>("overview");

  const employee = Boolean(currentUser && isEmployee(currentUser));

  useEffect(() => {
    setMounted(true);
    const sync = () => setNavigatorOffline(typeof navigator !== "undefined" && !navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const offlineBlock = mounted && navigatorOffline;

  const loadList = useCallback(async () => {
    if (!employee) {
      setItems([]);
      setLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [list, locs] = await Promise.all([listMyRams(), listLocations().catch(() => [])]);
      setItems(list);
      setLocations(locs);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_load", "Could not load RAMS."));
    } finally {
      setLoading(false);
    }
  }, [employee, t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const locationName = useCallback(
    (id: string | null) => {
      if (!id) {
        return "—";
      }
      return locations.find((l) => l.id === id)?.name ?? "—";
    },
    [locations],
  );

  const sorted = useMemo(() => {
    const score = (s: RamsAssessmentListItem) => {
      if (s.my_ack_status === "pending" && (s.status === "published" || s.status === "reviewed")) {
        return 0;
      }
      return 1;
    };
    return [...items].sort((a, b) => score(a) - score(b) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [items]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setError("");
    setAckName("");
    setSignaturePng(null);
    setReadAck(false);
    setDeclineReason("");
    setDetailTab("overview");
    try {
      const d = await getRams(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_load", "Could not load RAMS."));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const myRow = useMemo(() => {
    if (!detail || !currentUser) {
      return null;
    }
    return detail.acknowledgements.find((a) => a.user_id === currentUser.id) ?? null;
  }, [detail, currentUser]);

  const tabLabels = useMemo<Record<RamsEmployeeTab, string>>(
    () => ({
      overview: t("rams.tab_overview", "Overview"),
      ppe: t("rams.tab_ppe", "PPE"),
      hazards: t("rams.tab_hazards", "Hazards & controls"),
      method: t("rams.tab_method", "Method statement"),
      photos: t("rams.tab_photos", "Photos"),
      signoff: t("rams.tab_signoff", "Acknowledge"),
    }),
    [t],
  );

  const submitAck = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!detail || !selectedId) {
      return;
    }
    if (offlineBlock) {
      setError(t("rams.offline_ack", "Acknowledgement requires connection."));
      return;
    }
    setActionBusy(true);
    setError("");
    try {
      const d = await acknowledgeRams(selectedId, {
        read_understood_ack: readAck,
        acknowledgement_name: ackName.trim(),
        signature_image_data: signaturePng ?? "",
      });
      setDetail(d);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_ack", "Could not acknowledge."));
    } finally {
      setActionBusy(false);
    }
  };

  const submitDecline = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!detail || !selectedId) {
      return;
    }
    if (offlineBlock) {
      setError(t("rams.offline_ack", "Acknowledgement requires connection."));
      return;
    }
    setActionBusy(true);
    setError("");
    try {
      const d = await declineRams(selectedId, declineReason);
      setDetail(d);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_decline", "Could not decline."));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("rams.title", "RAMS / risk assessments")}
        description={t("rams.employee_intro", "Review assigned risk assessments and acknowledge.")}
      />
      {!isEmployee(currentUser) ? (
        <p className="text-sm text-[var(--color-text-soft)]">
          {t(
            "rams.employee_only_hint",
            "RAMS acknowledgement is for employee accounts. Managers can use Manage RAMS.",
          )}{" "}
          <a className="font-semibold underline" href="/rams/manage">
            {t("rams.manage_link", "Manage RAMS")}
          </a>
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {offlineBlock ? (
        <p className="text-sm text-[var(--color-text-soft)]">{t("rams.offline_ack", "Acknowledgement requires connection.")}</p>
      ) : null}
      {loading ? (
        <p className="text-sm text-[var(--color-text-soft)]">{t("rams.loading", "Loading…")}</p>
      ) : employee ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.length === 0 ? (
            <p className="text-sm text-[var(--color-text-soft)] sm:col-span-2">{t("rams.empty", "No RAMS assigned yet.")}</p>
          ) : (
            sorted.map((row) => (
              <button
                key={row.id}
                type="button"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left shadow-sm transition hover:border-[var(--color-text-soft)]"
                onClick={() => void openDetail(row.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-[var(--color-text)]">{row.title}</span>
                  <span className={`shrink-0 rounded border px-2 py-0.5 text-xs capitalize ${riskChipClass(row.risk_level)}`}>
                    {row.risk_level}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-soft)]">
                  {t("rams.col_site", "Site")}: {locationName(row.location_id)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-soft)]">
                  {t("rams.review_due", "Review due")}: {formatDate(row.review_due_date)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-soft)]">
                  {t("rams.col_your_status", "Your status")}: {row.my_ack_status ?? "—"}
                </p>
                <p className="mt-3 text-xs font-medium text-[var(--color-link)]">{t("rams.open", "Open")} →</p>
              </button>
            ))
          )}
        </div>
      ) : null}

      <Sheet>
        <SheetBody>
          {detailLoading && selectedId ? (
            <p className="text-sm text-[var(--color-text-soft)]">{t("rams.loading", "Loading…")}</p>
          ) : null}
          {detail && selectedId === detail.id ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">{detail.title}</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      void downloadRamsPdf(detail.id, detail.reference ?? detail.id).catch((e) =>
                        setError(e instanceof Error ? e.message : t("rams.error_pdf", "Could not download PDF.")),
                      )
                    }
                  >
                    {t("rams.download_rams_pdf", "Download RAMS PDF")}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => openRamsPrint(detail.id)}>
                    {t("rams.open_print_pack", "Print view")}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedId(null)}>
                    {t("rams.close_detail", "Close")}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] pb-2">
                {(["overview", "ppe", "hazards", "method", "photos", "signoff"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      detailTab === key ? "bg-[var(--color-text)] text-white" : "bg-[var(--color-cell)] text-[var(--color-text)]"
                    }`}
                    onClick={() => setDetailTab(key)}
                  >
                    {tabLabels[key]}
                  </button>
                ))}
              </div>

              {detailTab === "overview" ? (
                <div className="space-y-3">
                  <p className="text-[var(--color-text-soft)]">
                    {t("rams.work_activity", "Work activity")}: <span className="text-[var(--color-text)]">{detail.work_activity}</span>
                  </p>
                  {detail.description ? <p className="whitespace-pre-wrap text-[var(--color-text)]">{detail.description}</p> : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p>
                      <span className="font-medium text-[var(--color-text)]">{t("rams.col_site", "Site")}: </span>
                      {locationName(detail.location_id)}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--color-text)]">{t("rams.col_risk", "Risk")}: </span>
                      <span className={`inline-block rounded border px-2 py-0.5 text-xs capitalize ${riskChipClass(detail.risk_level)}`}>
                        {detail.risk_level}
                      </span>
                    </p>
                    <p>
                      <span className="font-medium text-[var(--color-text)]">{t("rams.review_due", "Review due")}: </span>
                      {formatDate(detail.review_due_date)}
                    </p>
                    {detail.project_name ? (
                      <p>
                        <span className="font-medium text-[var(--color-text)]">{t("rams.project_name", "Project")}: </span>
                        {detail.project_name}
                      </p>
                    ) : null}
                    {detail.client_name ? (
                      <p>
                        <span className="font-medium text-[var(--color-text)]">{t("rams.client_name", "Client")}: </span>
                        {detail.client_name}
                      </p>
                    ) : null}
                  </div>
                  {detail.emergency_contact || detail.muster_point ? (
                    <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-xs">
                      <p className="font-medium text-[var(--color-text)]">{t("rams.emergency_summary", "Emergency (summary)")}</p>
                      {detail.emergency_contact ? <p className="mt-1">{detail.emergency_contact}</p> : null}
                      {detail.muster_point ? (
                        <p className="mt-1">
                          {t("rams.muster_point", "Muster point")}: {detail.muster_point}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {detailTab === "ppe" ? (
                <div>
                  <p className="font-semibold text-[var(--color-text)]">{t("rams.ppe", "PPE")}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {detail.ppe_json.length === 0 && detail.no_special_ppe ? (
                      <li className="text-[var(--color-text-soft)]">{t("rams.no_special_ppe", "No special PPE (as recorded)")}</li>
                    ) : (
                      detail.ppe_json.map((p) => <li key={p}>{p}</li>)
                    )}
                  </ul>
                  {detail.glove_requirements && detail.glove_requirements.length > 0 ? (
                    <div className="mt-4">
                      <p className="font-semibold text-[var(--color-text)]">{t("rams.glove_requirements", "Glove / task PPE")}</p>
                      <ul className="mt-1 list-disc pl-5">
                        {detail.glove_requirements.map((g, i) => (
                          <li key={`${g}-${i}`}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {detailTab === "hazards" ? (
                <div className="space-y-2">
                  {detail.hazards.map((h) => (
                    <div key={h.id} className="rounded border border-[var(--color-border)] p-3">
                      <p className="font-medium">{h.hazard}</p>
                      {h.who_might_be_harmed ? (
                        <p className="text-[var(--color-text-soft)]">
                          {t("rams.who_harmed", "Who might be harmed")}: {h.who_might_be_harmed}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[var(--color-text-soft)]">
                        {t("rams.initial_risk", "Initial risk")}: {h.initial_risk_score} ({h.initial_risk_band}) →{" "}
                        {t("rams.residual_risk", "Residual risk")}: {h.residual_risk_score} ({h.residual_risk_band})
                        {h.residual_higher_than_initial ? (
                          <span className="ml-1 text-amber-700"> ({t("rams.residual_warning", "residual higher than initial")})</span>
                        ) : null}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap">{h.control_measures}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {detailTab === "method" ? (
                <div className="space-y-4">
                  {detail.sequence_of_works && detail.sequence_of_works.length > 0 ? (
                    <div>
                      <p className="font-semibold text-[var(--color-text)]">{t("rams.sequence_of_works", "Sequence of works")}</p>
                      <ol className="mt-2 list-decimal space-y-1 pl-5">
                        {detail.sequence_of_works.map((step, idx) => (
                          <li key={idx}>{step.text ?? "—"}</li>
                        ))}
                      </ol>
                    </div>
                  ) : (
                    <p className="text-[var(--color-text-soft)]">{t("rams.no_method_sequence", "No sequence of works recorded.")}</p>
                  )}
                  {detail.method_statement_sections && detail.method_statement_sections.length > 0 ? (
                    <div className="space-y-3">
                      {detail.method_statement_sections.map((sec, idx) => (
                        <div key={idx} className="rounded border border-[var(--color-border)] p-3">
                          {sec.title ? <p className="font-medium">{sec.title}</p> : null}
                          {sec.body ? <p className="mt-1 whitespace-pre-wrap text-[var(--color-text-soft)]">{sec.body}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {detailTab === "photos" ? (
                <div className="space-y-3">
                  {(detail.attachments ?? []).length === 0 ? (
                    <p className="text-[var(--color-text-soft)]">{t("rams.no_attachments", "No attachments yet.")}</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(detail.attachments ?? []).map((a) => (
                        <div key={a.id} className="rounded border border-[var(--color-border)] p-2">
                          <a href={ramsAttachmentUrl(a)} target="_blank" rel="noopener noreferrer" className="block">
                            {a.content_type.startsWith("image/") ? (
                              <img
                                src={ramsAttachmentUrl(a)}
                                alt={a.caption ?? a.original_filename}
                                className="h-40 w-full rounded object-cover"
                              />
                            ) : (
                              <span className="block py-8 text-center text-xs text-[var(--color-text-soft)]">{a.original_filename}</span>
                            )}
                          </a>
                          <p className="mt-1 text-xs text-[var(--color-text-soft)]">
                            {a.section_key}
                            {a.caption ? ` · ${a.caption}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {detailTab === "signoff" ? (
                <>
                  {isEmployee(currentUser) && myRow?.status === "pending" && (detail.status === "published" || detail.status === "reviewed") ? (
                    <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                      <form className="space-y-3" onSubmit={submitAck}>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" checked={readAck} onChange={(e) => setReadAck(e.target.checked)} className="mt-1" />
                          <span>{t("rams.read_ack", "I have read and understood this RAMS / risk assessment.")}</span>
                        </label>
                        <Input
                          label={t("signature.printed_name_label", "Printed name")}
                          value={ackName}
                          onChange={(e) => setAckName(e.target.value)}
                        />
                        <SignaturePad disabled={actionBusy || offlineBlock} value={signaturePng} onChange={setSignaturePng} />
                        <Button
                          type="submit"
                          disabled={actionBusy || offlineBlock || !readAck || !ackName.trim() || !signaturePng}
                        >
                          {t("rams.acknowledge", "Acknowledge")}
                        </Button>
                      </form>
                      <form className="space-y-2" onSubmit={submitDecline}>
                        <Input label={t("rams.decline_reason", "Decline reason")} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
                        <Button type="submit" variant="secondary" disabled={actionBusy || offlineBlock}>
                          {t("rams.decline", "Decline")}
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <p className="text-[var(--color-text-soft)]">
                      {myRow?.status === "acknowledged"
                        ? t("rams.already_ack", "You have already acknowledged this RAMS.")
                        : t("rams.signoff_unavailable", "Sign-off is not required or is not available for this RAMS.")}
                    </p>
                  )}
                </>
              ) : null}
            </div>
          ) : null}
        </SheetBody>
      </Sheet>
    </div>
  );
}
