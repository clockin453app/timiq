import { Check } from "lucide-react";

import { PUBLIC_TRUST_ITEMS } from "./public-copy";
import { cn } from "../../lib/cn";

type PublicTrustStripProps = {
  variant?: "light" | "onDark";
  className?: string;
};

export function PublicTrustStrip({ variant = "light", className }: PublicTrustStripProps) {
  const onDark = variant === "onDark";

  return (
    <ul
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-2 text-xs sm:text-sm",
        onDark ? "text-[var(--color-public-on-dark-muted)]" : "text-[var(--color-text-muted)]",
        className,
      )}
    >
      {PUBLIC_TRUST_ITEMS.map((item) => (
        <li className="inline-flex min-w-0 max-w-full items-center gap-1.5" key={item}>
          <Check
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0",
              onDark ? "text-[var(--color-topbar-fg)]" : "text-[var(--color-brand)]",
            )}
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}
