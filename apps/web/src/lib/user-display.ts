import type { AuthUser } from "../features/auth/api";

/** Display name for the signed-in user: profile first + last, else email. */
export function formatAuthUserDisplayName(user: Pick<AuthUser, "email" | "profile_first_name" | "profile_last_name">): string {
  const first = user.profile_first_name?.trim();
  const last = user.profile_last_name?.trim();
  const full = [first, last].filter(Boolean).join(" ");
  return full || user.email;
}

/** Name string for avatar initials, or undefined when only email should be used. */
export function authUserAvatarName(user: Pick<AuthUser, "profile_first_name" | "profile_last_name">): string | undefined {
  const full = [user.profile_first_name?.trim(), user.profile_last_name?.trim()].filter(Boolean).join(" ");
  return full || undefined;
}
