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

import { navItemMatchesActive } from "./grouped-nav";
import { NavDropdownPortal, navDropdownMenuContains } from "./nav-dropdown-portal";
import { NavItemIcon } from "./nav-item-icon";

type DesktopTopNavProps = {
  activeHref: string;
};

type OpenMenuState = {
  id: string;
  anchor: HTMLButtonElement;
} | null;

const directLinkActiveClass =
  "border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] text-[var(--color-text)]";
const directLinkIdleClass =
  "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-cell)] hover:text-[var(--color-text)]";

const dropdownTriggerOpenClass =
  "border-[var(--color-border)] bg-[var(--color-cell)] text-[var(--color-text)]";
const dropdownTriggerIdleClass =
  "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-cell)] hover:text-[var(--color-text)]";

function NavGroupTrigger(props: {
  groupId: string;
  groupLabel: string;
  isOpen: boolean;
  onToggle: (anchor: HTMLButtonElement) => void;
}) {
  return (
    <button
      aria-controls={`timiq-nav-menu-${props.groupId}`}
      aria-expanded={props.isOpen}
      aria-haspopup="menu"
      className={[
        "inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] border px-2.5 text-sm font-medium whitespace-nowrap",
        props.isOpen ? dropdownTriggerOpenClass : dropdownTriggerIdleClass,
      ].join(" ")}
      type="button"
      onClick={(event) => props.onToggle(event.currentTarget)}
    >
      <span>{props.groupLabel}</span>
      <ChevronDown
        aria-hidden
        className={["h-4 w-4 shrink-0 transition-transform", props.isOpen ? "rotate-180" : ""].join(" ")}
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
                className={[
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-sm font-medium whitespace-nowrap",
                  isDirectActive ? directLinkActiveClass : directLinkIdleClass,
                ].join(" ")}
                href={only.href}
              >
                <NavItemIcon labelKey={only.labelKey} className="h-4 w-4 shrink-0" />
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
          return (
            <div key={group.id} className="relative shrink-0">
              <NavGroupTrigger
                groupId={group.id}
                groupLabel={groupLabel}
                isOpen={isOpen}
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
                className={[
                  "flex items-center gap-2 px-3 py-2 text-sm font-medium break-words",
                  isChildActive
                    ? "bg-[var(--color-btn-active-bg)] text-[var(--color-text)]"
                    : "text-[var(--color-text)] hover:bg-[var(--color-cell)]",
                ].join(" ")}
                href={item.href}
                key={item.href}
                role="menuitem"
                onClick={closeMenus}
              >
                <NavItemIcon labelKey={item.labelKey} className="h-4 w-4 shrink-0" />
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
