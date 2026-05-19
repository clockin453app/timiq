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
        uiClasses.publicFeatureCard,
        onDark &&
          "lg:border-white/15 lg:bg-white/5 lg:shadow-none lg:backdrop-blur-sm",
        className,
      )}
    >
      <div
        className={cn(
          "mb-3 inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]",
          "border border-[var(--color-border)] bg-[var(--color-header)] text-[var(--color-brand)]",
          onDark &&
            "lg:border-white/20 lg:bg-white/10 lg:text-[var(--color-topbar-fg)]",
        )}
      >
        <Icon aria-hidden className="h-5 w-5" />
      </div>
      <h3
        className={cn(
          "text-sm font-semibold leading-snug text-[var(--color-text)]",
          onDark && "lg:text-[var(--color-topbar-fg)]",
        )}
      >
        {title}
      </h3>
      {description ? (
        <p
          className={cn(
            "mt-1.5 text-sm leading-relaxed text-[var(--color-text-muted)]",
            onDark && "lg:text-[var(--color-public-on-dark-muted)]",
          )}
        >
          {description}
        </p>
      ) : null}
    </article>
  );
}
