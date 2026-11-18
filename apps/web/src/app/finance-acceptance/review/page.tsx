import { notFound } from "next/navigation";
import Link from "next/link";

type Section = {
  id: string;
  title: string;
  ref: string;
  actual1440: string;
  actual820: string;
  actual390: string;
  gaps: string[];
};

const SECTIONS: Section[] = [
  {
    id: "overview",
    title: "1. Overview / Project CVR",
    ref: "/finance-acceptance/ref/01-overview.png",
    actual1440: "/finance-acceptance/actual/overview-1440.png",
    actual820: "/finance-acceptance/actual/overview-820.png",
    actual390: "/finance-acceptance/actual/overview-390.png",
    gaps: [
      "Density slightly looser than the generated mock.",
      "Kennington stays Not provided (honest empty commercial) — mock shows populated codes.",
    ],
  },
  {
    id: "costs",
    title: "2. Costs & Suppliers",
    ref: "/finance-acceptance/ref/02-costs.png",
    actual1440: "/finance-acceptance/actual/costs-1440.png",
    actual820: "/finance-acceptance/actual/costs-820.png",
    actual390: "/finance-acceptance/actual/costs-390.png",
    gaps: [
      "Kennington project register empty; COMPANY-WIDE KPIs labelled separately.",
      "Mock supplier rows not invented.",
    ],
  },
  {
    id: "payroll",
    title: "3. Payroll Finance",
    ref: "/finance-acceptance/ref/03-payroll.png",
    actual1440: "/finance-acceptance/actual/payroll-1440.png",
    actual820: "/finance-acceptance/actual/payroll-820.png",
    actual390: "/finance-acceptance/actual/payroll-390.png",
    gaps: [
      "Mock Gross/Deductions/Employer KPI cards and fake workers were not added (no API).",
      "CIS bank query is LIVE-only; DEMO shows explicit LIVE-API notice instead of a fake empty failure.",
    ],
  },
  {
    id: "customers",
    title: "4. Customers",
    ref: "/finance-acceptance/ref/04-customers.png",
    actual1440: "/finance-acceptance/actual/customers-1440.png",
    actual820: "/finance-acceptance/actual/customers-820.png",
    actual390: "/finance-acceptance/actual/customers-390.png",
    gaps: [
      "Uses existing invoice/receipt columns only; Kennington project scope is honestly empty until NLO is selected.",
      "Advanced invoice server filters are LIVE-only in DEMO (honest notice, not a fake empty failure).",
    ],
  },
  {
    id: "commercial",
    title: "5. Commercial",
    ref: "/finance-acceptance/ref/05-commercial.png",
    actual1440: "/finance-acceptance/actual/commercial-1440.png",
    actual820: "/finance-acceptance/actual/commercial-820.png",
    actual390: "/finance-acceptance/actual/commercial-390.png",
    gaps: [
      "Dayworks/retention empty for Kennington — mock populated commercial not invented.",
    ],
  },
  {
    id: "loans",
    title: "6. Loans",
    ref: "/finance-acceptance/ref/06-loans.png",
    actual1440: "/finance-acceptance/actual/loans-1440.png",
    actual820: "/finance-acceptance/actual/loans-820.png",
    actual390: "/finance-acceptance/actual/loans-390.png",
    gaps: [
      "Empty funding books show honest empty grid; mock loan rows not invented.",
    ],
  },
  {
    id: "reports",
    title: "7. Reports",
    ref: "/finance-acceptance/ref/07-reports.png",
    actual1440: "/finance-acceptance/actual/reports-1440.png",
    actual820: "/finance-acceptance/actual/reports-820.png",
    actual390: "/finance-acceptance/actual/reports-390.png",
    gaps: [
      "Catalogue lists existing worksheets only — no invented report engines.",
    ],
  },
];

/** Local visual comparison gallery. Blocked in production. */
export default function FinanceAcceptanceReviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main style={{ fontFamily: "Segoe UI, sans-serif", background: "#f4f6f8", color: "#0f172a", padding: "24px 18px 64px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ marginBottom: 28 }}>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>TIMIQ Finance — local acceptance only</p>
        <h1 style={{ margin: "6px 0 8px", fontSize: 28 }}>Visual review gallery</h1>
        <p style={{ margin: 0, maxWidth: 780, color: "#475569", lineHeight: 1.5 }}>
          Reference machetes vs actual local captures. LIVE <code>/finance</code> requires authentication; functional UI evidence uses the acceptance shell with TimIQ-like sidebar chrome and the same FinanceWorkspace components as LIVE.
        </p>
        <p style={{ marginTop: 12 }}>
          <Link href="/finance-acceptance">Open acceptance shell</Link>
          {" · "}
          <Link href="/finance-visual-qa">Open visual QA</Link>
        </p>
      </header>

      <section style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 10, padding: 16, marginBottom: 22 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>BEFORE</h2>
        <img src="/finance-acceptance/ref/00-before.png" alt="Before UI issues" style={{ width: "100%", maxWidth: 960, border: "1px solid #cbd5e1", borderRadius: 8 }} />
      </section>

      <section style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 10, padding: 16, marginBottom: 22 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Source Drawer (actual)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <figure style={{ margin: 0 }}><figcaption>1440</figcaption><img src="/finance-acceptance/actual/drawer-1440.png" alt="Drawer 1440" style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8 }} /></figure>
          <figure style={{ margin: 0 }}><figcaption>820</figcaption><img src="/finance-acceptance/actual/drawer-820.png" alt="Drawer 820" style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8 }} /></figure>
          <figure style={{ margin: 0 }}><figcaption>390</figcaption><img src="/finance-acceptance/actual/drawer-390.png" alt="Drawer 390" style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8 }} /></figure>
        </div>
      </section>

      {SECTIONS.map((section) => (
        <section key={section.id} id={section.id} style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 10, padding: 16, marginBottom: 22 }}>
          <h2 style={{ marginTop: 0, fontSize: 20 }}>{section.title}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
            <figure style={{ margin: 0 }}>
              <figcaption style={{ fontWeight: 700, marginBottom: 6 }}>Reference</figcaption>
              <img src={section.ref} alt={`${section.title} reference`} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8 }} />
            </figure>
            <figure style={{ margin: 0 }}>
              <figcaption style={{ fontWeight: 700, marginBottom: 6 }}>ACTUAL 1440</figcaption>
              <img src={section.actual1440} alt={`${section.title} 1440`} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8 }} />
            </figure>
            <figure style={{ margin: 0 }}>
              <figcaption style={{ fontWeight: 700, marginBottom: 6 }}>ACTUAL 820</figcaption>
              <img src={section.actual820} alt={`${section.title} 820`} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8 }} />
            </figure>
            <figure style={{ margin: 0 }}>
              <figcaption style={{ fontWeight: 700, marginBottom: 6 }}>ACTUAL 390</figcaption>
              <img src={section.actual390} alt={`${section.title} 390`} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8 }} />
            </figure>
          </div>
          <div style={{ marginTop: 12 }}>
            <strong>Remaining visual gaps</strong>
            <ul style={{ margin: "8px 0 0", color: "#334155" }}>
              {section.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </main>
  );
}