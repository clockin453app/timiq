import { API_URL } from "../../config/api";
import { type AuthUser } from "./api";
import { type SystemRole } from "./roles";

export type CreateManagedUserRequest = {
  email: string;
  password: string;
  system_role: SystemRole;
  is_active: boolean;
  company_id?: string | null;
};

export type UpdateManagedUserRequest = {
  email: string;
  system_role: SystemRole;
  company_id?: string | null;
};

export async function listManagedUsers(): Promise<AuthUser[]> {
  const response = await fetch(`${API_URL}/api/auth/users`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not load users.");
  }

  return response.json() as Promise<AuthUser[]>;
}

export async function createManagedUser(
  request: CreateManagedUserRequest,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to create this user.");
  }

  if (response.status === 404) {
    throw new Error("Company was not found.");
  }

  if (response.status === 409) {
    throw new Error("A user with this email already exists.");
  }

  if (!response.ok) {
    throw new Error("Could not create user.");
  }

  return response.json() as Promise<AuthUser>;
}

export async function updateManagedUser(
  userId: string,
  request: UpdateManagedUserRequest,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/users/${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to update this user.");
  }

  if (response.status === 404) {
    throw new Error("User or company was not found.");
  }

  if (response.status === 409) {
    throw new Error("A user with this email already exists.");
  }

  if (!response.ok) {
    throw new Error("Could not update user.");
  }

  return response.json() as Promise<AuthUser>;
}

export async function updateManagedUserStatus(
  userId: string,
  isActive: boolean,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/users/${userId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      is_active: isActive,
    }),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to update this user.");
  }

  if (response.status === 404) {
    throw new Error("User was not found.");
  }

  if (!response.ok) {
    throw new Error("Could not update user.");
  }

  return response.json() as Promise<AuthUser>;
}

export async function resetManagedUserPassword(
  userId: string,
  password: string,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/users/${userId}/password`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      password,
    }),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to reset this password.");
  }

  if (response.status === 404) {
    throw new Error("User was not found.");
  }

  if (!response.ok) {
    throw new Error("Could not reset password.");
  }

  return response.json() as Promise<AuthUser>;
}