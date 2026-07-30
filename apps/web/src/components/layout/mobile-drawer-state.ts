/** Matches the Tailwind `lg` breakpoint used for desktop shell chrome. */
export const MOBILE_DRAWER_DESKTOP_MIN_WIDTH = 1024;

export type MobileDrawerState = {
  open: boolean;
  /** Route the drawer was last synchronised with, so re-runs are not treated as navigation. */
  href: string;
};

export type MobileDrawerAction =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "route"; href: string }
  | { type: "viewport"; width: number };

export function createMobileDrawerState(href: string): MobileDrawerState {
  return { open: false, href };
}

export function mobileDrawerReducer(
  state: MobileDrawerState,
  action: MobileDrawerAction,
): MobileDrawerState {
  switch (action.type) {
    case "toggle":
      return { ...state, open: !state.open };
    case "close":
      return state.open ? { ...state, open: false } : state;
    case "route":
      return action.href === state.href ? state : { href: action.href, open: false };
    case "viewport":
      return state.open && action.width >= MOBILE_DRAWER_DESKTOP_MIN_WIDTH
        ? { ...state, open: false }
        : state;
    default:
      return state;
  }
}
