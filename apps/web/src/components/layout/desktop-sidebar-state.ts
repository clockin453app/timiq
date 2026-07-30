"use client";

import { useCallback, useLayoutEffect, useState } from "react";

import {
  resolveSidebarCollapsedState,
  SIDEBAR_COLLAPSED_KEY,
  WIDE_DESKTOP_MEDIA_QUERY,
} from "./desktop-sidebar-preference";

export { SIDEBAR_COLLAPSED_KEY } from "./desktop-sidebar-preference";
const SIDEBAR_STATE_EVENT = "timiq:sidebar-collapsed-change";

type SidebarStateEvent = CustomEvent<{ collapsed: boolean }>;

function readStoredSidebarValue(): string | null {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return stored === "0" || stored === "1" ? stored : null;
  } catch {
    return null;
  }
}

function readInitialSidebarState(): boolean {
  return resolveSidebarCollapsedState(
    readStoredSidebarValue(),
    window.matchMedia(WIDE_DESKTOP_MEDIA_QUERY).matches,
  );
}

function publishSidebarState(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* Local preference persistence is best effort. */
  }
  window.dispatchEvent(
    new CustomEvent(SIDEBAR_STATE_EVENT, { detail: { collapsed } }),
  );
}

export function useDesktopSidebarState() {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useLayoutEffect(() => {
    setCollapsed(readInitialSidebarState());
    setHydrated(true);

    const wideDesktop = window.matchMedia(WIDE_DESKTOP_MEDIA_QUERY);
    const onViewportDefaultChange = (event: MediaQueryListEvent) => {
      if (readStoredSidebarValue() === null) {
        setCollapsed(!event.matches);
      }
    };
    const onSidebarState = (event: Event) => {
      setCollapsed((event as SidebarStateEvent).detail.collapsed);
    };
    wideDesktop.addEventListener("change", onViewportDefaultChange);
    window.addEventListener(SIDEBAR_STATE_EVENT, onSidebarState);
    return () => {
      wideDesktop.removeEventListener("change", onViewportDefaultChange);
      window.removeEventListener(SIDEBAR_STATE_EVENT, onSidebarState);
    };
  }, []);

  const updateCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    publishSidebarState(next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    updateCollapsed(!collapsed);
  }, [collapsed, updateCollapsed]);

  return { collapsed, hydrated, setCollapsed: updateCollapsed, toggleCollapsed };
}
