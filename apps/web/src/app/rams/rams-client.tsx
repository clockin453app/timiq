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
} from "../../components/ui";
import { isEmployee, useCurrentUser } from "../../features/auth";
import { isNavigatorOffline } from "../../features/offline";
import {
  declineRams,
  getRams,
  listMyRams,
  acknowledgeRams,
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
  const [readAck, setReadAck] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const employee = Boolean(currentUser && isEmployee(currentUser));

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

  const offlineBlock = isNavigatorOffline();

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
      const d = await acknowledgeRams(selectedId, { read_understood_ack: readAck, acknowledgement_name: ackName });
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
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("rams.col_title", "Title")}</TableHead>
                <TableHead>{t("rams.col_site", "Site")}</TableHead>
                <TableHead>{t("rams.col_risk", "Risk")}</TableHead>
                <TableHead>{t("rams.col_status", "Status")}</TableHead>
                <TableHead>{t("rams.col_your_status", "Your status")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-[var(--color-text-soft)]">
                    {t("rams.empty", "No RAMS assigned yet.")}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell>{locationName(row.location_id)}</TableCell>
                    <TableCell>{row.risk_level}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>{row.my_ack_status ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="secondary" onClick={() => void openDetail(row.id)}>
                        {t("rams.open", "Open")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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
                <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedId(null)}>
                  {t("rams.close_detail", "Close")}
                </Button>
              </div>
              <p className="text-[var(--color-text-soft)]">
                {t("rams.work_activity", "Work activity")}: <span className="text-[var(--color-text)]">{detail.work_activity}</span>
              </p>
              {detail.description ? (
                <p className="whitespace-pre-wrap text-[var(--color-text)]">{detail.description}</p>
              ) : null}
              <div>
                <p className="font-semibold text-[var(--color-text)]">{t("rams.ppe", "PPE")}</p>
                <ul className="mt-1 list-disc pl-5">
                  {detail.ppe_json.length === 0 && detail.no_special_ppe ? (
                    <li className="text-[var(--color-text-soft)]">{t("rams.no_special_ppe", "No special PPE (as recorded)")}</li>
                  ) : (
                    detail.ppe_json.map((p) => <li key={p}>{p}</li>)
                  )}
                </ul>
              </div>
              <div>
                <p className="font-semibold text-[var(--color-text)]">{t("rams.hazards", "Hazards")}</p>
                <div className="mt-2 space-y-2">
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
              </div>
              {isEmployee(currentUser) && myRow?.status === "pending" && (detail.status === "published" || detail.status === "reviewed") ? (
                <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                  <form className="space-y-3" onSubmit={submitAck}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" checked={readAck} onChange={(e) => setReadAck(e.target.checked)} className="mt-1" />
                      <span>{t("rams.read_ack", "I have read and understood this RAMS / risk assessment.")}</span>
                    </label>
                    <Input label={t("rams.acknowledgement_name", "Your name (acknowledgement)")} value={ackName} onChange={(e) => setAckName(e.target.value)} />
                    <Button type="submit" disabled={actionBusy}>
                      {t("rams.acknowledge", "Acknowledge")}
                    </Button>
                  </form>
                  <form className="space-y-2" onSubmit={submitDecline}>
                    <Input label={t("rams.decline_reason", "Decline reason")} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
                    <Button type="submit" variant="secondary" disabled={actionBusy}>
                      {t("rams.decline", "Decline")}
                    </Button>
                  </form>
                </div>
              ) : null}
              <div>
                <p className="font-semibold">{t("rams.review_due", "Review due")}</p>
                <p>{formatDate(detail.review_due_date)}</p>
              </div>
            </div>
          ) : null}
        </SheetBody>
      </Sheet>
    </div>
  );
}
