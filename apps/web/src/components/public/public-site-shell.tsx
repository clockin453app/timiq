"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

import { PUBLIC_BRAND, PUBLIC_NAV } from "./public-copy";

type PublicSiteShellProps = {
  children: ReactNode;
  activePath?: string;
  variant?: "marketing" | "login";
};

function navLinkClass(isActive: boolean): string {
  return cn(
    uiClasses.transitionColors,
    uiClasses.topBarFocusRing,
    isActive ? uiClasses.publicNavLinkActive : uiClasses.publicNavLink,
  );
}

export function PublicSiteShell({ children, activePath, variant = "marketing" }: PublicSiteShellProps) {
  const pathname = usePathname();
  const current = activePath ?? pathname;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={cn(uiClasses.publicPage, "timiq-public-page")}>
      <header className={cn(uiClasses.shellTopBar, "sticky top-0 z-40 shrink-0")}>
        <div className="mx-auto flex min-h-[var(--layout-topbar-height)] w-full min-w-0 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link className="min-w-0 no-underline" href="/product">
            <p className={uiClasses.topBarBrandTitle}>{PUBLIC_BRAND.name}</p>
            <p className={cn(uiClasses.topBarBrandSubtitle, "hidden sm:block")}>{PUBLIC_BRAND.tagline}</p>
          </Link>

          <nav aria-label="Public" className="hidden items-center gap-1 md:flex">
            {PUBLIC_NAV.map((item) => (
              <Link className={navLinkClass(current === item.href)} href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
            <Link
              className={cn(
                uiClasses.topBarChromeButton,
                "ml-2 min-h-[36px] px-3 text-sm font-semibold no-underline",
                current === "/login" && "ring-2 ring-white/30",
              )}
              href="/login"
            >
              Sign in
            </Link>
          </nav>

          <button
            aria-controls="timiq-public-mobile-nav"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center md:hidden",
              uiClasses.topBarChromeButton,
              uiClasses.topBarFocusRing,
            )}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen ? (
          <nav
            className="border-t border-[var(--color-topbar-hover-border)] px-4 py-3 md:hidden"
            id="timiq-public-mobile-nav"
          >
            <ul className="flex flex-col gap-1">
              {PUBLIC_NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    className={cn(navLinkClass(current === item.href), "block")}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  className={cn(
                    uiClasses.topBarChromeButton,
                    "mt-1 flex min-h-[44px] w-full items-center justify-center text-sm font-semibold no-underline",
                  )}
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                >
                  Sign in
                </Link>
              </li>
            </ul>
          </nav>
        ) : null}
      </header>

      <main className="timiq-public-page-content w-full min-w-0 flex-1">
        {children}
      </main>

      <footer className="shrink-0 border-t border-[var(--color-topbar-border)] bg-[var(--color-topbar-bg)] text-[var(--color-public-on-dark-soft)]">
        <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-3 px-4 py-6 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:text-sm">
          <p className="min-w-0 text-[var(--color-public-on-dark-muted)]">
            © {new Date().getFullYear()} {PUBLIC_BRAND.name}. Built for UK payroll and workforce operations.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {PUBLIC_NAV.map((item) => (
              <Link
                className="text-[var(--color-public-on-dark-muted)] underline-offset-2 hover:text-[var(--color-public-on-dark-fg)] hover:underline"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
            <Link
              className="text-[var(--color-public-on-dark-muted)] underline-offset-2 hover:text-[var(--color-public-on-dark-fg)] hover:underline"
              href="/login"
            >
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
