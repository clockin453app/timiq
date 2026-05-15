"use client";

import { useState } from "react";

import { PageHeader, Sheet, SheetBody } from "../../components/ui";
import { useT } from "../../lib/i18n";
import { segmentBtnClass } from "./budget-ui";
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
        <div className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-1">
          <button
            className={segmentBtnClass(tab === "saved")}
            type="button"
            onClick={() => setTab("saved")}
          >
            {t("budgets.tab_saved")}
          </button>
          <button
            className={segmentBtnClass(tab === "calculator")}
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
