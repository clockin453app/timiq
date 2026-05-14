"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthShell } from "../../../components/layout";
import { Button, Input } from "../../../components/ui";
import { TIMIQ_AUTH_REFRESH_EVENT, verifyEmailWithToken } from "../../../features/auth";
import { useT } from "../../../lib/i18n";

function VerifyEmailForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const [token, setToken] = useState(tokenFromUrl);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setVerified(false);
    setSubmitting(true);
    try {
      await verifyEmailWithToken(token.trim());
      setVerified(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(TIMIQ_AUTH_REFRESH_EVENT));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.verify.failed", "Verification failed."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {verified ? (
        <div className="space-y-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text)]">
          <div>
            <p className="font-semibold text-[var(--color-text)]">{t("auth.verify.success_title", "Email verified.")}</p>
            <p className="mt-1 text-[var(--color-text-muted)]">{t("auth.verify.success_body", "You can return to TimIQ.")}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            <Link
              className="text-[var(--color-accent)] underline"
              href="/profile"
            >
              {t("auth.verify.go_profile", "Go to profile")}
            </Link>
            <Link
              className="text-[var(--color-accent)] underline"
              href="/settings"
            >
              {t("auth.verify.go_settings", "Go to settings")}
            </Link>
            <Link className="text-[var(--color-accent)] underline" href="/login">
              {t("auth.verify.sign_in", "Sign in")}
            </Link>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
          {error}
        </div>
      ) : null}
      {!tokenFromUrl ? (
        <Input label={t("auth.verify.token_label", "Verification token")} name="token" onChange={(ev) => setToken(ev.target.value)} required value={token} />
      ) : null}
      <Button className="w-full" disabled={submitting || verified} type="submit">
        {submitting ? t("auth.verify.verifying", "Verifying…") : t("auth.verify.verify_btn", "Verify email")}
      </Button>
    </form>
  );
}

export default function VerifyEmailPage() {
  const t = useT();
  return (
    <AuthShell
      title={t("auth.verify.title", "Verify email")}
      subtitle={t("auth.verify.subtitle", "Confirm your email address for TimIQ.")}
    >
      <Suspense fallback={<p className="text-sm text-[var(--color-text-muted)]">{t("auth.common.loading", "Loading…")}</p>}>
        <VerifyEmailForm />
      </Suspense>
    </AuthShell>
  );
}
