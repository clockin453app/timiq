"use client";

import Link from "next/link";

import { UserAvatar } from "../user-avatar";
import { getDefaultLandingPath } from "../../config/navigation";
import { formatSystemRole, LogoutButton, useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { useT } from "../../lib/i18n";

import { DesktopTopNav } from "./desktop-top-nav";
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

  return (
    <header
      className={cn(
        "timiq-print-hide-chrome sticky top-0 z-40 hidden min-h-[var(--layout-topbar-height)] w-full min-w-0 shrink-0 flex-col overflow-visible xl:flex",
        uiClasses.shellTopBar,
      )}
    >
      <div className="flex min-h-[var(--layout-topbar-height)] w-full min-w-0 items-center pr-4">
        <div className="flex min-h-[var(--layout-topbar-height)] w-[var(--layout-topbar-brand-width)] min-w-[9.5rem] max-w-[11.25rem] shrink-0 flex-col justify-center border-l-[3px] border-white/30 px-4">
          <Link
            className="min-w-0 no-underline"
            href={getDefaultLandingPath(user.system_role, { limitedAccess: limited })}
          >
            <p className={uiClasses.topBarBrandTitle}>{t("nav.tagline", "TimIQ")}</p>
            <p className={cn(uiClasses.topBarBrandSubtitle, "hidden sm:block")}>
              {t("nav.tagline_sub", "Payroll & workforce")}
            </p>
          </Link>
        </div>

        <div
          className="h-[var(--layout-topbar-divider-height)] shrink-0 border-l border-white/20"
          aria-hidden
          role="presentation"
        />
        <div className="w-4 shrink-0 xl:w-5 2xl:w-6" aria-hidden role="presentation" />
        <DesktopTopNav activeHref={activeHref} />

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!limited ? <MessagesHeaderButton activeHref={activeHref} /> : null}
          {!limited ? <NotificationBell /> : null}
          <UserAvatar
            email={user.email}
            name={[user.profile_first_name, user.profile_last_name].filter(Boolean).join(" ")}
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
                  "inline-flex h-9 max-w-[10rem] cursor-pointer items-center gap-2 px-2.5 sm:max-w-[14rem]",
                  uiClasses.topBarChromeButton,
                  uiClasses.transitionColors,
                )}
                title={t("shell.account_menu", "Account menu")}
              >
                <span
                  className="min-w-0 truncate text-xs font-semibold text-[var(--color-topbar-chrome-btn-fg)]"
                  title={user.email}
                >
                  {user.email}
                </span>
              </span>
            </summary>
            <div
              className={cn(
                "absolute right-0 z-[60] mt-1.5 w-60 max-w-[calc(100vw-1rem)]",
                uiClasses.navDropdownPanel,
              )}
            >
              <p className="truncate px-3 py-2 text-xs text-[var(--color-text-muted)]" title={user.email}>
                {user.email}
              </p>
              <p className="px-3 pb-2">
                <span className="inline-flex max-w-full truncate rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-header)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                  {t(roleLabelKey(user.system_role), formatSystemRole(user.system_role))}
                </span>
              </p>
              <Link
                className={cn(uiClasses.navDropdownItem, uiClasses.transitionColors)}
                href="/profile"
                role="menuitem"
              >
                <NavItemIcon labelKey="nav.profile" />
                <span className="min-w-0 flex-1">{t("nav.profile", "Profile")}</span>
              </Link>
              {!limited ? (
                <Link
                  className={cn(uiClasses.navDropdownItem, uiClasses.transitionColors)}
                  href="/settings"
                  role="menuitem"
                >
                  <NavItemIcon labelKey="nav.settings" />
                  <span className="min-w-0 flex-1">{t("nav.settings", "Settings")}</span>
                </Link>
              ) : null}
              <div className="border-t border-[var(--color-border)] px-2 py-2">
                <LogoutButton className="w-full" />
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
