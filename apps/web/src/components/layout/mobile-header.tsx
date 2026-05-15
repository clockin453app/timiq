"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import {
  filterNavGroupsForMobileQuickNav,
  getEmployeeNavigationGroups,
  getManagementNavigationGroups,
} from "../../config/navigation";
import { canAccessManagement, LogoutButton, useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { employeeRoleLabel } from "../../lib/i18n/display-labels";
import { useT } from "../../lib/i18n";

import { findDefaultAccordionGroupId, GroupedNavBlock } from "./grouped-nav";
import { MessagesHeaderButton } from "./messages-header-button";
import { NotificationBell } from "./notification-bell";

type MobileHeaderProps = {
  activeHref?: string;
};

export function MobileHeader({ activeHref = "/dashboard" }: MobileHeaderProps) {
  const user = useCurrentUser();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  const limited = userHasLimitedAccess(user);
  const isMgmt = canAccessManagement(user);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen((open) => !open), []);

  const employeeGroups = useMemo(() => {
    const groups = getEmployeeNavigationGroups(user.system_role, { limitedAccess: limited });
    return isMgmt ? filterNavGroupsForMobileQuickNav(groups) : groups;
  }, [user.system_role, limited, isMgmt]);

  const managementGroups = useMemo(() => {
    if (limited || !isMgmt) {
      return [];
    }
    return filterNavGroupsForMobileQuickNav(getManagementNavigationGroups(user.system_role));
  }, [user.system_role, limited, isMgmt]);

  const [accordionOpenGroupId, setAccordionOpenGroupId] = useState<string | null>(null);

  useEffect(() => {
    setAccordionOpenGroupId(findDefaultAccordionGroupId(employeeGroups, managementGroups, activeHref));
  }, [activeHref, employeeGroups, managementGroups]);

  useEffect(() => {
    closeMenu();
  }, [activeHref, closeMenu]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen, closeMenu]);

  const menuLabel = menuOpen ? t("nav.close_menu", "Close menu") : t("nav.menu", "Menu");
  const roleLabel = employeeRoleLabel(t, user.system_role);

  return (
    <header className="timiq-print-hide-chrome sticky top-0 z-30 w-full min-w-0 overflow-x-clip border-b border-[var(--color-border-dark)] bg-[var(--color-header)] pt-[env(safe-area-inset-top,0px)] xl:hidden">
      <div className="relative z-[60] flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-bold tracking-tight text-[var(--color-text)]">{t("nav.tagline", "TimIQ")}</p>
          <p className="truncate text-xs text-[#4b5563]">{t("nav.tagline_sub", "Payroll & workforce")}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <MessagesHeaderButton activeHref={activeHref} />
          <NotificationBell />
          <button
            aria-controls="timiq-mobile-menu"
            aria-expanded={menuOpen}
            aria-label={menuLabel}
            className="timiq-touch-target flex items-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-3 text-sm font-semibold text-[var(--color-text)]"
            type="button"
            onClick={toggleMenu}
          >
            {menuLabel}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <>
          <button
            aria-label={t("nav.close_menu", "Close menu")}
            className="fixed inset-0 z-50 bg-black/40"
            type="button"
            onClick={closeMenu}
          />
          <div
            className="fixed inset-y-0 right-0 z-[60] flex h-dvh w-full max-w-[100vw] flex-col overflow-hidden border-l border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_4px_24px_rgba(15,23,42,0.18)]"
            id="timiq-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.drawer_nav", "More navigation")}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
              <div className="min-w-0">
                <p className="truncate text-lg font-bold tracking-tight text-[var(--color-text)]">
                  {t("nav.tagline", "TimIQ")}
                </p>
                <p className="truncate text-xs text-[var(--color-text-muted)]">{roleLabel}</p>
              </div>
              <button
                aria-label={t("nav.close_menu", "Close menu")}
                className="timiq-touch-target flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] p-2 text-[var(--color-text)]"
                type="button"
                onClick={closeMenu}
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>

            <nav
              aria-label={t("shell.drawer_nav", "More navigation")}
              className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 text-sm [-webkit-overflow-scrolling:touch]"
            >
              {employeeGroups.length > 0 ? (
                <GroupedNavBlock
                  accordionOpenGroupId={accordionOpenGroupId}
                  activeHref={activeHref}
                  groups={employeeGroups}
                  onAccordionOpenGroupChange={setAccordionOpenGroupId}
                  onNavigate={closeMenu}
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
                <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                  <p className="mb-2 px-2 text-xs font-medium tracking-normal text-[#374151]">
                    {t("nav.management", "Management")}
                  </p>
                  <GroupedNavBlock
                    accordionOpenGroupId={accordionOpenGroupId}
                    activeHref={activeHref}
                    groups={managementGroups}
                    onAccordionOpenGroupChange={setAccordionOpenGroupId}
                    onNavigate={closeMenu}
                    role={user.system_role}
                    showIcons
                    storageScope="drawer-mobile-management"
                    variant="drawer"
                  />
                </div>
              ) : null}
            </nav>

            <div className="shrink-0 border-t border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
              <Link
                className="block min-h-[44px] rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                href="/profile"
                onClick={closeMenu}
              >
                {t("nav.profile", "Profile")}
              </Link>
              {!limited ? (
                <Link
                  className="block min-h-[44px] rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                  href="/settings"
                  onClick={closeMenu}
                >
                  {t("nav.settings", "Settings")}
                </Link>
              ) : null}
              <div className="mt-1 px-1">
                <LogoutButton className="w-full" />
              </div>
            </div>
          </div>
        </>
      ) : null}
    </header>
  );
}
