"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";

import { TimIQBrandLockup } from "../brand";
import { getMobileDrawerNavigationTree } from "../../config/navigation";
import { logout, LogoutConfirmDialog, useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { clearAllTimiqOfflineData } from "../../features/offline/db";
import { useI18n, useT } from "../../lib/i18n";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

import { MessagesHeaderButton } from "./messages-header-button";
import { MobileHeaderAvatar } from "./mobile-header-avatar";
import { createMobileDrawerState, mobileDrawerReducer } from "./mobile-drawer-state";
import { NavTree } from "./nav-tree";
import { NotificationBell } from "./notification-bell";

type MobileHeaderProps = {
  activeHref?: string;
};

/** ~104px wide at approved aspect (95–115 target). */
const MOBILE_HEADER_LOGO_HEIGHT = 46;
/** Compact lockup for the fixed drawer chrome. */
const MOBILE_DRAWER_LOGO_HEIGHT = 36;

/** Employee Account / limited Account / admin My workspace. */
const MOBILE_ACCOUNT_SECTION_IDS = ["emp-account", "limited-profile", "mgmt-workspace"];

/** max 300px, always leave ~32px backdrop: min(300px, calc(100vw - 32px)) */
const MOBILE_DRAWER_WIDTH_CLASS = "w-[min(300px,calc(100vw-32px))] max-w-[min(300px,calc(100vw-32px))]";
/** Matches nav-tree DRAWER_PAGE_PAD_X (section pad + icon + gap). */
const MOBILE_DRAWER_CHILD_PAD_X = 45;
const MOBILE_DRAWER_TRANSITION_MS = 220;

type DrawerOpenSource = "menu" | "avatar";

export function MobileHeader({ activeHref = "/dashboard" }: MobileHeaderProps) {
  const user = useCurrentUser();
  const t = useT();
  const { setLocale } = useI18n();
  const router = useRouter();
  const [drawer, dispatch] = useReducer(mobileDrawerReducer, activeHref, createMobileDrawerState);
  const menuOpen = drawer.open;
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const logoutOpenerRef = useRef<HTMLButtonElement | null>(null);
  const openSourceRef = useRef<DrawerOpenSource | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerEntered, setDrawerEntered] = useState(false);
  const [navTreeKey, setNavTreeKey] = useState(0);
  const [forceOpenIds, setForceOpenIds] = useState<string[]>([]);

  const limited = userHasLimitedAccess(user);

  const drawerTree = useMemo(
    () => getMobileDrawerNavigationTree(user.system_role, { limitedAccess: limited }),
    [user.system_role, limited],
  );

  const accountSectionId = useMemo(
    () => drawerTree.find((node) => MOBILE_ACCOUNT_SECTION_IDS.includes(node.id))?.id ?? null,
    [drawerTree],
  );

  const closeMenu = useCallback((restoreFocus = true) => {
    const source = openSourceRef.current;
    dispatch({ type: "close" });
    setForceOpenIds([]);
    openSourceRef.current = null;
    if (restoreFocus) {
      if (source === "avatar") {
        avatarButtonRef.current?.focus();
      } else {
        menuButtonRef.current?.focus();
      }
    }
  }, []);

  const openCollapsedFromMenu = useCallback(() => {
    if (menuOpen) {
      openSourceRef.current = "menu";
      closeMenu();
      return;
    }
    setForceOpenIds([]);
    openSourceRef.current = "menu";
    dispatch({ type: "open" });
  }, [closeMenu, menuOpen]);

  const openAccountFromAvatar = useCallback(() => {
    const accountIds = accountSectionId ? [accountSectionId] : [];
    if (menuOpen && openSourceRef.current === "avatar") {
      closeMenu();
      return;
    }
    setForceOpenIds(accountIds);
    openSourceRef.current = "avatar";
    if (menuOpen) {
      setNavTreeKey((key) => key + 1);
      return;
    }
    dispatch({ type: "open" });
  }, [accountSectionId, closeMenu, menuOpen]);

  useEffect(() => {
    dispatch({ type: "route", href: activeHref });
  }, [activeHref]);

  useEffect(() => {
    if (menuOpen) {
      setDrawerMounted(true);
      const frame = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setDrawerEntered(true));
      });
      return () => window.cancelAnimationFrame(frame);
    }
    setDrawerEntered(false);
    const timer = window.setTimeout(() => {
      setDrawerMounted(false);
      setNavTreeKey((key) => key + 1);
      setForceOpenIds([]);
      openSourceRef.current = null;
    }, MOBILE_DRAWER_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [menuOpen]);

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
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      if (appMain) appMain.inert = false;
    };
  }, [menuOpen, closeMenu]);

  const openLogoutConfirm = useCallback(() => {
    if (isLoggingOut) return;
    setLogoutConfirmOpen(true);
    closeMenu(false);
  }, [closeMenu, isLoggingOut]);

  const closeLogoutConfirm = useCallback(() => {
    if (!isLoggingOut) {
      setLogoutConfirmOpen(false);
    }
  }, [isLoggingOut]);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      await clearAllTimiqOfflineData();
      setLocale("en-GB");
      router.replace("/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
      setLogoutConfirmOpen(false);
    }
  }, [router, setLocale]);

  const logoutLabel = isLoggingOut
    ? t("common.logging_out", "Logging out...")
    : t("common.logout", "Logout");

  const logoutRow = (
    <button
      ref={logoutOpenerRef}
      aria-label={logoutLabel}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2.5 border-l-[3px] border-transparent pr-3.5 text-left",
        "min-h-11 bg-white font-normal text-[var(--color-danger-700)]",
        "hover:bg-[var(--color-sidebar-page-hover)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black/35",
        "disabled:pointer-events-none disabled:opacity-60",
      )}
      data-testid="timiq-mobile-drawer-logout"
      disabled={isLoggingOut}
      style={{ paddingLeft: MOBILE_DRAWER_CHILD_PAD_X, fontSize: 14 }}
      type="button"
      onClick={openLogoutConfirm}
    >
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <LogOut aria-hidden className="h-[17px] w-[17px] shrink-0 text-[var(--color-danger-700)]" />
      </span>
      <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{logoutLabel}</span>
    </button>
  );

  const menuLabel = menuOpen ? t("nav.close_menu", "Close menu") : t("nav.menu", "Menu");

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
          <TimIQBrandLockup
            className="max-w-[min(100%,115px)]"
            markSize={MOBILE_HEADER_LOGO_HEIGHT}
            surface="onDark"
            variant="full"
          />
        </div>

        <div
          className="flex min-w-0 shrink-0 items-center gap-1.5 min-[400px]:gap-2"
          data-testid="timiq-mobile-header-actions"
        >
          {!limited ? (
            <>
              <MessagesHeaderButton activeHref={activeHref} />
              <NotificationBell />
            </>
          ) : null}
          <MobileHeaderAvatar
            buttonRef={avatarButtonRef}
            user={user}
            onOpenAccount={openAccountFromAvatar}
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
            data-testid="timiq-mobile-header-menu"
            type="button"
            onClick={openCollapsedFromMenu}
            ref={menuButtonRef}
          >
            <Menu aria-hidden className="h-5 w-5" />
            <span className="sr-only">{menuLabel}</span>
          </button>
        </div>
      </div>

      {drawerMounted ? (
        <>
          <button
            aria-label={t("nav.close_menu", "Close menu")}
            className={cn(
              "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ease-out motion-reduce:transition-none",
              drawerEntered ? "opacity-100" : "opacity-0",
            )}
            data-testid="timiq-mobile-drawer-backdrop"
            type="button"
            onClick={() => closeMenu()}
          />
          <div
            className={cn(
              "fixed bottom-0 right-0 top-0 z-[60] flex flex-col overflow-hidden overscroll-contain border-l border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[var(--shadow-modal)] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
              MOBILE_DRAWER_WIDTH_CLASS,
              "transform-gpu transition-transform duration-200 ease-out motion-reduce:transition-none",
              drawerEntered ? "translate-x-0" : "translate-x-full",
            )}
            id="timiq-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.drawer_nav", "More navigation")}
            data-testid="timiq-mobile-drawer"
            data-account-expanded={forceOpenIds.length > 0 ? "true" : "false"}
            ref={drawerRef}
          >
            <div className="timiq-mobile-drawer-header shrink-0 border-b border-[var(--color-border)] bg-[var(--color-sheet)] pt-[env(safe-area-inset-top,0px)]">
              <div className="flex min-h-14 items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <TimIQBrandLockup
                    className="max-w-[min(100%,112px)]"
                    markSize={MOBILE_DRAWER_LOGO_HEIGHT}
                    variant="full"
                  />
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

            <nav
              aria-label={t("shell.drawer_nav", "More navigation")}
              className="timiq-mobile-drawer-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-1.5 py-1 [-webkit-overflow-scrolling:touch]"
            >
              {drawerTree.length > 0 ? (
                <NavTree
                  key={navTreeKey}
                  accountSectionExtras={accountSectionId ? logoutRow : undefined}
                  accountSectionIds={accountSectionId ? [accountSectionId] : MOBILE_ACCOUNT_SECTION_IDS}
                  activeHref={activeHref}
                  expansion={{ mode: "section-accordion", persist: false, autoExpandActive: false }}
                  forceOpenIds={forceOpenIds}
                  nodes={drawerTree}
                  role={user.system_role}
                  scrollActiveIntoView={false}
                  storageScope="mobile-drawer"
                  variant="drawer"
                  onNavigate={() => closeMenu(false)}
                />
              ) : (
                <p className="px-2 py-2 text-sm text-black/70">
                  {t("nav.drawer_hint_primary", "All primary pages are on the bottom bar.")}
                </p>
              )}
            </nav>
          </div>
        </>
      ) : null}

      <LogoutConfirmDialog
        isLoggingOut={isLoggingOut}
        open={logoutConfirmOpen}
        returnFocusRef={logoutOpenerRef}
        onCancel={closeLogoutConfirm}
        onConfirm={() => void handleLogout()}
      />
    </header>
  );
}
