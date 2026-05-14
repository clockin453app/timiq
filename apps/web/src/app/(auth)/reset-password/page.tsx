"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthShell } from "../../../components/layout";
import { Button, Input } from "../../../components/ui";
import { resetPasswordWithToken } from "../../../features/auth";
import { useT } from "../../../lib/i18n";

function ResetPasswordForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirm) {
      setError(t("auth.reset.password_mismatch", "Passwords do not match."));
      return;
    }
    if (password.length < 12) {
      setError(t("auth.reset.password_short", "Password must be at least 12 characters."));
      return;
    }
    setSubmitting(true);
    try {
      const res = await resetPasswordWithToken(token.trim(), password);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.reset.failed", "Reset failed."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {message ? (
        <div className="space-y-2 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text)]">
          <p>{message}</p>
          <Link className="text-[var(--color-accent)] underline" href="/login">
            {t("auth.verify.sign_in", "Sign in")}
          </Link>
        </div>
      ) : null}
      {error ? (
        <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
          {error}
        </div>
      ) : null}
      {!tokenFromUrl ? (
        <Input
          autoComplete="off"
          label={t("auth.reset.token_label", "Reset token (from email)")}
          name="token"
          onChange={(ev) => setToken(ev.target.value)}
          required
          value={token}
        />
      ) : null}
      <Input
        autoComplete="new-password"
        label={t("auth.reset.new_password", "New password")}
        name="password"
        onChange={(ev) => setPassword(ev.target.value)}
        required
        type="password"
        value={password}
      />
      <Input
        autoComplete="new-password"
        label={t("auth.reset.confirm", "Confirm new password")}
        name="confirm"
        onChange={(ev) => setConfirm(ev.target.value)}
        required
        type="password"
        value={confirm}
      />
      <Button className="w-full" disabled={submitting || Boolean(message)} type="submit">
        {submitting ? t("auth.reset.saving", "Saving…") : t("auth.reset.set_password", "Set new password")}
      </Button>
      <p className="text-center text-sm">
        <Link className="text-[var(--color-accent)] underline" href="/login">
          {t("auth.forgot.back", "Back to sign in")}
        </Link>
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useT();
  return (
    <AuthShell
      title={t("auth.reset.title", "Reset password")}
      subtitle={t("auth.reset.subtitle", "Choose a new password for your account.")}
    >
      <Suspense fallback={<p className="text-sm text-[var(--color-text-muted)]">{t("auth.common.loading", "Loading…")}</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
