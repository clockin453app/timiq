import type { AuthUser } from "./api";

export type SystemRole = AuthUser["system_role"];

export function formatSystemRole(role: SystemRole): string {
  switch (role) {
    case "administrator":
      return "Administrator";
    case "admin":
      return "Admin";
    case "employee":
      return "Employee";
    default:
      return role;
  }
}

export function isAdministrator(user: AuthUser) {
  return user.system_role === "administrator";
}

export function isAdmin(user: AuthUser) {
  return user.system_role === "admin";
}

export function isEmployee(user: AuthUser) {
  return user.system_role === "employee";
}

export function canAccessManagement(user: AuthUser) {
  return isAdministrator(user) || isAdmin(user);
}

/** Mirrors backend auth.service.can_manage_user (management scope for company admins). */
export function canManageUser(actor: AuthUser, target: AuthUser): boolean {
  if (isAdministrator(actor)) {
    return true;
  }

  if (!isAdmin(actor)) {
    return false;
  }

  if (!actor.company_id) {
    return false;
  }

  if (target.company_id !== actor.company_id) {
    return false;
  }

  return target.system_role === "employee";
}

export function canAccessSystemSettings(user: AuthUser) {
  return isAdministrator(user);
}

export function hasAnyRole(user: AuthUser, roles: SystemRole[]) {
  return roles.includes(user.system_role);
}