"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthShell } from "../../../components/layout";
import { Button, Input } from "../../../components/ui";
import { loginWithEmailPassword } from "../../../features/auth/api";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setIsSubmitting(true);

    try {
      await loginWithEmailPassword(email, password);
      router.replace("/dashboard");
    } catch {
      setErrorMessage("Invalid email or password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to manage your workforce."
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {errorMessage ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {errorMessage}
          </div>
        ) : null}

        <Input
          autoComplete="email"
          label="Email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          suppressHydrationWarning
          type="email"
          value={email}
        />

        <Input
          autoComplete="current-password"
          label="Password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          suppressHydrationWarning
          type="password"
          value={password}
        />

        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
        <p className="text-center text-sm">
          <Link className="text-[var(--color-accent)] underline" href="/forgot-password">
            Forgot password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}