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

function renderDocumentBlock(detail: RamsAssessmentDetail, block: NonNullable<RamsAssessmentDetail["document_sections"]>[number]["blocks"][number]) {
  if (block.type === "text" && block.text) {
    return <p className="whitespace-pre-wrap text-[var(--color-text)]">{block.text}</p>;
  }
  if (block.type === "list" && block.items?.length) {
    return <ul className="list-disc space-y-1 pl-5">{block.items.map((item, idx) => <li key={`${block.id}-${idx}`}>{item}</li>)}</ul>;
  }
  if (block.type === "table" && block.rows?.length) {
    const columns = block.columns?.length ? block.columns : Object.keys(block.rows[0] ?? {});
    return (
      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-[var(--color-header)]"><tr>{columns.map((col) => <th className="px-3 py-2 font-semibold" key={col}>{col}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, idx) => <tr className="border-t border-[var(--color-border)]" key={`${block.id}-row-${idx}`}>{columns.map((col) => <td className="px-3 py-2 align-top" key={col}>{String(row[col] ?? "")}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (block.type === "photo") {
    const attachment = (detail.attachments ?? []).find((a) => a.section_key === block.section_key);
    if (attachment && attachment.content_type.startsWith("image/")) {
      return <figure className="rounded border border-[var(--color-border)] p-2"><img alt={block.caption ?? attachment.original_filename} className="max-h-80 w-full object-contain" src={ramsAttachmentUrl(attachment)} /><figcaption className="mt-1 text-xs text-[var(--color-text-soft)]">{block.caption ?? attachment.original_filename}</figcaption></figure>;
    }
    return block.caption ? <p className="text-xs text-[var(--color-text-soft)]">Photo: {block.caption}</p> : null;
  }
  if (block.type === "hazard_table") {
    return <div className="space-y-2">{detail.hazards.map((h) => <div className="rounded border border-[var(--color-border)] p-3" key={h.id}><p className="font-medium">{h.hazard}</p><p className="text-xs text-[var(--color-text-soft)]">Initial {h.initial_risk_score} ({h.initial_risk_band}) · Residual {h.residual_risk_score} ({h.residual_risk_band})</p><p className="mt-2 whitespace-pre-wrap">{h.control_measures}</p></div>)}</div>;
  }
  if (block.type === "risk_matrix") {
    return <p className="text-[var(--color-text-soft)]">Risk score is likelihood x severity using a 1-5 scale: low 1-5, medium 6-10, high 11-15, critical 16-25.</p>;
  }
  return null;
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
              <div className="grid gap-2 rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-xs sm:grid-cols-2">
                <p><span className="font-medium">{t("rams.col_site", "Site")}:</span> {locationName(detail.location_id)}</p>
                <p><span className="font-medium">{t("rams.review_due", "Review due")}:</span> {formatDate(detail.review_due_date)}</p>
                <p><span className="font-medium">{t("rams.col_risk", "Risk")}:</span> <span className={`inline-block rounded border px-2 py-0.5 text-xs capitalize ${riskChipClass(detail.risk_level)}`}>{detail.risk_level}</span></p>
                <p><span className="font-medium">{t("rams.col_your_status", "Your status")}:</span> {myRow?.status ?? "pending"}</p>
              </div>
              <div className="space-y-5">
                {(detail.document_sections ?? []).filter((section) => section.visible_in_pdf).map((section) => (
                  <section className="rounded border border-[var(--color-border)] bg-white p-4" key={section.id}>
                    <h3 className="border-b border-[var(--color-border)] pb-2 text-base font-semibold text-[var(--color-text)]">{section.title}</h3>
                    {section.not_applicable ? <p className="mt-3 text-[var(--color-text-soft)]">Not applicable.</p> : null}
                    <div className="mt-3 space-y-3">{section.blocks.map((block) => <div key={block.id}>{renderDocumentBlock(detail, block)}</div>)}</div>
                  </section>
                ))}
              </div>
              <section className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <h3 className="text-base font-semibold text-[var(--color-text)]">Final acknowledgement</h3>
                {isEmployee(currentUser) && myRow?.status === "pending" && (detail.status === "published" || detail.status === "reviewed") ? (
                  <>
                    <form className="space-y-3" onSubmit={submitAck}>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={readAck} onChange={(e) => setReadAck(e.target.checked)} className="mt-1" />
                        <span>{t("rams.read_ack", "I have read and understood this RAMS and agree to follow the controls.")}</span>
                      </label>
                      <Input label={t("signature.printed_name_label", "Printed name")} value={ackName} onChange={(e) => setAckName(e.target.value)} />
                      <SignaturePad disabled={actionBusy || offlineBlock} value={signaturePng} onChange={setSignaturePng} />
                      <Button type="submit" disabled={actionBusy || offlineBlock || !readAck || !ackName.trim() || !signaturePng}>{t("rams.acknowledge", "Sign RAMS")}</Button>
                    </form>
                    <form className="space-y-2 border-t border-[var(--color-border)] pt-3" onSubmit={submitDecline}>
                      <Input label={t("rams.decline_reason", "Decline reason")} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
                      <Button type="submit" variant="secondary" disabled={actionBusy || offlineBlock}>{t("rams.decline", "Decline")}</Button>
                    </form>
                  </>
                ) : (
                  <p className="text-[var(--color-text-soft)]">{myRow?.status === "acknowledged" ? t("rams.already_ack", "You have already acknowledged this RAMS.") : t("rams.signoff_unavailable", "Sign-off is not required or is not available for this RAMS.")}</p>
                )}
              </section>
            </div>
          ) : null}
        </SheetBody>
      </Sheet>
    </div>
  );
}
