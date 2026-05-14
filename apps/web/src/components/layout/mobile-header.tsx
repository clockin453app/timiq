"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  filterNavGroupsForMobileQuickNav,
  getEmployeeNavigationGroups,
  getManagementNavigationGroups,
} from "../../config/navigation";
import { LogoutButton, useCurrentUser } from "../../features/auth";
import { useT } from "../../lib/i18n";

import { findDefaultAccordionGroupId, GroupedNavBlock } from "./grouped-nav";
import { NotificationBell } from "./notification-bell";

type MobileHeaderProps = {
  activeHref?: string;
};

export function MobileHeader({ activeHref = "/dashboard" }: MobileHeaderProps) {
  const user = useCurrentUser();
  const t = useT();

  const employeeGroups = useMemo(
    () => filterNavGroupsForMobileQuickNav(getEmployeeNavigationGroups(user.system_role)),
    [user.system_role],
  );

  const managementGroups = useMemo(
    () => filterNavGroupsForMobileQuickNav(getManagementNavigationGroups(user.system_role)),
    [user.system_role],
  );

  const [accordionOpenGroupId, setAccordionOpenGroupId] = useState<string | null>(null);

  useEffect(() => {
    setAccordionOpenGroupId(findDefaultAccordionGroupId(employeeGroups, managementGroups, activeHref));
  }, [activeHref, employeeGroups, managementGroups]);

  return (
    <header className="timiq-print-hide-chrome w-full min-w-0 overflow-x-clip border-b border-[var(--color-border-dark)] bg-[var(--color-header)] pt-[env(safe-area-inset-top,0px)] xl:hidden">
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-bold tracking-tight text-[var(--color-text)]">{t("nav.tagline", "TimIQ")}</p>
          <p className="truncate text-xs text-[#4b5563]">{t("nav.tagline_sub", "Payroll & workforce")}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <NotificationBell />
          <details className="relative shrink-0">
          <summary className="timiq-touch-target list-none flex items-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-3 text-sm font-semibold text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
            {t("nav.menu", "Menu")}
          </summary>

          <div className="absolute right-0 z-20 mt-2 flex w-[min(100vw-1.5rem,19rem)] max-w-[calc(100vw-1rem)] max-h-[min(85dvh,calc(100dvh-4rem))] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_1px_4px_rgba(15,23,42,0.08)]">
            <nav
              aria-label={t("shell.drawer_nav", "More navigation")}
              className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2 text-sm [-webkit-overflow-scrolling:touch]"
            >
              {employeeGroups.length > 0 ? (
                <GroupedNavBlock
                  accordionOpenGroupId={accordionOpenGroupId}
                  activeHref={activeHref}
                  groups={employeeGroups}
                  onAccordionOpenGroupChange={setAccordionOpenGroupId}
                  role={user.system_role}
                  showIcons
                  storageScope="drawer-mobile-primary"
                  variant="drawer"
                />
              ) : (
                <p className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
                  {t("nav.drawer_hint_primary", "All primary pages are on the bottom bar.")}
                </p>
              )}

              {managementGroups.length > 0 ? (
                <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                  <p className="mb-2 px-2 text-xs font-medium tracking-normal text-[#374151]">
                    {t("nav.management", "Management")}
                  </p>
                  <GroupedNavBlock
                    accordionOpenGroupId={accordionOpenGroupId}
                    activeHref={activeHref}
                    groups={managementGroups}
                    onAccordionOpenGroupChange={setAccordionOpenGroupId}
                    role={user.system_role}
                    showIcons
                    storageScope="drawer-mobile-management"
                    variant="drawer"
                  />
                </div>
              ) : null}
            </nav>

            <div className="shrink-0 border-t border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2">
              <Link
                className="block min-h-[44px] rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                href="/profile"
              >
                {t("nav.profile", "Profile")}
              </Link>
              <Link
                className="block min-h-[44px] rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                href="/settings"
              >
                {t("nav.settings", "Settings")}
              </Link>
              <div className="mt-1 px-1">
                <LogoutButton className="w-full" />
              </div>
            </div>
          </div>
        </details>
        </div>
      </div>
    </header>
  );
}
