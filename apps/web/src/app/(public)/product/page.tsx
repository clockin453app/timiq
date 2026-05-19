import type { Metadata } from "next";

import { PublicComplianceNote } from "../../../components/public/public-compliance-note";
import { PublicDemoCta } from "../../../components/public/public-demo-cta";
import { PublicFeatureCard } from "../../../components/public/public-feature-card";
import { PUBLIC_HERO, PUBLIC_LOGIN_BENEFITS, PUBLIC_PRODUCT_SECTIONS } from "../../../components/public/public-copy";
import { PublicHero } from "../../../components/public/public-hero";
import { PublicTrustStrip } from "../../../components/public/public-trust-strip";
import { uiClasses } from "../../../lib/ui-classes";

export const metadata: Metadata = {
  title: "Product | TimIQ",
  description: "Payroll and workforce management for UK site teams — CIS, PAYE, time tracking, and more.",
};

export default function ProductPage() {
  return (
    <div className={uiClasses.publicMain}>
      <PublicHero
        headline={PUBLIC_HERO.headline}
        primaryCta={{ href: "/features", label: "Explore features" }}
        subheadline={PUBLIC_HERO.subheadline}
      />

      <PublicTrustStrip className="mt-6" variant="onDark" />

      <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PUBLIC_LOGIN_BENEFITS.map((benefit) => (
          <PublicFeatureCard
            description={benefit.description}
            icon={benefit.icon}
            key={benefit.title}
            title={benefit.title}
          />
        ))}
      </section>

      <section className="mt-10 space-y-4">
        {PUBLIC_PRODUCT_SECTIONS.map((section) => (
          <article className={uiClasses.publicContentCard} key={section.title}>
            <h2 className="timiq-title-md">{section.title}</h2>
            <p className="timiq-body mt-2">{section.body}</p>
          </article>
        ))}
      </section>

      <PublicComplianceNote className="mt-8" variant="sheet" />

      <PublicDemoCta className="mt-10" />
    </div>
  );
}
