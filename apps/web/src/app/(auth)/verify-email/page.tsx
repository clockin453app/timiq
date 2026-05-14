"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthShell } from "../../../components/layout";
import { Button, Input } from "../../../components/ui";
import { verifyEmailWithToken } from "../../../features/auth";

function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const [token, setToken] = useState(tokenFromUrl);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const res = await verifyEmailWithToken(token.trim());
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
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
            Sign in
          </Link>
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
      <Button className="w-full" disabled={submitting || Boolean(message)} type="submit">
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
