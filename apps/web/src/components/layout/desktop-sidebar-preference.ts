export const SIDEBAR_COLLAPSED_KEY = "timiq-sidebar-collapsed";
export const WIDE_DESKTOP_MEDIA_QUERY = "(min-width: 1440px)";

/**
 * A stored choice always wins. Without one, laptop widths use the compact rail
 * and wide desktop uses the expanded tree.
 */
export function resolveSidebarCollapsedState(
  storedValue: string | null,
  isWideDesktop: boolean,
): boolean {
  if (storedValue === "1") return true;
  if (storedValue === "0") return false;
  return !isWideDesktop;
}
