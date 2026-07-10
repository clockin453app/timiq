"use client";

import { useMemo } from "react";

import { resolveNavigationLocation } from "../../config/navigation";
import { useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { useT } from "../../lib/i18n";
import { usePageLocationActionContent } from "./page-location-action-context";
import { PageLocationBackButton } from "./page-location-back-button";

type PageLocationGuideProps = {
  activeHref: string;
};

function isOverviewHomePath(activeHref: string): boolean {
  const path = activeHref.split("?")[0]?.split("#")[0] ?? activeHref;
  return path === "/overview";
}

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
  const showBackButton = !isOverviewHomePath(activeHref);

  return (
    <div className="mb-3 flex min-w-0 max-w-full items-start justify-between gap-3 text-xs leading-snug text-[var(--color-text-muted)]">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {showBackButton ? <PageLocationBackButton /> : null}
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
      </div>

      {action ? (
        <div className="flex min-w-0 max-w-[42rem] shrink-0 flex-wrap justify-end gap-1.5">{action}</div>
      ) : null}
    </div>
  );
}
