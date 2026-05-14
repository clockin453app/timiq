"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
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
import { canAccessManagement, isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../../features/auth";
import { listCompanies, type Company } from "../../../features/companies/api";
import {
  adminCancelLeaveRequest,
  adminCreateLeaveRequest,
  approveLeaveRequest,
  fetchCompanyLeaveRequests,
  fetchLeaveAdminSummary,
  fetchLeaveBalanceAdjustments,
  fetchLeavePolicy,
  patchLeavePolicy,
  postLeaveBalanceAdjustment,
  rejectLeaveRequest,
  type LeaveRequestResponse,
  type LeaveType,
} from "../../../features/leave/api";
import { leaveStatusLabel, leaveTypeLabel } from "../../../features/leave/labels";

function statusBadgeClass(status: string) {
  switch (status) {
    case "approved":
      return "border-emerald-800/30 bg-emerald-50 text-emerald-950";
    case "rejected":
      return "border-red-800/25 bg-red-50 text-red-900";
    case "pending":
      return "border-amber-800/30 bg-amber-50 text-amber-950";
    default:
      return "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]";
  }
}

export function LeaveManageClient() {
  const user = useCurrentUser();
  const management = canAccessManagement(user);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);

  const [adminSummary, setAdminSummary] = useState<Awaited<ReturnType<typeof fetchLeaveAdminSummary>> | null>(null);
  const [policy, setPolicy] = useState<Awaited<ReturnType<typeof fetchLeavePolicy>> | null>(null);
  const [requests, setRequests] = useState<LeaveRequestResponse[]>([]);
  const [adjustments, setAdjustments] = useState<Awaited<ReturnType<typeof fetchLeaveBalanceAdjustments>>>([]);

  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterUser, setFilterUser] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<LeaveRequestResponse | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [policySaved, setPolicySaved] = useState("");
  const [polMonth, setPolMonth] = useState(1);
  const [polDay, setPolDay] = useState(1);
  const [polAllow, setPolAllow] = useState("");
  const [polHalf, setPolHalf] = useState(true);
  const [polPaidA, setPolPaidA] = useState(true);
  const [polPaidS, setPolPaidS] = useState(false);
  const [polSickNote, setPolSickNote] = useState(false);

  const [adjUser, setAdjUser] = useState("");
  const [adjYear, setAdjYear] = useState("");
  const [adjDays, setAdjDays] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjMsg, setAdjMsg] = useState("");

  const [behalfUser, setBehalfUser] = useState("");
  const [bType, setBType] = useState<LeaveType>("annual_leave");
  const [bFrom, setBFrom] = useState("");
  const [bTo, setBTo] = useState("");
  const [bForceOverlap, setBForceOverlap] = useState(false);
  const [bMsg, setBMsg] = useState("");

  const employeesInCompany = useMemo(() => {
    return managedUsers
      .filter((u) => u.system_role === "employee" && (!companyId || u.company_id === companyId))
      .slice()
      .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
  }, [managedUsers, companyId]);

  const emailByUserId = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of managedUsers) {
      m.set(u.id, u.email);
    }
    return m;
  }, [managedUsers]);

  const loadAll = useCallback(async () => {
    if (!companyId) {
      setAdminSummary(null);
      setPolicy(null);
      setRequests([]);
      setAdjustments([]);
      return;
    }
    setError("");
    try {
      const [sum, pol, req, adj] = await Promise.all([
        fetchLeaveAdminSummary(companyId),
        fetchLeavePolicy(companyId),
        fetchCompanyLeaveRequests({
          company_id: companyId,
          status: filterStatus || undefined,
          user_id: filterUser || undefined,
        }),
        fetchLeaveBalanceAdjustments(companyId),
      ]);
      setAdminSummary(sum);
      setPolicy(pol);
      setRequests(req);
      setAdjustments(adj);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    }
  }, [companyId, filterStatus, filterUser]);

  useEffect(() => {
    if (!policy) {
      return;
    }
    setPolMonth(policy.annual_leave_year_start_month);
    setPolDay(policy.annual_leave_year_start_day);
    setPolAllow(policy.default_annual_allowance_days ?? "");
    setPolHalf(policy.allow_half_days);
    setPolPaidA(policy.paid_annual_leave);
    setPolPaidS(policy.paid_sick_leave);
    setPolSickNote(policy.sick_leave_requires_note);
  }, [policy]);

  useEffect(() => {
    if (!management) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [co, mu] = await Promise.all([
          isAdministrator(user) ? listCompanies() : Promise.resolve([]),
          listManagedUsers(),
        ]);
        if (!cancelled) {
          setCompanies(co);
          setManagedUsers(mu);
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
          setManagedUsers([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [management, user]);

  useEffect(() => {
    if (!companyId && user.company_id) {
      setCompanyId(user.company_id);
    }
  }, [user.company_id, companyId]);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      await loadAll();
      setLoading(false);
    })();
  }, [companyId, loadAll]);

  async function savePolicy(e: FormEvent) {
    e.preventDefault();
    setPolicySaved("");
    if (!companyId) {
      return;
    }
    try {
      const allowTrim = polAllow.trim();
      const p = await patchLeavePolicy(companyId, {
        annual_leave_year_start_month: polMonth,
        annual_leave_year_start_day: polDay,
        default_annual_allowance_days: allowTrim === "" ? null : allowTrim,
        allow_half_days: polHalf,
        paid_annual_leave: polPaidA,
        paid_sick_leave: polPaidS,
        sick_leave_requires_note: polSickNote,
      });
      setPolicy(p);
      setPolicySaved("Policy saved.");
    } catch (err) {
      setPolicySaved(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function submitAdjustment(e: FormEvent) {
    e.preventDefault();
    setAdjMsg("");
    if (!companyId || !adjUser || !adjYear || !adjDays || !adjReason.trim()) {
      setAdjMsg("Fill user, leave year, days, and reason.");
      return;
    }
    try {
      await postLeaveBalanceAdjustment(companyId, {
        user_id: adjUser,
        leave_year: adjYear.trim(),
        adjustment_days: adjDays.trim(),
        reason: adjReason.trim(),
      });
      setAdjMsg("Adjustment saved.");
      setAdjDays("");
      setAdjReason("");
      await loadAll();
    } catch (err) {
      setAdjMsg(err instanceof Error ? err.message : "Failed.");
    }
  }

  async function submitBehalf(e: FormEvent) {
    e.preventDefault();
    setBMsg("");
    if (!companyId || !behalfUser || !bFrom || !bTo) {
      setBMsg("Select employee and dates.");
      return;
    }
    try {
      await adminCreateLeaveRequest(companyId, {
        user_id: behalfUser,
        leave_type: bType,
        date_from: bFrom,
        date_to: bTo,
        force_overlap: bForceOverlap,
      });
      setBMsg("Leave created.");
      await loadAll();
    } catch (err) {
      setBMsg(err instanceof Error ? err.message : "Failed.");
    }
  }

  async function doApprove(id: string) {
    setBusy(id);
    try {
      await approveLeaveRequest(id);
      await loadAll();
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed.");
    } finally {
      setBusy(null);
    }
  }

  async function doReject(id: string) {
    setBusy(id);
    try {
      await rejectLeaveRequest(id, { admin_note: rejectNote.trim() || null });
      await loadAll();
      setSelected(null);
      setRejectNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed.");
    } finally {
      setBusy(null);
    }
  }

  async function doAdminCancel(id: string) {
    setBusy(id);
    try {
      await adminCancelLeaveRequest(id);
      await loadAll();
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed.");
    } finally {
      setBusy(null);
    }
  }

  const sortedRequests = useMemo(() => {
    const copy = requests.slice();
    copy.sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") {
        return -1;
      }
      if (a.status !== "pending" && b.status === "pending") {
        return 1;
      }
      return b.created_at.localeCompare(a.created_at);
    });
    return copy;
  }, [requests]);

  if (!management) {
    return (
      <Sheet>
        <PageHeader description="Approve leave and edit company leave policy." title="Leave management" />
        <SheetBody>
          <p className="text-sm text-[var(--color-text-muted)]">You do not have access to this page.</p>
        </SheetBody>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <PageHeader
        description="Review requests, adjust balances, and configure leave policy for your company."
        title="Leave management"
      />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        {isAdministrator(user) ? (
          <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Company</span>
            <select
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
              onChange={(ev) => setCompanyId(ev.target.value)}
              value={companyId}
            >
              <option value="">Choose company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-red-800/30 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </div>
        ) : null}

        {loading && companyId ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}

        {adminSummary && companyId ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: "Pending", value: String(adminSummary.pending_count) },
              { label: "Approved (all time)", value: String(adminSummary.approved_count) },
              { label: "Rejected (all time)", value: String(adminSummary.rejected_count) },
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
                  <p className="text-2xl font-semibold tabular-nums text-[var(--color-text)]">{c.value}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {policy && companyId ? (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Leave policy
              </p>
            </div>
            <form className="grid max-w-2xl grid-cols-1 gap-3 p-3 text-sm md:grid-cols-2" onSubmit={savePolicy}>
              <label className="text-xs font-bold text-[var(--color-text-soft)]">
                Year starts (month)
                <input
                  className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  max={12}
                  min={1}
                  onChange={(ev) => setPolMonth(Number(ev.target.value))}
                  type="number"
                  value={polMonth}
                />
              </label>
              <label className="text-xs font-bold text-[var(--color-text-soft)]">
                Year starts (day)
                <input
                  className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  max={31}
                  min={1}
                  onChange={(ev) => setPolDay(Number(ev.target.value))}
                  type="number"
                  value={polDay}
                />
              </label>
              <label className="text-xs font-bold text-[var(--color-text-soft)] md:col-span-2">
                Default annual allowance (days, blank = none)
                <input
                  className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(ev) => setPolAllow(ev.target.value)}
                  type="text"
                  value={polAllow}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text)]">
                <input checked={polHalf} onChange={(ev) => setPolHalf(ev.target.checked)} type="checkbox" />
                Allow half days
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text)]">
                <input checked={polPaidA} onChange={(ev) => setPolPaidA(ev.target.checked)} type="checkbox" />
                Paid annual leave (informational in reports this batch)
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text)]">
                <input checked={polPaidS} onChange={(ev) => setPolPaidS(ev.target.checked)} type="checkbox" />
                Paid sick leave (not auto-calculated in payroll yet)
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text)]">
                <input checked={polSickNote} onChange={(ev) => setPolSickNote(ev.target.checked)} type="checkbox" />
                Sick leave requires a note
              </label>
              <div className="md:col-span-2">
                <Button type="submit">Save policy</Button>
                {policySaved ? <p className="mt-2 text-xs text-[var(--color-text-muted)]">{policySaved}</p> : null}
              </div>
            </form>
          </div>
        ) : null}

        {companyId ? (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Balance adjustments
              </p>
            </div>
            <form className="flex flex-wrap items-end gap-2 p-3 text-xs" onSubmit={submitAdjustment}>
              <label className="font-bold text-[var(--color-text-soft)]">
                Employee
                <select
                  className="mt-1 block h-9 min-w-[12rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(e) => setAdjUser(e.target.value)}
                  value={adjUser}
                >
                  <option value="">—</option>
                  {employeesInCompany.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-bold text-[var(--color-text-soft)]">
                Leave year
                <input
                  className="mt-1 block h-9 w-24 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(e) => setAdjYear(e.target.value)}
                  placeholder="2026"
                  value={adjYear}
                />
              </label>
              <label className="font-bold text-[var(--color-text-soft)]">
                Days (+/−)
                <input
                  className="mt-1 block h-9 w-24 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(e) => setAdjDays(e.target.value)}
                  value={adjDays}
                />
              </label>
              <label className="min-w-[10rem] flex-1 font-bold text-[var(--color-text-soft)]">
                Reason
                <input
                  className="mt-1 block h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(e) => setAdjReason(e.target.value)}
                  value={adjReason}
                />
              </label>
              <Button type="submit">Add adjustment</Button>
            </form>
            {adjMsg ? <p className="px-3 pb-2 text-xs text-[var(--color-text-muted)]">{adjMsg}</p> : null}
            <div className="max-h-48 overflow-y-auto border-t border-[var(--color-border-dark)] px-2 py-2">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-[var(--color-text-muted)]" colSpan={4}>
                        No adjustments yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    adjustments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="max-w-[180px] truncate text-xs">
                          {emailByUserId.get(a.user_id) ?? a.user_id}
                        </TableCell>
                        <TableCell>{a.leave_year}</TableCell>
                        <TableCell className="tabular-nums">{a.adjustment_days}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{a.reason}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}

        {companyId ? (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Create on behalf
              </p>
            </div>
            <form className="flex flex-wrap items-end gap-2 p-3 text-xs" onSubmit={submitBehalf}>
              <label className="font-bold text-[var(--color-text-soft)]">
                Employee
                <select
                  className="mt-1 block h-9 min-w-[12rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(e) => setBehalfUser(e.target.value)}
                  value={behalfUser}
                >
                  <option value="">—</option>
                  {employeesInCompany.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-bold text-[var(--color-text-soft)]">
                Type
                <select
                  className="mt-1 block h-9 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(e) => setBType(e.target.value as LeaveType)}
                  value={bType}
                >
                  <option value="annual_leave">Annual</option>
                  <option value="sick_leave">Sick</option>
                  <option value="unpaid_leave">Unpaid</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="font-bold text-[var(--color-text-soft)]">
                From
                <input
                  className="mt-1 block h-9 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(e) => setBFrom(e.target.value)}
                  type="date"
                  value={bFrom}
                />
              </label>
              <label className="font-bold text-[var(--color-text-soft)]">
                To
                <input
                  className="mt-1 block h-9 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                  onChange={(e) => setBTo(e.target.value)}
                  type="date"
                  value={bTo}
                />
              </label>
              <label className="flex items-center gap-2 font-bold text-[var(--color-text)]">
                <input checked={bForceOverlap} onChange={(e) => setBForceOverlap(e.target.checked)} type="checkbox" />
                Allow overlap
              </label>
              <Button type="submit">Create</Button>
            </form>
            {bMsg ? <p className="px-3 pb-2 text-xs text-[var(--color-text-muted)]">{bMsg}</p> : null}
          </div>
        ) : null}

        {companyId ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <label className="font-bold text-[var(--color-text-soft)]">
              Status
              <select
                className="mt-1 block h-9 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                onChange={(e) => setFilterStatus(e.target.value)}
                value={filterStatus}
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="font-bold text-[var(--color-text-soft)]">
              Employee
              <select
                className="mt-1 block h-9 min-w-[12rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2"
                onChange={(e) => setFilterUser(e.target.value)}
                value={filterUser}
              >
                <option value="">All</option>
                {employeesInCompany.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </label>
            <Button
              className="self-end"
              onClick={() => void loadAll()}
              type="button"
              variant="secondary"
            >
              Apply filters
            </Button>
          </div>
        ) : null}

        {companyId ? (
          <div className="grid gap-3 lg:grid-cols-[1fr_minmax(16rem,22rem)]">
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
              <Table className="min-w-[800px] text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRequests.map((r) => (
                    <TableRow
                      className={selected?.id === r.id ? "bg-[var(--color-header)]" : "cursor-pointer"}
                      key={r.id}
                      onClick={() => setSelected(r)}
                    >
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {emailByUserId.get(r.user_id) ?? r.user_id}
                      </TableCell>
                      <TableCell>{leaveTypeLabel(r.leave_type)}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.date_from} → {r.date_to}
                      </TableCell>
                      <TableCell className="tabular-nums">{r.total_days}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(r.status)}`}
                        >
                          {leaveStatusLabel(r.status)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 text-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">Detail</p>
              {!selected ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">Select a row.</p>
              ) : (
                <div className="mt-2 space-y-2 text-xs">
                  <p>
                    <span className="font-semibold">Type:</span> {leaveTypeLabel(selected.leave_type)}
                  </p>
                  <p className="tabular-nums">
                    <span className="font-semibold">Dates:</span> {selected.date_from} → {selected.date_to}
                  </p>
                  <p>
                    <span className="font-semibold">Days:</span> {selected.total_days}
                  </p>
                  <p>
                    <span className="font-semibold">Status:</span> {leaveStatusLabel(selected.status)}
                  </p>
                  {selected.warnings?.length ? (
                    <ul className="list-inside list-disc text-amber-900">
                      {selected.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                  {selected.status === "pending" ? (
                    <div className="space-y-2 border-t border-[var(--color-border-dark)] pt-2">
                      <Button disabled={busy === selected.id} onClick={() => void doApprove(selected.id)} type="button">
                        Approve
                      </Button>
                      <label className="block font-bold text-[var(--color-text-soft)]">
                        Reject note
                        <textarea
                          className="mt-1 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1"
                          onChange={(e) => setRejectNote(e.target.value)}
                          value={rejectNote}
                        />
                      </label>
                      <Button
                        disabled={busy === selected.id}
                        onClick={() => void doReject(selected.id)}
                        type="button"
                        variant="secondary"
                      >
                        Reject
                      </Button>
                      <Button
                        disabled={busy === selected.id}
                        onClick={() => void doAdminCancel(selected.id)}
                        type="button"
                        variant="secondary"
                      >
                        Cancel (admin)
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">Select a company to manage leave.</p>
        )}
      </SheetBody>
    </Sheet>
  );
}
