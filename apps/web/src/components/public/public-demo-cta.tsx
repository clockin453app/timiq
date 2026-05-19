import Link from "next/link";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

import { PUBLIC_DEMO_CTA } from "./public-copy";

type PublicDemoCtaProps = {
  className?: string;
  showSignIn?: boolean;
};

export function PublicDemoCta({ className, showSignIn = true }: PublicDemoCtaProps) {
  return (
    <section
      aria-labelledby="public-demo-cta-title"
      className={cn(uiClasses.publicDemoCta, className)}
    >
      <h2 className="timiq-title-md" id="public-demo-cta-title">
        {PUBLIC_DEMO_CTA.title}
      </h2>
      <p className="timiq-body mt-2 max-w-2xl">{PUBLIC_DEMO_CTA.subtitle}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          className={cn(
            "inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)]",
            "border border-[var(--color-btn-primary-border)] bg-[var(--color-btn-primary-bg)]",
            "px-4 text-sm font-semibold text-[var(--color-btn-primary-fg)] no-underline",
            "hover:bg-[var(--color-btn-primary-hover-bg)]",
            uiClasses.focusRing,
          )}
          href={PUBLIC_DEMO_CTA.mailto}
        >
          {PUBLIC_DEMO_CTA.primaryLabel}
        </a>
        {showSignIn ? (
          <Link
            className={cn(
              "inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)]",
              "border border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-4",
              "text-sm font-semibold text-[var(--color-text)] no-underline",
              "hover:bg-[var(--color-header)]",
              uiClasses.focusRing,
            )}
            href="/login"
          >
            {PUBLIC_DEMO_CTA.secondaryLabel}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
