import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Calculator,
  ClipboardCheck,
  Clock,
  FileSpreadsheet,
  HardHat,
  ScrollText,
  Shield,
  User,
  Users,
  Wallet,
} from "lucide-react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

export type PublicFeatureIconKey =
  | "clock"
  | "cis"
  | "paye"
  | "onboarding"
  | "wallet"
  | "sites"
  | "employee"
  | "audit";

const ICON_BY_KEY: Record<PublicFeatureIconKey, LucideIcon> = {
  clock: Clock,
  cis: FileSpreadsheet,
  paye: Calculator,
  onboarding: ClipboardCheck,
  wallet: Wallet,
  sites: Building2,
  employee: User,
  audit: ScrollText,
};

type PublicFeatureCardProps = {
  title: string;
  description?: string;
  icon: PublicFeatureIconKey;
  variant?: "light" | "onDark";
  className?: string;
};

export function PublicFeatureCard({
  title,
  description,
  icon,
  variant = "light",
  className,
}: PublicFeatureCardProps) {
  const Icon = ICON_BY_KEY[icon] ?? Shield;

  const onDark = variant === "onDark";

  return (
    <article
      className={cn(
        onDark ? uiClasses.publicFeatureCardOnDark : uiClasses.publicFeatureCard,
        className,
      )}
    >
      <div
        className={cn(
          "mb-3 inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]",
          onDark
            ? "border border-white/20 bg-white/10 text-[var(--color-topbar-fg)]"
            : "border border-[var(--color-border)] bg-[var(--color-header)] text-[var(--color-brand)]",
        )}
      >
        <Icon aria-hidden className="h-5 w-5" />
      </div>
      <h3
        className={cn(
          "text-sm font-semibold leading-snug",
          onDark ? "text-[var(--color-topbar-fg)]" : "text-[var(--color-text)]",
        )}
      >
        {title}
      </h3>
      {description ? (
        <p
          className={cn(
            "mt-1.5 text-sm leading-relaxed",
            onDark ? "text-[var(--color-public-on-dark-muted)]" : "text-[var(--color-text-muted)]",
          )}
        >
          {description}
        </p>
      ) : null}
    </article>
  );
}
