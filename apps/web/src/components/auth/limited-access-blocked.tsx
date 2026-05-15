"use client";

import Link from "next/link";

import { useT } from "../../lib/i18n";

export function LimitedAccessBlocked() {
  const t = useT();
  return (
    <section className="mx-auto max-w-lg border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-sm text-[var(--color-text)]">
      <p className="font-medium">
        {t(
          "auth.limited_access.blocked_title",
          "Your account is deactivated. You can still view your timesheets and pay history.",
        )}
      </p>
      <p className="mt-2 text-[var(--color-text-muted)]">
        {t(
          "auth.limited_access.contact_admin",
          "Contact your company admin if you believe this is incorrect.",
        )}
      </p>
      <p className="mt-4 flex flex-wrap gap-3">
        <Link className="text-[var(--color-accent)] underline" href="/timesheets">
          {t("nav.timesheets", "Timesheets")}
        </Link>
        <Link className="text-[var(--color-accent)] underline" href="/pay-history">
          {t("nav.pay_history", "Pay History")}
        </Link>
      </p>
    </section>
  );
}
