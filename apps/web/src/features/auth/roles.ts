import type { AuthUser } from "./api";

export type SystemRole = AuthUser["system_role"];

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

export function canAccessSystemSettings(user: AuthUser) {
  return isAdministrator(user);
}

export function hasAnyRole(user: AuthUser, roles: SystemRole[]) {
  return roles.includes(user.system_role);
}