"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { AuthShell } from "../../../components/layout";
import { Button, Input } from "../../../components/ui";
import { requestForgotPassword } from "../../../features/auth";
import { useT } from "../../../lib/i18n";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const res = await requestForgotPassword(email.trim());
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.forgot.error_generic", "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={t("auth.forgot.title", "Forgot password")}
      subtitle={t(
        "auth.forgot.subtitle",
        "Enter your email address. If an account exists, you will receive reset instructions.",
      )}
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        {message ? (
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text)]">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}
        <Input
          autoComplete="email"
          label={t("auth.login.email", "Email")}
          name="email"
          onChange={(ev) => setEmail(ev.target.value)}
          required
          type="email"
          value={email}
        />
        <Button className="w-full" disabled={submitting} type="submit">
          {submitting ? t("auth.forgot.submitting", "Submitting…") : t("auth.forgot.submit", "Send reset link")}
        </Button>
        <p className="text-center text-sm">
          <Link className="text-[var(--color-accent)] underline" href="/login">
            {t("auth.forgot.back", "Back to sign in")}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
