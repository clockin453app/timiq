import { API_URL } from "../../config/api";

export type AuthUser = {
  id: string;
  company_id: string | null;
  email: string;
  system_role: "administrator" | "admin" | "employee";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  profile_first_name?: string | null;
  profile_last_name?: string | null;
};

export type LoginResponse = {
  user: AuthUser;
};

export async function loginWithEmailPassword(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    throw new Error("Invalid email or password.");
  }

  return response.json() as Promise<LoginResponse>;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Could not load current user.");
  }

  return response.json() as Promise<AuthUser>;
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not log out.");
  }
}