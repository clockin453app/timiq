"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthShell } from "../../../components/layout";
import { Button, Input } from "../../../components/ui";
import { TIMIQ_AUTH_REFRESH_EVENT, verifyEmailWithToken } from "../../../features/auth";

function VerifyEmailForm() {
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
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {verified ? (
        <div className="space-y-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text)]">
          <div>
            <p className="font-semibold text-[var(--color-text)]">Email verified.</p>
            <p className="mt-1 text-[var(--color-text-muted)]">You can return to TimIQ.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            <Link
              className="text-[var(--color-accent)] underline"
              href="/profile"
            >
              Go to profile
            </Link>
            <Link
              className="text-[var(--color-accent)] underline"
              href="/settings"
            >
              Go to settings
            </Link>
            <Link className="text-[var(--color-accent)] underline" href="/login">
              Sign in
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
        <Input label="Verification token" name="token" onChange={(ev) => setToken(ev.target.value)} required value={token} />
      ) : null}
      <Button className="w-full" disabled={submitting || verified} type="submit">
        {submitting ? "Verifying…" : "Verify email"}
      </Button>
    </form>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Verify email" subtitle="Confirm your email address for TimIQ.">
      <Suspense fallback={<p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}>
        <VerifyEmailForm />
      </Suspense>
    </AuthShell>
  );
}
