"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Menu, X } from "lucide-react";

import { UserAvatar } from "../user-avatar";
import { getMobileDrawerNavigationTree } from "../../config/navigation";
import { canAccessManagement, LogoutButton, useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { employeeRoleLabel } from "../../lib/i18n/display-labels";
import { useT } from "../../lib/i18n";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { authUserAvatarName } from "../../lib/user-display";

import { MessagesHeaderButton } from "./messages-header-button";
import { createMobileDrawerState, mobileDrawerReducer } from "./mobile-drawer-state";
import { NavItemIcon } from "./nav-item-icon";
import { NavTree } from "./nav-tree";
import { NotificationBell } from "./notification-bell";

type MobileHeaderProps = {
  activeHref?: string;
};

function mobileDrawerLinkClass(active: boolean): string {
  return cn(
    uiClasses.navDrawerLinkBase,
    "gap-2.5",
    uiClasses.transitionColors,
    active ? uiClasses.navDrawerLinkActive : uiClasses.navDrawerLinkIdle,
  );
}

export function MobileHeader({ activeHref = "/dashboard" }: MobileHeaderProps) {
  const user = useCurrentUser();
  const t = useT();
  const [drawer, dispatch] = useReducer(mobileDrawerReducer, activeHref, createMobileDrawerState);
  const menuOpen = drawer.open;
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const limited = userHasLimitedAccess(user);
  const hasMobileBottomNav = !canAccessManagement(user);

  const closeMenu = useCallback((restoreFocus = true) => {
    dispatch({ type: "close" });
    // The trigger stays mounted, so focus it now rather than waiting for a frame
    // that can be starved while the tab is occluded.
    if (restoreFocus) menuButtonRef.current?.focus();
  }, []);
  const toggleMenu = useCallback(() => dispatch({ type: "toggle" }), []);

  const drawerTree = useMemo(
    () => getMobileDrawerNavigationTree(user.system_role, { limitedAccess: limited }),
    [user.system_role, limited],
  );

  useEffect(() => {
    dispatch({ type: "route", href: activeHref });
  }, [activeHref]);

  useEffect(() => {
    if (!menuOpen) return;
    const onViewportChange = () => dispatch({ type: "viewport", width: window.innerWidth });
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    closeButtonRef.current?.focus();
    const appMain = document.querySelector<HTMLElement>(".timiq-app-main");
    if (appMain) appMain.inert = true;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.tabIndex !== -1);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (appMain) appMain.inert = false;
    };
  }, [menuOpen, closeMenu]);

  const menuLabel = menuOpen ? t("nav.close_menu", "Close menu") : t("nav.menu", "Menu");
  const roleLabel = employeeRoleLabel(t, user.system_role);
  const avatarName = authUserAvatarName(user);

  return (
    <header
      className={cn(
        "timiq-print-hide-chrome sticky top-0 w-full min-w-0 max-w-full overflow-visible pt-[env(safe-area-inset-top,0px)] lg:hidden",
        menuOpen ? "z-[1100]" : "z-30",
        uiClasses.shellTopBar,
      )}
    >
      <div
        className={cn(
          "relative flex min-w-0 max-w-full items-center justify-between gap-1.5 px-2 py-2.5 min-[400px]:gap-3 min-[400px]:px-3",
          menuOpen ? "z-40" : "z-[60]",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className={cn(uiClasses.topBarBrandTitle, "truncate")}>{t("nav.tagline", "TimIQ")}</p>
          <p className={cn(uiClasses.topBarBrandSubtitle, "hidden truncate min-[400px]:block")}>
            {t("nav.tagline_sub", "Payroll & workforce")}
          </p>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-0.5 min-[400px]:gap-1.5">
          {!limited ? (
            <>
              <MessagesHeaderButton activeHref={activeHref} />
              <NotificationBell />
            </>
          ) : null}
          <UserAvatar
            email={user.email}
            name={avatarName}
            sizeClassName="h-8 w-8 min-[400px]:h-9 min-[400px]:w-9"
            userId={user.id}
          />
          <button
            aria-controls="timiq-mobile-menu"
            aria-expanded={menuOpen}
            aria-label={menuLabel}
            className={cn(
              "timiq-touch-target flex h-10 w-10 shrink-0 items-center justify-center p-0",
              uiClasses.topBarChromeButton,
              uiClasses.transitionColors,
              uiClasses.topBarFocusRing,
            )}
            type="button"
            onClick={toggleMenu}
            ref={menuButtonRef}
          >
            <Menu aria-hidden className="h-5 w-5" />
            <span className="sr-only">{menuLabel}</span>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <>
          <button
            aria-label={t("nav.close_menu", "Close menu")}
            className="fixed inset-0 z-50 bg-black/30"
            type="button"
            onClick={() => closeMenu()}
          />
          <div
            className="fixed bottom-0 right-0 top-0 z-[60] flex w-[min(100vw-1.5rem,19rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-l border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[var(--shadow-modal)]"
            id="timiq-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.drawer_nav", "More navigation")}
            ref={drawerRef}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-sheet)] px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
              <div className="min-w-0">
                <p className="truncate text-base font-bold tracking-tight text-[var(--color-text)]">
                  {t("nav.tagline", "TimIQ")}
                </p>
                <p className="truncate text-xs text-[var(--color-text-muted)]">{roleLabel}</p>
              </div>
              <button
                aria-label={t("nav.close_menu", "Close menu")}
                className={cn(
                  "timiq-touch-target flex shrink-0 items-center justify-center p-2",
                  uiClasses.headerIconButton,
                  uiClasses.transitionColors,
                  uiClasses.focusRing,
                )}
                type="button"
                onClick={() => closeMenu()}
                ref={closeButtonRef}
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>

            <nav
              aria-label={t("shell.drawer_nav", "More navigation")}
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain p-2 text-sm [-webkit-overflow-scrolling:touch]"
            >
              {drawerTree.length > 0 ? (
                <NavTree
                  activeHref={activeHref}
                  nodes={drawerTree}
                  role={user.system_role}
                  storageScope="mobile-drawer"
                  variant="drawer"
                  onNavigate={() => closeMenu(false)}
                />
              ) : (
                <p className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
                  {t("nav.drawer_hint_primary", "All primary pages are on the bottom bar.")}
                </p>
              )}
            </nav>

            <div
              className={cn(
                "shrink-0 border-t border-[var(--color-border)] bg-[var(--color-header)] p-2",
                hasMobileBottomNav
                  ? "pb-[max(0.75rem,calc(var(--layout-mobile-bottom-nav-height)+env(safe-area-inset-bottom,0px)))]"
                  : "pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
              )}
            >
              <Link
                className={mobileDrawerLinkClass(activeHref === "/profile")}
                href="/profile"
                onClick={() => closeMenu(false)}
              >
                <NavItemIcon labelKey="nav.profile" />
                <span className="min-w-0 flex-1">{t("nav.profile", "Profile")}</span>
              </Link>
              {!limited ? (
                <Link
                  className={mobileDrawerLinkClass(activeHref === "/settings")}
                  href="/settings"
                  onClick={() => closeMenu(false)}
                >
                  <NavItemIcon labelKey="nav.settings" />
                  <span className="min-w-0 flex-1">{t("nav.settings", "Settings")}</span>
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
