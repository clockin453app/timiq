"use client";

import { useMemo } from "react";

import { resolveNavigationLocation } from "../../config/navigation";
import { useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { useT } from "../../lib/i18n";
import { usePageLocationActionContent } from "./page-location-action-context";

type PageLocationGuideProps = {
  activeHref: string;
};

export function PageLocationGuide({ activeHref }: PageLocationGuideProps) {
  const user = useCurrentUser();
  const t = useT();
  const limited = userHasLimitedAccess(user);
  const action = usePageLocationActionContent();

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
    <div className="mb-3 hidden min-w-0 max-w-full items-start justify-between gap-3 text-xs leading-snug text-[var(--color-text-muted)] xl:flex">
      <nav aria-label={t("shell.page_location", "Current page")} className="min-w-0 truncate">
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

      {action ? (
        <div className="flex min-w-0 max-w-[42rem] flex-wrap justify-end gap-1.5">{action}</div>
      ) : null}
    </div>
  );
}
