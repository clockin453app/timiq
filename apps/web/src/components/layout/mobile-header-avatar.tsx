"use client";

import { useEffect, useState, type RefObject } from "react";

import type { AuthUser } from "@/features/auth";
import { formatAuthUserDisplayName } from "@/features/auth";
import { fetchFaceReferenceImage } from "@/features/face-check/api";
import { employeeInitials } from "@/features/employees/employee-identity";
import { cn } from "@/lib/cn";
import { uiClasses } from "@/lib/ui-classes";

type MobileHeaderAvatarProps = {
  user: AuthUser;
  onOpenAccount: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
};

/** Visible 36px circle inside a 44px touch target. */
const AVATAR_INNER = "h-9 w-9";

export function MobileHeaderAvatar({ user, onOpenAccount, buttonRef }: MobileHeaderAvatarProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const name = formatAuthUserDisplayName(user);
  const initials = employeeInitials(user);
  const hasPhoto = Boolean(user.face_reference_configured);

  useEffect(() => {
    if (!hasPhoto) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const blob = await fetchFaceReferenceImage(user.id, { variant: "thumb" });
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setImageUrl(null);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [hasPhoto, user.id]);

  return (
    <button
      aria-label={`Open account menu for ${name}`}
      className={cn(
        "timiq-touch-target flex h-11 w-11 shrink-0 items-center justify-center p-0",
        uiClasses.transitionColors,
        uiClasses.topBarFocusRing,
      )}
      data-testid="timiq-mobile-header-avatar"
      ref={buttonRef}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenAccount();
      }}
    >
      <span
        aria-hidden
        className={cn(
          AVATAR_INNER,
          "overflow-hidden rounded-full border border-[var(--color-border-dark)] bg-slate-100",
        )}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="h-full w-full object-cover" src={imageUrl} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[11px] font-bold text-slate-700">
            {initials}
          </span>
        )}
      </span>
    </button>
  );
}
