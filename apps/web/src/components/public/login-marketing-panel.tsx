import Link from "next/link";

import { PUBLIC_HERO, PUBLIC_LOGIN_BENEFITS } from "./public-copy";
import { PublicComplianceNote } from "./public-compliance-note";
import { PublicDemoCta } from "./public-demo-cta";
import { PublicFeatureCard } from "./public-feature-card";
import { PublicHero } from "./public-hero";
import { PublicTrustStrip } from "./public-trust-strip";

export function LoginMarketingPanel() {
  return (
    <div className="min-w-0 space-y-6 lg:max-w-xl">
      <PublicHero headline={PUBLIC_HERO.headline} subheadline={PUBLIC_HERO.subheadline} variant="login" />

      <PublicTrustStrip variant="onDark" />

      <div className="grid gap-3 sm:grid-cols-2">
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

      <PublicDemoCta />

      <PublicComplianceNote variant="onDark" />

      <p className="text-sm text-[var(--color-public-on-dark-soft)]">
        <Link className="font-semibold text-[var(--color-topbar-fg)] underline" href="/features">
          Explore all features
        </Link>{" "}
        or read our{" "}
        <Link className="font-semibold text-[var(--color-topbar-fg)] underline" href="/security">
          security overview
        </Link>
        .
      </p>
    </div>
  );
}
