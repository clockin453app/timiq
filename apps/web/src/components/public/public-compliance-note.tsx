import { Info } from "lucide-react";

import { PUBLIC_PAYE_DISCLAIMER } from "./public-copy";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

type PublicComplianceNoteProps = {
  variant?: "light" | "onDark" | "sheet";
  className?: string;
};

export function PublicComplianceNote({ variant = "sheet", className }: PublicComplianceNoteProps) {
  const sheet = variant === "sheet" || variant === "light";
  const onDark = variant === "onDark";

  return (
    <aside
      className={cn(
        "flex gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-xs leading-relaxed sm:text-sm",
        sheet && uiClasses.publicComplianceSheet,
        onDark &&
          "max-lg:border-[var(--color-border-dark)] max-lg:bg-[var(--color-sheet)] max-lg:text-[var(--color-text-muted)] max-lg:shadow-[var(--shadow-card)] lg:border-white/15 lg:bg-white/5 lg:text-[var(--color-public-on-dark-muted)]",
        className,
      )}
    >
      <Info
        aria-hidden
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 text-[var(--color-brand)]",
          onDark && "lg:text-[var(--color-topbar-fg)]",
        )}
      />
      <p className="min-w-0">{PUBLIC_PAYE_DISCLAIMER}</p>
    </aside>
  );
}
