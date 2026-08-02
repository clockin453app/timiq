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
import { LogoutButton, formatAuthUserDisplayName, useCurrentUser } from "../../features/auth";
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

type AccountNavLink = {
  href: "/profile" | "/settings" | "/help";
  labelKey: "nav.profile" | "nav.settings" | "nav.help";
  fallback: string;
};

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

  const accountNavLinks = useMemo((): AccountNavLink[] => {
    const links: AccountNavLink[] = [
      { href: "/profile", labelKey: "nav.profile", fallback: "Profile" },
    ];
    if (!limited) {
      links.push(
        { href: "/settings", labelKey: "nav.settings", fallback: "Settings" },
        { href: "/help", labelKey: "nav.help", fallback: "Help centre" },
      );
    }
    return links;
  }, [limited]);

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

  const displayName = useMemo(() => formatAuthUserDisplayName(user), [user]);
  const showEmailSecondary = displayName !== user.email;

  return (
    <aside
      className="timiq-print-hide-chrome timiq-desktop-sidebar hidden min-h-0 shrink-0 flex-col overflow-hidden border-r border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-bg)] text-[var(--color-sidebar-fg)] transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex"
      data-testid="desktop-sidebar"
      style={{ width: resolvedWidth }}
    >
      {collapsed ? (
        <nav
          aria-label={t("shell.sidebar_section", "Navigation")}
          className="timiq-sidebar-scrollbar flex min-h-0 flex-1 flex-col items-center overflow-y-auto overflow-x-hidden overscroll-y-contain py-1 pb-3 [-webkit-overflow-scrolling:touch]"
          data-testid="desktop-sidebar-nav-scroll"
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
          <div
            aria-label={t("shell.account_links", "Account")}
            className="mt-1 flex w-full flex-col items-center border-t border-white/10 pt-1"
            data-testid="desktop-sidebar-account-nav"
          >
            {accountNavLinks.map((link) => {
              const label = t(link.labelKey, link.fallback);
              const active = activeHref === link.href || activeHref.startsWith(`${link.href}/`);
              return (
                <Link
                  className={`${railLink} ${active ? "border-l-white/80 bg-[var(--color-sidebar-active)] text-white" : ""}`}
                  href={link.href}
                  key={link.href}
                  title={label}
                >
                  <NavItemIcon aria-hidden className="h-3.5 w-3.5" labelKey={link.labelKey} surface="navy" />
                  <span className="sr-only">{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : (
        <nav
          aria-label={t("shell.sidebar_section", "Navigation")}
          className="timiq-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain py-1 pb-4 [-webkit-overflow-scrolling:touch]"
          data-testid="desktop-sidebar-nav-scroll"
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

      <div
        className="shrink-0 border-t border-white/15 bg-[#142950]"
        data-testid="desktop-sidebar-account-footer"
      >
        {collapsed ? (
          <div className="flex flex-col items-center py-1">
            <span
              className="block w-full [&_button]:!h-8 [&_button]:!w-full [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!border-l-2 [&_button]:!border-l-transparent [&_button]:!bg-transparent [&_button]:!p-0 [&_button]:!text-white/80 [&_button]:!shadow-none [&_button:hover]:!bg-[var(--color-sidebar-active)] [&_button:hover]:!text-white [&_svg]:!h-3.5 [&_svg]:!w-3.5 [&_svg]:!text-[#e6a0a0]"
              title={displayName}
            >
              <LogoutButton iconOnly />
            </span>
          </div>
        ) : (
          <div className="space-y-1 px-2.5 py-1.5 text-xs leading-tight">
            <div className="min-w-0">
              <p
                className="truncate text-[12px] font-semibold leading-tight text-white"
                title={user.email}
              >
                {displayName}
              </p>
              {showEmailSecondary ? (
                <p className="mt-px truncate text-[10px] leading-tight text-white/45" title={user.email}>
                  {user.email}
                </p>
              ) : null}
              <p className="mt-px text-[9px] font-medium uppercase tracking-wide text-white/50">
                {user.system_role}
              </p>
            </div>
            <span className="block [&_button]:!h-8 [&_button]:!min-h-8 [&_button]:!w-full [&_button]:!justify-start [&_button]:!gap-1.5 [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:!px-0 [&_button]:!py-0 [&_button]:!text-[11px] [&_button]:!font-medium [&_button]:!leading-tight [&_button]:!text-white/80 [&_button]:!shadow-none [&_button:hover]:!bg-transparent [&_button:hover]:!text-white [&_svg]:!h-3.5 [&_svg]:!w-3.5 [&_svg]:!text-[#e6a0a0]">
              <LogoutButton showIcon />
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
