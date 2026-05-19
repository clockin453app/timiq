import Link from "next/link";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

type PublicHeroProps = {
  headline: string;
  subheadline: string;
  variant?: "page" | "login";
  primaryCta?: { href: string; label: string };
  secondaryCta?: { href: string; label: string };
  className?: string;
};

export function PublicHero({
  headline,
  subheadline,
  variant = "page",
  primaryCta,
  secondaryCta,
  className,
}: PublicHeroProps) {
  const onLogin = variant === "login";

  return (
    <div className={cn("min-w-0", className)}>
      <h1
        className={cn(
          onLogin
            ? "m-0 text-2xl font-bold leading-tight tracking-tight text-[var(--color-topbar-fg)] sm:text-3xl"
            : uiClasses.publicHeroTitle,
        )}
      >
        {headline}
      </h1>
      <p
        className={cn(
          onLogin
            ? "mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-public-on-dark-muted)] sm:text-base"
            : uiClasses.publicHeroSubtitle,
        )}
      >
        {subheadline}
      </p>
      {primaryCta || secondaryCta ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {primaryCta ? (
            <Link className={cn(uiClasses.publicCtaPrimary, "no-underline")} href={primaryCta.href}>
              {primaryCta.label}
            </Link>
          ) : null}
          {secondaryCta ? (
            <Link className={cn(uiClasses.publicCtaSecondary, "no-underline")} href={secondaryCta.href}>
              {secondaryCta.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
