"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  getDesktopSidebarNavigationTree,
  nodeContainsActiveRoute,
  type NavigationNode,
} from "../../config/navigation";
import type { NotificationSummary } from "../../features/notifications/api";
import { navBadgesFromSummary } from "../../features/notifications/nav-badges";
import { LogoutButton, useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { useT } from "../../lib/i18n";

import { useDesktopSidebarState } from "./desktop-sidebar-state";
import { NavGroupIcon, NavItemIcon } from "./nav-item-icon";
import { NavTree } from "./nav-tree";

type DesktopSidebarProps = {
  activeHref?: string;
};

function rootSectionIconKey(node: NavigationNode): string {
  if (node.iconKey) {
    return node.iconKey;
  }
  return node.id;
}

export function DesktopSidebar({ activeHref = "/dashboard" }: DesktopSidebarProps) {
  const user = useCurrentUser();
  const t = useT();
  const limited = userHasLimitedAccess(user);
  const { collapsed, hydrated, setCollapsed } = useDesktopSidebarState();
  const tree = useMemo(
    () =>
      getDesktopSidebarNavigationTree(user.system_role, {
        limitedAccess: limited,
      }),
    [limited, user.system_role],
  );
  const [forceOpenIds, setForceOpenIds] = useState<string[]>([]);
  const [navBadges, setNavBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    const onSummary = (event: Event) => {
      const detail = (event as CustomEvent<NotificationSummary>).detail;
      if (detail?.items) setNavBadges(navBadgesFromSummary(detail.items));
    };
    window.addEventListener("timiq:notification-summary", onSummary as EventListener);
    return () =>
      window.removeEventListener("timiq:notification-summary", onSummary as EventListener);
  }, []);

  useEffect(() => {
    if (!collapsed && forceOpenIds.length > 0) {
      const timer = window.setTimeout(() => setForceOpenIds([]), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [collapsed, forceOpenIds]);

  const width = collapsed
    ? "var(--layout-sidebar-collapsed)"
    : "var(--layout-sidebar-width)";
  const resolvedWidth = hydrated ? width : "var(--layout-sidebar-responsive-default)";
  const railButton =
    "relative flex h-9 w-full shrink-0 items-center justify-center border-l-2 border-l-transparent text-[var(--color-sidebar-fg-muted)] transition-colors hover:bg-[var(--color-sidebar-active)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80";
  const railLink =
    "relative flex h-9 w-full shrink-0 items-center justify-center border-l-2 border-l-transparent text-[var(--color-sidebar-fg-muted)] transition-colors hover:bg-[var(--color-sidebar-active)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80";

  const onCollapsedSectionClick = (node: NavigationNode) => {
    setForceOpenIds(node.children?.length ? [node.id] : []);
    setCollapsed(false);
  };

  return (
    <aside
      className="timiq-print-hide-chrome timiq-desktop-sidebar hidden min-h-0 shrink-0 flex-col overflow-hidden border-r border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-bg)] text-[var(--color-sidebar-fg)] transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex"
      style={{ width: resolvedWidth }}
    >
      {collapsed ? (
        <nav
          aria-label={t("shell.sidebar_section", "Navigation")}
          className="timiq-sidebar-scrollbar flex min-h-0 flex-1 flex-col items-center overflow-y-auto overflow-x-hidden overscroll-y-contain py-1 [-webkit-overflow-scrolling:touch]"
        >
          {tree.map((node) => {
            const label = t(node.labelKey, node.label);
            const active = nodeContainsActiveRoute(node, activeHref);
            const hasBadge = Boolean(
              node.href
                ? (navBadges[node.href] ?? 0) > 0
                : node.children?.some((child) =>
                    child.href ? (navBadges[child.href] ?? 0) > 0 : false,
                  ),
            );
            return (
              <button
                aria-label={`${t("shell.expand_sidebar", "Expand sidebar")}: ${label}`}
                className={`${railButton} ${
                  active
                    ? "border-l-white/80 bg-[var(--color-sidebar-active)] text-white"
                    : ""
                }`}
                key={node.id}
                title={label}
                type="button"
                onClick={() => onCollapsedSectionClick(node)}
              >
                {node.href && !node.children?.length ? (
                  <NavItemIcon
                    aria-hidden
                    className="h-[var(--layout-sidebar-icon-size)] w-[var(--layout-sidebar-icon-size)]"
                    labelKey={node.labelKey}
                    surface="navy"
                  />
                ) : (
                  <NavGroupIcon
                    aria-hidden
                    className="h-[var(--layout-sidebar-icon-size)] w-[var(--layout-sidebar-icon-size)]"
                    groupId={rootSectionIconKey(node)}
                    surface="navy"
                  />
                )}
                {hasBadge ? (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-400 ring-2 ring-[var(--color-sidebar-bg)]" />
                ) : null}
              </button>
            );
          })}
        </nav>
      ) : (
        <nav
          aria-label={t("shell.sidebar_section", "Navigation")}
          className="timiq-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain py-1 [-webkit-overflow-scrolling:touch]"
        >
          <NavTree
            activeHref={activeHref}
            badgeByHref={navBadges}
            forceOpenIds={forceOpenIds}
            nodes={tree}
            role={user.system_role}
            showIcons
            storageScope="sidebar-desktop"
            variant="sidebar"
          />
        </nav>
      )}

      <div className="timiq-sidebar-scrollbar max-h-[50%] shrink-0 overflow-y-auto overscroll-contain border-t border-white/15 bg-[#142950]">
        {collapsed ? (
          <div className="flex flex-col items-center py-1.5">
            <Link className={railLink} href="/profile" title={t("nav.profile", "Profile")}>
              <NavItemIcon aria-hidden className="h-3.5 w-3.5" labelKey="nav.profile" surface="navy" />
              <span className="sr-only">{t("nav.profile", "Profile")}</span>
            </Link>
            {!limited ? (
              <>
                <Link className={railLink} href="/settings" title={t("nav.settings", "Settings")}>
                  <NavItemIcon aria-hidden className="h-3.5 w-3.5" labelKey="nav.settings" surface="navy" />
                  <span className="sr-only">{t("nav.settings", "Settings")}</span>
                </Link>
                <Link className={railLink} href="/help" title={t("nav.help", "Help centre")}>
                  <NavItemIcon aria-hidden className="h-3.5 w-3.5" labelKey="nav.help" surface="navy" />
                  <span className="sr-only">{t("nav.help", "Help centre")}</span>
                </Link>
              </>
            ) : null}
            <span className="block w-full [&_button]:!h-9 [&_button]:!w-full [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!border-l-2 [&_button]:!border-l-transparent [&_button]:!bg-transparent [&_button]:!p-0 [&_button]:!text-white/80 [&_button]:!shadow-none [&_button:hover]:!bg-[var(--color-sidebar-active)] [&_button:hover]:!text-white [&_svg]:!h-3.5 [&_svg]:!w-3.5 [&_svg]:!text-[#e6a0a0]">
              <LogoutButton iconOnly />
            </span>
          </div>
        ) : (
          <div className="text-xs">
            <div className="border-b border-white/10 px-3 py-1.5">
              <p className="truncate font-medium text-white" title={user.email}>
                {user.email}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-white/60">
                {user.system_role}
              </p>
            </div>
            <div className="py-1">
              <Link
                className="flex min-h-[var(--layout-sidebar-row-height)] w-full items-center gap-2 px-3 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
                href="/profile"
              >
                <NavItemIcon
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0"
                  labelKey="nav.profile"
                  surface="navy"
                />
                {t("nav.profile", "Profile")}
              </Link>
              {!limited ? (
                <>
                  <Link
                    className="flex min-h-[var(--layout-sidebar-row-height)] w-full items-center gap-2 px-3 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
                    href="/settings"
                  >
                    <NavItemIcon
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0"
                      labelKey="nav.settings"
                      surface="navy"
                    />
                    {t("nav.settings", "Settings")}
                  </Link>
                  <Link
                    className="flex min-h-[var(--layout-sidebar-row-height)] w-full items-center gap-2 px-3 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
                    href="/help"
                  >
                    <NavItemIcon
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0"
                      labelKey="nav.help"
                      surface="navy"
                    />
                    {t("nav.help", "Help centre")}
                  </Link>
                </>
              ) : null}
              <span className="block [&_button]:!h-[var(--layout-sidebar-row-height)] [&_button]:!w-full [&_button]:!justify-start [&_button]:!gap-2 [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:!px-3 [&_button]:!text-xs [&_button]:!font-medium [&_button]:!text-white/80 [&_button]:!shadow-none [&_button:hover]:!bg-white/10 [&_button:hover]:!text-white [&_svg]:!h-3.5 [&_svg]:!w-3.5 [&_svg]:!text-[#e6a0a0]">
                <LogoutButton showIcon />
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
