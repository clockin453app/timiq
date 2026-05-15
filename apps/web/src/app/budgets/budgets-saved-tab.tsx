"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui";
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
  type BudgetCategoryTotals,
  type BudgetExpenseResponse,
  type BudgetProjectDetailResponse,
  type BudgetProjectSummary,
} from "../../features/budgets/api";
import { listCompanies, type Company } from "../../features/companies/api";
import { formatHoursFromSeconds } from "../../features/payroll/format";
import { listLocations, type Location } from "../../features/locations/api";
import { listWorkplaces, type Workplace } from "../../features/workplaces/api";
import {
  BudgetCompactStat,
  BudgetHealthBar,
  budgetStatusBadgeTone,
  expenseCategoryLabel,
  isoTodayYmd,
  moneyDisplay,
  percentDisplay,
  segmentBtnClass,
} from "./budget-ui";

const BUDGET_STATUSES = ["draft", "active", "completed", "archived"] as const;

const CATEGORY_KEYS = [
  "materials",
  "tools",
  "equipment",
  "subcontractor",
  "plant_hire",
  "transport",
  "other",
] as const;

type BudgetDetailTab = "overview" | "purchases" | "labour" | "reports";

type CategoryEntry = { key: (typeof CATEGORY_KEYS)[number]; amount: number };

function resolveCompanyId(user: AuthUser, override: string | null): string | null {
  if (isAdministrator(user)) {
    return override;
  }
  return user.company_id;
}

function overlayPanelClass() {
  return "w-full max-w-lg rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg";
}

function expenseModalClass() {
  return "w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg";
}

function fieldLabelClass() {
  return "block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]";
}

function selectClass() {
  return "mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]";
}

function textareaClass() {
  return "mt-1.5 min-h-[64px] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2 text-sm text-[var(--color-text)]";
}

function formatHeaderDate(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function categoryAmount(cats: BudgetCategoryTotals, key: (typeof CATEGORY_KEYS)[number]): number {
  const v = cats[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function purchaseDateDisplay(row: BudgetExpenseResponse): string {
  if (typeof row.purchase_date === "string") {
    return row.purchase_date;
  }
  return String(row.purchase_date).slice(0, 10);
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
  const [detailTab, setDetailTab] = useState<BudgetDetailTab>("overview");

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [expenseSuccess, setExpenseSuccess] = useState("");

  const [locations, setLocations] = useState<Location[]>([]);
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);

  const activeCompanyId = useMemo(() => resolveCompanyId(user, companyOverride), [user, companyOverride]);

  const budgetCompanyId = detail?.budget.company_id ?? activeCompanyId;

  useEffect(() => {
    if (!expenseSuccess) {
      return;
    }
    const t = window.setTimeout(() => setExpenseSuccess(""), 4500);
    return () => window.clearTimeout(t);
  }, [expenseSuccess]);

  useEffect(() => {
    setDetailTab("overview");
  }, [selectedId]);

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

  const suggestedSiteId = useMemo(() => {
    if (cLocation.trim()) {
      return null;
    }
    if (!cWorkplace.trim()) {
      return null;
    }
    const wp = workplaces.find((w) => w.id === cWorkplace);
    if (!wp) {
      return null;
    }
    const key = wp.name.trim().toLowerCase();
    const matches = locations.filter((l) => l.name.trim().toLowerCase() === key);
    return matches.length === 1 ? matches[0].id : null;
  }, [cLocation, cWorkplace, workplaces, locations]);

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
  const [showZeroCategories, setShowZeroCategories] = useState(false);

  useEffect(() => {
    setShowZeroCategories(false);
  }, [selectedId, detail?.budget.id]);

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

  function openAddExpenseModal() {
    setActionError("");
    resetExpenseForm();
    setShowExpenseModal(true);
    setDetailTab("purchases");
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
      setShowExpenseModal(false);
      resetExpenseForm();
      setExpenseSuccess(editingExpenseId ? "Purchase updated." : "Purchase saved.");
      await reloadDetail(selectedId);
      await reloadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Expense save failed.");
    } finally {
      setExpenseSaving(false);
    }
  }

  function startEditExpense(row: BudgetExpenseResponse) {
    setActionError("");
    setEditingExpenseId(row.id);
    setExCategory(row.category);
    setExDesc(row.description);
    setExSupplier(row.supplier ?? "");
    setExDate(purchaseDateDisplay(row));
    setExAmount(String(row.amount));
    setExVat(row.vat_amount != null ? String(row.vat_amount) : "");
    setExInv(row.invoice_ref ?? "");
    setExNotes(row.notes ?? "");
    setShowExpenseModal(true);
    setDetailTab("purchases");
  }

  async function handleDeleteExpense(id: string) {
    if (!selectedId || !window.confirm("Delete this purchase line?")) {
      return;
    }
    setActionError("");
    try {
      await deleteBudgetExpense(selectedId, id);
      resetExpenseForm();
      setShowExpenseModal(false);
      setExpenseSuccess("Purchase deleted.");
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
      setShowExpenseModal(false);
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

  const categoryRows = useMemo(() => {
    if (!cats) {
      return { nonZero: [] as CategoryEntry[], zeros: [] as CategoryEntry[] };
    }
    const entries = CATEGORY_KEYS.map((key) => ({ key, amount: categoryAmount(cats, key) }));
    const nonZero = entries.filter((e) => e.amount > 0);
    const zeros = entries.filter((e) => e.amount === 0);
    return { nonZero, zeros };
  }, [cats]);

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
          <span className="text-[var(--color-text)]">Operational site</span>
          <select className={selectClass()} onChange={(e) => setCLocation(e.target.value)} value={cLocation}>
            <option value="">— Select site —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            Labour totals are filtered by this clocking site.
          </span>
          {suggestedSiteId ? (
            <button
              className="mt-1 text-xs font-semibold text-[var(--color-text)] underline decoration-dotted hover:text-[var(--color-text-muted)]"
              type="button"
              onClick={() => setCLocation(suggestedSiteId)}
            >
              Suggested site: {locations.find((l) => l.id === suggestedSiteId)?.name ?? "match"}
            </button>
          ) : null}
        </label>
        <label className={fieldLabelClass()}>
          <span className="text-[var(--color-text)]">CIS workplace / payroll reference (optional)</span>
          <select className={selectClass()} onChange={(e) => setCWorkplace(e.target.value)} value={cWorkplace}>
            <option value="">None</option>
            {workplaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            For CIS and payroll reference only; does not filter labour.
          </span>
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

  const expenseFormFields = (
    <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(ev) => void submitExpense(ev)}>
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
      {actionError && showExpenseModal ? (
        <p className="sm:col-span-2 text-sm text-[var(--color-danger-700)]">{actionError}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button disabled={expenseSaving} type="submit">
          {expenseSaving ? "Saving…" : editingExpenseId ? "Save changes" : "Save purchase"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setShowExpenseModal(false);
            resetExpenseForm();
            setActionError("");
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );

  if (!activeCompanyId && isAdministrator(user)) {
    return <p className="text-sm text-[var(--color-text-muted)]">Select a company to manage saved budgets.</p>;
  }

  if (selectedId) {
    const b = detail?.budget;
    const isOver = totals ? Number(totals.over_budget_amount) > 0 : false;
    const pctNum = totals ? Number(totals.budget_used_percent) : NaN;
    const pctBar = Number.isFinite(pctNum) ? Math.max(0, pctNum) : 0;
    const dateStart = formatHeaderDate(b?.start_date ?? null);
    const dateEnd = formatHeaderDate(b?.end_date ?? null);
    let dateRangeLabel = "No dates set";
    if (dateStart && dateEnd) {
      dateRangeLabel = `${dateStart} – ${dateEnd}`;
    } else if (dateStart) {
      dateRangeLabel = `${dateStart} – Ongoing`;
    } else if (dateEnd) {
      dateRangeLabel = `Until ${dateEnd}`;
    }

    const siteParts: string[] = [];
    if (b?.location_name) {
      siteParts.push(`Operational site: ${b.location_name}`);
    }
    if (b?.workplace_name) {
      siteParts.push(`CIS workplace: ${b.workplace_name}`);
    }
    const siteLine =
      siteParts.length > 0 ? siteParts.join(" · ") : "No operational site selected — labour not filtered by site";
    const hasOperationalSite = Boolean(b?.location_id);

    return (
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap gap-2 border-b border-[var(--color-border-dark)] pb-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSelectedId(null);
              setDetailError("");
              setActionError("");
              setExpenseSuccess("");
              setShowExpenseModal(false);
            }}
          >
            Back
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
        {actionError && !showExpenseModal ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {actionError}
          </div>
        ) : null}
        {expenseSuccess ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-success-700)] bg-[var(--color-success-50)] px-3 py-2 text-sm text-[var(--color-success-700)]">
            {expenseSuccess}
          </div>
        ) : null}

        {detail && totals && b ? (
          <>
            <header className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold tracking-tight text-[var(--color-text)]">{b.name}</h2>
                    <Badge tone={budgetStatusBadgeTone(b.status)}>{b.status}</Badge>
                  </div>
                  {b.client_name ? <p className="text-sm text-[var(--color-text)]">{b.client_name}</p> : null}
                  <p className="text-sm text-[var(--color-text-muted)]">{siteLine}</p>
                  <p className="text-xs text-[var(--color-text-soft)]">{dateRangeLabel}</p>
                  {b.reference_code ? (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Reference: <span className="font-mono text-[var(--color-text)]">{b.reference_code}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            </header>

            <div className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-1">
              {(
                [
                  ["overview", "Overview"],
                  ["purchases", "Purchases"],
                  ["labour", "Labour"],
                  ["reports", "Reports"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={segmentBtnClass(detailTab === id)}
                  type="button"
                  onClick={() => setDetailTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {detailTab === "overview" ? (
              <div className="space-y-5">
                <BudgetHealthBar
                  isOverBudget={isOver}
                  percentUsedDisplay={percentDisplay(totals.budget_used_percent)}
                  percentUsedNumeric={pctBar}
                  plannedDisplay={moneyDisplay(totals.planned_budget_amount)}
                  remainingOrOverDisplay={
                    isOver ? moneyDisplay(totals.over_budget_amount) : moneyDisplay(totals.remaining_budget)
                  }
                  spentDisplay={moneyDisplay(totals.total_spent)}
                />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <BudgetCompactStat label="Planned budget" value={moneyDisplay(totals.planned_budget_amount)} />
                  <BudgetCompactStat label="Total spent" value={moneyDisplay(totals.total_spent)} />
                  <BudgetCompactStat
                    emphasis={isOver ? "danger" : "default"}
                    label={isOver ? "Over budget" : "Remaining"}
                    value={isOver ? moneyDisplay(totals.over_budget_amount) : moneyDisplay(totals.remaining_budget)}
                  />
                  <BudgetCompactStat label="Budget used" value={percentDisplay(totals.budget_used_percent)} />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <BudgetCompactStat label="Finalized labour" value={moneyDisplay(totals.finalized_labour_cost)} />
                  <BudgetCompactStat label="Estimated labour" value={moneyDisplay(totals.estimated_labour_cost)} />
                  <BudgetCompactStat label="Purchases / expenses" value={moneyDisplay(totals.total_expenses)} />
                  <BudgetCompactStat
                    hint={
                      totals.missing_rate_count > 0
                        ? `${totals.missing_rate_count} employee(s) missing hourly rate`
                        : undefined
                    }
                    label="Open shifts / rates"
                    value={`${totals.open_shift_count} open · ${totals.missing_rate_count} missing rate`}
                  />
                </div>

                {cats ? (
                  <section>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--color-text)]">Expense categories</h3>
                      {categoryRows.zeros.length > 0 ? (
                        <button
                          className="text-xs font-semibold text-[var(--color-text-muted)] underline decoration-dotted hover:text-[var(--color-text)]"
                          type="button"
                          onClick={() => setShowZeroCategories((v) => !v)}
                        >
                          {showZeroCategories ? "Hide zero categories" : "Show zero categories"}
                        </button>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {(showZeroCategories ? [...categoryRows.nonZero, ...categoryRows.zeros] : categoryRows.nonZero.length > 0
                        ? categoryRows.nonZero
                        : categoryRows.zeros
                      ).map(({ key, amount }) => (
                        <div
                          key={key}
                          className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2.5 py-2"
                        >
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                            {expenseCategoryLabel(key)}
                          </p>
                          <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--color-text)]">
                            {moneyDisplay(amount)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {!hasOperationalSite ? (
                  <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-[var(--color-warning-700)]">
                      Select an operational site to calculate labour accurately.
                    </p>
                    {b.status !== "archived" ? (
                      <Button size="sm" type="button" variant="secondary" onClick={openEditFromDetail}>
                        Edit budget
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
                    Labour totals are filtered by the selected operational site.
                  </p>
                )}

                {totals.warnings.length > 0 ? (
                  <ul className="list-inside list-disc rounded-[var(--radius-md)] border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] px-3 py-2 text-sm text-[var(--color-warning-700)]">
                    {totals.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}

                <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  {totals.estimate_note}
                </p>
              </div>
            ) : null}

            {detailTab === "purchases" ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Purchases</h3>
                  {b.status !== "archived" ? (
                    <Button type="button" onClick={openAddExpenseModal}>
                      + Add purchase
                    </Button>
                  ) : null}
                </div>

                {expenses.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-8 text-center">
                    <p className="text-sm text-[var(--color-text-muted)]">No purchases added yet.</p>
                    {b.status !== "archived" ? (
                      <Button className="mt-3" type="button" onClick={openAddExpenseModal}>
                        Add first purchase
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
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
                              <TableCell className="whitespace-nowrap tabular-nums text-sm">
                                {purchaseDateDisplay(row)}
                              </TableCell>
                              <TableCell className="text-sm">{expenseCategoryLabel(row.category)}</TableCell>
                              <TableCell className="text-sm">{row.supplier ?? "—"}</TableCell>
                              <TableCell className="max-w-[200px] truncate text-sm">{row.description}</TableCell>
                              <TableCell className="text-right text-sm tabular-nums">{moneyDisplay(row.amount)}</TableCell>
                              <TableCell className="text-right text-sm tabular-nums">
                                {row.vat_amount != null ? moneyDisplay(row.vat_amount) : "—"}
                              </TableCell>
                              <TableCell className="text-sm">{row.invoice_ref ?? "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {b.status !== "archived" ? (
                                  <>
                                    <Button size="sm" type="button" variant="ghost" onClick={() => startEditExpense(row)}>
                                      Edit
                                    </Button>
                                    <Button
                                      size="sm"
                                      type="button"
                                      variant="danger"
                                      onClick={() => void handleDeleteExpense(row.id)}
                                    >
                                      Delete
                                    </Button>
                                  </>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="space-y-2 md:hidden">
                      {expenses.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-[var(--color-text-soft)]">
                              {purchaseDateDisplay(row)} · {expenseCategoryLabel(row.category)}
                            </p>
                            <p className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{moneyDisplay(row.amount)}</p>
                          </div>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{row.description}</p>
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                            {row.supplier ?? "—"} · VAT: {row.vat_amount != null ? moneyDisplay(row.vat_amount) : "—"} · Inv:{" "}
                            {row.invoice_ref ?? "—"}
                          </p>
                          {b.status !== "archived" ? (
                            <div className="mt-2 flex gap-2">
                              <Button size="sm" type="button" variant="secondary" onClick={() => startEditExpense(row)}>
                                Edit
                              </Button>
                              <Button size="sm" type="button" variant="danger" onClick={() => void handleDeleteExpense(row.id)}>
                                Delete
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {detailTab === "labour" ? (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-text-muted)]">
                  <strong className="text-[var(--color-text)]">Finalized labour</strong> uses approved or paid payroll
                  gross where available. <strong className="text-[var(--color-text)]">Estimated labour</strong> covers
                  periods not yet finalized, using payroll-rounded time and profile rates. Official totals always come from
                  the server.
                </p>
                {(totals.open_shift_count > 0 || totals.missing_rate_count > 0) && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] px-3 py-2 text-sm text-[var(--color-warning-700)]">
                    {totals.open_shift_count > 0 ? (
                      <p>{totals.open_shift_count} open shift(s) in range are not included in labour cost.</p>
                    ) : null}
                    {totals.missing_rate_count > 0 ? (
                      <p>{totals.missing_rate_count} employee(s) are missing an hourly rate; those hours may show as zero cost.</p>
                    ) : null}
                  </div>
                )}
                <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
                  {detail.breakdown_by_employee.length === 0 ? (
                    <p className="p-4 text-sm text-[var(--color-text-muted)]">
                      {!hasOperationalSite
                        ? "No operational site selected. Select a site on this budget to include shift labour."
                        : "No completed shifts found at this site in the budget date range."}
                    </p>
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
            ) : null}

            {detailTab === "reports" ? (
              <div className="max-w-xl space-y-4 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-4">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Exports</h3>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Download a CSV for spreadsheets, or open a print-ready HTML summary (use your browser Print → Save as
                  PDF). Both include budget summary, category totals, purchase lines, and labour breakdown using the same
                  server-side figures as this page. They do not include sensitive payroll identifiers.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => void handleExportCsv()}>
                    Export CSV
                  </Button>
                  <Button type="button" variant="secondary" onClick={handlePrint}>
                    Print report
                  </Button>
                </div>
              </div>
            ) : null}
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

        {showExpenseModal && detail && detail.budget.status !== "archived" ? (
          <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
            <div className={expenseModalClass()}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-[var(--color-text)]">
                  {editingExpenseId ? "Edit purchase" : "Add purchase"}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowExpenseModal(false);
                    resetExpenseForm();
                    setActionError("");
                  }}
                >
                  Close
                </Button>
              </div>
              {expenseFormFields}
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
