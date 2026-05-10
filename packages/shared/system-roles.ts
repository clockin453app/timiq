export const systemRoles = ["administrator", "admin", "employee"] as const;

export type SystemRole = (typeof systemRoles)[number];
