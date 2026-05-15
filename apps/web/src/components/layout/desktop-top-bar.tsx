"use client";

import Link from "next/link";

import { getDefaultLandingPath } from "../../config/navigation";
import { formatSystemRole, LogoutButton, useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { useT } from "../../lib/i18n";

import { DesktopTopNav } from "./desktop-top-nav";
import { MessagesHeaderButton } from "./messages-header-button";
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
    <header className="timiq-print-hide-chrome sticky top-0 z-40 hidden min-h-[var(--layout-topbar-height)] w-full min-w-0 shrink-0 flex-col overflow-visible border-b border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_1px_0_rgba(15,23,42,0.04)] xl:flex">
      <div className="flex min-h-[var(--layout-topbar-height)] w-full min-w-0 items-center px-4">
        <div className="flex w-[var(--layout-topbar-brand-width)] min-w-[9.5rem] max-w-[11.25rem] shrink-0 flex-col justify-center">
          <Link
            className="min-w-0 no-underline"
            href={getDefaultLandingPath(user.system_role, { limitedAccess: limited })}
          >
            <p className="text-base font-bold tracking-tight text-[var(--color-text)]">{t("nav.tagline", "TimIQ")}</p>
            <p className="hidden text-[11px] leading-tight text-[var(--color-text-muted)] sm:block">
              {t("nav.tagline_sub", "Payroll & workforce")}
            </p>
          </Link>
        </div>

        <div
          aria-hidden
          className="mx-4 h-[var(--layout-topbar-divider-height)] shrink-0 self-center border-l border-[var(--color-border)] xl:mx-5 2xl:mx-6"
          role="presentation"
        />

        <DesktopTopNav activeHref={activeHref} />

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!limited ? <MessagesHeaderButton activeHref={activeHref} /> : null}
          {!limited ? <NotificationBell /> : null}

          <details className="relative shrink-0">
            <summary
              aria-label={t("shell.account_menu", "Account menu")}
              className="timiq-touch-target list-none [&::-webkit-details-marker]:hidden"
            >
              <span
                className="inline-flex h-9 max-w-[10rem] cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-2.5 text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)] sm:max-w-[14rem]"
                title={t("shell.account_menu", "Account menu")}
              >
                <span className="min-w-0 truncate text-xs font-medium" title={user.email}>
                  {user.email}
                </span>
              </span>
            </summary>
            <div className="absolute right-0 z-[60] mt-1 w-60 max-w-[calc(100vw-1rem)] rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] py-1 shadow-[0_10px_28px_rgba(15,23,42,0.16)]">
              <p className="truncate px-3 py-2 text-xs text-[var(--color-text-muted)]" title={user.email}>
                {user.email}
              </p>
              <p className="px-3 pb-2">
                <span className="inline-flex max-w-full truncate rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                  {t(roleLabelKey(user.system_role), formatSystemRole(user.system_role))}
                </span>
              </p>
              <Link
                className="block px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-cell)]"
                href="/profile"
              >
                {t("nav.profile", "Profile")}
              </Link>
              {!limited ? (
                <Link
                  className="block px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-cell)]"
                  href="/settings"
                >
                  {t("nav.settings", "Settings")}
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
