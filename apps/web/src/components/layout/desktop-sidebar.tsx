"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight, LayoutDashboard } from "lucide-react";

import {
  getAllNavLinksForRole,
  getEmployeeNavigationGroups,
  getManagementNavigationGroups,
} from "../../config/navigation";
import { useCurrentUser, UserAccountSummary } from "../../features/auth";
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

  const employeeGroups = useMemo(
    () => getEmployeeNavigationGroups(user.system_role),
    [user.system_role],
  );

  const managementGroups = useMemo(
    () => getManagementNavigationGroups(user.system_role),
    [user.system_role],
  );

  const flatNav = useMemo(() => getAllNavLinksForRole(user.system_role), [user.system_role]);

  const [accordionOpenGroupId, setAccordionOpenGroupId] = useState<string | null>(null);

  useEffect(() => {
    setAccordionOpenGroupId(findDefaultAccordionGroupId(employeeGroups, managementGroups, activeHref));
  }, [activeHref, employeeGroups, managementGroups]);

  const sidebarWidth = collapsed ? "var(--layout-sidebar-collapsed)" : "var(--layout-sidebar-width)";

  return (
    <aside
      className="timiq-print-hide-chrome hidden min-w-0 flex-col border-r border-[var(--color-border-dark)] bg-[var(--color-sidebar-bg)] text-sm transition-[width] duration-200 ease-out xl:flex xl:h-full xl:max-h-full xl:min-h-0 xl:shrink-0 xl:overflow-hidden"
      style={{ width: hydrated ? sidebarWidth : "var(--layout-sidebar-width)" }}
    >
      <div className="flex shrink-0 items-start justify-between gap-1 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-2 py-3">
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
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
              {t("shell.sidebar_section", "Navigation")}
            </p>
            <p className="mt-0.5 text-base font-bold tracking-tight text-[var(--color-text)]">{t("nav.tagline", "TimIQ")}</p>
            <p className="mt-0.5 text-xs leading-snug text-[var(--color-text-muted)]">
              {t("nav.tagline_sub", "Payroll & workforce")}
            </p>
          </div>
        )}
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("shell.expand_nav", "Expand navigation") : t("shell.collapse_nav", "Collapse navigation")}
          className="timiq-touch-target flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
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
          className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden px-1 py-3"
          aria-label={t("shell.sidebar_section", "Navigation")}
        >
          {flatNav.map((item) => {
            const label = t(item.labelKey, item.label);
            const active =
              item.href === "/dashboard"
                ? activeHref === "/dashboard"
                : activeHref === item.href || activeHref.startsWith(`${item.href}/`);
            return (
              <Link
                aria-label={label}
                className={[
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition-colors",
                  active
                    ? "border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-cell)] hover:text-[var(--color-text)]",
                ].join(" ")}
                href={item.href}
                key={item.href}
                title={label}
              >
                <NavItemIcon labelKey={item.labelKey} className="h-5 w-5 shrink-0" />
              </Link>
            );
          })}
        </nav>
      ) : (
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2.5 py-4">
          <GroupedNavBlock
            accordionOpenGroupId={accordionOpenGroupId}
            activeHref={activeHref}
            groups={employeeGroups}
            onAccordionOpenGroupChange={setAccordionOpenGroupId}
            role={user.system_role}
            showIcons
            storageScope="sidebar-desktop-primary"
            variant="sidebar"
          />

          {managementGroups.length > 0 ? (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <p className="mb-2 px-2 text-xs font-medium tracking-normal text-[var(--color-text-muted)]">
                {t("nav.management", "Management")}
              </p>
              <GroupedNavBlock
                accordionOpenGroupId={accordionOpenGroupId}
                activeHref={activeHref}
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
        <div className="mt-auto shrink-0 border-t border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2">
          <Link
            aria-label={t("nav.profile", "Profile")}
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]"
            href="/profile"
            title={t("nav.profile", "Profile")}
          >
            <NavItemIcon labelKey="nav.profile" className="h-5 w-5 shrink-0" />
          </Link>
        </div>
      ) : (
        <div className="shrink-0">
          <UserAccountSummary />
        </div>
      )}
    </aside>
  );
}
