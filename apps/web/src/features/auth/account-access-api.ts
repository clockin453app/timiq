import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";
import type { AuthUser } from "./api";

async function readError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const detail = JSON.parse(text) as { detail?: unknown };
    return fastApiDetailToMessage(detail.detail, fallback);
  } catch {
    return fastApiDetailToMessage(text, fallback);
  }
}

export type GenericMessageResponse = {
  message: string;
};

export type InviteUserRequest = {
  email: string;
  system_role: "administrator" | "admin" | "employee";
  company_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  personal_message?: string | null;
};

export type InviteUserResponse = {
  user: AuthUser;
  dev_invite_link?: string | null;
};

export type SendVerificationEmailResponse = {
  message: string;
  dev_verification_link?: string | null;
};

export async function requestForgotPassword(email: string): Promise<GenericMessageResponse> {
  const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status === 429) {
    throw new Error("Too many requests. Try again later.");
  }
  if (!res.ok) {
    throw new Error(await readError(res, "Request failed."));
  }
  return res.json() as Promise<GenericMessageResponse>;
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<GenericMessageResponse> {
  const res = await fetch(`${API_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not reset password."));
  }
  return res.json() as Promise<GenericMessageResponse>;
}

export async function acceptInvite(
  token: string,
  newPassword: string,
  firstName?: string | null,
  lastName?: string | null,
): Promise<GenericMessageResponse> {
  const res = await fetch(`${API_URL}/api/auth/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      new_password: newPassword,
      first_name: firstName ?? null,
      last_name: lastName ?? null,
    }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not accept invitation."));
  }
  return res.json() as Promise<GenericMessageResponse>;
}

export async function verifyEmailWithToken(token: string): Promise<GenericMessageResponse> {
  const res = await fetch(`${API_URL}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not verify email."));
  }
  return res.json() as Promise<GenericMessageResponse>;
}

export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/change-password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not change password."));
  }
}

export async function sendVerificationEmail(): Promise<SendVerificationEmailResponse> {
  const res = await fetch(`${API_URL}/api/auth/send-verification-email`, {
    method: "POST",
    credentials: "include",
  });
  if (res.status === 429) {
    throw new Error("Too many verification emails requested. Try again later.");
  }
  if (!res.ok) {
    throw new Error(await readError(res, "Could not send verification email."));
  }
  return res.json() as Promise<SendVerificationEmailResponse>;
}

export async function inviteUserByEmail(body: InviteUserRequest): Promise<InviteUserResponse> {
  const res = await fetch(`${API_URL}/api/auth/admin/invite-user`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Could not send invite."));
  }
  return res.json() as Promise<InviteUserResponse>;
}
