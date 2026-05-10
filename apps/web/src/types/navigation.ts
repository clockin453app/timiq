export type SystemRole = "administrator" | "admin" | "employee";

export type NavigationItem = {
  label: string;
  href: string;
  roles: SystemRole[];
};
