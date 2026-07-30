"use client";

import Link from "next/link";
import { CircleHelp, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { UserAvatar } from "../user-avatar";
import { getDefaultLandingPath } from "../../config/navigation";
import { formatSystemRole, LogoutButton, useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { useT } from "../../lib/i18n";
import { authUserAvatarName, formatAuthUserDisplayName } from "../../lib/user-display";

import { useDesktopSidebarState } from "./desktop-sidebar-state";
import { MessagesHeaderButton } from "./messages-header-button";
import { NavItemIcon } from "./nav-item-icon";
import { NotificationBell } from "./notification-bell";

type DesktopTopBarProps = {
  activeHref?: string;
};

function roleLabelKey(role: string): string {
  switch (role) {
    case "administrator":
      return "shell.role.administrator";
    case "admin":
      return "shell.role.admin";
    case "employee":
      return "shell.role.employee";
    default:
      return "shell.role.unknown";
  }
}

export function DesktopTopBar({ activeHref = "/dashboard" }: DesktopTopBarProps) {
  const user = useCurrentUser();
  const limited = userHasLimitedAccess(user);
  const t = useT();
  const displayName = formatAuthUserDisplayName(user);
  const avatarName = authUserAvatarName(user);
  const showNameInDropdown = Boolean(avatarName);
  const { collapsed, hydrated, toggleCollapsed } = useDesktopSidebarState();
  const resolvedCollapsed = hydrated ? collapsed : null;
  const brandWidth =
    resolvedCollapsed === null
      ? "var(--layout-sidebar-responsive-default)"
      : resolvedCollapsed
        ? "var(--layout-sidebar-collapsed)"
        : "var(--layout-sidebar-width)";

  return (
    <header
      className={cn(
        "timiq-print-hide-chrome z-40 hidden min-h-[var(--layout-topbar-height)] w-full min-w-0 shrink-0 overflow-visible lg:flex",
        "[--color-topbar-bg:var(--color-utilitybar-bg)] [--color-topbar-border:var(--color-utilitybar-border)]",
        "[--color-topbar-fg:var(--color-utilitybar-fg)] [--color-topbar-fg-muted:var(--color-utilitybar-fg-muted)] [--color-topbar-fg-subtle:var(--color-utilitybar-fg-muted)]",
        "[--color-topbar-hover-bg:var(--color-utilitybar-hover)] [--color-topbar-hover-border:var(--color-utilitybar-border-strong)]",
        "[--color-topbar-active-bg:var(--color-utilitybar-hover)] [--color-topbar-active-fg:var(--color-utilitybar-fg)] [--color-topbar-active-border:var(--color-utilitybar-border-strong)]",
        "[--color-topbar-chrome-btn-bg:#fff] [--color-topbar-chrome-btn-border:var(--color-utilitybar-border)] [--color-topbar-chrome-btn-hover:var(--color-utilitybar-hover)] [--color-topbar-chrome-btn-fg:var(--color-utilitybar-fg)]",
        "[--focus-ring-topbar:0_0_0_3px_rgba(25,47,96,0.22)]",
        uiClasses.shellTopBar,
        "shadow-[0_1px_2px_rgba(15,47,87,0.08)]",
      )}
    >
      <div className="flex min-h-[var(--layout-topbar-height)] w-full min-w-0 items-center">
        <div
          className={cn(
            "flex min-h-[var(--layout-topbar-height)] shrink-0 items-center border-l-[3px] border-l-[var(--color-sidebar-active)] border-r border-r-[var(--color-utilitybar-border-strong)] transition-[width,padding] duration-200 ease-out motion-reduce:transition-none",
            resolvedCollapsed !== false ? "justify-between gap-0 px-1" : "gap-2 px-3",
          )}
          style={{ width: brandWidth }}
        >
          <Link
            aria-label={t("nav.tagline", "TimIQ")}
            className={cn(
              "min-w-0 no-underline",
              resolvedCollapsed !== false
                ? "flex h-9 w-6 shrink-0 items-center justify-center text-sm font-bold text-[var(--color-utilitybar-fg)]"
                : "flex-1",
            )}
            href={getDefaultLandingPath(user.system_role, { limitedAccess: limited })}
            title={t("nav.tagline", "TimIQ")}
          >
            {resolvedCollapsed !== false ? (
              <span aria-hidden>T</span>
            ) : (
              <span>
                <span className={cn(uiClasses.topBarBrandTitle, "block text-[15px] text-[var(--color-utilitybar-fg)]")}>
                  {t("nav.tagline", "TimIQ")}
                </span>
                <span className={cn(uiClasses.topBarBrandSubtitle, "block text-[11px] text-[var(--color-utilitybar-fg-muted)]")}>
                  {t("nav.tagline_sub", "Payroll & workforce")}
                </span>
              </span>
            )}
          </Link>
          <button
            aria-expanded={resolvedCollapsed === false}
            aria-label={
              resolvedCollapsed !== false
                ? t("shell.expand_nav", "Expand navigation")
                : t("shell.collapse_nav", "Collapse navigation")
            }
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--color-utilitybar-border)] bg-white text-[var(--color-utilitybar-fg)] hover:bg-[var(--color-utilitybar-hover)]",
              uiClasses.transitionColors,
              uiClasses.focusRing,
            )}
            onClick={toggleCollapsed}
            title={
              resolvedCollapsed !== false
                ? t("shell.expand_nav", "Expand navigation")
                : t("shell.collapse_nav", "Collapse navigation")
            }
            type="button"
          >
            {resolvedCollapsed !== false ? (
              <PanelLeftOpen aria-hidden className="h-4 w-4" />
            ) : (
              <PanelLeftClose aria-hidden className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 px-2 sm:gap-1.5 sm:px-4">
          <Link
            aria-label={t("nav.help", "Help centre")}
            className={uiClasses.topBarIconButton}
            href="/help"
            title={t("nav.help", "Help centre")}
          >
            <CircleHelp aria-hidden className="h-4 w-4" />
          </Link>
          {!limited ? <MessagesHeaderButton activeHref={activeHref} /> : null}
          {!limited ? <NotificationBell /> : null}
          <UserAvatar
            email={user.email}
            name={avatarName}
            sizeClassName="h-9 w-9"
            userId={user.id}
          />

          <details className="relative shrink-0">
            <summary
              aria-label={t("shell.account_menu", "Account menu")}
              className={cn(
                "timiq-touch-target list-none [&::-webkit-details-marker]:hidden",
                uiClasses.topBarFocusRing,
              )}
            >
              <span
                className={cn(
                  "inline-flex h-10 max-w-[13rem] cursor-pointer items-center px-3",
                  uiClasses.topBarChromeButton,
                  uiClasses.transitionColors,
                )}
                title={displayName}
              >
                <span className="min-w-0 truncate text-xs font-semibold">{displayName}</span>
              </span>
            </summary>
            <div
              className={cn(
                "absolute right-0 z-[60] mt-1.5 w-[17.5rem] max-w-[calc(100vw-1rem)]",
                "max-h-[min(80dvh,calc(100dvh-var(--layout-topbar-height)-1rem))] overflow-y-auto overscroll-contain",
                uiClasses.topBarDropdownPanel,
              )}
            >
              {showNameInDropdown ? (
                <p className="truncate px-3 pt-2 text-sm font-semibold" title={displayName}>
                  {displayName}
                </p>
              ) : null}
              <p
                className={cn(
                  "truncate px-3 text-xs text-[var(--color-topbar-fg-subtle)]",
                  showNameInDropdown ? "pb-2 pt-1" : "py-2",
                )}
                title={user.email}
              >
                {user.email}
              </p>
              <p className="px-3 pb-2">
                <span className="inline-flex max-w-full truncate rounded border border-[var(--color-topbar-hover-border)] bg-[var(--color-topbar-hover-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  {t(roleLabelKey(user.system_role), formatSystemRole(user.system_role))}
                </span>
              </p>
              <Link className={uiClasses.topBarDropdownItem} href="/profile" role="menuitem">
                <NavItemIcon labelKey="nav.profile" />
                <span>{t("nav.profile", "Profile")}</span>
              </Link>
              {!limited ? (
                <Link className={uiClasses.topBarDropdownItem} href="/settings" role="menuitem">
                  <NavItemIcon labelKey="nav.settings" />
                  <span>{t("nav.settings", "Settings")}</span>
                </Link>
              ) : null}
              <div className="border-t border-[var(--color-topbar-hover-border)] px-2 py-2">
                <LogoutButton className="w-full" />
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
