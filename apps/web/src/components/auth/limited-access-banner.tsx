"use client";

import { useT } from "../../lib/i18n";

export function LimitedAccessBanner() {
  const t = useT();
  return (
    <div
      className="mb-4 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text)]"
      role="status"
    >
      <p className="font-medium">
        {t(
          "limited_access.banner",
          "Your account has limited access. Some features are unavailable until your account is reactivated.",
        )}
      </p>
      <p className="mt-1 text-[var(--color-text-muted)]">
        {t(
          "auth.limited_access.contact_admin",
          "Contact your company admin if you believe this is incorrect.",
        )}
      </p>
    </div>
  );
}
