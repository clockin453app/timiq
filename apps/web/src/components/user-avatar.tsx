"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchFaceReferenceImage } from "../features/face-check/api";
import { fetchOnboardingProfilePhotoBlob } from "../features/onboarding/api";

function initialsFromIdentity(name: string | null | undefined, email: string | null | undefined): string {
  const cleanedName = (name || "").trim();
  if (cleanedName) {
    const parts = cleanedName.split(/\s+/).filter(Boolean);
    const chars = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2);
    return chars.toUpperCase();
  }

  const cleanedEmail = (email || "").trim();
  if (cleanedEmail) {
    return cleanedEmail.slice(0, 2).toUpperCase();
  }

  return "??";
}

type UserAvatarProps = {
  userId: string;
  name?: string | null;
  email?: string | null;
  sizeClassName?: string;
  className?: string;
};

export function UserAvatar({
  userId,
  name,
  email,
  sizeClassName = "h-9 w-9",
  className = "",
}: UserAvatarProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const initials = useMemo(() => initialsFromIdentity(name, email), [name, email]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImageUrl(null);

    async function load() {
      const loaders = [fetchOnboardingProfilePhotoBlob, fetchFaceReferenceImage];
      for (const fetchImage of loaders) {
        try {
          const blob = await fetchImage(userId);
          if (cancelled) {
            return;
          }
          objectUrl = URL.createObjectURL(blob);
          setImageUrl(objectUrl);
          return;
        } catch {
          // Try the next protected image source before falling back to initials.
        }
      }

      if (!cancelled) {
        setImageUrl(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [userId]);

  const baseClassName = `${sizeClassName} shrink-0 rounded-full border border-[var(--color-border-dark)] ${className}`.trim();

  if (imageUrl) {
    return <img alt="" className={`${baseClassName} object-cover`} src={imageUrl} />;
  }

  return (
    <span
      aria-hidden="true"
      className={`${baseClassName} inline-flex items-center justify-center bg-slate-100 text-xs font-bold text-slate-700`}
    >
      {initials}
    </span>
  );
}
