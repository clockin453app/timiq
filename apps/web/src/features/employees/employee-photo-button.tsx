"use client";

import { useEffect, useRef, useState } from "react";

import { fetchFaceReferenceImage } from "@/features/face-check/api";

import { employeeDisplayName, employeeInitials } from "./employee-identity";

type Identity = {
  id: string;
  email: string;
  profile_first_name?: string | null;
  profile_last_name?: string | null;
  face_reference_configured?: boolean;
};

export function EmployeePhotoButton({
  user,
  sizeClassName = "h-11 w-11",
  onOpen,
}: {
  user: Identity;
  sizeClassName?: string;
  onOpen: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const name = employeeDisplayName(user);
  const initials = employeeInitials(user);
  const hasPhoto = Boolean(user.face_reference_configured);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !hasPhoto) {
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
  }, [visible, hasPhoto, user.id]);

  return (
    <button
      aria-label={`View photo of ${name}`}
      className={`${sizeClassName} shrink-0 overflow-hidden rounded-full border border-[var(--color-border-dark)] bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]`}
      ref={rootRef}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="h-full w-full object-cover" loading="lazy" src={imageUrl} />
      ) : (
        <span aria-hidden className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-700">
          {initials}
        </span>
      )}
    </button>
  );
}
