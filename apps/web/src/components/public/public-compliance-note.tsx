import { Info } from "lucide-react";

import { PUBLIC_PAYE_DISCLAIMER } from "./public-copy";
import { cn } from "../../lib/cn";

type PublicComplianceNoteProps = {
  variant?: "light" | "onDark";
  className?: string;
};

export function PublicComplianceNote({ variant = "light", className }: PublicComplianceNoteProps) {
  const onDark = variant === "onDark";

  return (
    <aside
      className={cn(
        "flex gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-xs leading-relaxed sm:text-sm",
        onDark
          ? "border-white/15 bg-white/5 text-[var(--color-public-on-dark-muted)]"
          : "border-[var(--color-border)] bg-[var(--color-header)] text-[var(--color-text-muted)]",
        className,
      )}
    >
      <Info
        aria-hidden
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          onDark ? "text-[var(--color-topbar-fg)]" : "text-[var(--color-brand)]",
        )}
      />
      <p className="min-w-0">{PUBLIC_PAYE_DISCLAIMER}</p>
    </aside>
  );
}
