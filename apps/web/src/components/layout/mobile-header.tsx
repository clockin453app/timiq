"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Menu, X } from "lucide-react";

import { TimIQBrandLockup } from "../brand";
import { UserAvatar } from "../user-avatar";
import {
  getMobileDrawerNavigationTree,
  omitMobileDrawerFooterLeaves,
} from "../../config/navigation";
import { LogoutButton, useCurrentUser } from "../../features/auth";
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

/** ~104px wide at approved aspect (95–115 target). */
const MOBILE_HEADER_LOGO_HEIGHT = 46;

function mobileDrawerLinkClass(active: boolean): string {
  return cn(
    uiClasses.navDrawerLinkBase,
    "min-h-10 gap-2",
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
  const showAccountExtras = !limited;

  const closeMenu = useCallback((restoreFocus = true) => {
    dispatch({ type: "close" });
    if (restoreFocus) menuButtonRef.current?.focus();
  }, []);
  const toggleMenu = useCallback(() => dispatch({ type: "toggle" }), []);

  const drawerTree = useMemo(
    () =>
      omitMobileDrawerFooterLeaves(
        getMobileDrawerNavigationTree(user.system_role, { limitedAccess: limited }),
      ),
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
          "relative flex min-h-14 min-w-0 max-w-full items-center justify-between gap-1.5 px-2 py-2 min-[400px]:gap-3 min-[400px]:px-3",
          menuOpen ? "z-40" : "z-[60]",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {/* Light plate keeps approved dark “Tim” readable on navy without recolouriing the asset. */}
          <TimIQBrandLockup
            className="max-w-[min(100%,115px)]"
            markSize={MOBILE_HEADER_LOGO_HEIGHT}
            surface="onDark"
            variant="full"
          />
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-0.5 min-[400px]:gap-1.5">
          {!limited ? (
            <>
              <MessagesHeaderButton activeHref={activeHref} />
              <NotificationBell />
            </>
          ) : null}
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
            className="fixed bottom-0 right-0 top-0 z-[60] flex w-[min(92vw,360px)] min-w-[min(100%,300px)] max-w-[min(92vw,360px)] flex-col overflow-hidden border-l border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[var(--shadow-modal)]"
            id="timiq-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.drawer_nav", "More navigation")}
            ref={drawerRef}
          >
            {/* Fixed account header only — no logo */}
            <div className="timiq-mobile-drawer-header shrink-0 border-b border-[var(--color-border)] bg-[var(--color-sheet)] pt-[env(safe-area-inset-top,0px)]">
              <div className="flex h-14 items-center gap-2 px-3">
                <UserAvatar
                  email={user.email}
                  name={avatarName}
                  sizeClassName="h-9 w-9"
                  userId={user.id}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13px] font-medium leading-tight text-[var(--color-text)]"
                    title={user.email}
                  >
                    {user.email}
                  </p>
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {roleLabel}
                  </p>
                </div>
                <button
                  aria-label={t("nav.close_menu", "Close menu")}
                  className={cn(
                    "timiq-touch-target flex h-11 w-11 shrink-0 items-center justify-center",
                    uiClasses.headerIconButton,
                    uiClasses.transitionColors,
                    uiClasses.focusRing,
                  )}
                  type="button"
                  onClick={() => closeMenu()}
                  ref={closeButtonRef}
                >
                  <X aria-hidden className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            {/* Single scrollable menu: nav tree + account actions */}
            <nav
              aria-label={t("shell.drawer_nav", "More navigation")}
              className="timiq-mobile-drawer-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-2 py-1 text-[length:var(--text-nav-row)] [-webkit-overflow-scrolling:touch] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]"
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

              <div className="mt-1 border-t border-[var(--color-border)] pt-1" role="group" aria-label={t("nav.group.account", "Account")}>
                <Link
                  className={mobileDrawerLinkClass(activeHref === "/profile")}
                  href="/profile"
                  onClick={() => closeMenu(false)}
                >
                  <NavItemIcon className="h-3.5 w-3.5 shrink-0" labelKey="nav.profile" />
                  <span className="min-w-0 flex-1 truncate">{t("nav.profile", "Profile")}</span>
                </Link>
                {showAccountExtras ? (
                  <Link
                    className={mobileDrawerLinkClass(activeHref === "/settings")}
                    href="/settings"
                    onClick={() => closeMenu(false)}
                  >
                    <NavItemIcon className="h-3.5 w-3.5 shrink-0" labelKey="nav.settings" />
                    <span className="min-w-0 flex-1 truncate">{t("nav.settings", "Settings")}</span>
                  </Link>
                ) : null}
                {showAccountExtras ? (
                  <Link
                    className={mobileDrawerLinkClass(activeHref === "/help")}
                    href="/help"
                    onClick={() => closeMenu(false)}
                  >
                    <NavItemIcon className="h-3.5 w-3.5 shrink-0" labelKey="nav.help" />
                    <span className="min-w-0 flex-1 truncate">{t("nav.help", "Help centre")}</span>
                  </Link>
                ) : null}
                <LogoutButton appearance="menuRow" className="min-h-10" />
              </div>
            </nav>
          </div>
        </>
      ) : null}
    </header>
  );
}
