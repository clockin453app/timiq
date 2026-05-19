import type { Metadata } from "next";

import { PublicComplianceNote } from "../../../components/public/public-compliance-note";
import { PublicDemoCta } from "../../../components/public/public-demo-cta";
import { PUBLIC_SECURITY_POINTS } from "../../../components/public/public-copy";
import { PublicHero } from "../../../components/public/public-hero";
import { PublicTrustStrip } from "../../../components/public/public-trust-strip";
import { uiClasses } from "../../../lib/ui-classes";

export const metadata: Metadata = {
  title: "Security | TimIQ",
  description: "Role-based access, company-scoped data, and audit-friendly workflows for TimIQ.",
};

export default function SecurityPage() {
  return (
    <div className={uiClasses.publicMain}>
      <PublicHero
        headline="Security and trust for operational teams"
        subheadline="TimIQ is designed with role-based access, company-scoped data, and audit-friendly workflows — without overstating compliance certifications."
      />

      <PublicTrustStrip className="mt-6" variant="onDark" />

      <section className="mt-10 space-y-4">
        {PUBLIC_SECURITY_POINTS.map((point) => (
          <article className={uiClasses.publicContentCard} key={point.title}>
            <h2 className="timiq-title-md">{point.title}</h2>
            <p className="timiq-body mt-2">{point.body}</p>
          </article>
        ))}
      </section>

      <PublicComplianceNote className="mt-8" variant="sheet" />

      <p className="mt-6 text-sm text-[var(--color-text-muted)]">
        TimIQ does not provide tax advice or legal compliance guarantees. Some payroll compliance workflows,
        including RTI/HMRC submission, are not enabled yet. See the product pages for current capability.
      </p>

      <PublicDemoCta className="mt-10" />
    </div>
  );
}
