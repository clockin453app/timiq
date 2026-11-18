"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { API_URL } from "@/config/api";
import { listCompanies, type Company } from "@/features/companies/api";
import { readStoredCompanyId, writeStoredCompanyId } from "@/features/companies/selected-company";

import "./finance-v3.css";
import "./finance-grid.css";
import { CommercialPerformanceChart, buildCommercialBars } from "./finance-chart";
import { FinanceCvrScreen } from "./finance-cvr-screen";
import { FinanceDataGrid, type FinanceGridColumn } from "./finance-data-grid";
import { FinanceOverviewScreen } from "./finance-overview-screen";
import { DEMO_ALLOCATION_LINES } from "./finance-demo-fixture";
import { FinanceSourceDrawer } from "./finance-source-drawer";
import { CisBankPayments, EMPTY_QUERY, FinanceQueryBar, RegisterSearch, exportHref, useFinanceQuery, type FinanceQuery } from "./finance-query";
import { FICTIONAL_WORKER_PREVIEW } from "./finance-preview";
import type { SourceBreakdownPayload } from "./finance-reconcile";
import {
  WORKSHEET_NAV,
  FINANCE_FIGURE_HELP,
  INVOICE_LEARNING_STEPS,
  addMoney,
  allocationRemaining,
  budgetForecastReview,
  confirmationCopy,
  compactMetricStatus,
  controlAmount,
  controlPercent,
  costDocumentTouchesProject,
  forecastShare,
  financeUiAttentionActions,
  financePortfolioSummary,
  forecastTone,
  isForecastLoss,
  activeMovementCount,
  customerSettlementStatus,
  effectiveMovementTotal,
  formatGbp,
  formatKnownMoney,
  invoiceCashReceived,
  metricHonestyLabel,
  primaryKpisReady,
  projectControlDrilldown,
  receiptAllocationStatus,
  reversalState,
  invoiceGross,
  ownerControl,
  paymentPreview,
  postedSupplierTotals,
  retentionPreview,
  retentionReleaseStatus,
  subtractMoney,
  supplierCashPaid,
  supplierCreditApplied,
  supplierSettlementStatus,
  supplierStatus,
  toMinor,
  vatPostingBlocker,
  worksheetHeading,
  withCompany,
  type FinanceNavigateTarget,
  type MetricScope,
  type VatDecision,
  type MoneyValue,
  type Worksheet,
} from "./presentation";

type Row = Record<string, string | number | boolean | null>;
type Books = {
  projects: Row[];
  parties: Row[];
  codes: Row[];
  costs: Row[];
  supplierPayments: Row[];
  customerInvoices: Row[];
  receipts: Row[];
  tax: Record<string, string> | null;
  certificates: Row[];
  releases: Row[];
  applications: Row[];
  variations: Row[];
  dayworks: Row[];
  commitments: Row[];
  funding: Row[];
  openings: Row[];
  audit: Row[];
  position: Record<string, string> | null;
  cis: Row[];
  workerPayments: Row[];
  cisSources: Row[];
  payeSources: Row[];
  cvrs: Row[];
};

const EMPTY: Books = {
  projects: [], parties: [], codes: [], costs: [], supplierPayments: [], customerInvoices: [], receipts: [],
  tax: null, certificates: [], releases: [], applications: [], variations: [], dayworks: [], commitments: [],
  funding: [], openings: [], audit: [], position: null, cis: [], workerPayments: [], cisSources: [], payeSources: [], cvrs: [],
};

const LIABILITY = new Set(["supplier_invoice", "expense_receipt"]);
const ReadOnlyPreview = createContext(true);

function Action({ className, onClick, children, disabled = false }: { className: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  const locked = useContext(ReadOnlyPreview);
  const blocked = locked || disabled;
  return <button className={className} type="button" disabled={blocked} title={locked ? "Disabled in read-only preview" : undefined} onClick={onClick}>{children}</button>;
}

export type FinanceWorkspaceDemo = {
  companies: Company[];
  books: Books;
  categories?: { category: string; eligible: string }[];
  initialSheet?: Worksheet;
  initialProjectId?: string;
  label?: string;
};

export function FinanceWorkspace({ demo }: { demo?: FinanceWorkspaceDemo } = {}) {
  const demoMode = Boolean(demo);
  const [companies, setCompanies] = useState<Company[]>(demo?.companies ?? []);
  const [companyId, setCompanyId] = useState(demo?.companies[0]?.id ?? "");
  const [projectId, setProjectId] = useState(demo?.initialProjectId ?? "");
  const [sheet, setSheet] = useState<Worksheet>(demo?.initialSheet ?? "PROJECT CONTROL");
  const [books, setBooks] = useState<Books>(demo?.books ?? EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [expenseFilter, setExpenseFilter] = useState("All");
  const [payView, setPayView] = useState("Supplier payments");
  const [loanView, setLoanView] = useState("Movements");
  const [drawer, setDrawer] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ title: string; body: string; warning: string } | null>(null);
  const [categories, setCategories] = useState<{ category: string; eligible: string }[]>(demo?.categories ?? []);
  const [categoryLoadFailed, setCategoryLoadFailed] = useState(!(demo?.categories?.length));
  const [previewReadonly, setPreviewReadonly] = useState(true);
  const [navFocus, setNavFocus] = useState<FinanceNavigateTarget["focus"] | null>(null);
  const busy = useRef(false);

  function navigateFinance(target: FinanceNavigateTarget) {
    if (target.expenseFilter) setExpenseFilter(target.expenseFilter);
    setSheet(target.sheet);
    setQuery("");
    setMessage("");
    setNavFocus(target.focus ?? null);
  }

  useEffect(() => {
    if (demoMode) {
      setPreviewReadonly(true);
      return;
    }
    let cancelled = false;
    fetch(`${API_URL}/api/finance/preview-mode`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview");
        return response.json() as Promise<{ readonly?: boolean }>;
      })
      .then((body) => { if (!cancelled) setPreviewReadonly(body.readonly !== false); })
      .catch(() => { if (!cancelled) setPreviewReadonly(true); });
    return () => { cancelled = true; };
  }, [companyId, demoMode]);

  useEffect(() => {
    if (demoMode) return;
    listCompanies().then((list) => {
      setCompanies(list);
      const stored = readStoredCompanyId();
      const next = list.find((item) => item.id === stored)?.id ?? list[0]?.id ?? "";
      setCompanyId(next);
    }).catch(() => setError("Companies could not be loaded."));
  }, [demoMode]);

  useEffect(() => {
    if (demoMode) {
      if (!demo) return;
      const selectedCvrs = projectId
        ? demo.books.cvrs.filter((row) => String(row.id) === projectId)
        : demo.books.cvrs;
      setBooks({ ...demo.books, cvrs: selectedCvrs });
      setCategories(demo.categories ?? []);
      setCategoryLoadFailed(!(demo.categories?.length));
      setLoading(false);
      setError("");
      return;
    }
    if (!companyId) return;
    writeStoredCompanyId(companyId);
    let cancelled = false;
    setLoading(true);
    setError("");
    const get = async (path: string) => {
      const response = await fetch(`${API_URL}${withCompany(path, companyId)}`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      return response.json();
    };
    void (async () => {
      try {
        const [projects, parties, codes, costs, supplierPayments, customerInvoices, receipts, tax, certificates, releases, applications, variations, dayworks, commitments, funding, openings, audit, position, cis, workerPayments, cisSources, payeSources] = await Promise.all([
          get("/api/finance/projects"), get("/api/finance/counterparties"), get("/api/finance/cost-codes"),
          get("/api/finance/registers/supplier-invoices"), get("/api/finance/registers/supplier-payments"),
          get("/api/finance/registers/invoices"), get("/api/finance/registers/receipts"), get("/api/finance/tax-report"),
          get("/api/finance/registers/certificates"), get("/api/finance/registers/retention"), get("/api/finance/registers/applications"),
          get("/api/finance/registers/variations"), get("/api/finance/registers/dayworks"), get("/api/finance/registers/commitments"),
          get("/api/finance/registers/funding"), get("/api/finance/registers/openings"), get("/api/finance/registers/audit"),
          get("/api/finance/supplier-position"), get("/api/finance/cis"), get("/api/finance/registers/worker-payments"),
          get("/api/finance/cis-sources"), get("/api/finance/paye-sources"),
        ]);
        const selected = projectId ? (projects as Row[]).filter((item) => String(item.id) === projectId) : (projects as Row[]);
        const cvrs: Row[] = [];
        for (const project of selected) {
          const cvr = await get(`/api/finance/cvr?project_id=${encodeURIComponent(String(project.id))}`) as Record<string, string>;
          cvrs.push({ id: String(project.id), name: String(project.name ?? ""), reference_code: String(project.reference_code ?? ""), ...cvr });
        }
        let nextCategories: { category: string; eligible: string }[] = [];
        let categoriesFailed = false;
        try {
          const categoryPath = projectId ? `/api/finance/cost-categories?project_id=${encodeURIComponent(projectId)}` : "/api/finance/cost-categories";
          nextCategories = await get(categoryPath) as { category: string; eligible: string }[];
        } catch {
          categoriesFailed = true;
        }
        if (!cancelled) {
          setCategories(nextCategories);
          setCategoryLoadFailed(categoriesFailed);
          setBooks({ projects, parties, codes, costs, supplierPayments, customerInvoices, receipts, tax, certificates, releases, applications, variations, dayworks, commitments, funding, openings, audit, position, cis, workerPayments, cisSources, payeSources, cvrs });
        }
      } catch (reason: unknown) {
        if (!cancelled) { setBooks(EMPTY); setCategories([]); setCategoryLoadFailed(true); setError(reason instanceof Error ? reason.message : "Finance records could not be loaded."); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, projectId, reloadToken, demoMode, demo]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setDrawer(null); setExplain(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(path: string, body: unknown, posting: boolean, quiet = false) {
    if (previewReadonly) { setError("Read-only preview is active. The change was not sent."); return null; }
    if (busy.current) { setError("A finance save is already in progress. Wait for it to finish before trying again."); return null; }
    const prompt = posting ? confirmationCopy("finance record") : "Save this draft? It stays out of posted totals until posting is confirmed.";
    if (!quiet && !window.confirm(prompt)) return null;
    busy.current = true;
    setError("");
    try {
      const response = await fetch(`${API_URL}${withCompany(path, companyId)}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setError(await readError(response)); return null; }
      const payload = await response.json();
      setMessage(posting ? "Posted from the finance records. The register will reload." : "Draft saved. It is not in the posted totals.");
      setReloadToken((value) => value + 1);
      return payload as { id?: string };
    } catch {
      setError("The finance service did not answer. Nothing was confirmed as saved.");
      return null;
    } finally {
      busy.current = false;
    }
  }

  const names = useMemo(() => new Map(books.parties.map((item) => [String(item.id), String(item.name)])), [books.parties]);
  const projectsById = useMemo(() => new Map(books.projects.map((item) => [String(item.id), String(item.name)])), [books.projects]);
  const open = (title: string, body: string, warning: string) => setExplain({ title, body, warning });
  const activeNavGroup = WORKSHEET_NAV.find((group) => group.items.some((item) => item.sheet === sheet))?.group ?? WORKSHEET_NAV[0].group;
  const [openNavGroup, setOpenNavGroup] = useState(activeNavGroup);
  useEffect(() => { setOpenNavGroup(activeNavGroup); }, [activeNavGroup]);
  const openGroupItems = WORKSHEET_NAV.find((group) => group.group === openNavGroup)?.items ?? [];

  return (
    <ReadOnlyPreview.Provider value={previewReadonly}>
    <div className="fv3" data-finance-v3="true" data-readonly={previewReadonly ? "true" : "false"}>
      <header className="top">
        <div className="brand">TIMIQ <span>Finance</span><small>{demoMode ? (demo?.label ?? "Local DEMO visual QA") : "Commercial control · UK construction"}</small></div>
        <div className="top-meta">
          {demoMode ? <span className="chip readonly">DEMO DATA · local only</span> : null}
          {previewReadonly ? <span className="chip readonly">Read-only pilot</span> : <span className="chip live">Editing enabled</span>}
        </div>
      </header>
      <div className="main">
        <nav className="fv-context-nav" aria-label="Finance worksheets">
          <div className="fv-context-groups">
            {WORKSHEET_NAV.map((group) => {
              const isActive = activeNavGroup === group.group;
              const isOpen = openNavGroup === group.group;
              return (
                <button
                  key={group.group}
                  type="button"
                  className={`fv-context-group${isActive ? " active" : ""}${isOpen && !isActive ? " open" : ""}`}
                  aria-expanded={isOpen}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => setOpenNavGroup(group.group)}
                >
                  {group.group}
                </button>
              );
            })}
          </div>
          <div className="fv-context-sheets" role="list">
            {openGroupItems.map((item) => (
              <button
                key={`${item.sheet}-${item.label}`}
                type="button"
                role="listitem"
                className={`fv-sheet-pill${sheet === item.sheet ? " active" : ""}`}
                title={item.hint}
                aria-current={sheet === item.sheet ? "page" : undefined}
                onClick={() => { setSheet(item.sheet); setQuery(""); setMessage(""); }}
              >
                {item.label}
              </button>
            ))}
            {openNavGroup === "Reports" ? (
              <a className="fv-sheet-pill link" href={demoMode ? "#audit" : "/finance/audit"} role="listitem">Audit trail</a>
            ) : null}
            <div className="fv-context-filters">
              <label>Company
                <select aria-label="Company" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setProjectId(""); }}>
                  {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </label>
              <label>Project
                <select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">All projects</option>
                  {(demo?.books.projects ?? books.projects).map((project) => <option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}
                </select>
              </label>
            </div>
          </div>
        </nav>
        <section className="workarea">
          {error ? <p className="notice bad" role="alert">{error} <button className="linkbtn" type="button" onClick={() => setReloadToken((value) => value + 1)}>Retry</button></p> : null}
          {message ? <p className="notice neutral">{message}</p> : null}
          {loading ? <p className="sub">Loading finance records…</p> : null}
          {sheet === "PROJECT CONTROL" ? (
            projectId ? (
              <FinanceCvrScreen
                companyId={companyId}
                companyName={companies.find((item) => item.id === companyId)?.name ?? ""}
                projectId={projectId}
                projectName={String((demo?.books.projects ?? books.projects).find((item) => String(item.id) === projectId)?.name ?? "")}
                cvr={books.cvrs[0] ?? {}}
                categories={categories}
                categoryLoadFailed={categoryLoadFailed}
                books={books}
                demoMode={demoMode}
                demoAllocations={demoMode ? DEMO_ALLOCATION_LINES.filter((row) => row.projectId === projectId) : []}
                onRefresh={() => setReloadToken((value) => value + 1)}
                onNavigate={navigateFinance}
                onExplain={open}
              />
            ) : (
              <FinanceOverviewScreen
                companyName={companies.find((item) => item.id === companyId)?.name ?? ""}
                projects={demo?.books.projects ?? books.projects}
                cvrs={books.cvrs}
                demoMode={demoMode}
                onSelectProject={setProjectId}
                onRefresh={() => setReloadToken((value) => value + 1)}
                onNavigate={navigateFinance}
              />
            )
          ) : null}
          {sheet === "Project Expenses" ? <Expenses books={books} companyId={companyId} names={names} projectId={projectId} query={query} onQuery={setQuery} filter={expenseFilter} onFilter={setExpenseFilter} onExplain={open} onInvoice={() => setDrawer("invoice")} onExpense={() => setDrawer("expense")} demoMode={demoMode} /> : null}
          {sheet === "Payment Register" ? <Payments books={books} companyId={companyId} names={names} view={payView} onView={setPayView} onExplain={open} onPay={() => setDrawer("supplier-payment")} onWorker={() => setDrawer("worker-payment")} /> : null}
          {sheet === "Customer Invoices" ? <Customers books={books} companyId={companyId} names={names} projectsById={projectsById} projectId={projectId} onExplain={open} onNew={() => setDrawer("customer-invoice")} /> : null}
          {sheet === "Receipts Register" ? <Receipts books={books} companyId={companyId} names={names} onExplain={open} onNew={() => setDrawer("receipt")} /> : null}
          {sheet === "VAT Reconciliation" ? <Vat books={books} names={names} onExplain={open} /> : null}
          {sheet === "CIS Tax HMRC" ? <CisTax books={books} onPreview={() => { setSheet("Payment Register"); setPayView("Fictional preview"); }} onImport={() => setDrawer("cis-import")} /> : null}
          {sheet === "Retention Register" ? <Retention books={books} companyId={companyId} names={names} projectsById={projectsById} onExplain={open} onRelease={() => setDrawer("retention")} /> : null}
          {sheet === "DAYWORKS LIVE" ? <Dayworks books={books} companyId={companyId} projectsById={projectsById} onExplain={open} onNew={() => setDrawer("daywork")} /> : null}
          {sheet === "Loans & Advances" ? <Loans books={books} companyId={companyId} names={names} view={loanView} onView={setLoanView} onExplain={open} onNew={() => setDrawer("funding")} /> : null}
        </section>
      </div>
      {explain ? (
        <div className="drawerback" role="dialog" aria-modal="true" aria-label={explain.title}>
          <aside className="drawer">
            <header className="dhead"><div><h3>{explain.title}</h3><div className="sub">Source-linked explanation</div></div><button className="close" type="button" onClick={() => setExplain(null)} aria-label="Close">Close</button></header>
            <section className="dbody"><div className="calc">{explain.body}</div><div className="notice">{explain.warning}</div></section>
            <footer className="dfoot"><button className="btn" type="button" onClick={() => setExplain(null)}>Close</button></footer>
          </aside>
        </div>
      ) : null}
      {drawer ? (
        <Editor drawer={drawer} books={books} onClose={() => setDrawer(null)} send={send} />
      ) : null}
    </div>
    </ReadOnlyPreview.Provider>
  );
}

function money(value: MoneyValue): string {
  return formatGbp(value) || "Not determined";
}

function receiptUnallocated(rows: Row[]): string {
  if (rows.some((row) => String(row.status) === "posted" && reversalState(row, "receipt_reversed") === null)) return "Not determined";
  const posted = rows.filter((row) => reversalState(row, "receipt_reversed") === false);
  if (posted.some((row) => row.allocated_amount === undefined || row.allocated_amount === null)) return "Not on this register";
  return formatGbp(posted.reduce((sum, row) => sum + (subtractMoney(row.amount, row.allocated_amount) ?? 0n), 0n));
}

function inProject(row: Row, projectId: string, projectName: string): boolean {
  return costDocumentTouchesProject(row, projectId, projectName);
}

function badge(label: string, tone: string) {
  return <span className={`state ${tone}`}>{label}</span>;
}

function toneFor(status: string): string {
  if (/paid|approved|posted|settled/i.test(status) && !/part|review|demo/i.test(status)) return "green";
  if (/draft|reversed/i.test(status) && !/not confirmed/i.test(status)) return "gray";
  if (/overdue|error/i.test(status)) return "red";
  if (/part|review|missing|incomplete|not determined|not confirmed/i.test(status)) return "amber";
  return "blue";
}

function Stats({ items }: { items: [string, string, string?][] }) {
  return <div className="stats">{items.map(([cap, val, tone]) => <div key={cap} className={`stat ${tone ?? ""}`}><div className="cap">{cap}</div><div className="val">{val}</div></div>)}</div>;
}

function Grid({ headers, rows, emptyTitle = "No records", emptyText = "Nothing matches this company and filter." }: { headers: { label: string; amt?: boolean; hide?: boolean }[]; rows: ReactNode[][]; emptyTitle?: string; emptyText?: string }) {
  if (rows.length === 0) {
    return (
      <div className="empty" role="status">
        <strong>{emptyTitle}</strong>
        <span>{emptyText}</span>
      </div>
    );
  }
  return (
    <div className="gridwrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header.label} className={`${header.amt ? "amt" : ""} ${header.hide ? "hide-mid" : ""}`}>{header.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr key={index}>{cells.map((cell, cellIndex) => <td key={cellIndex} className={`${headers[cellIndex]?.amt ? "amt" : ""} ${headers[cellIndex]?.hide ? "hide-mid" : ""}`}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncompleteKpis({ scopeLabel }: { scopeLabel: string }) {
  return (
    <div className="fv-incomplete" role="status">
      <strong>Commercial figures incomplete</strong>
      <p>
        Primary KPIs for {scopeLabel} are not determined yet. Missing CTC is never forced to £0.
      </p>
    </div>
  );
}

function Head({ title, text, children, hideTitle = false }: { title: string; text: string; children?: ReactNode; hideTitle?: boolean }) {
  return (
    <div className="pagehead">
      <div>
        {hideTitle ? null : <h2>{title}</h2>}
        <div className="sub">{text}</div>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  scope,
  tone = "",
  statusBadge,
  statusDetail,
  onActivate,
}: {
  title: string;
  value?: string;
  scope?: MetricScope;
  tone?: string;
  statusBadge?: string;
  statusDetail?: string;
  onActivate?: () => void;
}) {
  const className = `metric-card ${tone}${onActivate ? "" : " inert"}`;
  const body = (
    <>
      <div className="cap">
        <span>{title}</span>
        {scope ? <span className="scope">{scope}</span> : null}
      </div>
      {statusBadge ? badge(statusBadge, tone === "red" ? "red" : tone === "green" ? "green" : tone === "gray" ? "gray" : "amber") : <div className="val">{value}</div>}
      {statusDetail ? <p className="hint">{statusDetail}</p> : null}
      {onActivate ? <p className="hint">Open details ↗</p> : null}
    </>
  );
  if (onActivate) {
    return (
      <button type="button" className={className} onClick={onActivate} aria-label={`${title}${scope ? `, ${scope}` : ""}`}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

function ProjectControl({ books, companyId, projectId, categories, categoryLoadFailed, navFocus, onNavFocusConsumed, onExplain, onNew, onBudget, onRefresh, onNavigate }: {
  books: Books;
  companyId: string;
  projectId: string;
  categories: { category: string; eligible: string }[];
  categoryLoadFailed: boolean;
  navFocus: FinanceNavigateTarget["focus"] | null;
  onNavFocusConsumed: () => void;
  onExplain: (title: string, body: string, warning: string) => void;
  onNew: () => void;
  onBudget: () => void;
  onRefresh: () => void;
  onNavigate: (target: FinanceNavigateTarget) => void;
}) {
  const [asOfDate, setAsOfDate] = useState("");
  const [asOfReport, setAsOfReport] = useState<Record<string, string> | null>(null);
  const [asOfError, setAsOfError] = useState("");
  const [asOfLoading, setAsOfLoading] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const asOfInputRef = useRef<HTMLInputElement | null>(null);
  const attentionRef = useRef<HTMLDivElement | null>(null);
  const portfolioRef = useRef<HTMLDivElement | null>(null);
  const dashboardRef = useRef<HTMLDivElement | null>(null);
  const projectName = String(books.projects.find((item) => String(item.id) === projectId)?.name ?? "");
  const invoices = projectId ? books.customerInvoices.filter((row) => String(row.project_id ?? "") === projectId) : books.customerInvoices;
  const rows = books.cvrs;
  const portfolio = financePortfolioSummary(rows);
  const figures = ownerControl({
    projectSelected: Boolean(projectId),
    projectName,
    receipts: books.receipts,
    invoices,
    cvrs: rows,
    costs: books.costs,
    supplierPayments: books.supplierPayments,
    funding: books.funding,
    openings: books.openings,
    categories,
    categoryLoadFailed,
    releasesPosted: books.releases.filter((row) => String(row.status) === "posted").length,
    retentionAudited: books.audit.some((row) => String(row.action) === "retention_released"),
    today: new Date().toISOString().slice(0, 10),
  });
  const attentionActions = financeUiAttentionActions(figures.attention);
  const selected = projectId ? rows[0] : null;
  const projectScope: MetricScope = projectId ? "SELECTED PROJECT" : "COMPANY-WIDE";
  const supplierTotals = postedSupplierTotals(books.costs);
  const customerInvoiced = formatGbp(addMoney(invoices.filter((row) => String(row.status) === "posted").map((row) => row.net_amount))) || "Not determined";
  const incompleteNotes = rows.flatMap((row) => {
    const notes: string[] = [];
    const name = String(row.name || "Unnamed project");
    if (row.approved_contract_value === "missing" || row.approved_contract_value === undefined || row.approved_contract_value === null || String(row.approved_contract_value).trim() === "") {
      notes.push(`${name}: missing approved contract.`);
    }
    if (row.cost_to_complete === "missing" || row.cost_to_complete === undefined || row.cost_to_complete === null || String(row.cost_to_complete).trim() === "") {
      notes.push(`${name}: missing CTC.`);
    }
    if (row.forecast_final_cost === "missing" || row.forecast_final_profit === "missing") {
      notes.push(`${name}: incomplete forecast.`);
    }
    return notes;
  });
  const vowStatus = compactMetricStatus("experimentalUnavailable");
  const certifiedStatus = compactMetricStatus("certifiedUnvalidated");
  const liveStatus = compactMetricStatus("liveAsOf");

  useEffect(() => {
    setAsOfReport(null);
    setAsOfError("");
    setAsOfDate("");
  }, [companyId, projectId]);

  useEffect(() => {
    let cancelled = false;
    if (!companyId || !projectId || !asOfDate) {
      setAsOfReport(null);
      setAsOfError("");
      setAsOfLoading(false);
      return () => { cancelled = true; };
    }
    setAsOfLoading(true);
    setAsOfError("");
    (async () => {
      try {
        const path = withCompany(
          `/api/finance/cvr/as-of?project_id=${encodeURIComponent(projectId)}&cut_off=${encodeURIComponent(asOfDate)}`,
          companyId,
        );
        const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
        if (!response.ok) throw new Error(await readError(response));
        const report = await response.json() as Record<string, string>;
        if (!cancelled) setAsOfReport(report);
      } catch (reason: unknown) {
        if (!cancelled) {
          setAsOfReport(null);
          setAsOfError(reason instanceof Error ? reason.message : "As-of CVR could not be loaded.");
        }
      } finally {
        if (!cancelled) setAsOfLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, projectId, asOfDate]);

  useEffect(() => {
    if (!navFocus) return;
    if (navFocus === "attention-center") {
      setAttentionOpen(true);
      attentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (navFocus === "as-of-cutoff") {
      document.getElementById("finance-as-of-cutoff")?.scrollIntoView({ behavior: "smooth", block: "start" });
      asOfInputRef.current?.focus();
    } else if (navFocus === "portfolio") {
      portfolioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (navFocus === "control-dashboard") {
      dashboardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    onNavFocusConsumed();
  }, [navFocus, onNavFocusConsumed]);

  const largestCategory = figures.categories.reduce((max, row) => row.eligible > max ? row.eligible : max, 1n);
  const largestCash = (figures.cashMonths ?? []).reduce((max, row) => {
    const peak = [row.receipts, row.supplierPayments].reduce((best, value) => value > best ? value : best, 0n);
    return peak > max ? peak : max;
  }, 1n);

  function openDrill(
    kind: Parameters<typeof projectControlDrilldown>[0],
    scope: MetricScope,
    extras: Partial<Parameters<typeof projectControlDrilldown>[1]> = {},
  ) {
    const detail = projectControlDrilldown(kind, {
      projectName: projectName || (projectId ? "Selected project" : "All projects"),
      scope,
      row: selected,
      supplierOutstanding: supplierTotals.outstanding,
      supplierGross: supplierTotals.gross,
      supplierCashPaid: supplierTotals.cashPaid,
      supplierCredits: supplierTotals.creditApplied,
      cashReceived: figures.cashReceived,
      customerInvoiced,
      reliableProjects: portfolio.reliableProjects,
      totalProjects: rows.length,
      incompleteNotes,
      ...extras,
    });
    onExplain(detail.title, detail.body, detail.warning);
    // Formula-only cards stay on Project Control. Register cards navigate after the explanation opens.
    if (detail.navigate && (detail.navigate.sheet !== "PROJECT CONTROL" || detail.navigate.focus)) {
      onNavigate(detail.navigate);
    }
  }

  function openAttentionItem(item: ReturnType<typeof financeUiAttentionActions>[number]) {
    onExplain(item.title, `${item.reason} Recommended: ${item.recommendedAction}`, item.available ? "Open the linked Finance worksheet to continue." : "This action is not yet available in current Finance.");
    if (!item.available || !item.sheet) return;
    onNavigate({ sheet: item.sheet, focus: item.focus, expenseFilter: item.expenseFilter });
  }

  const approvedValue = selected ? controlAmount(selected.approved_contract_value) : portfolio.approvedContract;
  const incurredValue = selected ? controlAmount(selected.actual_incurred_cost ?? selected.actual_eligible_cost) : portfolio.actualIncurred;
  const finalCostValue = selected ? controlAmount(selected.forecast_final_cost) : portfolio.forecastFinalCost;
  const profitValue = selected ? controlAmount(selected.forecast_final_profit ?? selected.forecast_margin) : portfolio.forecastProfit;
  const commitmentsValue = selected ? controlAmount(selected.open_commitments ?? selected.open_commitment) : portfolio.openCommitments;
  const ctcValue = selected ? controlAmount(selected.cost_to_complete) : portfolio.additionalCtc;
  const marginValue = selected ? controlPercent(selected.forecast_final_margin_percent) : portfolio.forecastMargin;
  const profitTone = selected ? forecastTone(selected.forecast_final_profit) : (portfolio.lossMaking ? "red" : portfolio.missingCtc ? "amber" : "");

  const chartBars = buildCommercialBars({
    contract: selected?.approved_contract_value ?? portfolio.approvedContract,
    incurred: selected?.actual_incurred_cost ?? selected?.actual_eligible_cost ?? portfolio.actualIncurred,
    commitments: selected?.open_commitments ?? selected?.open_commitment ?? portfolio.openCommitments,
    ctc: selected?.cost_to_complete ?? portfolio.additionalCtc,
    forecastFinal: selected?.forecast_final_cost ?? portfolio.forecastFinalCost,
    forecastProfit: selected?.forecast_final_profit ?? selected?.forecast_margin ?? portfolio.forecastProfit,
  });
  const kpisReady = primaryKpisReady([approvedValue, incurredValue, finalCostValue, profitValue]);
  const scopePhrase = projectId ? (projectName || "the selected project") : "this company";

  return (
    <>
      <Head
        title={projectId ? `Project CVR · ${projectName || "Selected project"}` : "Finance overview"}
        text={projectId
          ? "One-job commercial position from live Finance Core figures. Snapshot bars only — no invented months."
          : "Company commercial overview. Select a project for Project CVR."}
      >
        <Action className="btn mainbtn" onClick={onNew}>+ New project</Action>
        <button className="btn" type="button" onClick={onRefresh}>Refresh</button>
        {projectId ? <a className="btn" href={`${API_URL}/api/finance/projects/${projectId}/report.xlsx?company_id=${encodeURIComponent(companyId)}`}>Export report</a> : <button className="btn" type="button" disabled title="Select one project first">Export report</button>}
      </Head>

      <div className="panel quiet" ref={dashboardRef} id="control-dashboard">
        <p className="sub">Scope: {projectScope}. Forecast profit is not certified accounting profit.</p>
        {kpisReady ? (
          <div className="kpi-grid">
            <MetricCard title="Contract Value" value={approvedValue} scope={projectScope} tone={portfolio.missingContract ? "amber" : "blue"} onActivate={() => openDrill("approvedContract", projectScope)} />
            <MetricCard title="Cost to Date" value={incurredValue} scope={projectScope} onActivate={() => openDrill("actualIncurred", projectScope)} />
            <MetricCard title="Forecast Final Cost" value={finalCostValue} scope={projectScope} tone={selected?.forecast_final_cost === "missing" || portfolio.missingCtc ? "amber" : ""} onActivate={() => openDrill("forecastFinalCost", projectScope)} />
            <MetricCard title="Forecast Profit" value={profitValue} scope={projectScope} tone={profitTone} onActivate={() => openDrill("forecastProfit", projectScope)} />
          </div>
        ) : (
          <IncompleteKpis scopeLabel={scopePhrase} />
        )}
      </div>

      {projectId ? (
        <div className="cvr-layout">
          <div className="cvr-hero">
            <CommercialPerformanceChart
              title="CVR commercial performance"
              subtitle="Validated Finance Core snapshot. No invented monthly history."
              bars={chartBars}
            />
            <aside className="cvr-summary-compact" aria-label="Secondary CVR summary">
              <h3>Position summary</h3>
              <dl>
                <div><dt>Open commitments</dt><dd>{commitmentsValue}</dd></div>
                <div><dt>Cost to complete</dt><dd>{ctcValue}</dd></div>
                <div><dt>Forecast margin</dt><dd>{marginValue}</dd></div>
                <div><dt>Customer invoiced</dt><dd>{customerInvoiced}</dd></div>
                <div><dt>Cash received</dt><dd>{figures.cashReceived}</dd></div>
                <div><dt>Customer outstanding</dt><dd>{figures.customerOutstanding}</dd></div>
                <div><dt>Supplier outstanding</dt><dd>{figures.supplierOutstanding}</dd></div>
                <div><dt>Internal VOW</dt><dd>{vowStatus.badge}</dd></div>
                <div><dt>Certified value</dt><dd>{certifiedStatus.badge}</dd></div>
                <div><dt>Reporting basis</dt><dd>{asOfDate ? `Cut-off ${asOfDate}` : liveStatus.badge}</dd></div>
              </dl>
              {isForecastLoss(selected?.forecast_final_profit) ? <p className="notice bad" role="status">Forecast loss — amount shown in the profit KPI above.</p> : null}
              <div className="bar" style={{ marginTop: 10 }}>
                <button className="btn" type="button" onClick={() => openDrill("asOf", "LIVE AS-OF")}>As-of cut-off</button>
                <button className="btn" type="button" onClick={() => { setAttentionOpen(true); attentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                  Attention ({attentionActions.length})
                </button>
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <div className="company-strip">
          <div className="secondary-metrics">
            <MetricCard title="Projects loaded" value={String(rows.length)} scope="COMPANY-WIDE" />
            <MetricCard title="Supplier outstanding" value={figures.supplierOutstanding} scope="COMPANY-WIDE" tone="amber" onActivate={() => openDrill("supplierOutstanding", "COMPANY-WIDE")} />
            <MetricCard
              title="Reliable project data"
              value={`${portfolio.reliableProjects} of ${rows.length}`}
              scope="COMPANY-WIDE"
              tone={portfolio.reliableProjects ? "green" : "amber"}
              onActivate={() => openDrill("reliableProjects", "COMPANY-WIDE")}
            />
          </div>
          {kpisReady ? (
            <div style={{ marginTop: 12 }}>
              <CommercialPerformanceChart
                title="Cost & forecast overview"
                subtitle="Company roll-up from Finance Core. No invented monthly history."
                bars={chartBars}
              />
            </div>
          ) : (
            <p className="sub" style={{ marginTop: 8 }}>{figures.supplierNote}</p>
          )}
        </div>
      )}

      {attentionActions.length > 0 ? (
        <div className="panel attention-center" ref={attentionRef} id="attention-center">
          <div className="pagehead">
            <div>
              <h3>Needs attention</h3>
              <p className="sub"><b>{attentionActions.length}</b> real exception{attentionActions.length === 1 ? "" : "s"} in this context.</p>
            </div>
            <button className="btn" type="button" onClick={() => setAttentionOpen((value) => !value)} aria-expanded={attentionOpen}>
              {attentionOpen ? "Hide" : "Review"}
            </button>
          </div>
          {attentionOpen ? (
            <ul className="attention-list">
              {attentionActions.map((item) => (
                <li key={item.id} className={`attention-item ${item.severity === "red" ? "attn-red" : "attn-amber"}`}>
                  <h4>{item.title}</h4>
                  <p className="sub">{item.reason}</p>
                  <p className="sub">Recommended: {item.recommendedAction}</p>
                  <div className="bar">
                    {item.sheet && item.available ? (
                      <button className="btn" type="button" onClick={() => openAttentionItem(item)}>
                        Open {item.sheet === "PROJECT CONTROL" ? "Overview" : worksheetHeading(item.sheet)}
                      </button>
                    ) : (
                      <button className="btn" type="button" onClick={() => openAttentionItem(item)}>View explanation</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div ref={attentionRef} id="attention-center" className="sub" style={{ padding: "4px 2px" }}>No attention items for this selection.</div>
      )}

      {!projectId ? (
        <div ref={portfolioRef} id="project-portfolio" className="panel">
          <h3>Project summary</h3>
          <p className="sub">Compact portfolio. Incomplete forecasts stay Not determined — never forced to £0.</p>
          <Grid
            emptyTitle="No projects loaded"
            emptyText="Select a company with Finance projects to see the summary."
            headers={[
              { label: "Project" },
              { label: "Contract", amt: true },
              { label: "Incurred", amt: true, hide: true },
              { label: "Forecast profit", amt: true },
              { label: "Margin", amt: true },
              { label: "Status" },
            ]}
            rows={rows.map((row) => {
              const warning = budgetForecastReview(row as Record<string, string>);
              const missingCtc = row.cost_to_complete === "missing" || row.cost_to_complete === undefined || row.cost_to_complete === null || String(row.cost_to_complete).trim() === "";
              const missingForecast = row.forecast_final_cost === "missing"
                || row.forecast_final_profit === "missing"
                || row.forecast_margin === "missing"
                || row.forecast_final_margin_percent === "missing";
              const loss = isForecastLoss(row.forecast_final_profit);
              const reviewLabel = loss ? "Forecast loss" : missingForecast || missingCtc ? "Incomplete" : warning ? "Review" : "OK";
              const explainWarning = "Forecast Profit is an estimate to job completion — not certified or official accounting profit. Missing CTC is not treated as £0.";
              return [
                <><b>{String(row.name || "Unnamed project")}</b><br /><span className="sub">{String(row.reference_code || "Reference missing")}</span></>,
                controlAmount(row.approved_contract_value),
                controlAmount(row.actual_incurred_cost ?? row.actual_eligible_cost),
                <button className={`linkbtn${loss ? " loss" : ""}`} type="button" onClick={() => onExplain("CVR forecast", cvrText(row), explainWarning)}>{controlAmount(row.forecast_final_profit ?? row.forecast_margin)} ↗</button>,
                <button className={`linkbtn${loss ? " loss" : ""}`} type="button" onClick={() => onExplain("CVR forecast", cvrText(row), explainWarning)}>{controlPercent(row.forecast_final_margin_percent)} ↗</button>,
                badge(reviewLabel, loss ? "red" : missingForecast || missingCtc || warning ? "amber" : "green"),
              ];
            })}
          />
        </div>
      ) : null}

      <details className="panel fv-more" id="finance-as-of-cutoff">
        <summary>More detail · as-of, cash and cost codes</summary>
        <div className="fv-more-body">
          <h3>Historical as-of CVR</h3>
          <p className="sub">One project and a cut-off date. Amounts come from the as-of API only — not a frozen month-end close.</p>
          {!projectId ? (
            <p className="sub">Choose a project before requesting a historical cut-off.</p>
          ) : (
            <label className="sub">
              Reporting cut-off{" "}
              <input
                ref={asOfInputRef}
                type="date"
                value={asOfDate}
                onChange={(event) => setAsOfDate(event.target.value)}
                aria-label="CVR reporting cut-off date"
              />
            </label>
          )}
          {asOfLoading ? <p className="sub">Loading as-of position…</p> : null}
          {asOfError ? <p className="sub" role="alert">{asOfError}</p> : null}
          {asOfReport ? (
            <>
              <Stats items={[
                ["Actual incurred", controlAmount(asOfReport.actual_incurred_cost)],
                ["Open commitments", controlAmount(asOfReport.open_commitments ?? asOfReport.open_commitment)],
                ["Cost to complete", controlAmount(asOfReport.cost_to_complete)],
                ["Forecast final cost", controlAmount(asOfReport.forecast_final_cost)],
                ["Forecast profit", controlAmount(asOfReport.forecast_final_profit ?? asOfReport.forecast_margin)],
                ["Forecast margin %", controlPercent(asOfReport.forecast_final_margin_percent)],
                ["Invoiced", controlAmount(asOfReport.customer_invoiced_net), "blue"],
                ["Cash received", controlAmount(asOfReport.customer_receipts), "green"],
                ["Outstanding", controlAmount(asOfReport.customer_outstanding), "amber"],
              ]} />
              <p className="sub">
                Cut-off {asOfReport.cut_off}. Accrued cost: {controlAmount(asOfReport.accrued_cost)}. Internal VOW: {controlAmount(asOfReport.internal_vow)}.
                Certified (unvalidated): {controlAmount(asOfReport.certified_value)}. {asOfReport.certified_status ?? ""} {asOfReport.cut_off_policy ?? ""}
              </p>
            </>
          ) : null}

          {!projectId ? (
            <div className="company-strip" style={{ marginTop: 12 }}>
              <h3 className="head2">Cash & receivables</h3>
              <div className="secondary-metrics">
                <MetricCard title="Cash received" value={figures.cashReceived} scope="COMPANY-WIDE" onActivate={() => openDrill("cashReceived", "COMPANY-WIDE")} />
                <MetricCard title="Contract left to invoice" value={figures.remainingToInvoice} scope="COMPANY-WIDE" tone="blue" />
                <MetricCard title="Customer outstanding" value={figures.customerOutstanding} scope="COMPANY-WIDE" tone="amber" onActivate={() => onNavigate({ sheet: "Customer Invoices" })} />
              </div>
              <p className="sub" style={{ marginTop: 8 }}>{figures.cashNote}</p>
            </div>
          ) : null}

          <div className="split" style={{ marginTop: 12 }}>
            <div>
              <h3>Expenditure by cost code</h3>
              {categoryLoadFailed ? <p className="sub">The cost-code breakdown could not be loaded. Nothing has been inferred.</p> : figures.categories.length === 0 ? <p className="sub">No posted cost-code allocation is stored for this selection.</p> : figures.categories.map((row) => (
                <div className="barline" key={row.category}><span>{row.category}</span><span className="track"><span className="fill" style={{ width: `${Number((row.eligible * 100n) / largestCategory)}%` }} /></span><b>{formatGbp(row.eligible)}</b></div>
              ))}
              {figures.categoryGap && figures.categoryGap !== "Not determined" ? <p className="sub">Unclassified eligible cost {figures.categoryGap}.</p> : null}
            </div>
            <div>
              <h3>Budget used by actual cost</h3>
              {figures.budgetUse.length === 0 ? <p className="sub">No project budget is loaded.</p> : figures.budgetUse.map((row) => (
                <div className="barline" key={row.project}><span>{row.project}</span><span className="track"><span className="fill" style={{ width: row.percent.endsWith("%") ? row.percent : "0%" }} /></span><b>{row.percent}</b></div>
              ))}
            </div>
          </div>

          {!projectId ? (
            <div style={{ marginTop: 12 }}>
              <h3>Cash movement by month</h3>
              {figures.cashMovementNote ? <p className="sub">{figures.cashMovementNote}</p> : figures.cashMonths === null ? <p className="sub">Monthly cash is a company view.</p> : figures.cashMonths.length === 0 ? <p className="sub">No dated posted receipts, supplier payments or financing movements are available.</p> : figures.cashMonths.map((row) => (
                <div key={row.month}>
                  <div className="barline"><span>{row.month} received</span><span className="track"><span className="fill" style={{ width: `${Number((row.receipts * 100n) / largestCash)}%` }} /></span><b>{formatGbp(row.receipts)}</b></div>
                  <div className="barline"><span>{row.month} suppliers</span><span className="track"><span className="fill pay" style={{ width: `${Number((row.supplierPayments * 100n) / largestCash)}%` }} /></span><b>{formatGbp(row.supplierPayments)}</b></div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="bar" style={{ marginTop: 12 }}>
            <Action className="btn" onClick={onBudget}>+ Budget revision</Action>
            <button className="btn" type="button" onClick={() => onExplain("CVR calculation and sources", projectId && selected ? cvrText(selected) : (rows.map(cvrText).join(" ") || "Select a company with projects."), "Employer NI, pension and PAYE on-costs are not included unless separately recorded.")}>Show CVR sources</button>
          </div>
        </div>
      </details>
    </>
  );
}

function cvrText(row: Row): string {
  const incurred = row.actual_incurred_cost;
  const profit = row.forecast_final_profit ?? row.forecast_margin;
  const percent = row.forecast_final_margin_percent;
  return `${String(row.name)}: original contract ${controlAmount(row.original_contract_value)} + approved variations ${controlAmount(row.approved_variations)} + approved dayworks ${controlAmount(row.approved_dayworks_in_contract)} = approved contract ${controlAmount(row.approved_contract_value)}. Approved budget ${controlAmount(row.approved_budget)}. Actual eligible cost ${controlAmount(row.actual_eligible_cost)}. CIS gross project labour ${controlAmount(row.cis_labour_gross)}. Actual incurred cost ${controlAmount(incurred)}. Open commitments ${controlAmount(row.open_commitments ?? row.open_commitment)}. Cost to complete ${controlAmount(row.cost_to_complete)}. Forecast final cost ${controlAmount(row.forecast_final_cost)}. Forecast final profit ${controlAmount(profit)}. Forecast final margin ${controlPercent(percent)}. Legacy forecast margin (GBP) ${controlAmount(row.forecast_margin)}. Forecast profit share ${forecastShare(String(row.approved_contract_value ?? ""), String(profit ?? ""))}. A period-to-date earned value is not on this API. ${String(row.review_required || "")}`;
}

function Expenses({ books, companyId, names, projectId, query, onQuery, filter, onFilter, onExplain, onInvoice, onExpense, demoMode = false }: {
  books: Books; companyId: string; names: Map<string, string>; projectId: string; query: string; onQuery: (value: string) => void; filter: string; onFilter: (value: string) => void; onExplain: (title: string, body: string, warning: string) => void; onInvoice: () => void; onExpense: () => void; demoMode?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const projectName = String(books.projects.find((item) => String(item.id) === projectId)?.name ?? "");
  const totals = postedSupplierTotals(books.costs);
  const scoped = books.costs.filter((row) => inProject(row, projectId, projectName));
  const rows = scoped.filter((row) => {
    const type = String(row.document_type);
    const status = supplierStatus(row, today);
    if (filter === "Supplier invoices" && type !== "supplier_invoice") return false;
    if (filter === "Other expenses" && type !== "expense_receipt") return false;
    if (filter === "Credits" && type !== "supplier_credit") return false;
    if (filter === "Draft" && status !== "Draft") return false;
    if (filter === "Outstanding" && !((subtractMoney(row.outstanding, "0") ?? 0n) > 0n && String(row.status) === "posted")) return false;
    if (filter === "Review" && status !== "Review" && status !== "Overdue") return false;
    const blob = `${names.get(String(row.counterparty_id)) ?? ""} ${row.external_reference ?? ""}`.toLowerCase();
    return blob.includes(query.trim().toLowerCase());
  });
  const listScope = projectId ? `SELECTED PROJECT (${projectName || "unnamed"})` : "COMPANY-WIDE";
  const [invoiceDrawer, setInvoiceDrawer] = useState<SourceBreakdownPayload | null>(null);
  const expenseColumns: FinanceGridColumn[] = [
    { id: "supplier", label: "Supplier" },
    { id: "reference", label: "Reference" },
    { id: "date", label: "Date" },
    { id: "project", label: "Project" },
    { id: "gross", label: "Gross", money: true, align: "right" },
    { id: "outstanding", label: "Outstanding", money: true, align: "right" },
    { id: "status", label: "Status" },
  ];

  async function openInvoiceDetail(row: Row) {
    const documentId = String(row.id || "");
    const reference = String(row.external_reference || "Draft document");
    const postedRow = String(row.status) === "posted" && LIABILITY.has(String(row.document_type));
    const cash = postedRow ? supplierCashPaid(row) : null;
    const credit = postedRow ? supplierCreditApplied(row) : null;
    const basePayload: SourceBreakdownPayload = {
      metric: "supplier_invoice",
      company_id: companyId,
      project_id: projectId || "",
      displayed_total: String(row.gross_amount || "0.0000"),
      formula: "Register row gross (not project eligible cost)",
      basis: "Cash paid is bank settlement — not a second project cost",
      reconcilable: false,
      verification: "PARTIAL",
      difference: "0.0000",
      source_total: String(row.gross_amount || "0.0000"),
      groups: [
        {
          id: "invoice",
          label: reference,
          total: String(row.gross_amount || "0.0000"),
          rows: [
            {
              id: documentId,
              reference,
              source_type: String(row.document_type || "supplier_invoice"),
              document_date: String(row.document_date || ""),
              status: String(row.status || ""),
              amount: String(row.gross_amount || "0.0000"),
              net: String(row.net_amount || "0.0000"),
              document_id: documentId,
            },
          ],
        },
      ],
      warnings: [
        `Outstanding ${postedRow ? money(row.outstanding) : "—"}. Cash paid ${cash === null ? "—" : formatGbp(cash)}. Credits ${credit === null ? "—" : formatGbp(credit)}.`,
      ],
    };
    if (demoMode || !documentId) {
      setInvoiceDrawer(basePayload);
      return;
    }
    try {
      const path = withCompany(`/api/finance/cost-documents/${encodeURIComponent(documentId)}`, companyId);
      const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
      if (response.ok) {
        const detail = await response.json() as Record<string, unknown>;
        basePayload.warnings.push(`Loaded cost document detail for ${documentId}.`);
        basePayload.groups[0].rows[0].reference = String(detail.external_reference || reference);
      }
    } catch {
      basePayload.warnings.push("Cost document detail endpoint unavailable — showing register row only.");
    }
    setInvoiceDrawer(basePayload);
  }

  return (
    <>
      <Head
        title="Supplier invoices"
        hideTitle
        text="Cost documents only. Cash paid is bank settlement — not a second project cost. Bank entry lives on Supplier payments."
      >
        <Action className="btn mainbtn" onClick={onInvoice}>+ Supplier invoice</Action>
        <Action className="btn" onClick={onExpense}>+ Other expense</Action>
      </Head>
      <Stats items={[
        [`Invoice gross · ${totals.scope}`, totals.gross],
        [`Cash paid · ${totals.scope}`, totals.cashPaid, "green"],
        [`Credits · ${totals.scope}`, totals.creditApplied, "amber"],
        [`Outstanding · ${totals.scope}`, totals.outstanding, "amber"],
      ]} />
      <div className="table-toolbar">
        <div className="pills">
          {["All", "Supplier invoices", "Other expenses", "Credits", "Draft", "Outstanding", "Review"].map((item) => (
            <button key={item} className={`pill${filter === item ? " active" : ""}`} type="button" onClick={() => onFilter(item)}>{item}</button>
          ))}
        </div>
        <input className="search" aria-label="Search expenses" placeholder="Search supplier or reference" value={query} onChange={(event) => onQuery(event.target.value)} />
      </div>
      {demoMode ? null : (
        <RegisterSearch companyId={companyId} register="supplier-invoices" dateField="expense" dateFields={[["expense", "Expense date"], ["due", "Due date"]]} parties={books.parties.filter((item) => item.counterparty_type === "supplier").map((item) => [String(item.id), String(item.name)])} partyLabel="Supplier" statusOptions={[["all", "All"], ["posted", "Posted"], ["draft", "Draft"]]} />
      )}
      <p className="sub">Summary is {totals.scope} document liability. Table is {listScope}.</p>
      <FinanceDataGrid
        columns={expenseColumns}
        emptyTitle="No supplier invoices"
        emptyText="No cost documents match this company, project and filter."
        rows={rows.map((row) => {
          const postedRow = String(row.status) === "posted" && LIABILITY.has(String(row.document_type));
          const status = supplierSettlementStatus(row, today);
          const label = String(row.document_type) === "supplier_credit" ? "Credit" : status === "Partial" ? "Partial" : status;
          return {
            id: String(row.id),
            metricId: "supplier_invoice",
            amountColumnIds: ["gross", "outstanding"],
            cells: {
              supplier: names.get(String(row.counterparty_id ?? "")) ?? "Supplier name missing",
              reference: String(row.external_reference || "Reference missing"),
              date: String(row.document_date || "Date missing"),
              project: String(row.project_names || "").trim() || "No project allocation stored",
              gross: row.gross_amount,
              outstanding: postedRow ? row.outstanding : null,
              status: label,
            },
            meta: { row },
          };
        })}
        onAmountClick={(_metric, gridRow) => {
          const row = gridRow.meta?.row as Row | undefined;
          if (row) void openInvoiceDetail(row);
        }}
      />
      <FinanceSourceDrawer
        open={Boolean(invoiceDrawer)}
        title="Supplier invoice detail"
        payload={invoiceDrawer}
        onClose={() => setInvoiceDrawer(null)}
      />
    </>
  );
}

function Payments({ books, companyId, names, view, onView, onExplain, onPay, onWorker }: {
  books: Books; companyId: string; names: Map<string, string>; view: string; onView: (value: string) => void; onExplain: (title: string, body: string, warning: string) => void; onPay: () => void; onWorker: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const payables = books.costs.filter((row) => String(row.status) === "posted" && LIABILITY.has(String(row.document_type)));
  const companyTotals = postedSupplierTotals(books.costs);
  return (
    <>
      <Head title="Supplier payments" text="Bank settlements against existing obligations. Payments do not create project cost again.">
        <Action className="btn mainbtn" onClick={view === "Supplier payments" ? onPay : onWorker}>+ Record bank payment</Action>
      </Head>
      <div className="pills">
        {["Supplier payments", "CIS workers", "PAYE employees", "Fictional preview"].map((item) => <button key={item} type="button" className={`pill${view === item ? " active" : ""}`} onClick={() => onView(item)}>{item}</button>)}
      </div>
      {view === "Supplier payments" ? (
        <>
          <Stats items={[["Posted rows", String(books.supplierPayments.filter((row) => String(row.status) === "posted").length)], ["Active payments", formatCount(activeMovementCount(books.supplierPayments, "payment_reversed"))], ["Open payables", String(payables.filter((row) => (subtractMoney(row.outstanding, "0") ?? 0n) > 0n).length), "amber"], ["Bank paid", formatKnownMoney(effectiveMovementTotal(books.supplierPayments, "amount", "payment_reversed")), "green"], [`Outstanding · ${companyTotals.scope}`, companyTotals.outstanding, "amber"]]} />
          <p className="sub">Company-wide bank payments. Credits are not cash paid.</p>
          <Grid headers={[{ label: "Payee" }, { label: "Source invoice" }, { label: "Invoice gross", amt: true, hide: true }, { label: "Cash paid", amt: true, hide: true }, { label: "Credits", amt: true, hide: true }, { label: "Outstanding", amt: true }, { label: "Bank reference" }, { label: "Status" }]} rows={payables.map((row) => {
            const cash = supplierCashPaid(row);
            const credit = supplierCreditApplied(row);
            const status = supplierSettlementStatus(row, today);
            const cashText = cash === null ? "Not determined" : formatGbp(cash);
            const creditText = credit === null ? "Not determined" : formatGbp(credit);
            return [names.get(String(row.counterparty_id ?? "")) ?? "Supplier name missing", String(row.external_reference || "Reference missing"), money(row.gross_amount), cashText, creditText, <button className="linkbtn" type="button" onClick={() => onExplain(String(row.payment_references || "Supplier balance"), `Invoice gross ${money(row.gross_amount)}. Cash paid (bank) ${cashText}. Supplier credits ${creditText}. Outstanding ${money(row.outstanding)}. Payment refs: ${String(row.payment_references || "none")}.`, "A supplier payment is not a second project cost. Credits are not cash paid.")}>{money(row.outstanding)} ↗</button>, String(row.payment_references || "None"), badge(status, toneFor(status))];
          })} />
        </>
      ) : null}
      {view === "CIS workers" ? <CisBankPayments companyId={companyId} workers={books.cisSources.map((item) => [String(item.user_id), String(item.email || item.user_id || "Worker")])} /> : null}
      {view === "PAYE employees" ? <LiveWorkers title="PAYE" rows={[]} empty="No approved PAYE snapshot is posted for this company. Employee net bank payments are not the same as PAYE deductions." onExplain={onExplain} /> : null}
      {view === "Fictional preview" ? <FictionalPreview /> : null}
    </>
  );
}

function LiveWorkers({ title, rows, empty, onExplain }: { title: string; rows: Row[]; empty: string; onExplain: (title: string, body: string, warning: string) => void }) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <Grid headers={[{ label: title === "CIS" ? "Worker" : "Employee" }, { label: "Period" }, { label: "Source payable", amt: true }, { label: "Bank paid", amt: true }, { label: "Remaining", amt: true }, { label: "Status" }]} rows={rows.map((row) => [
      String(row.email || row.source_user_id || "Worker"),
      String(row.week_start || row.tax_month || "Period missing"),
      money(row.effective_payable_amount || row.net_pay),
      money(row.bank_allocated),
      <button className="linkbtn" type="button" onClick={() => onExplain(`${title} obligation`, `Source payable ${money(row.effective_payable_amount || row.net_pay)}. Bank allocated ${money(row.bank_allocated)}. Still owed ${money(row.still_owed)}. CIS deduction ${money(row.effective_cis_deduction)}.`, "Statutory deductions are shown only when the approved snapshot includes them. They are not inferred from a net payment.")}>{money(row.still_owed || row.outstanding)} ↗</button>,
      badge("Source snapshot", "blue"),
    ])} />
  );
}

function FictionalPreview() {
  return (
    <div>
      <div className="preview"><b>{FICTIONAL_WORKER_PREVIEW.label}.</b> These workers and amounts are a visual sample. They are not Finance Local Trial records, not approved Payroll, and not bank payments. They cannot be selected for posting.</div>
      <h3 className="head2">Sample CIS rows</h3>
      <Grid headers={[{ label: "Worker" }, { label: "Period" }, { label: "Demo payable", amt: true }, { label: "Demo bank paid", amt: true }, { label: "Demo outstanding", amt: true }, { label: "Demo reference" }, { label: "State" }]} rows={FICTIONAL_WORKER_PREVIEW.cis.map((row) => [row.worker, row.period, row.payable, row.paid, row.due, row.reference, badge(row.status, "amber")])} />
      <h3 className="head2">Sample PAYE row</h3>
      <Grid headers={[{ label: "Employee" }, { label: "Period" }, { label: "Demo net payable", amt: true }, { label: "Demo bank paid", amt: true }, { label: "Demo outstanding", amt: true }, { label: "Demo reference" }, { label: "State" }]} rows={FICTIONAL_WORKER_PREVIEW.paye.map((row) => [row.worker, row.period, row.payable, row.paid, row.due, row.reference, badge(row.status, "amber")])} />
      <p className="sub">CIS tax, PAYE, NI and pension are not derived from these sample nets.</p>
    </div>
  );
}

function Customers({ books, companyId, names, projectsById, projectId, onExplain, onNew }: { books: Books; companyId: string; names: Map<string, string>; projectsById: Map<string, string>; projectId: string; onExplain: (title: string, body: string, warning: string) => void; onNew: () => void }) {
  const [invoiceQuery, setInvoiceQuery] = useState<FinanceQuery>({ ...EMPTY_QUERY, dateField: "issue" });
  const invoiceServer = useFinanceQuery(companyId, "invoices", invoiceQuery);
  const visible = books.customerInvoices.filter((row) => !projectId || String(row.project_id ?? "") === projectId);
  const posted = visible.filter((row) => String(row.status) === "posted" && String(row.document_kind) === "invoice");
  const gross = addMoney(posted.map((row) => row.gross_amount));
  const missing = posted.filter((row) => !String(row.external_reference ?? "").trim() || !String(row.due_date ?? "").trim()).length;
  return (
    <>
      <Head title="Customer invoices" text="Amounts billed to the customer. Missing references are not invented.">
        <Action className="btn mainbtn" onClick={onNew}>+ New customer invoice</Action>
      </Head>
      <Stats items={[["Posted gross", formatGbp(gross)], ["Rows loaded", String(visible.length)], ["Missing ref / due", String(missing), missing ? "amber" : "green"], ["Filter", invoiceServer.note || "Company register", "blue"]]} />
      <FinanceQueryBar dateFields={[["issue", "Invoice issue date"], ["due", "Invoice due date"]]} parties={books.parties.filter((item) => item.counterparty_type === "customer").map((item) => [String(item.id), String(item.name)])} partyLabel="Customer" value={invoiceQuery} onChange={setInvoiceQuery} exportHref={exportHref(companyId, "invoices", invoiceQuery)} />
      <Grid headers={[{ label: "Customer" }, { label: "Invoice ref" }, { label: "Due date", hide: true }, { label: "Project", hide: true }, { label: "Net", amt: true, hide: true }, { label: "Output VAT", amt: true, hide: true }, { label: "Gross", amt: true, hide: true }, { label: "Received", amt: true, hide: true }, { label: "Outstanding", amt: true }, { label: "Status" }]} rows={(invoiceQuery.q || invoiceQuery.dateFrom || invoiceQuery.dateTo || invoiceQuery.partyId || invoiceQuery.status !== "all" ? visible.filter((row) => invoiceServer.rows.some((item) => String(item.id) === String(row.id))) : visible).map((row) => {
        const live = String(row.status) === "posted" && String(row.document_kind) === "invoice";
        const got = invoiceCashReceived(row);
        const reference = String(row.external_reference || "").trim();
        const due = String(row.due_date || "").trim();
        const status = String(row.status) === "draft" ? "Draft" : !reference || !due ? "Needs correction" : customerSettlementStatus(row, new Date().toISOString().slice(0, 10));
        const receivedLabel = formatKnownMoney(got);
        return [
          names.get(String(row.counterparty_id ?? "")) ?? "Customer name missing",
          reference || "Reference missing",
          due || "Due date not stored",
          projectsById.get(String(row.project_id ?? "")) ?? "Not linked",
          money(row.net_amount), money(row.tax_amount), money(row.gross_amount), receivedLabel,
          <button className="linkbtn" type="button" onClick={() => onExplain("Customer balance", `Net ${money(row.net_amount)} + output VAT ${money(row.tax_amount)} = gross ${money(row.gross_amount)}. Effective receipt allocations ${String(row.receipt_references || "none")} ${receivedLabel}. Outstanding ${live ? money(row.outstanding) : "£0.00"}.`, "Outstanding includes credits and receipts. Cash received is the effective allocation only. A zero outstanding balance is not labelled Paid unless the cash allocation covers it.")}>{live ? money(row.outstanding) : "—"} ↗</button>,
          badge(status, toneFor(status)),
        ];
      })} />
    </>
  );
}

function formatCount(value: number | null): string {
  return value === null ? "Not determined" : String(value);
}

function Receipts({ books, companyId, names, onExplain, onNew }: { books: Books; companyId: string; names: Map<string, string>; onExplain: (title: string, body: string, warning: string) => void; onNew: () => void }) {
  return (
    <>
      <Head title="Customer receipts" text="Cash received only. A receipt is not extra turnover.">
        <Action className="btn mainbtn" onClick={onNew}>+ Record receipt</Action>
      </Head>
      <Stats items={[["Receipt rows", String(books.receipts.length)], ["Unallocated", receiptUnallocated(books.receipts), "amber"], ["Drafts", String(books.receipts.filter((row) => String(row.status) !== "posted").length)], ["Allocation", "Posted links", "blue"]]} />
      <RegisterSearch companyId={companyId} register="receipts" dateField="receipt" dateFields={[["receipt", "Actual bank receipt date"]]} parties={books.parties.filter((item) => item.counterparty_type === "customer").map((item) => [String(item.id), String(item.name)])} partyLabel="Customer" />
      <Grid headers={[{ label: "Date" }, { label: "Receipt ref" }, { label: "Customer" }, { label: "Amount received", amt: true }, { label: "Linked invoice" }, { label: "Allocated", amt: true }, { label: "Status" }]} rows={books.receipts.map((row) => {
        const reference = String(row.external_reference || "Reference missing");
        const linked = books.customerInvoices.filter((invoice) => String(invoice.receipt_references || "").includes(reference) && reference !== "Reference missing");
        return [
          String(row.receipt_date || "Date missing"),
          reference,
          names.get(String(row.counterparty_id ?? "")) ?? "Customer name missing",
          money(row.amount),
          linked.length ? linked.map((invoice) => String(invoice.external_reference || "Reference missing")).join(", ") : "Not linked on the invoice list",
          row.allocated_amount === undefined || row.allocated_amount === null ? "Not on this register" : money(row.allocated_amount),
          badge(receiptAllocationStatus(row), receiptAllocationStatus(row) === "Fully allocated" ? "green" : receiptAllocationStatus(row) === "Reversed" ? "gray" : "amber"),
        ];
      })} />
      <p className="sub">Allocated is the sum of posted receipt allocations that have not been reversed. It is not copied from the receipt total. Cash received is summarised on Project Control. <button className="linkbtn" type="button" onClick={() => onExplain("Receipt allocation", "Allocated comes from posted customer-receipt allocations. Unallocated is the receipt amount minus that sum. A receipt is not extra turnover.", "Do not treat the receipt as new revenue.")}>Explain</button></p>
    </>
  );
}

function Vat({ books, names, onExplain }: { books: Books; names: Map<string, string>; onExplain: (title: string, body: string, warning: string) => void }) {
  const documents = [
    ...books.costs.filter((row) => String(row.status) === "posted").map((row) => ({ kind: "Input", row })),
    ...books.customerInvoices.filter((row) => String(row.status) === "posted").map((row) => ({ kind: "Output", row })),
  ];
  return (
    <>
      <Head title="VAT reconciliation" text="Company-wide control totals — not a filed VAT return." />
      <Stats items={[["Output VAT", money(books.tax?.output_vat), "blue"], ["Input VAT recorded", money(books.tax?.input_vat)], ["Indicative control", money(books.tax?.net_vat_control), "violet"], ["Recoverability", "Not determined", "amber"]]} />
      <p className="sub">Recorded input VAT is not verified recoverable VAT. The indicative control is not an HMRC reclaim.</p>
      <Grid headers={[{ label: "Document ref" }, { label: "Type" }, { label: "Party" }, { label: "Net", amt: true }, { label: "VAT code/rate", hide: true }, { label: "Input VAT", amt: true }, { label: "Output VAT", amt: true }, { label: "Recoverable", hide: true }, { label: "Review" }]} rows={documents.map(({ kind, row }) => [
        String(row.external_reference || "Reference missing"),
        kind,
        names.get(String(row.counterparty_id ?? "")) ?? "Party missing",
        money(row.net_amount),
        "Not determined",
        kind === "Input" ? money(row.tax_amount) : "—",
        kind === "Output" ? money(row.tax_amount) : "—",
        "Not determined",
        badge("Review required", "amber"),
      ])} />
      <div className="bar"><button className="btn" type="button" onClick={() => onExplain("VAT control", `Output VAT ${money(books.tax?.output_vat)} minus recorded input VAT ${money(books.tax?.input_vat)} = indicative net control ${money(books.tax?.net_vat_control)}. ${String(books.tax?.review_required || "")}`, "Recoverable VAT is not determined from the recorded VAT amount.")}>Explain control</button></div>
    </>
  );
}

function CisTax({ books, onPreview, onImport }: { books: Books; onPreview: () => void; onImport: () => void }) {
  const empty = books.cis.length === 0;
  return (
    <>
      <Head title="CIS tax / HMRC" text="Approved snapshots only. Statutory rates are not guessed." />
      {empty ? <div className="empty" role="status"><strong>No approved payroll snapshots</strong><span>The live CIS register stays empty for this company.</span></div> : null}
      <div className="bar">
        <button className="btn" type="button" onClick={onPreview}>View fictional worker preview</button>
        <Action className="btn mainbtn" disabled={books.cisSources.length === 0} onClick={onImport}>Import approved snapshot</Action>
      </div>
      <Grid headers={[{ label: "Source period" }, { label: "Worker" }, { label: "Source obligation", amt: true }, { label: "CIS deduction", amt: true }, { label: "Bank paid", amt: true }, { label: "Outstanding", amt: true }, { label: "Status" }]} rows={books.cis.map((row) => [String(row.week_start || "Period missing"), String(row.source_user_id || "Worker"), money(row.effective_payable_amount), money(row.effective_cis_deduction), money(row.bank_allocated), money(row.still_owed), badge("Posted snapshot", "blue")])} />
      <h3 className="head2">PAYE / HMRC control</h3>
      <p className="sub">Employer NI and pension from the tax control: {money(books.tax?.employer_ni_and_pension)}. HMRC payments recorded: {money(books.tax?.hmrc_payments_recorded)}. These are not worker net pay and not project cost.</p>
      {books.payeSources.length === 0 ? <p className="empty">No approved PAYE source is available to import.</p> : <p className="sub">{books.payeSources.length} approved PAYE source row(s) can be imported from the secondary action. They are not bank payments.</p>}
    </>
  );
}

function Retention({ books, companyId, names, projectsById, onExplain, onRelease }: { books: Books; companyId: string; names: Map<string, string>; projectsById: Map<string, string>; onExplain: (title: string, body: string, warning: string) => void; onRelease: () => void }) {
  const withheld = addMoney(books.certificates.filter((row) => String(row.status) === "posted").map((row) => row.retention_withheld));
  const released = addMoney(books.releases.filter((row) => String(row.status) === "posted").map((row) => row.amount));
  return (
    <>
      <Head title="Retention & certificates" text="Certificate retention held and released. Release is not new revenue.">
        <Action className="btn mainbtn" onClick={onRelease}>+ Release retention</Action>
      </Head>
      <Stats items={[["Withheld", formatGbp(withheld)], ["Released", formatGbp(released), "green"], ["Still retained", formatGbp(withheld - released), "amber"], ["Certificates", String(books.certificates.length)]]} />
      <RegisterSearch companyId={companyId} register="retention" dateField="release" dateFields={[["release", "Release date"]]} showSearch={false} statusOptions={[["all", "All"], ["posted", "Posted"], ["draft", "Draft"]]} />
      <Grid headers={[{ label: "Project" }, { label: "Customer", hide: true }, { label: "Certificate" }, { label: "Certified", amt: true, hide: true }, { label: "Recorded rate" }, { label: "Withheld", amt: true }, { label: "Released", amt: true, hide: true }, { label: "Remaining", amt: true }, { label: "Status" }]} rows={books.certificates.map((row) => {
        const application = books.applications.find((item) => String(item.id) === String(row.application_id));
        const releasedFor = addMoney(books.releases.filter((item) => String(item.certificate_id) === String(row.id) && String(item.status) === "posted").map((item) => item.amount));
        const remaining = (subtractMoney(row.retention_withheld, 0) ?? 0n) - releasedFor;
        const rate = recordedRate(row.retention_rate);
        return [
          projectsById.get(String(application?.project_id ?? "")) ?? "Project not on the certificate",
          names.get(String(application?.counterparty_id ?? "")) ?? "Customer not on the certificate",
          String(row.certificate_reference || "Reference missing"),
          money(row.certified_net),
          rate,
          money(row.retention_withheld),
          formatGbp(releasedFor),
          <button className="linkbtn" type="button" onClick={() => onExplain(String(row.certificate_reference || "Retention"), `Certified ${money(row.certified_net)} at recorded rate ${rate}. Withheld ${money(row.retention_withheld)}. Released ${formatGbp(releasedFor)}. Remaining withheld minus released = ${formatGbp(remaining)}.`, "The release is not extra revenue. The rate is the recorded certificate rate, not a contract clause invented here.")}>{formatGbp(remaining)} ↗</button>,
          badge(retentionReleaseStatus(releasedFor, remaining), retentionReleaseStatus(releasedFor, remaining) === "Fully released" ? "green" : "amber"),
        ];
      })} />
    </>
  );
}

function Dayworks({ books, companyId, projectsById, onExplain, onNew }: { books: Books; companyId: string; projectsById: Map<string, string>; onExplain: (title: string, body: string, warning: string) => void; onNew: () => void }) {
  const dayApproved = addMoney(books.dayworks.filter((row) => String(row.approval_status) === "approved").map((row) => row.approved_value));
  const variationApproved = addMoney(books.variations.filter((row) => String(row.approval_status) === "approved").map((row) => row.approved_value));
  const rows: ReactNode[][] = [
    ...books.dayworks.map((row) => {
      const parts = addMoney([row.labour_amount, row.material_amount, row.plant_amount]);
      return [projectsById.get(String(row.project_id)) ?? "Project missing", String(row.work_date || "Date missing"), String(row.reference_code), String(row.description || ""), money(row.labour_amount), money(row.material_amount), money(row.plant_amount), <button className="linkbtn" type="button" onClick={() => onExplain(String(row.reference_code), `Labour ${money(row.labour_amount)} + materials ${money(row.material_amount)} + plant ${money(row.plant_amount)} = stored split ${formatGbp(parts)}. Submitted ${money(row.submitted_value)}. Approved ${money(row.approved_value)}.`, "Hours and rates are not stored. They are not invented from the totals.")}>{money(row.approved_value)} ↗</button>, badge(String(row.approval_status || "Review"), toneFor(String(row.approval_status)))];
    }),
    ...books.variations.map((row) => [projectsById.get(String(row.project_id)) ?? "Project missing", "—", String(row.reference_code), String(row.description || "Variation"), "—", "—", "—", money(row.approved_value), badge(String(row.approval_status || "Review"), toneFor(String(row.approval_status)))]),
  ];
  return (
    <>
      <Head title="Dayworks" text="Amount register only: labour / materials / plant totals. Not the experimental CVR-6 engine.">
        <Action className="btn mainbtn" onClick={onNew}>+ New daywork</Action>
      </Head>
      <Stats items={[["Daywork approved", formatGbp(dayApproved), "green"], ["Variation approved", formatGbp(variationApproved), "green"], ["Hours / rates", "Not stored", "amber"], ["Contract uplift", formatGbp(dayApproved + variationApproved), "blue"]]} />
      <p className="sub">Hours, rates and CVR-6 immutability remain {metricHonestyLabel("experimentalUnavailable")}.</p>
      <RegisterSearch companyId={companyId} register="dayworks" dateField="work" dateFields={[["work", "Work date"]]} statusOptions={[["all", "All"], ["approved", "Approved"], ["draft", "Draft"], ["submitted", "Submitted"]]} />
      <Grid headers={[{ label: "Project" }, { label: "Work/date", hide: true }, { label: "Reference" }, { label: "Description", hide: true }, { label: "Labour", amt: true, hide: true }, { label: "Materials", amt: true, hide: true }, { label: "Plant", amt: true, hide: true }, { label: "Approved value", amt: true }, { label: "Status" }]} rows={rows} />
    </>
  );
}

function Loans({ books, companyId, names, view, onView, onExplain, onNew }: { books: Books; companyId: string; names: Map<string, string>; view: string; onView: (value: string) => void; onExplain: (title: string, body: string, warning: string) => void; onNew: () => void }) {
  const posted = books.funding.filter((row) => String(row.status) === "posted");
  const draw = addMoney(posted.filter((row) => row.entry_kind === "loan_draw").map((row) => row.amount));
  const repaid = addMoney(posted.filter((row) => row.entry_kind === "loan_repayment" || row.entry_kind === "principal_repayment").map((row) => row.amount));
  return (
    <>
      <Head title="Loans & advances" text="Loan principal is a liability, not project income or trading revenue.">
        <Action className="btn mainbtn" onClick={onNew}>+ Loan movement</Action>
      </Head>
      <div className="pills">{["Movements", "Opening balances", "Supplier position", "Audit"].map((item) => <button key={item} className={`pill${view === item ? " active" : ""}`} type="button" onClick={() => onView(item)}>{item}</button>)}</div>
      <Stats items={[["Loan draw", formatGbp(draw)], ["Principal repaid", formatGbp(repaid), "green"], ["Principal remaining", formatGbp(draw - repaid), "amber"], ["Opening remaining", money(books.position?.opening_remaining), "violet"]]} />
      <RegisterSearch companyId={companyId} register="funding" dateField="entry" dateFields={[["entry", "Entry date"]]} statusOptions={[["all", "All"], ["posted", "Posted"], ["draft", "Draft"]]} />
      {view === "Movements" ? <Grid headers={[{ label: "Kind" }, { label: "Reference" }, { label: "Date" }, { label: "Amount", amt: true }, { label: "Status" }]} rows={books.funding.map((row) => [labelKind(String(row.entry_kind)), String(row.external_reference || "Reference missing"), String(row.entry_date || ""), money(row.amount), badge(String(row.status) === "posted" ? "Posted" : "Draft", toneFor(String(row.status)))])} /> : null}
      {view === "Opening balances" ? <Grid headers={[{ label: "Kind" }, { label: "Reference" }, { label: "Date" }, { label: "Amount", amt: true }, { label: "Review" }]} rows={books.openings.map((row) => [labelKind(String(row.balance_kind)), String(row.source_reference || "Reference missing"), String(row.effective_date || ""), money(row.amount), badge(String(row.review_status || "Review"), "violet")])} /> : null}
      {view === "Supplier position" ? <div className="calc"><div className="line"><span>Invoice outstanding</span><span>{money(books.position?.invoice_outstanding)}</span></div><div className="line"><span>Opening payable</span><span>{money(books.position?.opening_supplier_payable)}</span></div><div className="line"><span>Opening settled</span><span>{money(books.position?.opening_settled)}</span></div><div className="line"><span>Opening remaining</span><span>{money(books.position?.opening_remaining)}</span></div><div className="line"><span>Combined supplier position</span><span>{money(books.position?.combined_supplier_position)}</span></div><button className="linkbtn" type="button" onClick={() => onExplain("Supplier position", `Invoice outstanding ${money(books.position?.invoice_outstanding)} plus opening remaining ${money(books.position?.opening_remaining)} is the combined position ${money(books.position?.combined_supplier_position)}.`, "Opening balances are not reduced by invoice allocations.")}>Explain</button></div> : null}
      {view === "Audit" ? <Grid headers={[{ label: "When" }, { label: "Record" }, { label: "Action" }, { label: "Reason" }]} rows={books.audit.map((row) => [String(row.created_at || ""), labelKind(String(row.entity_type)), labelKind(String(row.action)), String(row.reason || "—")])} /> : null}
      <p className="sub">{names.size ? "" : ""}</p>
    </>
  );
}

function recordedRate(value: MoneyValue): string {
  const formatted = formatGbp(value);
  if (!formatted) return "Not determined";
  return `${formatted.replace("£", "").replace("−", "-")}% recorded`;
}

function labelKind(value: string): string {
  const names: Record<string, string> = { loan_draw: "Loan draw", loan_repayment: "Principal repayment", principal_repayment: "Principal repayment", supplier_opening: "Historical supplier payable", opening_supplier_payable: "Historical supplier payable" };
  return names[value] ?? value.replaceAll("_", " ");
}

function Editor({ drawer, books, onClose, send }: { drawer: string; books: Books; onClose: () => void; send: EditorProps["send"] }) {
  const title: Record<string, string> = {
    project: "New project", budget: "Budget revision", invoice: "Supplier invoice", expense: "Project expense",
    "supplier-payment": "Record supplier payment", "worker-payment": "Record worker bank payment", "cis-import": "Import approved snapshot",
    "customer-invoice": "Customer invoice", receipt: "Customer receipt", retention: "Release retention", daywork: "New daywork", funding: "Loan movement",
  };
  return (
    <div className="drawerback" role="dialog" aria-modal="true" aria-label={title[drawer] ?? "Editor"}>
      <aside className="drawer">
        <header className="dhead"><div><h3>{title[drawer]}</h3><div className="sub">The register stays in place behind this panel.</div></div><button className="close" type="button" aria-label="Close" onClick={onClose}>Close</button></header>
        <section className="dbody">
          {drawer === "project" ? <ProjectForm books={books} send={send} onClose={onClose} /> : null}
          {drawer === "budget" ? <BudgetForm books={books} send={send} onClose={onClose} /> : null}
          {drawer === "invoice" || drawer === "expense" ? <CostForm kind={drawer} books={books} send={send} onClose={onClose} /> : null}
          {drawer === "supplier-payment" ? <SupplierPayForm books={books} send={send} onClose={onClose} /> : null}
          {drawer === "worker-payment" ? <WorkerPayForm books={books} send={send} /> : null}
          {drawer === "cis-import" ? <ImportForm books={books} send={send} /> : null}
          {drawer === "customer-invoice" ? <CustomerForm books={books} send={send} onClose={onClose} /> : null}
          {drawer === "receipt" ? <ReceiptForm books={books} send={send} onClose={onClose} /> : null}
          {drawer === "retention" ? <RetentionForm books={books} send={send} onClose={onClose} /> : null}
          {drawer === "daywork" ? <DayworkForm books={books} send={send} onClose={onClose} /> : null}
          {drawer === "funding" ? <FundingForm send={send} onClose={onClose} /> : null}
        </section>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><label>{label}{children}</label></div>;
}

function ProjectForm({ books, send, onClose }: { books: Books; send: EditorProps["send"]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [contract, setContract] = useState("0.00");
  return (
    <form onSubmit={async (event) => { event.preventDefault(); const saved = await send("/api/finance/projects", { name, reference_code: reference, contract_value_net: contract }, true); if (saved) onClose(); }}>
      <p className="notice neutral">Creating a project records the original contract immediately. A separate draft is not available.</p>
      <div className="formrow">
        <Field label="Project name"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Reference"><input value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label="Original contract"><input value={contract} onChange={(event) => setContract(event.target.value)} /></Field>
      </div>
      <Footer post="Confirm project" />
      <p className="sub">{books.projects.length} project(s) already on this company.</p>
    </form>
  );
}

function BudgetForm({ books, send, onClose }: { books: Books; send: EditorProps["send"]; onClose: () => void }) {
  const [project, setProject] = useState("");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("0.00");
  return (
    <form onSubmit={async (event) => { event.preventDefault(); const saved = await send("/api/finance/budgets", { project_id: project, note: "Budget revision", lines: [{ cost_code_id: code, amount_net: amount, description: "Revision" }] }, false); if (saved) onClose(); }}>
      <p className="notice neutral">This saves a draft budget. Approval is a separate action and is not done here.</p>
      <div className="formrow">
        <Field label="Project"><Select options={books.projects.map((item) => [String(item.id), String(item.name)])} value={project} onChange={setProject} /></Field>
        <Field label="Cost code"><Select options={books.codes.map((item) => [String(item.id), `${item.code} ${item.name}`])} value={code} onChange={setCode} /></Field>
        <Field label="Amount"><input value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      </div>
      <Footer draft />
    </form>
  );
}

type ExtraAllocation = { projectId: string; codeId: string; net: string };

function CostForm({ kind, books, send, onClose }: { kind: string; books: Books; send: EditorProps["send"]; onClose: () => void }) {
  const previewLocked = useContext(ReadOnlyPreview);
  const expense = kind === "expense";
  const [party, setParty] = useState("");
  const [project, setProject] = useState("");
  const [code, setCode] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [due, setDue] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [taxPoint, setTaxPoint] = useState("");
  const [net, setNet] = useState("");
  const [tax, setTax] = useState("");
  const [decision, setDecision] = useState<VatDecision>("undetermined");
  const [recoverable, setRecoverable] = useState("");
  const [treatment, setTreatment] = useState("");
  const [draftId, setDraftId] = useState("");
  const [overhead, setOverhead] = useState(false);
  const [extras, setExtras] = useState<ExtraAllocation[]>([]);
  const suppliers = books.parties.filter((item) => item.counterparty_type === "supplier");
  const gross = invoiceGross(net || "0", tax || "0");
  const recoverableValue = decision === "confirmed_non_recoverable" ? "0.00" : recoverable;
  const blocker = vatPostingBlocker(decision, tax || "0", recoverableValue || "0");
  const duplicate = reference.trim() !== "" && books.costs.some((row) => String(row.external_reference ?? "").trim().toLowerCase() === reference.trim().toLowerCase() && String(row.counterparty_id) === party);
  const postedDuplicate = duplicate && books.costs.some((row) => String(row.status) === "posted" && String(row.document_type) === "supplier_invoice" && String(row.counterparty_id) === party && String(row.external_reference ?? "").trim().toLowerCase() === reference.trim().toLowerCase());
  const names = new Map(books.parties.map((item) => [String(item.id), String(item.name)]));
  const projectName = books.projects.find((item) => String(item.id) === project)?.name;
  const codeName = books.codes.find((item) => String(item.id) === code);
  const unclassified = decision === "undetermined" || decision === "accountant_review";
  const statusName = decision === "undetermined" ? "not_determined" : decision === "verified_recoverable" ? "confirmed_recoverable" : decision === "accountant_review" ? "accountant_review" : "confirmed_non_recoverable";
  const projectOptions = books.projects.map((item) => [String(item.id), String(item.name)] as [string, string]);
  const codeOptions = books.codes.map((item) => [String(item.id), `${item.code} ${item.name}`] as [string, string]);
  function markDirty() { setDraftId(""); }
  function setExtra(index: number, patch: Partial<ExtraAllocation>) {
    setExtras((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
    markDirty();
  }
  function addExtra() {
    setExtras((rows) => [...rows, { projectId: "", codeId: code, net: "" }]);
    markDirty();
  }
  function removeExtra(index: number) {
    setExtras((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    markDirty();
  }
  const activeExtras = extras.filter((row) => row.net.trim() !== "");
  const extraParts = activeExtras.map((row) => row.net);
  const primaryNetMinor = (() => {
    if (!activeExtras.length) return toMinor(net || "0");
    const netMinor = toMinor(net || "0");
    if (netMinor === null) return null;
    let allocated = 0n;
    for (const part of extraParts) {
      const value = toMinor(part);
      if (value === null) return null;
      allocated += value;
    }
    return netMinor - allocated;
  })();
  // Primary absorbs remainder so allocated parts always sum to invoice net when primaryNetMinor >= 0.
  const splitInvalid = Boolean(
    activeExtras.length
    && (
      primaryNetMinor === null
      || primaryNetMinor < 0n
      || activeExtras.some((row) => !row.codeId || (!overhead && (!row.projectId || row.projectId === project)))
    )
  );
  const remainingPreview = activeExtras.length && primaryNetMinor !== null && primaryNetMinor >= 0n
    ? allocationRemaining(net || "0", [formatPlain(primaryNetMinor), ...extraParts])
    : allocationRemaining(net || "0", activeExtras.length ? extraParts : [net || "0"]);
  const remainingDisplay = remainingPreview.error && primaryNetMinor !== null && primaryNetMinor < 0n
    ? formatGbp(primaryNetMinor)
    : remainingPreview.remaining;
  const remainingError = primaryNetMinor !== null && primaryNetMinor < 0n
    ? "Allocated net exceeds invoice net."
    : "";
  async function save(event: FormEvent) {
    event.preventDefault();
    if (projectMissing || splitInvalid || remainingError) return;
    if (!unclassified && (blocker || !treatment)) return;
    const saved = await send("/api/finance/cost-documents", costBody(), false);
    if (saved?.id) setDraftId(String(saved.id));
  }
  const multiProject = activeExtras.length > 0;
  const projectMissing = !overhead && !project;
  function costBody() {
    const nonRecoverableAmount = unclassified ? "0.00" : nonRecoverable(tax, recoverableValue);
    if (!activeExtras.length) {
      return {
        document_type: expense ? "expense_receipt" : "supplier_invoice",
        counterparty_id: party,
        external_reference: reference,
        service_date: serviceDate || null,
        document_date: date,
        tax_point_date: taxPoint || null,
        due_date: due || null,
        notes: description || null,
        lines: [{
          line_number: 1,
          description: description || reference,
          net_amount: net,
          tax_treatment: treatment || null,
          tax_amount: tax,
          recoverable_amount: unclassified ? "0.00" : recoverableValue,
          vat_recoverability_status: statusName,
          allocations: [{ allocation_number: 1, project_id: overhead ? null : project, cost_code_id: code, is_overhead: overhead, amount_net: net, amount_non_recoverable: nonRecoverableAmount }],
        }],
      };
    }
    const allocations = [
      { allocation_number: 1, project_id: overhead ? null : project, cost_code_id: code, is_overhead: overhead, amount_net: formatPlain(primaryNetMinor ?? 0n), amount_non_recoverable: nonRecoverableAmount },
      ...activeExtras.map((row, index) => ({
        allocation_number: index + 2,
        project_id: overhead ? null : row.projectId,
        cost_code_id: row.codeId,
        is_overhead: overhead,
        amount_net: row.net,
        amount_non_recoverable: "0.0000",
      })),
    ];
    return {
      document_type: expense ? "expense_receipt" : "supplier_invoice",
      counterparty_id: party,
      external_reference: reference,
      service_date: serviceDate || null,
      document_date: date,
      tax_point_date: taxPoint || null,
      due_date: due || null,
      notes: description || null,
      lines: [{
        line_number: 1,
        description: description || reference,
        net_amount: net,
        tax_treatment: treatment || null,
        tax_amount: tax,
        recoverable_amount: unclassified ? "0.00" : recoverableValue,
        vat_recoverability_status: statusName,
        allocations,
      }],
    };
  }
  const eligible = blocker ? "Not shown until recoverability is explicit" : formatGbp(addMoney([net, nonRecoverable(tax, recoverableValue)]));
  const allocatedTotal = activeExtras.length && primaryNetMinor !== null && primaryNetMinor >= 0n
    ? formatGbp(addMoney([formatPlain(primaryNetMinor), ...extraParts]))
    : formatGbp(addMoney([net || "0"]));
  const extraNames = activeExtras
    .map((row) => books.projects.find((item) => String(item.id) === row.projectId)?.name || "Extra project")
    .join(", ");
  return (
    <form onSubmit={save}>
      <p className="notice neutral">{expense ? "This is a project expense, not a supplier invoice and not a bank payment." : "This is a supplier invoice. It creates project COST and supplier LIABILITY. It is not a bank payment and not a commitment."} One invoice may allocate eligible net across N projects in this company. Gross supplier liability stays on the invoice once. A supplier payment is recorded later on Supplier payments. Payroll labour is not entered here.</p>
      {!expense ? (
        <ol className="learn-steps" aria-label="Supplier invoice learning steps">
          {INVOICE_LEARNING_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
      ) : null}
      <h4 className="head2">1. Document</h4>
      <div className="formrow">
        <Field label="Supplier"><Select options={suppliers.map((item) => [String(item.id), String(item.name)])} value={party} onChange={(value) => { setParty(value); markDirty(); }} /></Field>
        <Field label="Primary project"><Select optional={overhead} options={projectOptions} value={overhead ? "" : project} onChange={(value) => { setProject(value); setExtras([]); markDirty(); }} /></Field>
        <Field label="Primary cost code"><Select options={codeOptions} value={code} onChange={(value) => { setCode(value); markDirty(); }} /></Field>
        <Field label={expense ? "Expense reference" : "Supplier invoice reference"}><input required value={reference} onChange={(event) => { setReference(event.target.value); markDirty(); }} /></Field>
        <Field label="Document date"><input required type="date" value={date} onChange={(event) => { setDate(event.target.value); markDirty(); }} /></Field>
        <Field label="Due date, if the document has one"><input type="date" value={due} onChange={(event) => { setDue(event.target.value); markDirty(); }} /></Field>
        <Field label="Service date"><input type="date" value={serviceDate} onChange={(event) => { setServiceDate(event.target.value); markDirty(); }} /></Field>
        <Field label="Tax point date"><input type="date" value={taxPoint} onChange={(event) => { setTaxPoint(event.target.value); markDirty(); }} /></Field>
        <Field label="Description"><input value={description} onChange={(event) => { setDescription(event.target.value); markDirty(); }} /></Field>
      </div>
      <h4 className="head2">3. Allocate net across projects</h4>
      <p className="sub">Add one row per extra project (N allocations supported). The primary project receives the remaining net so allocated total equals invoice net. Under-allocation leaves remaining net; over-allocation is rejected. Changing the primary project clears extra rows.</p>
      {extras.map((row, index) => (
        <div className="formrow" key={`extra-${index}`}>
          <Field label={`Project ${index + 2}`}><Select optional options={projectOptions} value={overhead ? "" : row.projectId} onChange={(value) => setExtra(index, { projectId: value })} /></Field>
          <Field label={`Cost code ${index + 2}`}><Select optional options={codeOptions} value={row.codeId} onChange={(value) => setExtra(index, { codeId: value })} /></Field>
          <Field label={`Net on allocation ${index + 2}`}><input value={row.net} onChange={(event) => setExtra(index, { net: event.target.value })} /></Field>
          <button className="btn" type="button" onClick={() => removeExtra(index)}>Remove</button>
        </div>
      ))}
      <button className="btn" type="button" disabled={overhead || !project} onClick={addExtra}>Add project allocation</button>
      <h4 className="head2">2. Invoice values (net + VAT)</h4>
      <div className="formrow">
        <Field label="Net amount"><input required value={net} onChange={(event) => { setNet(event.target.value); markDirty(); }} /></Field>
        <Field label="VAT amount"><input required value={tax} onChange={(event) => { setTax(event.target.value); markDirty(); }} /></Field>
        <Field label="Gross total"><input readOnly value={gross.error ? gross.error : gross.gross} /></Field>
        <Field label="VAT classification"><select value={treatment} onChange={(event) => { setTreatment(event.target.value); markDirty(); }}><option value="">Not yet classified</option><option value="standard">Standard — rate is not assumed</option><option value="reduced">Reduced — rate is not assumed</option><option value="zero">Zero</option><option value="exempt">Exempt</option><option value="outside_scope">Outside scope</option></select></Field>
        <Field label="Recoverability">
          <select value={decision} onChange={(event) => { setDecision(event.target.value as VatDecision); markDirty(); }}>
            <option value="undetermined">Not yet determined</option>
            <option value="accountant_review">Accountant review</option>
            <option value="verified_recoverable">Verified recoverable amount</option>
            <option value="confirmed_non_recoverable">Confirmed non-recoverable</option>
          </select>
        </Field>
        {decision === "verified_recoverable" ? <Field label="Verified recoverable VAT"><input value={recoverable} onChange={(event) => { setRecoverable(event.target.value); markDirty(); }} /></Field> : null}
      </div>
      <div className="calc">
        <div className="line"><span>Net + recorded VAT</span><span>{gross.gross}</span></div>
        <div className="line"><span>Recoverable VAT</span><span>{decision === "undetermined" ? "Not determined" : money(recoverableValue)}</span></div>
        <div className="line"><span>Non-recoverable VAT</span><span>{blocker ? "Not determined" : money(nonRecoverable(tax || "0", recoverableValue || "0"))}</span></div>
        <div className="line"><span>Eligible project cost under the current rule</span><span>{eligible}</span></div>
        <div className="line"><span>Primary project net</span><span>{activeExtras.length && primaryNetMinor !== null && primaryNetMinor >= 0n ? formatGbp(primaryNetMinor) : money(net || "0")}</span></div>
        <div className="line"><span>Allocated net total</span><span>{allocatedTotal}</span></div>
        <div className="line"><span>Remaining net to allocate</span><span className={remainingError ? "bad" : undefined}>{remainingError || remainingDisplay}</span></div>
        <div className="line"><span>Supplier gross liability (not project expense)</span><span>{gross.error ? gross.error : gross.gross}</span></div>
      </div>
      <label className="sub"><input type="checkbox" checked={overhead} onChange={(event) => { setOverhead(event.target.checked); setExtras([]); markDirty(); }} /> Company overhead. No project is assigned. This is not a site-material invoice.</label>
      <h4 className="head2">4–5. Review allocated / remaining, then post</h4>
      <div className="notice" role="status">{overhead ? "Company overhead. This document is not assigned to a project." : multiProject ? `Multi-project allocation: ${projectName || "Primary project"}${extraNames ? `, ${extraNames}` : ""}. Allocated net must equal invoice net. Site/location totals are not inferred.` : projectName ? `Project assignment: ${projectName}. Additional projects can be added above.` : "Select at least one project. A site-material invoice is not posted without one."}</div>
      <div className="notice">{blocker || "Recoverability is explicit. Posting still needs a saved draft, then a separate confirmation. Posted documents stay read-only."}</div>
      {!party ? <p className="notice bad" role="alert">Choose a supplier before saving.</p> : null}
      {projectMissing ? <p className="notice bad" role="alert">Choose the project for this invoice, or mark it as company overhead.</p> : null}
      {remainingError ? <p className="notice bad" role="alert">{remainingError} Posting is blocked while allocated net exceeds invoice net.</p> : null}
      {splitInvalid && !remainingError ? <p className="notice bad" role="alert">Each extra allocation needs a different project in this company and a cost code.</p> : null}
      {postedDuplicate ? <p className="notice bad" role="alert">This supplier already has a posted invoice with this reference. Posting is blocked. The existing document is not changed.</p> : duplicate ? <p className="notice" role="status">This reference is already used on another row. Saving a draft will not change or replace it.</p> : null}
      {!serviceDate || !taxPoint ? <p className="sub">Service date and tax point are required by the posting service. They are not copied from the invoice date. PDF attachments are not supported.</p> : null}
      <p className="sub">{names.get(party) || "Supplier not selected"} · {overhead ? "Company overhead" : String(projectName || "Project not selected")}{multiProject ? ` + ${extraNames || "extra projects"}` : ""} · {codeName ? `${codeName.code} ${codeName.name}` : "Cost code not selected"} · {reference || "Reference missing"} · {date || "Date missing"}</p>
      <p className="sub">Supplier payable after posting would be the gross above, until a separate bank payment is allocated. Eligible project cost is the allocated net under the current VAT rule, not the gross liability. Input VAT control would record the VAT amount. That is not a verified reclaim.</p>
      <Footer draft draftDisabled={projectMissing || splitInvalid || Boolean(remainingError) || (!unclassified && (Boolean(blocker) || !treatment))} />
      <button className="btn mainbtn" type="button" disabled={!draftId || projectMissing || Boolean(blocker) || Boolean(remainingError) || postedDuplicate || previewLocked} onClick={async () => { const saved = await send(`/api/finance/cost-documents/${draftId}/post`, {}, true); if (saved) onClose(); }}>Confirm post</button>
      {!draftId ? <p className="sub">Save the draft before posting. Enter does not post. Changing a field clears the saved draft link.</p> : null}
    </form>
  );
}

function nonRecoverable(tax: string, recoverable: string): string {
  const difference = subtractMoney(tax, recoverable);
  if (difference === null) return "0.0000";
  return formatPlain(difference);
}

function formatPlain(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const pounds = absolute / 10000n;
  const fraction = (absolute % 10000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${pounds}.${fraction}`;
}

function SupplierPayForm({ books, send, onClose }: { books: Books; send: EditorProps["send"]; onClose: () => void }) {
  const [party, setParty] = useState("");
  const [invoice, setInvoice] = useState("");
  const [amount, setAmount] = useState("0.00");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [secondInvoice, setSecondInvoice] = useState("");
  const [secondAmount, setSecondAmount] = useState("");
  const suppliers = books.parties.filter((item) => item.counterparty_type === "supplier");
  const open = books.costs.filter((item) => String(item.status) === "posted" && LIABILITY.has(String(item.document_type)) && (!party || String(item.counterparty_id) === party));
  const selected = open.find((item) => String(item.id) === invoice);
  const second = open.find((item) => String(item.id) === secondInvoice);
  const firstAmount = secondAmount.trim() ? subtractMoney(amount || "0", secondAmount) : null;
  const preview = selected ? paymentPreview(String(selected.outstanding), secondAmount.trim() ? formatPlain(firstAmount ?? 0n) : amount || "0") : { after: "Not determined", error: "Select the invoice this payment settles." };
  const secondPreview = second ? paymentPreview(String(second.outstanding), secondAmount || "0") : null;
  const splitError = secondAmount.trim() && (firstAmount === null || firstAmount <= 0n || !second);
  return (
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!selected || preview.error || splitError || (secondPreview && secondPreview.error)) return;
      const saved = await send("/api/finance/supplier-payments", { counterparty_id: party, payment_date: date, payment_method: "bank_transfer", external_reference: reference, amount }, true);
      if (saved?.id) {
        const allocations = second && firstAmount !== null
          ? [{ cost_document_id: invoice, amount: formatPlain(firstAmount) }, { cost_document_id: secondInvoice, amount: secondAmount }]
          : [{ cost_document_id: invoice, amount }];
        const allocated = await send(`/api/finance/supplier-payments/${saved.id}/allocations`, { allocations }, true, true);
        if (!allocated) return;
      }
      if (saved) onClose();
    }}>
      <p className="notice neutral">PAYMENT settles supplier LIABILITY. It does not create project COST again. Project incurred stays on the original invoice allocations. The usual entry settles one invoice; a second invoice can be added only when the same real transfer paid both. It is not bank-verified.</p>
      <div className="formrow">
        <Field label="Supplier"><Select options={suppliers.map((item) => [String(item.id), String(item.name)])} value={party} onChange={setParty} /></Field>
        <Field label="Invoice to settle"><Select options={open.map((item) => [String(item.id), `${item.external_reference || "Reference missing"} · ${item.project_names || "No single project"} · due ${money(item.outstanding)}`])} value={invoice} onChange={setInvoice} /></Field>
        <Field label="Second invoice on this same transfer"><Select optional options={open.filter((item) => String(item.id) !== invoice).map((item) => [String(item.id), `${item.external_reference || "Reference missing"} · ${item.project_names || "No single project"} · due ${money(item.outstanding)}`])} value={secondInvoice} onChange={setSecondInvoice} /></Field>
        <Field label="Amount of this transfer for the second invoice"><input value={secondAmount} onChange={(event) => setSecondAmount(event.target.value)} /></Field>
        <Field label="Payment date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Your payment reference"><input required value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label="Bank transfer amount"><input value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      </div>
      <div className="calc">
        <div className="line"><span>COST — project allocation (unchanged by payment)</span><span>{selected ? String(selected.project_names || "Stored on more than one project, or none") : "Select an invoice"}</span></div>
        <div className="line"><span>COST — invoice net (eligible cost)</span><span>{selected ? money(selected.net_amount) : "—"}</span></div>
        <div className="line"><span>PAYMENT — invoice gross liability</span><span>{selected ? money(selected.gross_amount) : "—"}</span></div>
        <div className="line"><span>Previous payment references</span><span>{selected ? String(selected.payment_references || "None") : "—"}</span></div>
        <div className="line"><span>PAYMENT — Supplier Outstanding now</span><span>{selected ? money(selected.outstanding) : "Select an invoice"}</span></div>
        <div className="line"><span>PAYMENT — this transfer</span><span>{amount ? money(amount) : "—"}</span></div>
        <div className="line"><span>PAYMENT — outstanding after first invoice, if accepted</span><span>{preview.after}</span></div>
        {second ? <div className="line"><span>PAYMENT — outstanding after second invoice, if accepted</span><span>{secondPreview?.after}</span></div> : null}
      </div>
      {splitError ? <p className="notice bad">The second invoice amount must be part of this one bank transfer, and the first invoice must keep a positive amount.</p> : null}
      {preview.error ? <p className="notice bad">{preview.error}</p> : null}
      {secondPreview?.error ? <p className="notice bad">{secondPreview.error}</p> : null}
      <Footer post="Confirm post" postDisabled={Boolean(preview.error) || Boolean(splitError) || Boolean(secondPreview?.error)} />
    </form>
  );
}

function WorkerPayForm({ books, send }: { books: Books; send: EditorProps["send"] }) {
  const [userId, setUserId] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [amount, setAmount] = useState("0.00");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  if (books.cis.length === 0) return <p className="empty">No approved worker obligation is available. The fictional preview cannot be paid from here.</p>;
  return (
    <form onSubmit={async (event) => {
      event.preventDefault();
      const saved = await send("/api/finance/worker-payments", { source_user_id: userId, amount, payment_date: date, payment_method: "bank_transfer", external_reference: reference }, true);
      if (saved?.id) await send(`/api/finance/worker-payments/${saved.id}/allocations`, { allocations: [{ cis_snapshot_id: snapshot, amount }] }, true);
    }}>
      <div className="formrow">
        <Field label="Approved worker"><Select options={books.cisSources.map((item) => [String(item.user_id), String(item.email)])} value={userId} onChange={setUserId} /></Field>
        <Field label="Obligation"><Select options={books.cis.map((item) => [String(item.id), `${item.week_start} owed ${money(item.still_owed)}`])} value={snapshot} onChange={setSnapshot} /></Field>
        <Field label="Bank date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Bank reference"><input required value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label="Amount"><input value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      </div>
      <Footer post="Confirm post" />
    </form>
  );
}

function ImportForm({ books, send }: { books: Books; send: EditorProps["send"] }) {
  const [itemId, setItemId] = useState("");
  if (books.cisSources.length === 0) return <p className="empty">No approved CIS source row is available.</p>;
  return (
    <form onSubmit={async (event) => { event.preventDefault(); await send(`/api/finance/cis/import?payroll_item_id=${encodeURIComponent(itemId)}&correct=false`, {}, true); }}>
      <Field label="Approved CIS week"><Select options={books.cisSources.map((item) => [String(item.id), `${item.week_start} ${item.email}`])} value={itemId} onChange={setItemId} /></Field>
      <Footer post="Import snapshot" />
    </form>
  );
}

function CustomerForm({ books, send, onClose }: { books: Books; send: EditorProps["send"]; onClose: () => void }) {
  const [party, setParty] = useState("");
  const [project, setProject] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [due, setDue] = useState("");
  const [net, setNet] = useState("0.00");
  const [tax, setTax] = useState("0.00");
  const customers = books.parties.filter((item) => item.counterparty_type === "customer");
  const gross = invoiceGross(net || "0", tax || "0");
  return (
    <form onSubmit={async (event) => { event.preventDefault(); if (gross.error || !reference.trim() || !due || !party) return; const saved = await send("/api/finance/customer-invoices", { counterparty_id: party, project_id: project || null, document_kind: "invoice", external_reference: reference.trim(), document_date: date, due_date: due, lines: [{ description: reference.trim(), taxable: true, net_amount: net, tax_amount: tax }] }, true); if (saved) onClose(); }}>
      <p className="notice neutral">Customer invoice number/reference is entered manually below. There is no draft save for customer invoices in current Finance — Confirm post posts immediately. A posted invoice cannot be edited from this screen.</p>
      <div className="formrow">
        <Field label="Customer"><Select options={customers.map((item) => [String(item.id), String(item.name)])} value={party} onChange={setParty} /></Field>
        <Field label="Project"><Select optional options={books.projects.map((item) => [String(item.id), String(item.name)])} value={project} onChange={setProject} /></Field>
        <Field label="Invoice number / reference"><input required aria-label="Invoice number / reference" placeholder="e.g. INV-2026-001" value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label="Invoice date"><input required type="date" aria-label="Invoice date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Due date"><input required type="date" aria-label="Due date" value={due} onChange={(event) => setDue(event.target.value)} /></Field>
        <Field label="Net"><input required aria-label="Net amount" value={net} onChange={(event) => setNet(event.target.value)} /></Field>
        <Field label="Output VAT"><input required aria-label="Output VAT" value={tax} onChange={(event) => setTax(event.target.value)} /></Field>
        <Field label="Gross (calculated)"><input readOnly aria-label="Gross total" value={gross.error ? gross.error : gross.gross} /></Field>
      </div>
      <div className="calc">
        <div className="line"><span>Net + output VAT = gross</span><span>{gross.gross}</span></div>
        <div className="line"><span>Status after confirm</span><span>Posted (no draft step)</span></div>
        <div className="line"><span>Receipt / cash</span><span>Record separately on Customer receipts</span></div>
      </div>
      {!party ? <p className="notice bad" role="alert">Choose a customer before posting.</p> : null}
      {!reference.trim() ? <p className="notice bad" role="alert">Enter the invoice number / reference. It is not generated automatically.</p> : null}
      <Footer post="Confirm post" postDisabled={Boolean(gross.error) || !party || !reference.trim()} />
    </form>
  );
}

function ReceiptForm({ books, send, onClose }: { books: Books; send: EditorProps["send"]; onClose: () => void }) {
  const [party, setParty] = useState("");
  const [invoice, setInvoice] = useState("");
  const [amount, setAmount] = useState("0.00");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const customers = books.parties.filter((item) => item.counterparty_type === "customer");
  const open = books.customerInvoices.filter((item) => String(item.status) === "posted");
  const selected = open.find((item) => String(item.id) === invoice);
  const preview = selected ? paymentPreview(String(selected.outstanding), amount || "0") : { after: "Not determined", error: invoice ? "" : "Select the invoice, or leave allocation until the receipt is recorded." };
  return (
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (invoice && preview.error) return;
      const saved = await send("/api/finance/customer-receipts", { counterparty_id: party, receipt_date: date, amount, external_reference: reference }, true);
      if (saved?.id && invoice) {
        const allocated = await send(`/api/finance/customer-receipts/${saved.id}/allocations`, { allocations: [{ invoice_id: invoice, amount }] }, true, true);
        if (!allocated) return;
      }
      if (saved) onClose();
    }}>
      <p className="notice neutral">A receipt is money received. It is not extra invoice revenue. There is no draft save. The allocated amount is not invented when the invoice is left blank.</p>
      <div className="formrow">
        <Field label="Customer"><Select options={customers.map((item) => [String(item.id), String(item.name)])} value={party} onChange={setParty} /></Field>
        <Field label="Invoice, if allocating now"><Select optional options={open.map((item) => [String(item.id), `${item.external_reference || "Reference missing"} due ${money(item.outstanding)}`])} value={invoice} onChange={setInvoice} /></Field>
        <Field label="Bank date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Receipt reference"><input required value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label="Amount"><input value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      </div>
      {invoice && preview.error ? <p className="notice bad">{preview.error}</p> : null}
      {selected ? <div className="calc"><div className="line"><span>Invoice outstanding now</span><span>{money(selected.outstanding)}</span></div><div className="line"><span>Outstanding after this allocation</span><span>{preview.after}</span></div></div> : <p className="sub">Unallocated amount is not calculated until an allocation is stored.</p>}
      <Footer post="Confirm post" postDisabled={Boolean(invoice && preview.error)} />
    </form>
  );
}

function RetentionForm({ books, send, onClose }: { books: Books; send: EditorProps["send"]; onClose: () => void }) {
  const [certificate, setCertificate] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const selected = books.certificates.find((item) => String(item.id) === certificate);
  const released = selected ? addMoney(books.releases.filter((item) => String(item.certificate_id) === String(selected.id) && String(item.status) === "posted").map((item) => item.amount)) : 0n;
  const preview = selected ? retentionPreview(String(selected.retention_withheld), formatPlain(released), amount || "0") : { remaining: "Not determined", error: "Select the certificate." };
  return (
    <form onSubmit={async (event) => { event.preventDefault(); if (preview.error) return; const saved = await send("/api/finance/retention-releases", { certificate_id: certificate, amount, release_date: date }, true); if (saved) onClose(); }}>
      <p className="notice neutral">A release is not extra sales revenue. There is no draft save. The server still rejects a release above the remaining balance.</p>
      <div className="formrow">
        <Field label="Certificate"><Select options={books.certificates.map((item) => [String(item.id), `${item.certificate_reference} withheld ${money(item.retention_withheld)}`])} value={certificate} onChange={setCertificate} /></Field>
        <Field label="Release date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Amount to release"><input required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      </div>
      <div className="calc">
        <div className="line"><span>Withheld</span><span>{selected ? money(selected.retention_withheld) : "—"}</span></div>
        <div className="line"><span>Already released</span><span>{formatGbp(released)}</span></div>
        <div className="line"><span>Remaining after this release</span><span>{preview.remaining}</span></div>
      </div>
      {preview.error ? <p className="notice bad">{preview.error}</p> : null}
      <Footer post="Confirm post" postDisabled={Boolean(preview.error)} />
    </form>
  );
}

function DayworkForm({ books, send, onClose }: { books: Books; send: EditorProps["send"]; onClose: () => void }) {
  const [project, setProject] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [labour, setLabour] = useState("0.00");
  const [material, setMaterial] = useState("0.00");
  const [plant, setPlant] = useState("0.00");
  return (
    <form onSubmit={async (event) => { event.preventDefault(); const saved = await send("/api/finance/dayworks", { project_id: project, reference_code: reference, work_date: date, description, labour_amount: labour, material_amount: material, plant_amount: plant }, false); if (saved) onClose(); }}>
      <p className="notice neutral">This saves a draft daywork. Approval is a later workflow and is not implied by saving.</p>
      <div className="formrow">
        <Field label="Project"><Select options={books.projects.map((item) => [String(item.id), String(item.name)])} value={project} onChange={setProject} /></Field>
        <Field label="Reference"><input required value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label="Work date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Description"><input required value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <Field label="Labour amount"><input value={labour} onChange={(event) => setLabour(event.target.value)} /></Field>
        <Field label="Materials amount"><input value={material} onChange={(event) => setMaterial(event.target.value)} /></Field>
        <Field label="Plant amount"><input value={plant} onChange={(event) => setPlant(event.target.value)} /></Field>
      </div>
      <p className="sub">Hours, quantities and rates are not stored. Only the labour, material and plant amounts are saved. Approval is a separate later step. This draft is not revenue and not a variation.</p>
      <Footer draft />
    </form>
  );
}

function FundingForm({ send, onClose }: { send: EditorProps["send"]; onClose: () => void }) {
  const [kind, setKind] = useState("loan_draw");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("0.00");
  const [reference, setReference] = useState("");
  return (
    <form onSubmit={async (event) => { event.preventDefault(); const saved = await send("/api/finance/funding", { entry_kind: kind, entry_date: date, amount, external_reference: reference }, true); if (saved) onClose(); }}>
      <p className="notice neutral">The API posts this movement in one step. Principal is not operating income.</p>
      <div className="formrow">
        <Field label="Movement"><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="loan_draw">Loan draw</option><option value="loan_repayment">Principal repayment</option></select></Field>
        <Field label="Date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Reference"><input required value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label="Amount"><input value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      </div>
      <Footer post="Confirm post" />
    </form>
  );
}

function Select({ options, value, onChange, optional = false }: { options: [string, string][]; value: string; onChange: (value: string) => void; optional?: boolean }) {
  return <select required={!optional} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{optional ? "Not allocated yet" : "Select"}</option>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>;
}

function Footer({ draft, post, draftDisabled = false, postDisabled = false }: { draft?: boolean; post?: string; draftDisabled?: boolean; postDisabled?: boolean }) {
  const previewLocked = useContext(ReadOnlyPreview);
  return <div className="dfoot" style={{ padding: 0, border: 0 }}>{draft ? <button className="btn" type="submit" disabled={draftDisabled || previewLocked}>Save draft</button> : null}{post ? <button className="btn mainbtn" type="submit" disabled={postDisabled || previewLocked}>{post}</button> : null}<span className="sub">{previewLocked ? "Read-only preview. Nothing can be saved or posted." : "Escape closes this panel. Close does not post."}</span></div>;
}

type EditorProps = { send: (path: string, body: unknown, posting: boolean, quiet?: boolean) => Promise<{ id?: string } | null> };

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
  if (payload && typeof payload.detail === "object" && payload.detail && "message" in payload.detail) return String((payload.detail as { message: string }).message);
  if (typeof payload?.detail === "string") return payload.detail;
  return `Finance request failed (${response.status}).`;
}
