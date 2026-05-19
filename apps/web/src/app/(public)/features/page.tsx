import type { Metadata } from "next";
import Link from "next/link";

import { PublicComplianceNote } from "../../../components/public/public-compliance-note";
import { PublicDemoCta } from "../../../components/public/public-demo-cta";
import { PublicFeatureCard } from "../../../components/public/public-feature-card";
import { PUBLIC_FEATURE_GROUPS } from "../../../components/public/public-copy";
import { PublicHero } from "../../../components/public/public-hero";
import { cn } from "../../../lib/cn";
import { uiClasses } from "../../../lib/ui-classes";

export const metadata: Metadata = {
  title: "Features | TimIQ",
  description: "Time and attendance, CIS payroll, monthly PAYE, onboarding, and workforce management features.",
};

export default function FeaturesPage() {
  return (
    <div className={uiClasses.publicMain}>
      <PublicHero
        headline="Features built for payroll and site operations"
        subheadline="From clock events to CIS and PAYE workflows, TimIQ connects the tools your teams use every day."
      />

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        {PUBLIC_FEATURE_GROUPS.map((group) => (
          <article className={uiClasses.publicContentCard} key={group.title}>
            <PublicFeatureCard
              className="border-0 bg-transparent p-0 shadow-none"
              description=""
              icon={group.icon}
              title={group.title}
            />
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-[var(--color-text-muted)]">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <PublicComplianceNote className="mt-8" variant="sheet" />

      <PublicDemoCta className="mt-10" />

      <p className={cn("mt-8 text-center", uiClasses.publicExploreText)}>
        <Link className={uiClasses.publicExploreLink} href="/product">
          Product overview
        </Link>
      </p>
    </div>
  );
}
