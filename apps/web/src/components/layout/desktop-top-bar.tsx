"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Building2, Clock, MessageSquare, UserRound } from "lucide-react";

import { formatSystemRole, LogoutButton, useCurrentUser } from "../../features/auth";
import { useT } from "../../lib/i18n";

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
  const t = useT();

  const displayName = useMemo(() => {
    const fn = user.profile_first_name?.trim();
    const ln = user.profile_last_name?.trim();
    if (fn || ln) {
      return [fn, ln].filter(Boolean).join(" ");
    }
    return user.email;
  }, [user.email, user.profile_first_name, user.profile_last_name]);

  const quickBtn = (href: string, labelKey: string, fallback: string, Icon: typeof Clock) => {
    const active =
      href === "/dashboard"
        ? activeHref === "/dashboard"
        : activeHref === href || activeHref.startsWith(`${href}/`);
    const label = t(labelKey, fallback);
    return (
      <Link
        aria-label={label}
        className={[
          "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition-colors",
          active
            ? "border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] text-[var(--color-text)]"
            : "border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-btn-default-hover)]",
        ].join(" ")}
        href={href}
        title={label}
      >
        <Icon aria-hidden className="h-5 w-5" />
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-20 hidden h-[var(--layout-topbar-height)] w-full min-w-0 shrink-0 items-center gap-4 border-b border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] xl:flex">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link className="shrink-0 no-underline" href="/dashboard">
          <p className="text-base font-bold tracking-tight text-[var(--color-text)]">{t("nav.tagline", "TimIQ")}</p>
          <p className="hidden text-xs text-[var(--color-text-muted)] sm:block">{t("nav.tagline_sub", "Payroll & workforce")}</p>
        </Link>

        <div className="hidden min-w-0 flex-1 md:block">
          <p className="truncate text-sm font-medium text-[var(--color-text)]" title={user.email}>
            {displayName}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex max-w-full truncate rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              {t(roleLabelKey(user.system_role), formatSystemRole(user.system_role))}
            </span>
            {user.company_id ? (
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                {t("shell.company_workspace", "Company workspace")}
              </span>
            ) : (
              <span className="text-[10px] text-[var(--color-text-muted)]">{t("shell.no_company", "No company linked")}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {quickBtn("/clock", "nav.clock", "Clock In / Out", Clock)}
        {quickBtn("/site-progress", "nav.site_progress", "Site Progress", Building2)}
        {quickBtn("/messages", "nav.messages", "Messages", MessageSquare)}

        <details className="relative shrink-0">
          <summary
            aria-label={t("shell.account_menu", "Account menu")}
            className="timiq-touch-target list-none [&::-webkit-details-marker]:hidden"
          >
            <span
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
              title={t("shell.account_menu", "Account menu")}
            >
              <UserRound aria-hidden className="h-5 w-5" />
            </span>
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] py-1 shadow-[0_4px_16px_rgba(15,23,42,0.12)]">
            <p className="truncate px-3 py-2 text-xs text-[var(--color-text-muted)]" title={user.email}>
              {user.email}
            </p>
            <Link
              className="block px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-cell)]"
              href="/profile"
            >
              {t("nav.profile", "Profile")}
            </Link>
            <Link
              className="block px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-cell)]"
              href="/settings"
            >
              {t("nav.settings", "Settings")}
            </Link>
            <div className="border-t border-[var(--color-border)] px-2 py-2">
              <LogoutButton className="w-full" />
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
