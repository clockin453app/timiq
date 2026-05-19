"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { getDesktopTopNavigationGroups, type NavigationGroupDefinition } from "../../config/navigation";
import type { NotificationSummary } from "../../features/notifications/api";
import { navBadgesFromSummary } from "../../features/notifications/nav-badges";
import { useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { useT } from "../../lib/i18n";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

import { groupContainsActiveRoute, navItemMatchesActive } from "./grouped-nav";
import { NavDropdownPortal, navDropdownMenuContains } from "./nav-dropdown-portal";
import { NavGroupIcon, NavItemIcon } from "./nav-item-icon";

type DesktopTopNavProps = {
  activeHref: string;
};

type OpenMenuState = {
  id: string;
  anchor: HTMLButtonElement;
} | null;

function NavGroupTrigger(props: {
  groupId: string;
  groupLabel: string;
  isOpen: boolean;
  isChildActive: boolean;
  onFocusSwitch: (anchor: HTMLButtonElement) => void;
  onHoverSwitch: (anchor: HTMLButtonElement) => void;
  onToggle: (anchor: HTMLButtonElement) => void;
}) {
  return (
    <button
      aria-controls={`timiq-nav-menu-${props.groupId}`}
      aria-expanded={props.isOpen}
      aria-haspopup="menu"
      className={cn(
        uiClasses.navTriggerBase,
        uiClasses.transitionColors,
        uiClasses.topBarFocusRing,
        props.isOpen
          ? uiClasses.topBarNavTriggerOpen
          : props.isChildActive
            ? uiClasses.topBarNavLinkActive
            : uiClasses.topBarNavTriggerIdle,
      )}
      type="button"
      onFocus={(event) => props.onFocusSwitch(event.currentTarget)}
      onMouseEnter={(event) => props.onHoverSwitch(event.currentTarget)}
      onClick={(event) => props.onToggle(event.currentTarget)}
    >
      <NavGroupIcon groupId={props.groupId} />
      <span>{props.groupLabel}</span>
      <ChevronDown
        aria-hidden
        className={cn("h-4 w-4 shrink-0 opacity-70 transition-transform", props.isOpen && "rotate-180")}
      />
    </button>
  );
}

export function DesktopTopNav({ activeHref }: DesktopTopNavProps) {
  const user = useCurrentUser();
  const t = useT();
  const limited = userHasLimitedAccess(user);
  const navRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenuState>(null);
  const [navBadges, setNavBadges] = useState<Record<string, number>>({});

  const groups = useMemo(
    () => getDesktopTopNavigationGroups(user.system_role, { limitedAccess: limited }),
    [user.system_role, limited],
  );

  useEffect(() => {
    const onSummary = (ev: Event) => {
      const d = (ev as CustomEvent<NotificationSummary>).detail;
      if (!d?.items) {
        return;
      }
      setNavBadges(navBadgesFromSummary(d.items));
    };
    window.addEventListener("timiq:notification-summary", onSummary as EventListener);
    return () => window.removeEventListener("timiq:notification-summary", onSummary as EventListener);
  }, []);

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
  }, []);

  const switchOpenMenu = useCallback((groupId: string, anchor: HTMLButtonElement) => {
    setOpenMenu((prev) => {
      if (!prev) {
        return prev;
      }
      if (prev.id === groupId && prev.anchor === anchor) {
        return prev;
      }
      return { id: groupId, anchor };
    });
  }, []);

  useEffect(() => {
    closeMenus();
  }, [activeHref, closeMenus]);

  useEffect(() => {
    if (!openMenu) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (navRef.current?.contains(target)) {
        return;
      }
      if (navDropdownMenuContains(target)) {
        return;
      }
      closeMenus();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [openMenu, closeMenus]);

  if (groups.length === 0) {
    return null;
  }

  const openGroup =
    openMenu !== null ? groups.find((g) => g.id === openMenu.id) : undefined;

  return (
    <>
      <nav
        ref={navRef}
        aria-label={t("shell.top_nav", "Main navigation")}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 xl:flex-nowrap xl:overflow-x-auto xl:overscroll-x-contain xl:[-webkit-overflow-scrolling:touch]"
      >
        {groups.map((group) => {
          const visible = group.items;
          if (visible.length === 0) {
            return null;
          }

          const groupLabel = t(group.groupLabelKey, group.label);

          if (visible.length === 1) {
            const only = visible[0];
            const isDirectActive = navItemMatchesActive(only.href, activeHref);
            const n = navBadges[only.href] ?? 0;
            return (
              <Link
                key={group.id}
                className={cn(
                  uiClasses.navLinkBase,
                  uiClasses.transitionColors,
                  uiClasses.topBarFocusRing,
                  isDirectActive ? uiClasses.topBarNavLinkActive : uiClasses.topBarNavLinkIdle,
                )}
                href={only.href}
              >
                <NavItemIcon labelKey={only.labelKey} />
                <span>{t(only.labelKey, only.label)}</span>
                {n > 0 ? (
                  <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-tight text-white">
                    {n > 99 ? "99+" : n}
                  </span>
                ) : null}
              </Link>
            );
          }

          const isOpen = openMenu?.id === group.id;
          const isChildActive = groupContainsActiveRoute(group, activeHref);
          return (
            <div key={group.id} className="relative shrink-0">
              <NavGroupTrigger
                groupId={group.id}
                groupLabel={groupLabel}
                isChildActive={isChildActive}
                isOpen={isOpen}
                onFocusSwitch={(anchor) => switchOpenMenu(group.id, anchor)}
                onHoverSwitch={(anchor) => switchOpenMenu(group.id, anchor)}
                onToggle={(anchor) => {
                  setOpenMenu((prev) =>
                    prev?.id === group.id ? null : { id: group.id, anchor },
                  );
                }}
              />
            </div>
          );
        })}
      </nav>

      {openGroup && openMenu ? (
        <NavDropdownPortal
          anchorEl={openMenu.anchor}
          menuId={`timiq-nav-menu-${openGroup.id}`}
          open
        >
          {openGroup.items.map((item) => {
            const isChildActive = navItemMatchesActive(item.href, activeHref);
            const n = navBadges[item.href] ?? 0;
            return (
              <Link
                className={cn(
                  uiClasses.topBarDropdownItem,
                  uiClasses.transitionColors,
                  isChildActive ? uiClasses.topBarDropdownItemActive : undefined,
                )}
                href={item.href}
                key={item.href}
                role="menuitem"
                onClick={closeMenus}
              >
                <NavItemIcon labelKey={item.labelKey} />
                <span className="min-w-0 flex-1">{t(item.labelKey, item.label)}</span>
                {n > 0 ? (
                  <span className="shrink-0 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-tight text-white">
                    {n > 99 ? "99+" : n}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </NavDropdownPortal>
      ) : null}
    </>
  );
}
