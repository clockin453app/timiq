"use client";

import { useMemo } from "react";

import { resolveNavigationLocation } from "../../config/navigation";
import { useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { useT } from "../../lib/i18n";

type PageLocationGuideProps = {
  activeHref: string;
};

export function PageLocationGuide({ activeHref }: PageLocationGuideProps) {
  const user = useCurrentUser();
  const t = useT();
  const limited = userHasLimitedAccess(user);

  const location = useMemo(
    () =>
      resolveNavigationLocation(user.system_role, activeHref, {
        limitedAccess: limited,
      }),
    [user.system_role, activeHref, limited],
  );

  if (!location) {
    return null;
  }

  const groupLabel = t(location.groupLabelKey, location.groupLabel);
  const pageLabel = t(location.pageLabelKey, location.pageLabel);

  return (
    <nav
      aria-label={t("shell.page_location", "Current page")}
      className="mb-3 hidden min-w-0 max-w-full truncate text-xs leading-snug text-[var(--color-text-muted)] xl:block"
    >
      {location.showGroup ? (
        <>
          <span className="font-medium text-[var(--color-text-soft)]">{groupLabel}</span>
          <span aria-hidden className="mx-1.5 text-[var(--color-text-soft)]">
            /
          </span>
        </>
      ) : null}
      <span className="font-semibold text-[var(--color-text)]">{pageLabel}</span>
    </nav>
  );
}
