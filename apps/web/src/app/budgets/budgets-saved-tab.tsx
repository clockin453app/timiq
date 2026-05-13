"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui";
import { isAdministrator, useCurrentUser, type AuthUser } from "../../features/auth";
import {
  archiveBudget,
  BUDGET_EXPENSE_CATEGORIES,
  createBudget,
  createBudgetExpense,
  deleteBudgetExpense,
  downloadBudgetReportCsv,
  getBudgetDetail,
  listBudgetExpenses,
  listBudgetProjects,
  openBudgetReportPrint,
  patchBudget,
  patchBudgetExpense,
  type BudgetExpenseResponse,
  type BudgetProjectDetailResponse,
  type BudgetProjectSummary,
} from "../../features/budgets/api";
import { listCompanies, type Company } from "../../features/companies/api";
import { formatHoursFromSeconds } from "../../features/payroll/format";
import { listLocations, type Location } from "../../features/locations/api";
import { listWorkplaces, type Workplace } from "../../features/workplaces/api";
import { BudgetStatCard, expenseCategoryLabel, isoTodayYmd, moneyDisplay, percentDisplay } from "./budget-ui";

const BUDGET_STATUSES = ["draft", "active", "completed", "archived"] as const;

function resolveCompanyId(user: AuthUser, override: string | null): string | null {
  if (isAdministrator(user)) {
    return override;
  }
  return user.company_id;
}

function overlayPanelClass() {
  return "w-full max-w-lg rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg";
}

function fieldLabelClass() {
  return "block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]";
}

function selectClass() {
  return "mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]";
}

function textareaClass() {
  return "mt-1.5 min-h-[72px] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2 text-sm text-[var(--color-text)]";
}

export function BudgetsSavedTab() {
  const user = useCurrentUser();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const [rows, setRows] = useState<BudgetProjectSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BudgetProjectDetailResponse | null>(null);
  const [expenses, setExpenses] = useState<BudgetExpenseResponse[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const [locations, setLocations] = useState<Location[]>([]);
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);

  const activeCompanyId = useMemo(() => resolveCompanyId(user, companyOverride), [user, companyOverride]);

  const budgetCompanyId = detail?.budget.company_id ?? activeCompanyId;

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listCompanies();
        if (!cancelled) {
          setCompanies(list.filter((c) => c.is_active));
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

  useEffect(() => {
    if (!isAdministrator(user) || companies.length === 0 || companyOverride !== null) {
      return;
    }
    setCompanyOverride(companies[0].id);
  }, [user, companies, companyOverride]);

  const loadLocationFilters = useCallback(async () => {
    if (!budgetCompanyId) {
      setLocations([]);
      setWorkplaces([]);
      return;
    }
    try {
      const [locs, wps] = await Promise.all([listLocations(), listWorkplaces()]);
      setLocations(locs.filter((l) => l.company_id === budgetCompanyId && l.is_active));
      setWorkplaces(wps.filter((w) => w.company_id === budgetCompanyId && w.is_active));
    } catch {
      setLocations([]);
      setWorkplaces([]);
    }
  }, [budgetCompanyId]);

  useEffect(() => {
    void loadLocationFilters();
  }, [loadLocationFilters]);

  const reloadList = useCallback(async () => {
    if (!activeCompanyId) {
      setRows([]);
      return;
    }
    setListLoading(true);
    setListError("");
    try {
      const data = await listBudgetProjects({
        companyId: isAdministrator(user) ? activeCompanyId : null,
        status: statusFilter || null,
        search: searchApplied.trim() || null,
        limit: 100,
        offset: 0,
      });
      setRows(data);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load budgets.");
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, [activeCompanyId, searchApplied, statusFilter, user]);

  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  const reloadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const [d, ex] = await Promise.all([getBudgetDetail(id), listBudgetExpenses(id)]);
      setDetail(d);
      setExpenses(ex);
    } catch (err) {
      setDetail(null);
      setExpenses([]);
      setDetailError(err instanceof Error ? err.message : "Could not load budget.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setExpenses([]);
      return;
    }
    void reloadDetail(selectedId);
  }, [selectedId, reloadDetail]);

  const [cName, setCName] = useState("");
  const [cClient, setCClient] = useState("");
  const [cRef, setCRef] = useState("");
  const [cWorkplace, setCWorkplace] = useState("");
  const [cLocation, setCLocation] = useState("");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const [cPlanned, setCPlanned] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cNotes, setCNotes] = useState("");
  const [cStatus, setCStatus] = useState("active");

  function resetCreateForm() {
    setCName("");
    setCClient("");
    setCRef("");
    setCWorkplace("");
    setCLocation("");
    setCStart("");
    setCEnd("");
    setCPlanned("");
    setCDesc("");
    setCNotes("");
    setCStatus("active");
  }

  function openEditFromDetail() {
    if (!detail) {
      return;
    }
    const b = detail.budget;
    setCName(b.name);
    setCClient(b.client_name ?? "");
    setCRef(b.reference_code ?? "");
    setCWorkplace(b.workplace_id ?? "");
    setCLocation(b.location_id ?? "");
    setCStart(b.start_date ?? "");
    setCEnd(b.end_date ?? "");
    setCPlanned(String(b.planned_budget_amount));
    setCDesc(b.description ?? "");
    setCNotes(b.notes ?? "");
    setCStatus(b.status);
    setShowEdit(true);
    setActionError("");
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    setActionError("");
    if (!activeCompanyId) {
      setActionError("Select a company.");
      return;
    }
    if (!cName.trim() || !cPlanned.trim()) {
      setActionError("Name and planned budget are required.");
      return;
    }
    setSaving(true);
    try {
      await createBudget({
        company_id: isAdministrator(user) ? activeCompanyId : undefined,
        name: cName.trim(),
        client_name: cClient.trim() || null,
        reference_code: cRef.trim() || null,
        workplace_id: cWorkplace.trim() || null,
        location_id: cLocation.trim() || null,
        start_date: cStart.trim() || null,
        end_date: cEnd.trim() || null,
        planned_budget_amount: cPlanned.trim(),
        description: cDesc.trim() || null,
        notes: cNotes.trim() || null,
        status: cStatus,
      });
      setShowCreate(false);
      await reloadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !detail) {
      return;
    }
    setActionError("");
    if (!cName.trim() || !cPlanned.trim()) {
      setActionError("Name and planned budget are required.");
      return;
    }
    setSaving(true);
    try {
      await patchBudget(selectedId, {
        name: cName.trim(),
        client_name: cClient.trim() || null,
        reference_code: cRef.trim() || null,
        workplace_id: cWorkplace.trim() || null,
        location_id: cLocation.trim() || null,
        start_date: cStart.trim() || null,
        end_date: cEnd.trim() || null,
        planned_budget_amount: cPlanned.trim(),
        description: cDesc.trim() || null,
        notes: cNotes.trim() || null,
        status: cStatus,
      });
      setShowEdit(false);
      await reloadDetail(selectedId);
      await reloadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  const [exCategory, setExCategory] = useState<string>("materials");
  const [exDesc, setExDesc] = useState("");
  const [exSupplier, setExSupplier] = useState("");
  const [exDate, setExDate] = useState(isoTodayYmd());
  const [exAmount, setExAmount] = useState("");
  const [exVat, setExVat] = useState("");
  const [exInv, setExInv] = useState("");
  const [exNotes, setExNotes] = useState("");
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

  function resetExpenseForm() {
    setExCategory("materials");
    setExDesc("");
    setExSupplier("");
    setExDate(isoTodayYmd());
    setExAmount("");
    setExVat("");
    setExInv("");
    setExNotes("");
    setEditingExpenseId(null);
  }

  async function submitExpense(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) {
      return;
    }
    setActionError("");
    if (!exDesc.trim() || !exAmount.trim()) {
      setActionError("Description and amount are required.");
      return;
    }
    setExpenseSaving(true);
    try {
      if (editingExpenseId) {
        await patchBudgetExpense(selectedId, editingExpenseId, {
          category: exCategory,
          description: exDesc.trim(),
          supplier: exSupplier.trim() || null,
          purchase_date: exDate,
          amount: exAmount.trim(),
          vat_amount: exVat.trim() || null,
          invoice_ref: exInv.trim() || null,
          notes: exNotes.trim() || null,
        });
      } else {
        await createBudgetExpense(selectedId, {
          category: exCategory,
          description: exDesc.trim(),
          supplier: exSupplier.trim() || null,
          purchase_date: exDate,
          amount: exAmount.trim(),
          vat_amount: exVat.trim() || null,
          invoice_ref: exInv.trim() || null,
          notes: exNotes.trim() || null,
        });
      }
      resetExpenseForm();
      await reloadDetail(selectedId);
      await reloadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Expense save failed.");
    } finally {
      setExpenseSaving(false);
    }
  }

  function startEditExpense(row: BudgetExpenseResponse) {
    setEditingExpenseId(row.id);
    setExCategory(row.category);
    setExDesc(row.description);
    setExSupplier(row.supplier ?? "");
    setExDate(typeof row.purchase_date === "string" ? row.purchase_date : String(row.purchase_date).slice(0, 10));
    setExAmount(String(row.amount));
    setExVat(row.vat_amount != null ? String(row.vat_amount) : "");
    setExInv(row.invoice_ref ?? "");
    setExNotes(row.notes ?? "");
  }

  async function handleDeleteExpense(id: string) {
    if (!selectedId || !window.confirm("Delete this purchase line?")) {
      return;
    }
    setActionError("");
    try {
      await deleteBudgetExpense(selectedId, id);
      resetExpenseForm();
      await reloadDetail(selectedId);
      await reloadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function handleArchive() {
    if (!selectedId || !window.confirm("Archive this budget? It will be marked archived.")) {
      return;
    }
    setActionError("");
    try {
      await archiveBudget(selectedId);
      setShowEdit(false);
      await reloadDetail(selectedId);
      await reloadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Archive failed.");
    }
  }

  async function handleExportCsv() {
    if (!selectedId) {
      return;
    }
    setActionError("");
    try {
      await downloadBudgetReportCsv(selectedId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  function handlePrint() {
    if (!selectedId) {
      return;
    }
    openBudgetReportPrint(selectedId);
  }

  const totals = detail?.totals;
  const cats = detail?.breakdown_by_category;

  const sharedFormFields = (
    <>
      <label className={fieldLabelClass()}>
        <span className="text-[var(--color-text)]">Project / job name</span>
        <Input className="mt-1" onChange={(e) => setCName(e.target.value)} value={cName} />
      </label>
      <label className={fieldLabelClass()}>
        <span className="text-[var(--color-text)]">Client name</span>
        <Input className="mt-1" onChange={(e) => setCClient(e.target.value)} value={cClient} />
      </label>
      <label className={fieldLabelClass()}>
        <span className="text-[var(--color-text)]">Reference</span>
        <Input className="mt-1" onChange={(e) => setCRef(e.target.value)} value={cRef} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={fieldLabelClass()}>
          <span className="text-[var(--color-text)]">Workplace (optional)</span>
          <select className={selectClass()} onChange={(e) => setCWorkplace(e.target.value)} value={cWorkplace}>
            <option value="">Any</option>
            {workplaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClass()}>
          <span className="text-[var(--color-text)]">Location (optional)</span>
          <select className={selectClass()} onChange={(e) => setCLocation(e.target.value)} value={cLocation}>
            <option value="">Company-wide</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={fieldLabelClass()}>
          <span className="text-[var(--color-text)]">Start date</span>
          <Input className="mt-1" onChange={(e) => setCStart(e.target.value)} type="date" value={cStart} />
        </label>
        <label className={fieldLabelClass()}>
          <span className="text-[var(--color-text)]">End date</span>
          <Input className="mt-1" onChange={(e) => setCEnd(e.target.value)} type="date" value={cEnd} />
        </label>
      </div>
      <label className={fieldLabelClass()}>
        <span className="text-[var(--color-text)]">Planned budget (£)</span>
        <Input className="mt-1" inputMode="decimal" onChange={(e) => setCPlanned(e.target.value)} value={cPlanned} />
      </label>
      <label className={fieldLabelClass()}>
        <span className="text-[var(--color-text)]">Status</span>
        <select className={selectClass()} onChange={(e) => setCStatus(e.target.value)} value={cStatus}>
          {BUDGET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldLabelClass()}>
        <span className="text-[var(--color-text)]">Description</span>
        <textarea className={textareaClass()} onChange={(e) => setCDesc(e.target.value)} value={cDesc} />
      </label>
      <label className={fieldLabelClass()}>
        <span className="text-[var(--color-text)]">Notes</span>
        <textarea className={textareaClass()} onChange={(e) => setCNotes(e.target.value)} value={cNotes} />
      </label>
    </>
  );

  if (!activeCompanyId && isAdministrator(user)) {
    return <p className="text-sm text-[var(--color-text-muted)]">Select a company to manage saved budgets.</p>;
  }

  if (selectedId) {
    return (
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSelectedId(null);
              setDetailError("");
            }}
          >
            ← Back to list
          </Button>
          {detail && detail.budget.status !== "archived" ? (
            <>
              <Button type="button" variant="secondary" onClick={() => void handleExportCsv()}>
                Export CSV
              </Button>
              <Button type="button" variant="secondary" onClick={handlePrint}>
                Print report
              </Button>
              <Button type="button" variant="secondary" onClick={openEditFromDetail}>
                Edit
              </Button>
              <Button type="button" variant="danger" onClick={() => void handleArchive()}>
                Archive
              </Button>
            </>
          ) : null}
        </div>

        {detailLoading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}
        {detailError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {detailError}
          </div>
        ) : null}
        {actionError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {actionError}
          </div>
        ) : null}

        {detail && totals ? (
          <>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">{detail.budget.name}</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                {detail.budget.client_name ? `${detail.budget.client_name} · ` : null}
                {detail.budget.location_name ?? "All company sites"}
                {detail.budget.workplace_name ? ` · ${detail.budget.workplace_name}` : null}
              </p>
            </div>

            {totals.warnings.length > 0 ? (
              <ul className="list-inside list-disc rounded-[var(--radius-md)] border border-amber-700/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {totals.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}

            <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              {totals.estimate_note}
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <BudgetStatCard label="Planned budget" value={moneyDisplay(totals.planned_budget_amount)} />
              <BudgetStatCard label="Finalized labour" value={moneyDisplay(totals.finalized_labour_cost)} />
              <BudgetStatCard label="Estimated labour" value={moneyDisplay(totals.estimated_labour_cost)} />
              <BudgetStatCard label="Total labour" value={moneyDisplay(totals.total_labour_cost)} />
              <BudgetStatCard label="Purchases / expenses" value={moneyDisplay(totals.total_expenses)} />
              <BudgetStatCard label="Total spent" value={moneyDisplay(totals.total_spent)} />
              <BudgetStatCard label="Remaining" value={moneyDisplay(totals.remaining_budget)} />
              <BudgetStatCard
                label="Over budget"
                value={moneyDisplay(totals.over_budget_amount)}
                hint={Number(totals.over_budget_amount) > 0 ? "Spent exceeds planned" : undefined}
              />
              <BudgetStatCard label="Budget used" value={percentDisplay(totals.budget_used_percent)} />
              <BudgetStatCard label="Labour % of budget" value={percentDisplay(totals.labour_percent_of_budget)} />
              <BudgetStatCard label="Expenses % of budget" value={percentDisplay(totals.expenses_percent_of_budget)} />
              <BudgetStatCard label="Open shifts (not costed)" value={String(totals.open_shift_count)} />
              <BudgetStatCard label="Missing hourly rates" value={String(totals.missing_rate_count)} />
            </div>

            {cats ? (
              <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
                <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                    Expense totals by category
                  </p>
                </div>
                <div className="overflow-x-auto p-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(
                        [
                          ["materials", cats.materials],
                          ["tools", cats.tools],
                          ["equipment", cats.equipment],
                          ["subcontractor", cats.subcontractor],
                          ["plant_hire", cats.plant_hire],
                          ["transport", cats.transport],
                          ["other", cats.other],
                        ] as const
                      ).map(([k, v]) => (
                        <TableRow key={k}>
                          <TableCell>{expenseCategoryLabel(k)}</TableCell>
                          <TableCell className="text-right tabular-nums">{moneyDisplay(v)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
              <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                  Labour by employee
                </p>
              </div>
              <div className="overflow-x-auto p-2">
                {detail.breakdown_by_employee.length === 0 ? (
                  <p className="p-2 text-sm text-[var(--color-text-muted)]">No labour in this budget window.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Finalized</TableHead>
                        <TableHead className="text-right">Estimated</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.breakdown_by_employee.map((row) => (
                        <TableRow key={row.user_id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{row.employee_name ?? row.employee_email}</span>
                              <span className="text-xs text-[var(--color-text-muted)]">{row.employee_email}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatHoursFromSeconds(row.total_payroll_seconds)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{moneyDisplay(row.finalized_labour_cost)}</TableCell>
                          <TableCell className="text-right tabular-nums">{moneyDisplay(row.estimated_labour_cost)}</TableCell>
                          <TableCell className="text-right tabular-nums">{moneyDisplay(row.total_labour_cost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {editingExpenseId ? "Edit purchase" : "Add purchase"}
              </p>
              <form className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(ev) => void submitExpense(ev)}>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Category</span>
                  <select className={selectClass()} onChange={(e) => setExCategory(e.target.value)} value={exCategory}>
                    {BUDGET_EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {expenseCategoryLabel(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Purchase date</span>
                  <Input className="mt-1" onChange={(e) => setExDate(e.target.value)} type="date" value={exDate} />
                </label>
                <label className={`sm:col-span-2 ${fieldLabelClass()}`}>
                  <span className="text-[var(--color-text)]">Description</span>
                  <Input className="mt-1" onChange={(e) => setExDesc(e.target.value)} value={exDesc} />
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Supplier</span>
                  <Input className="mt-1" onChange={(e) => setExSupplier(e.target.value)} value={exSupplier} />
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Amount (£)</span>
                  <Input className="mt-1" inputMode="decimal" onChange={(e) => setExAmount(e.target.value)} value={exAmount} />
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">VAT (£)</span>
                  <Input className="mt-1" inputMode="decimal" onChange={(e) => setExVat(e.target.value)} value={exVat} />
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Invoice ref</span>
                  <Input className="mt-1" onChange={(e) => setExInv(e.target.value)} value={exInv} />
                </label>
                <label className={`sm:col-span-2 ${fieldLabelClass()}`}>
                  <span className="text-[var(--color-text)]">Notes</span>
                  <textarea className={textareaClass()} onChange={(e) => setExNotes(e.target.value)} value={exNotes} />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Button disabled={expenseSaving} type="submit">
                    {expenseSaving ? "Saving…" : editingExpenseId ? "Update purchase" : "Add purchase"}
                  </Button>
                  {editingExpenseId ? (
                    <Button type="button" variant="ghost" onClick={resetExpenseForm}>
                      Cancel edit
                    </Button>
                  ) : null}
                </div>
              </form>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
              <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">Purchases</p>
              </div>
              <div className="overflow-x-auto p-2">
                {expenses.length === 0 ? (
                  <p className="p-2 text-sm text-[var(--color-text-muted)]">No purchases yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {typeof row.purchase_date === "string" ? row.purchase_date : String(row.purchase_date)}
                          </TableCell>
                          <TableCell>{expenseCategoryLabel(row.category)}</TableCell>
                          <TableCell>{row.supplier ?? "—"}</TableCell>
                          <TableCell>{row.description}</TableCell>
                          <TableCell className="text-right tabular-nums">{moneyDisplay(row.amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.vat_amount != null ? moneyDisplay(row.vat_amount) : "—"}</TableCell>
                          <TableCell>{row.invoice_ref ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Button size="sm" type="button" variant="ghost" onClick={() => startEditExpense(row)}>
                              Edit
                            </Button>
                            <Button size="sm" type="button" variant="danger" onClick={() => void handleDeleteExpense(row.id)}>
                              Delete
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </>
        ) : null}

        {showEdit && detail ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4">
            <div className={overlayPanelClass()}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-[var(--color-text)]">Edit budget</h3>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowEdit(false);
                    setActionError("");
                  }}
                >
                  Close
                </Button>
              </div>
              <form className="space-y-3" onSubmit={(ev) => void submitEdit(ev)}>
                {sharedFormFields}
                {actionError ? <p className="text-sm text-[var(--color-danger-700)]">{actionError}</p> : null}
                <div className="flex gap-2 pt-2">
                  <Button disabled={saving} type="submit">
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {isAdministrator(user) ? (
          <label className={fieldLabelClass()}>
            <span className="text-[var(--color-text)]">Company</span>
            <select
              className={selectClass()}
              onChange={(e) => setCompanyOverride(e.target.value || null)}
              value={companyOverride ?? ""}
            >
              <option value="">Choose…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={fieldLabelClass()}>
          <span className="text-[var(--color-text)]">Status</span>
          <select className={selectClass()} onChange={(e) => setStatusFilter(e.target.value)} value={statusFilter}>
            <option value="">All</option>
            {BUDGET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className={`max-w-xs ${fieldLabelClass()}`}>
          <span className="text-[var(--color-text)]">Search</span>
          <Input className="mt-1" onChange={(e) => setSearchInput(e.target.value)} value={searchInput} />
        </label>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSearchApplied(searchInput);
          }}
        >
          Apply
        </Button>
        <div className="flex-1" />
        <Button
          disabled={!activeCompanyId}
          type="button"
          onClick={() => {
            resetCreateForm();
            setActionError("");
            setShowCreate(true);
          }}
        >
          New budget
        </Button>
      </div>

      {listError ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
          {listError}
        </div>
      ) : null}

      {listLoading ? <p className="text-sm text-[var(--color-text-muted)]">Loading budgets…</p> : null}

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
        <div className="overflow-x-auto p-2">
          {rows.length === 0 && !listLoading ? (
            <p className="p-3 text-sm text-[var(--color-text-muted)]">No saved budgets yet. Create one to track job costs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.client_name ?? "—"}</TableCell>
                    <TableCell>{r.location_name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{moneyDisplay(r.planned_budget_amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{moneyDisplay(r.total_spent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{moneyDisplay(r.remaining_budget)}</TableCell>
                    <TableCell className="text-right tabular-nums">{percentDisplay(r.budget_used_percent)}</TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell>
                      <Button size="sm" type="button" variant="secondary" onClick={() => setSelectedId(r.id)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4">
          <div className={overlayPanelClass()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">New budget</h3>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowCreate(false);
                  setActionError("");
                }}
              >
                Close
              </Button>
            </div>
            <form className="space-y-3" onSubmit={(ev) => void submitCreate(ev)}>
              {sharedFormFields}
              {actionError ? <p className="text-sm text-[var(--color-danger-700)]">{actionError}</p> : null}
              <div className="flex gap-2 pt-2">
                <Button disabled={saving} type="submit">
                  {saving ? "Creating…" : "Create budget"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
