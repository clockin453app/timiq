"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui";
import { useCurrentUser } from "../../features/auth";
import {
  cancelMyLeaveRequest,
  createMyLeaveRequest,
  fetchMyLeaveRequests,
  fetchMyLeaveSummary,
  type LeaveRequestResponse,
  type LeaveType,
} from "../../features/leave/api";
import { leaveStatusLabel, leaveTypeLabel } from "../../features/leave/labels";

function statusBadgeClass(status: string) {
  switch (status) {
    case "approved":
      return "border-emerald-800/30 bg-emerald-50 text-emerald-950";
    case "rejected":
      return "border-red-800/25 bg-red-50 text-red-900";
    case "pending":
      return "border-amber-800/30 bg-amber-50 text-amber-950";
    case "cancelled":
      return "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]";
    default:
      return "border-[var(--color-border-dark)] bg-[var(--color-cell)] text-[var(--color-text)]";
  }
}

export function LeaveClient() {
  const user = useCurrentUser();
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof fetchMyLeaveSummary>> | null>(null);
  const [rows, setRows] = useState<LeaveRequestResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [leaveType, setLeaveType] = useState<LeaveType>("annual_leave");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [startHalf, setStartHalf] = useState<"" | "morning" | "afternoon">("");
  const [endHalf, setEndHalf] = useState<"" | "morning" | "afternoon">("");
  const [reason, setReason] = useState("");
  const [employeeNote, setEmployeeNote] = useState("");
  const [formMsg, setFormMsg] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [s, list] = await Promise.all([fetchMyLeaveSummary(), fetchMyLeaveRequests()]);
      setSummary(s);
      setRows(list);
    } catch (e) {
      setSummary(null);
      setRows([]);
      setError(e instanceof Error ? e.message : "Could not load leave.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormMsg("");
    if (!dateFrom || !dateTo) {
      setFormMsg("Choose start and end dates.");
      return;
    }
    try {
      const body = {
        leave_type: leaveType,
        date_from: dateFrom,
        date_to: dateTo,
        reason: reason.trim() || null,
        employee_note: employeeNote.trim() || null,
        ...(summary?.allow_half_days && (startHalf || endHalf)
          ? {
              start_half_day: (startHalf || undefined) as "morning" | "afternoon" | undefined,
              end_half_day: (endHalf || undefined) as "morning" | "afternoon" | undefined,
            }
          : {}),
      };
      await createMyLeaveRequest(body);
      setFormMsg("Request submitted.");
      setReason("");
      setEmployeeNote("");
      await load();
    } catch (err) {
      setFormMsg(err instanceof Error ? err.message : "Request failed.");
    }
  }

  async function onCancel(id: string) {
    setBusyId(id);
    try {
      await cancelMyLeaveRequest(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!user.company_id) {
    return (
      <Sheet>
        <PageHeader description="Request and track annual leave, sick leave, and other absence." title="Leave" />
        <SheetBody>
          <p className="text-sm text-[var(--color-text-muted)]">Your account is not linked to a company.</p>
        </SheetBody>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <PageHeader
        description="Request leave and view status. Approved leave also appears on your week report and timesheet context."
        title="Leave"
      />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-red-800/30 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </div>
        ) : null}

        {summary ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Annual allowance (days)", value: summary.allowance_days ?? "—" },
              { label: "Used (approved annual)", value: summary.used_annual_days },
              { label: "Pending (annual)", value: summary.pending_annual_days },
              { label: "Remaining", value: summary.remaining_days ?? "—" },
            ].map((c) => (
              <div
                className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]"
                key={c.label}
              >
                <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                    {c.label}
                  </p>
                </div>
                <div className="px-3 py-3">
                  <p className="text-xl font-semibold tabular-nums text-[var(--color-text)]">{c.value}</p>
                  <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">Leave year {summary.leave_year}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              New request
            </p>
          </div>
          <form className="space-y-3 p-3 text-sm" onSubmit={onSubmit}>
            <label className="block text-xs font-bold text-[var(--color-text-soft)]">
              Type
              <select
                className="mt-1 h-10 w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-[var(--color-text)]"
                onChange={(ev) => setLeaveType(ev.target.value as LeaveType)}
                value={leaveType}
              >
                <option value="annual_leave">Annual leave</option>
                <option value="sick_leave">Sick leave</option>
                <option value="unpaid_leave">Unpaid leave</option>
                <option value="other">Other authorised absence</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="block text-xs font-bold text-[var(--color-text-soft)]">
                From
                <input
                  className="mt-1 block h-10 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-[var(--color-text)]"
                  onChange={(ev) => setDateFrom(ev.target.value)}
                  type="date"
                  value={dateFrom}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text-soft)]">
                To
                <input
                  className="mt-1 block h-10 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-[var(--color-text)]"
                  onChange={(ev) => setDateTo(ev.target.value)}
                  type="date"
                  value={dateTo}
                />
              </label>
            </div>
            {summary?.allow_half_days ? (
              <div className="flex flex-wrap gap-3">
                <label className="block text-xs font-bold text-[var(--color-text-soft)]">
                  First day (half)
                  <select
                    className="mt-1 block h-10 min-w-[10rem] rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-[var(--color-text)]"
                    onChange={(ev) => setStartHalf(ev.target.value as typeof startHalf)}
                    value={startHalf}
                  >
                    <option value="">Full day default</option>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                  </select>
                </label>
                <label className="block text-xs font-bold text-[var(--color-text-soft)]">
                  Last day (half)
                  <select
                    className="mt-1 block h-10 min-w-[10rem] rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-[var(--color-text)]"
                    onChange={(ev) => setEndHalf(ev.target.value as typeof endHalf)}
                    value={endHalf}
                  >
                    <option value="">Full day default</option>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                  </select>
                </label>
              </div>
            ) : null}
            <label className="block text-xs font-bold text-[var(--color-text-soft)]">
              Reason / context (optional)
              <textarea
                className="mt-1 min-h-[4rem] w-full max-w-xl rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1.5 text-[var(--color-text)]"
                onChange={(ev) => setReason(ev.target.value)}
                value={reason}
              />
            </label>
            <label className="block text-xs font-bold text-[var(--color-text-soft)]">
              Note to employer (optional)
              <textarea
                className="mt-1 min-h-[3rem] w-full max-w-xl rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1.5 text-[var(--color-text)]"
                onChange={(ev) => setEmployeeNote(ev.target.value)}
                value={employeeNote}
              />
            </label>
            {summary?.sick_leave_requires_note && leaveType === "sick_leave" ? (
              <p className="text-xs text-amber-900">
                Company policy requires a brief note for sick leave (use reason or note to employer).
              </p>
            ) : null}
            {formMsg ? <p className="text-xs text-[var(--color-text-muted)]">{formMsg}</p> : null}
            <Button type="submit">Submit request</Button>
          </form>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              My requests
            </p>
          </div>
          <div className="overflow-x-auto p-2">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-sm text-[var(--color-text-muted)]" colSpan={5}>
                      No requests yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{leaveTypeLabel(r.leave_type)}</TableCell>
                      <TableCell className="text-xs tabular-nums text-[var(--color-text-muted)]">
                        {r.date_from} → {r.date_to}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{r.total_days}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(r.status)}`}
                        >
                          {leaveStatusLabel(r.status)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "pending" ? (
                          <Button
                            disabled={busyId === r.id}
                            onClick={() => void onCancel(r.id)}
                            type="button"
                            variant="secondary"
                          >
                            {busyId === r.id ? "…" : "Cancel"}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );
}
