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
import { SignaturePad } from "../../components/signature/signature-pad";
import { isEmployee, useCurrentUser } from "../../features/auth";
import {
  declineToolboxTalk,
  downloadToolboxTalkPdf,
  getToolboxTalk,
  listMyToolboxTalks,
  signToolboxTalk,
  type ToolboxTalkDetail,
  type ToolboxTalkSummary,
} from "../../features/toolbox-talks/api";
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

function signatureMethodLabel(method: string | null | undefined) {
  if (method === "app_signature") {
    return "App signature";
  }
  if (method === "manual_paper") {
    return "Manual/paper record";
  }
  return "Not signed";
}

export function ToolboxTalksClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const [talks, setTalks] = useState<ToolboxTalkSummary[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [detail, setDetail] = useState<ToolboxTalkDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [signName, setSignName] = useState("");
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [attendedAck, setAttendedAck] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [navigatorOffline, setNavigatorOffline] = useState(false);

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
    setLoading(true);
    setError("");
    try {
      const [list, locs] = await Promise.all([listMyToolboxTalks(), listLocations().catch(() => [])]);
      setTalks(list);
      setLocations(locs);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_load", "Could not load talks."));
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  const sortedTalks = useMemo(() => {
    const score = (s: ToolboxTalkSummary) => {
      if (s.status === "published") {
        return 0;
      }
      if (s.status === "completed") {
        return 1;
      }
      return 2;
    };
    return [...talks].sort((a, b) => score(a) - score(b));
  }, [talks]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setError("");
    setSignName("");
    setSignaturePng(null);
    setAttendedAck(false);
    setDeclineReason("");
    try {
      const d = await getToolboxTalk(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_load", "Could not load talks."));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const myRow = useMemo(() => {
    if (!detail || !currentUser) {
      return null;
    }
    return detail.attendees.find((a) => a.user_id === currentUser.id) ?? null;
  }, [detail, currentUser]);

  const onSign = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!detail) {
      return;
    }
    if (offlineBlock) {
      setError(t("toolbox_talks.offline_sign", "Signing requires an internet connection."));
      return;
    }
    if (!signaturePng) {
      setError(t("toolbox_talks.signature_draw_required", "Draw your signature before signing."));
      return;
    }
    setActionBusy(true);
    setError("");
    try {
      const next = await signToolboxTalk(detail.id, {
        attended_ack: attendedAck,
        signature_name: signName.trim(),
        signature_image_data: signaturePng,
      });
      setDetail(next);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_sign", "Could not sign."));
    } finally {
      setActionBusy(false);
    }
  };

  const onDecline = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!detail) {
      return;
    }
    if (offlineBlock) {
      setError(t("toolbox_talks.offline_sign", "Signing requires an internet connection."));
      return;
    }
    setActionBusy(true);
    setError("");
    try {
      const next = await declineToolboxTalk(detail.id, declineReason.trim());
      setDetail(next);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolbox_talks.error_decline", "Could not decline."));
    } finally {
      setActionBusy(false);
    }
  };

  if (!isEmployee(currentUser)) {
    return (
      <div className="space-y-4">
        <PageHeader
          description={t(
            "toolbox_talks.employee_only_hint",
            "Toolbox talk sign-off is for employee accounts. Use Manage toolbox talks to create and assign talks.",
          )}
          title={t("toolbox_talks.title", "Toolbox talks")}
        />
        <p className="text-sm text-[var(--color-text-soft)]">
          <a className="font-semibold text-[var(--color-text)] underline" href="/toolbox-talks/manage">
            {t("toolbox_talks.manage_link", "Manage toolbox talks")}
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description={t(
          "toolbox_talks.employee_intro",
          "Read assigned safety briefings and sign to confirm you have understood.",
        )}
        title={t("toolbox_talks.title", "Toolbox talks")}
      />

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading", "Loading…")}</p>
      ) : sortedTalks.length === 0 ? (
        <p className="text-sm text-[var(--color-text-soft)]">
          {t("toolbox_talks.empty_employee", "You have no assigned toolbox talks yet.")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("toolbox_talks.col_title", "Title")}</TableHead>
                <TableHead>{t("toolbox_talks.topic", "Topic")}</TableHead>
                <TableHead>{t("toolbox_talks.col_site", "Site")}</TableHead>
                <TableHead>{t("toolbox_talks.scheduled", "Scheduled")}</TableHead>
                <TableHead>{t("toolbox_talks.col_status", "Status")}</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTalks.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium text-[var(--color-text)]">{row.title}</TableCell>
                  <TableCell>
                    <span className="inline-flex rounded-full bg-[var(--color-header)] px-2 py-0.5 text-xs font-medium text-[var(--color-text)]">
                      {row.topic_display}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-[var(--color-text-soft)]">{locationName(row.location_id)}</TableCell>
                  <TableCell className="text-sm">{formatDate(row.scheduled_date)}</TableCell>
                  <TableCell className="text-sm capitalize">{row.status}</TableCell>
                  <TableCell>
                    <Button onClick={() => void openDetail(row.id)} size="sm" type="button" variant="secondary">
                      {t("common.details", "Details")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet>
        <SheetBody className="space-y-4">
          {detailLoading && selectedId ? (
            <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading", "Loading…")}</p>
          ) : null}
          {detail && selectedId === detail.id ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">{detail.title}</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    type="button"
                    onClick={() =>
                      void downloadToolboxTalkPdf(detail.id).catch((e) =>
                        setError(e instanceof Error ? e.message : t("toolbox_talks.error_pdf", "Could not download PDF.")),
                      )
                    }
                  >
                    {t("toolbox_talks.download_pdf", "Download PDF")}
                  </Button>
                  <Button onClick={() => setSelectedId(null)} size="sm" type="button" variant="secondary">
                    {t("toolbox_talks.close_detail", "Close")}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-sm text-[var(--color-text-soft)]">
                <span>
                  {t("toolbox_talks.topic", "Topic")}:{" "}
                  <strong className="text-[var(--color-text)]">{detail.topic_display}</strong>
                </span>
                <span>·</span>
                <span>
                  {t("toolbox_talks.col_site", "Site")}:{" "}
                  <strong className="text-[var(--color-text)]">{locationName(detail.location_id)}</strong>
                </span>
                <span>·</span>
                <span>
                  {t("toolbox_talks.scheduled", "Scheduled")}:{" "}
                  <strong className="text-[var(--color-text)]">{formatDate(detail.scheduled_date)}</strong>
                </span>
              </div>
              <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm leading-relaxed text-[var(--color-text)] shadow-sm whitespace-pre-wrap">
                {detail.talk_body}
              </div>

              {myRow?.status === "pending" && detail.status === "published" ? (
                <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    {t("toolbox_talks.sign_heading", "Sign talk")}
                  </h3>
                  {offlineBlock ? (
                    <p className="text-sm text-amber-800">{t("toolbox_talks.offline_sign", "Signing requires an internet connection.")}</p>
                  ) : null}
                  <form className="space-y-3" onSubmit={onSign}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        checked={attendedAck}
                        className="mt-1"
                        onChange={(e) => setAttendedAck(e.target.checked)}
                        type="checkbox"
                      />
                      <span>{t("toolbox_talks.attended_ack", "I have attended/read and understood this toolbox talk.")}</span>
                    </label>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]" htmlFor="tt-sign-name">
                        {t("signature.printed_name_label", "Printed name")}
                      </label>
                      <Input
                        autoComplete="name"
                        id="tt-sign-name"
                        onChange={(e) => setSignName(e.target.value)}
                        value={signName}
                      />
                    </div>
                    <SignaturePad disabled={actionBusy || offlineBlock} value={signaturePng} onChange={setSignaturePng} />
                    <Button disabled={actionBusy || offlineBlock || !signaturePng || !signName.trim() || !attendedAck} type="submit">
                      {t("toolbox_talks.sign_button", "Sign")}
                    </Button>
                  </form>
                  <form className="space-y-2 border-t border-[var(--color-border)] pt-4" onSubmit={onDecline}>
                    <h4 className="text-sm font-semibold text-[var(--color-text)]">{t("toolbox_talks.decline", "Decline")}</h4>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-soft)]" htmlFor="tt-decline">
                      {t("toolbox_talks.decline_reason", "Reason")}
                    </label>
                    <Input id="tt-decline" onChange={(e) => setDeclineReason(e.target.value)} value={declineReason} />
                    <Button disabled={actionBusy || offlineBlock} type="submit" variant="secondary">
                      {t("toolbox_talks.decline_submit", "Submit decline")}
                    </Button>
                  </form>
                </div>
              ) : myRow ? (
                <div className="space-y-2 text-sm text-[var(--color-text-soft)]">
                  <p>
                    {t("toolbox_talks.your_status", "Your status")}: <strong className="capitalize">{myRow.status}</strong>
                    {myRow.signed_at ? ` · ${formatDate(myRow.signed_at)}` : null}
                    {` · ${signatureMethodLabel(myRow.signature_method)}`}
                  </p>
                  {myRow.status === "signed" ? (
                    <Button
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void downloadToolboxTalkPdf(detail.id).catch((e) =>
                          setError(e instanceof Error ? e.message : t("toolbox_talks.error_pdf", "Could not download PDF.")),
                        )
                      }
                    >
                      {t("toolbox_talks.download_pdf", "Download PDF")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </SheetBody>
      </Sheet>
    </div>
  );
}
