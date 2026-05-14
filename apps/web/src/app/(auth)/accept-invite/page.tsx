"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthShell } from "../../../components/layout";
import { Button, Input } from "../../../components/ui";
import { acceptInvite } from "../../../features/auth";

function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await acceptInvite(
        token.trim(),
        password,
        firstName.trim() || null,
        lastName.trim() || null,
      );
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete invite.");
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
        <Input label="Invite token" name="token" onChange={(ev) => setToken(ev.target.value)} required value={token} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="First name (optional)" name="fn" onChange={(ev) => setFirstName(ev.target.value)} value={firstName} />
        <Input label="Last name (optional)" name="ln" onChange={(ev) => setLastName(ev.target.value)} value={lastName} />
      </div>
      <Input
        autoComplete="new-password"
        label="New password"
        name="password"
        onChange={(ev) => setPassword(ev.target.value)}
        required
        type="password"
        value={password}
      />
      <Input
        autoComplete="new-password"
        label="Confirm password"
        name="confirm"
        onChange={(ev) => setConfirm(ev.target.value)}
        required
        type="password"
        value={confirm}
      />
      <Button className="w-full" disabled={submitting || Boolean(message)} type="submit">
        {submitting ? "Saving…" : "Activate account"}
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <AuthShell title="Accept invitation" subtitle="Set your password to activate your TimIQ account.">
      <Suspense fallback={<p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}>
        <AcceptInviteForm />
      </Suspense>
    </AuthShell>
  );
}
