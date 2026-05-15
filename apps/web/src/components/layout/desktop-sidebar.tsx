"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight, LayoutDashboard, Settings, UserRound } from "lucide-react";

import {
  getAllNavLinksForRole,
  getEmployeeNavigationGroups,
  getManagementNavigationGroups,
} from "../../config/navigation";
import type { NotificationSummary } from "../../features/notifications/api";
import { navBadgesFromSummary } from "../../features/notifications/nav-badges";
import { LogoutButton, useCurrentUser, UserAccountSummary } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { useT } from "../../lib/i18n";

import { findDefaultAccordionGroupId, GroupedNavBlock } from "./grouped-nav";
import { NavItemIcon } from "./nav-item-icon";

const SIDEBAR_COLLAPSED_KEY = "timiq-sidebar-collapsed";

type DesktopSidebarProps = {
  activeHref?: string;
};

export function DesktopSidebar({ activeHref = "/dashboard" }: DesktopSidebarProps) {
  const user = useCurrentUser();
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setCollapsed(raw === "1");
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const setCollapsedPersist = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const limited = userHasLimitedAccess(user);

  const employeeGroups = useMemo(
    () => getEmployeeNavigationGroups(user.system_role, { limitedAccess: limited }),
    [user.system_role, limited],
  );

  const managementGroups = useMemo(
    () => (limited ? [] : getManagementNavigationGroups(user.system_role)),
    [user.system_role, limited],
  );

  const flatNav = useMemo(() => getAllNavLinksForRole(user.system_role), [user.system_role]);

  const [accordionOpenGroupId, setAccordionOpenGroupId] = useState<string | null>(null);
  const [navBadges, setNavBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    const onSummary = (ev: Event) => {
      const d = (ev as CustomEvent<NotificationSummary>).detail;
      if (!d?.items) {
        return;
      }
      setNavBadges(navBadgesFromSummary(d.items));
    };
    window.addEventListener("timiq:notification-summary", onSummary as EventListener);
    return () => window.removeEventListener("timiq:notification-summary", onSummary as EventListener);
  }, []);

  useEffect(() => {
    setAccordionOpenGroupId(findDefaultAccordionGroupId(employeeGroups, managementGroups, activeHref));
  }, [activeHref, employeeGroups, managementGroups]);

  const sidebarWidth = collapsed ? "var(--layout-sidebar-collapsed)" : "var(--layout-sidebar-width)";

  const collapsedIconLink =
    "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition-colors";

  return (
    <aside
      className="timiq-print-hide-chrome timiq-desktop-sidebar hidden min-w-0 flex-col border-r border-[var(--color-border-dark)] bg-[var(--color-sidebar-bg)] text-sm transition-[width] duration-200 ease-out xl:flex xl:h-dvh xl:max-h-dvh xl:min-h-0 xl:shrink-0 xl:overflow-hidden"
      style={{ width: hydrated ? sidebarWidth : "var(--layout-sidebar-width)" }}
    >
      <div className="flex shrink-0 items-start justify-between gap-1 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-2 py-2">
        {collapsed ? (
          <Link
            aria-label={t("nav.dashboard", "Dashboard")}
            className="mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-transparent text-[var(--color-text)] hover:bg-[var(--color-cell)]"
            href="/dashboard"
            title={t("nav.tagline", "TimIQ")}
          >
            <LayoutDashboard aria-hidden className="h-5 w-5" />
          </Link>
        ) : (
          <div className="min-w-0 flex-1 px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
              {t("shell.sidebar_section", "Navigation")}
            </p>
            <p className="text-base font-bold leading-tight tracking-tight text-[var(--color-text)]">
              {t("nav.tagline", "TimIQ")}
            </p>
          </div>
        )}
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("shell.expand_nav", "Expand navigation") : t("shell.collapse_nav", "Collapse navigation")}
          className="timiq-touch-target flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
          type="button"
          onClick={() => setCollapsedPersist(!collapsed)}
        >
          {collapsed ? (
            <ChevronsRight aria-hidden className="h-4 w-4" />
          ) : (
            <ChevronsLeft aria-hidden className="h-4 w-4" />
          )}
        </button>
      </div>

      {collapsed ? (
        <nav
          className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden overscroll-y-contain px-1 py-2 [-webkit-overflow-scrolling:touch]"
          aria-label={t("shell.sidebar_section", "Navigation")}
        >
          {flatNav.map((item) => {
            const label = t(item.labelKey, item.label);
            const active =
              item.href === "/dashboard"
                ? activeHref === "/dashboard"
                : activeHref === item.href || activeHref.startsWith(`${item.href}/`);
            const n = navBadges[item.href] ?? 0;
            return (
              <Link
                aria-label={label}
                className={[
                  collapsedIconLink,
                  active
                    ? "border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-cell)] hover:text-[var(--color-text)]",
                ].join(" ")}
                href={item.href}
                key={item.href}
                title={label}
              >
                <NavItemIcon labelKey={item.labelKey} className="h-[1.125rem] w-[1.125rem] shrink-0" />
                {n > 0 ? (
                  <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-600 ring-2 ring-[var(--color-sidebar-bg)]" />
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : (
        <nav
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 py-2 [-webkit-overflow-scrolling:touch]"
          aria-label={t("shell.sidebar_section", "Navigation")}
        >
          <GroupedNavBlock
            accordionOpenGroupId={accordionOpenGroupId}
            activeHref={activeHref}
            badgeByHref={navBadges}
            groups={employeeGroups}
            onAccordionOpenGroupChange={setAccordionOpenGroupId}
            role={user.system_role}
            showIcons
            storageScope="sidebar-desktop-primary"
            variant="sidebar"
          />

          {managementGroups.length > 0 ? (
            <div className="mt-3 border-t border-[var(--color-border)] pt-2">
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
                {t("nav.management", "Management")}
              </p>
              <GroupedNavBlock
                accordionOpenGroupId={accordionOpenGroupId}
                activeHref={activeHref}
                badgeByHref={navBadges}
                groups={managementGroups}
                onAccordionOpenGroupChange={setAccordionOpenGroupId}
                role={user.system_role}
                showIcons
                storageScope="sidebar-desktop-management"
                variant="sidebar"
              />
            </div>
          ) : null}
        </nav>
      )}

      {collapsed ? (
        <div className="flex shrink-0 flex-col items-center gap-1 border-t border-[var(--color-border-dark)] bg-[var(--color-cell)] px-1.5 py-2">
          <Link
            aria-label={t("nav.profile", "Profile")}
            className={`${collapsedIconLink} border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]`}
            href="/profile"
            title={t("nav.profile", "Profile")}
          >
            <UserRound aria-hidden className="h-4 w-4" />
          </Link>
          <Link
            aria-label={t("nav.settings", "Settings")}
            className={`${collapsedIconLink} border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]`}
            href="/settings"
            title={t("nav.settings", "Settings")}
          >
            <Settings aria-hidden className="h-4 w-4" />
          </Link>
          <LogoutButton iconOnly />
        </div>
      ) : (
        <div className="shrink-0">
          <UserAccountSummary layout="compact" />
        </div>
      )}
    </aside>
  );
}
