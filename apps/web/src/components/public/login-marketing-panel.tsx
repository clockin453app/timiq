import Link from "next/link";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

import { PUBLIC_HERO, PUBLIC_LOGIN_BENEFITS } from "./public-copy";
import { PublicComplianceNote } from "./public-compliance-note";
import { PublicFeatureCard } from "./public-feature-card";
import { PublicHero } from "./public-hero";
import { PublicTrustStrip } from "./public-trust-strip";

type SlotClassProps = {
  className?: string;
};

/** Short hero for /login — trust strip on desktop only (below hero in left column). */
export function LoginPageIntro({ className }: SlotClassProps) {
  return (
    <div className={cn("min-w-0 space-y-4 lg:max-w-xl", className)}>
      <PublicHero headline={PUBLIC_HERO.headline} subheadline={PUBLIC_HERO.subheadline} variant="login" />
      <PublicTrustStrip className="hidden lg:flex" variant="onDark" />
    </div>
  );
}

/** Benefit cards — below form on mobile, left column on desktop. */
export function LoginBenefitsGrid({ className }: SlotClassProps) {
  return (
    <div className={cn("grid min-w-0 gap-3 sm:grid-cols-2 lg:max-w-xl", className)}>
      {PUBLIC_LOGIN_BENEFITS.map((benefit) => (
        <PublicFeatureCard
          description={benefit.description}
          icon={benefit.icon}
          key={benefit.title}
          title={benefit.title}
          variant="onDark"
        />
      ))}
    </div>
  );
}

/** Compliance + explore links — bottom of login marketing column. */
export function LoginPageFooter({ className }: SlotClassProps) {
  return (
    <div className={cn("min-w-0 space-y-4 lg:max-w-xl", className)}>
      <PublicComplianceNote variant="sheet" />
      <p className={uiClasses.publicExploreText}>
        <Link className={uiClasses.publicExploreLink} href="/features">
          Explore all features
        </Link>{" "}
        or read our{" "}
        <Link className={uiClasses.publicExploreLink} href="/security">
          security overview
        </Link>
        .
      </p>
    </div>
  );
}
