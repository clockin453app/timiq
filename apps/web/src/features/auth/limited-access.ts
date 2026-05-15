import type { AuthUser } from "./api";

/** Routes a deactivated employee may open (prefix match). */
export const LIMITED_ACCESS_ALLOWED_PATHS = [
  "/timesheets",
  "/pay-history",
  "/profile",
] as const;

export function userHasLimitedAccess(user: AuthUser): boolean {
  return Boolean(user.limited_access);
}

export function isPathAllowedForLimitedAccess(pathname: string): boolean {
  return LIMITED_ACCESS_ALLOWED_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  );
}

export function defaultLimitedAccessPath(): string {
  return "/pay-history";
}
