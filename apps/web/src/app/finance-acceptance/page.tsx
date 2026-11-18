"use client";

import { notFound } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import { DEMO_BOOKS, DEMO_CATEGORIES, DEMO_COMPANY } from "@/features/finance/finance-demo-fixture";
import { FinanceWorkspace, type FinanceWorkspaceDemo } from "@/features/finance/finance-workspace";

/** Local acceptance shell with TimIQ-like sidebar. Blocked in production. */
export default function FinanceAcceptanceShellPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const books = {
    ...DEMO_BOOKS,
    projects: [
      ...DEMO_BOOKS.projects,
      {
        id: "demo-kennington",
        name: "Kennington (0001)",
        reference_code: "0001",
        status: "active",
      },
    ],
    cvrs: [
      ...DEMO_BOOKS.cvrs,
      {
        id: "demo-kennington",
        name: "Kennington (0001)",
        approved_contract_value: "missing",
        approved_budget: "missing",
        actual_eligible_cost: "missing",
        actual_incurred_cost: "missing",
        cis_labour_gross: "missing",
        open_commitments: "missing",
        open_commitment: "missing",
        cost_to_complete: "missing",
        forecast_final_cost: "missing",
        forecast_final_profit: "missing",
        forecast_margin: "missing",
        forecast_final_margin_percent: "missing",
      },
    ],
  } as FinanceWorkspaceDemo["books"];

  const nav = [
    "Dashboard",
    "Employees",
    "Companies",
    "Workplaces",
    "Finance",
    "Payroll report",
    "Live attendance",
    "System health",
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#eef1f5" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "#0f2744", color: "#fff" }}>
        <button type="button" onClick={() => setMobileNavOpen((v) => !v)} style={{ background: "#1d4f86", color: "#fff", border: 0, padding: "8px 12px", borderRadius: 6, minHeight: 44 }}>
          Menu
        </button>
        <strong style={{ fontSize: 18 }}>TimIQ</strong>
        <span style={{ opacity: 0.8, fontSize: 13 }}>Local acceptance shell — not LIVE auth</span>
        <span style={{ marginLeft: "auto", fontSize: 12, background: "#334155", padding: "4px 8px", borderRadius: 999 }}>Read-only pilot</span>
        <Link href="/finance-acceptance/review" style={{ color: "#bfdbfe", fontSize: 13 }}>Open review gallery</Link>
      </header>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          className={`fa-sidebar${mobileNavOpen ? " fa-sidebar-open" : ""}`}
          style={{
            minWidth: 0,
            background: "#0f2744",
            color: "#dbe7f5",
            display: "block",
            overflow: "hidden",
            transition: "width .2s ease, padding .2s ease",
          }}
        >
          <nav aria-label="TimIQ main" style={{ display: "grid", gap: 4 }}>
            {nav.map((item) => (
              <div
                key={item}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: item === "Finance" ? "#1d4f86" : "transparent",
                  color: "#fff",
                  fontWeight: item === "Finance" ? 700 : 500,
                  minHeight: 44,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {item}
              </div>
            ))}
          </nav>
        </aside>
        <main style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          <FinanceWorkspace
            demo={{
              label: "Acceptance shell — DEMO books inside TimIQ-like chrome",
              companies: [DEMO_COMPANY],
              books,
              categories: DEMO_CATEGORIES,
              initialSheet: "PROJECT CONTROL",
              initialProjectId: "demo-kennington",
            }}
          />
        </main>
      </div>
      <style>{`
        .fa-sidebar { width: 0; padding: 0; }
        .fa-sidebar.fa-sidebar-open { width: 240px; padding: 12px; }
        @media (min-width: 821px) {
          .fa-sidebar { width: 240px !important; padding: 12px !important; }
        }
      `}</style>
    </div>
  );
}