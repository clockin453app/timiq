"use client";

import { notFound } from "next/navigation";

import { DEMO_BOOKS, DEMO_CATEGORIES, DEMO_COMPANY, DEMO_PROJECT_ID } from "@/features/finance/finance-demo-fixture";
import { FinanceWorkspace, type FinanceWorkspaceDemo } from "@/features/finance/finance-workspace";

/** Local visual QA only. Blocked in production builds. */
export default function FinanceVisualQaPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

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

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7" }}>
      <FinanceWorkspace
        demo={{
          label: "Local visual QA - not LIVE",
          companies: [DEMO_COMPANY],
          books,
          categories: DEMO_CATEGORIES,
          initialSheet: "PROJECT CONTROL",
          initialProjectId: "demo-kennington",
        }}
      />
      <p style={{ display: "none" }} data-demo-project={DEMO_PROJECT_ID}>
        demo
      </p>
    </main>
  );
}