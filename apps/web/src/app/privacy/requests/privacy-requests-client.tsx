"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../../components/ui";
import { isAdministrator, useCurrentUser } from "../../../features/auth";
import {
  fetchPrivacyAdminRequestDetail,
  fetchPrivacyAdminRequests,
  patchPrivacyAdminRequest,
  postPrivacyAdminRequestClose,
  type PrivacyAdminRequestDetail,
  type PrivacyAdminRequestListItem,
} from "../../../features/privacy/api";
import { listCompanies, type Company } from "../../../features/companies/api";

const STATUSES = ["submitted", "in_review", "completed", "rejected", "cancelled"] as const;

function formatDt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function PrivacyRequestsClient() {
  const user = useCurrentUser();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [rows, setRows] = useState<PrivacyAdminRequestListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PrivacyAdminRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusEdit, setStatusEdit] = useState("submitted");
  const [responseEdit, setResponseEdit] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const c = await listCompanies();
        if (!cancelled) {
          setCompanies(c);
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = isAdministrator(user) ? companyFilter : null;
      const data = await fetchPrivacyAdminRequests(q);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [user, companyFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const d = await fetchPrivacyAdminRequestDetail(id);
      setDetail(d);
      setStatusEdit(d.status);
      setResponseEdit(d.admin_response ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load detail.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body: { status?: string; admin_response?: string | null } = {};
      if (statusEdit !== detail?.status) {
        body.status = statusEdit;
      }
      const trimmed = responseEdit.trim();
      if (trimmed !== (detail?.admin_response ?? "").trim()) {
        body.admin_response = trimmed || null;
      }
      if (Object.keys(body).length === 0) {
        setSaving(false);
        return;
      }
      const d = await patchPrivacyAdminRequest(selectedId, body);
      setDetail(d);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function onClose() {
    if (!selectedId) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const d = await postPrivacyAdminRequestClose(selectedId);
      setDetail(d);
      setStatusEdit(d.status);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Close failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        description="Review privacy and data subject requests from employees in scope."
        title="Privacy requests"
      />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {isAdministrator(user) ? (
          <div className="max-w-md">
            <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]" htmlFor="co">
              Filter by company
            </label>
            <select
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm"
              id="co"
              value={companyFilter ?? ""}
              onChange={(e) => setCompanyFilter(e.target.value || null)}
            >
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => void loadList()}>
            Refresh list
          </Button>
        </div>

        <div className="flex min-h-[360px] min-w-0 flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1 overflow-x-auto">
            {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}
            <table className="min-w-[720px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-dark)] text-[var(--color-text-soft)]">
                  <th className="py-2 pr-2">Employee</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`cursor-pointer border-b border-[var(--color-border-dark)] hover:bg-[var(--color-header)] ${
                      selectedId === r.id ? "bg-[var(--color-header)]" : ""
                    }`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className="py-2 pr-2">{r.requester_display}</td>
                    <td className="py-2 pr-2">{r.request_type}</td>
                    <td className="py-2 pr-2">{r.status}</td>
                    <td className="py-2 pr-2 text-[var(--color-text-muted)]">{formatDt(r.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && rows.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">No requests in this scope.</p>
            ) : null}
          </div>

          <div className="w-full shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 lg:max-w-md">
            {!selectedId ? (
              <p className="text-sm text-[var(--color-text-muted)]">Select a request.</p>
            ) : detailLoading ? (
              <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
            ) : detail ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">Employee</p>
                  <p className="text-[var(--color-text)]">{detail.requester_display}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{detail.user_email}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">Message</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[var(--color-text)]">{detail.message}</p>
                </div>
                <form className="space-y-3 border-t border-[var(--color-border-dark)] pt-3" onSubmit={onSave}>
                  <div>
                    <label className="text-xs font-bold uppercase text-[var(--color-text-soft)]" htmlFor="st">
                      Status
                    </label>
                    <select
                      className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm"
                      disabled={
                        detail.status === "cancelled" ||
                        detail.status === "completed" ||
                        detail.status === "rejected"
                      }
                      id="st"
                      value={statusEdit}
                      onChange={(e) => setStatusEdit(e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-[var(--color-text-soft)]" htmlFor="resp">
                      Admin response
                    </label>
                    <textarea
                      className="mt-1.5 min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2 text-sm"
                      disabled={detail.status === "cancelled"}
                      id="resp"
                      maxLength={8000}
                      value={responseEdit}
                      onChange={(e) => setResponseEdit(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={saving || detail.status === "cancelled"} type="submit">
                      {saving ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      disabled={saving || detail.status === "cancelled" || detail.status === "completed" || detail.status === "rejected"}
                      type="button"
                      variant="secondary"
                      onClick={() => void onClose()}
                    >
                      Mark completed (close)
                    </Button>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );
}
