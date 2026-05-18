"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthShell } from "../../../components/layout";
import { Button, Input } from "../../../components/ui";
import { loginWithEmailPassword } from "../../../features/auth/api";
import { getDefaultLandingPath } from "../../../config/navigation";
import { userHasLimitedAccess } from "../../../features/auth/limited-access";
import { useT } from "../../../lib/i18n";

function safeInternalNextPath(value: string | null): string | null {
  const next = (value ?? "").trim();
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return null;
  }
  return next;
}

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const session = await loginWithEmailPassword(email, password);
      const fallback = getDefaultLandingPath(session.user.system_role, {
        limitedAccess: userHasLimitedAccess(session.user),
      });
      router.replace(safeInternalNextPath(searchParams.get("next")) ?? fallback);
    } catch {
      setErrorMessage(t("auth.login.error_invalid", "Invalid email or password."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={t("auth.login.title", "Welcome back")}
      subtitle={t("auth.login.subtitle", "Sign in to manage your workforce.")}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {errorMessage ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {errorMessage}
          </div>
        ) : null}

        <Input
          autoComplete="email"
          label={t("auth.login.email", "Email")}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          suppressHydrationWarning
          type="email"
          value={email}
        />

        <div className="space-y-1">
          <label className="timiq-label" htmlFor="password">
            {t("auth.login.password", "Password")}
          </label>
          <div className="relative">
            <input
              autoComplete="current-password"
              className="timiq-input pr-12"
              id="password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              suppressHydrationWarning
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-accent)]"
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              {showPassword ? (
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 4.2A9.7 9.7 0 0112 4c5 0 8.5 4.1 9.7 6.8a2.9 2.9 0 010 2.4 12.1 12.1 0 01-2.1 3.1M6.4 6.4a12 12 0 00-4.1 4.4 2.9 2.9 0 000 2.4C3.5 15.9 7 20 12 20c1.5 0 2.9-.4 4.1-1"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              ) : (
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M2.3 10.8C3.5 8.1 7 4 12 4s8.5 4.1 9.7 6.8a2.9 2.9 0 010 2.4C20.5 15.9 17 20 12 20s-8.5-4.1-9.7-6.8a2.9 2.9 0 010-2.4z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M12 15a3 3 0 100-6 3 3 0 000 6z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? t("auth.login.signing_in", "Signing in…") : t("auth.login.sign_in", "Sign in")}
        </Button>
        <p className="text-center text-sm">
          <Link className="text-[var(--color-accent)] underline" href="/forgot-password">
            {t("auth.login.forgot_password", "Forgot password?")}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}