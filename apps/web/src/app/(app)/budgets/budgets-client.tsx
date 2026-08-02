"use client";

import { useState } from "react";

import { PageHeader, Sheet, SheetBody } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { budgetUnderlineTabClass } from "./budget-ui";
import { BudgetQuickCalculatorTab } from "./budgets-calculator-tab";
import { BudgetsSavedTab } from "./budgets-saved-tab";

type TabId = "saved" | "calculator";

export function BudgetsClient() {
  const t = useT();
  const [tab, setTab] = useState<TabId>("saved");

  return (
    <Sheet>
      <PageHeader description={t("budgets.page_description")} title={t("budgets.page_title")} />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <div className="timiq-scroll-x -mx-1 flex w-full min-w-0 max-w-full gap-1 overflow-x-auto border-b border-[var(--color-border)] px-1">
          <button
            className={budgetUnderlineTabClass(tab === "saved")}
            type="button"
            onClick={() => setTab("saved")}
          >
            {t("budgets.tab_saved")}
          </button>
          <button
            className={budgetUnderlineTabClass(tab === "calculator")}
            type="button"
            onClick={() => setTab("calculator")}
          >
            {t("budgets.tab_calculator")}
          </button>
        </div>
        {tab === "saved" ? <BudgetsSavedTab /> : <BudgetQuickCalculatorTab />}
      </SheetBody>
    </Sheet>
  );
}
