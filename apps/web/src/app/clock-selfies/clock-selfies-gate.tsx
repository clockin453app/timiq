"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PageHeader, Sheet, SheetBody } from "../../components/ui";
import { canAccessManagement, useCurrentUser } from "../../features/auth";

export function ClockSelfiesGate() {
  const user = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (canAccessManagement(user)) {
      router.replace("/clock-selfie-review");
    }
  }, [router, user]);

  if (canAccessManagement(user)) {
    return (
      <Sheet>
        <PageHeader title="Clock selfies" description="Redirecting to management review..." />
        <SheetBody>
          <p className="text-sm text-[var(--color-text-muted)]">Opening Clock selfie review…</p>
        </SheetBody>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <PageHeader
        title="Stored selfies unavailable"
        description="Browsing saved clock selfies is not enabled for employee accounts."
      />
      <SheetBody>
        <p className="text-sm text-[var(--color-text-muted)]">
          Live camera capture is still required when you clock in or out. If you need a recorded selfie reviewed,
          ask your company administrator.
        </p>
        <div className="mt-4">
          <Link className="text-sm font-semibold text-[var(--color-text)] underline" href="/clock">
            Back to Clock In / Out
          </Link>
        </div>
      </SheetBody>
    </Sheet>
  );
}
