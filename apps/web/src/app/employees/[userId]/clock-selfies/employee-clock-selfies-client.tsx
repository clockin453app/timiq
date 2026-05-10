"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui";
import { RoleGuard } from "../../../../features/auth";
import {
  fetchClockSelfieBlob,
  listClockSelfiesForUser,
  type ClockSelfieMetadata,
} from "../../../../features/time-clock/selfies-api";

type EmployeeClockSelfiesClientProps = {
  userId: string;
};

function formatPhase(phase: string) {
  if (phase === "clock_in") {
    return "Clock in";
  }
  if (phase === "clock_out") {
    return "Clock out";
  }
  return phase.replaceAll("_", " ");
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function EmployeeClockSelfiesClient({ userId }: EmployeeClockSelfiesClientProps) {
  const [items, setItems] = useState<ClockSelfieMetadata[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError("");
      try {
        const data = await listClockSelfiesForUser(userId);
        if (!cancelled) {
          setItems(data);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load clock selfies.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (previewId === null) {
      setPreviewUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return null;
      });
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }

    const selfieId = previewId;
    let cancelled = false;

    async function loadPreview() {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const blob = await fetchClockSelfieBlob(selfieId);
        if (cancelled) {
          return;
        }
        const nextUrl = URL.createObjectURL(blob);
        setPreviewUrl((previous) => {
          if (previous) {
            URL.revokeObjectURL(previous);
          }
          return nextUrl;
        });
      } catch (error) {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : "Could not open selfie preview.");
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [previewId]);

  useEffect(() => {
    return () => {
      setPreviewUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return null;
      });
    };
  }, []);

  function closePreview() {
    setPreviewId(null);
  }

  const fallback = (
    <Sheet>
      <PageHeader title="Clock selfies" description="Management access is required." />
      <SheetBody>
        <div className="border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
          You do not have permission to review employee clock selfies.
          <div className="mt-3">
            <Link className="text-sm font-semibold text-[var(--color-text)] underline" href="/employees">
              Back to employees
            </Link>
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );

  return (
    <RoleGuard allowedRoles={["administrator", "admin"]} fallback={fallback}>
      <Sheet>
        <PageHeader
          title="Employee clock selfies"
          description="Review clock-in and clock-out selfies for this user. Management previews are audited."
        />
        <SheetBody>
          {isLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading selfies...</p>
          ) : null}

          {loadError ? (
            <div className="mb-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {loadError}
            </div>
          ) : null}

          {!isLoading && !loadError && items.length === 0 ? (
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
              No clock selfies found for this user yet.
            </div>
          ) : null}

          {!isLoading && items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phase</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead>Shift started</TableHead>
                  <TableHead>Shift ended</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatPhase(item.phase)}</TableCell>
                    <TableCell>{formatWhen(item.captured_at)}</TableCell>
                    <TableCell>{formatWhen(item.clock_in_at)}</TableCell>
                    <TableCell>{item.clock_out_at ? formatWhen(item.clock_out_at) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button onClick={() => setPreviewId(item.id)} type="button">
                        Preview
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          <div className="mt-4">
            <Link className="text-sm font-semibold text-[var(--color-text)] underline" href="/employees">
              Back to employees
            </Link>
          </div>

          {previewId ? (
            <div
              aria-modal="true"
              className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-3"
              role="dialog"
            >
              <div className="w-full max-w-lg rounded border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-md">
                <p className="text-sm font-bold text-[var(--color-text)]">Selfie preview</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Loaded through a protected server request using your session.
                </p>

                {previewLoading ? (
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">Opening image...</p>
                ) : null}

                {previewError ? (
                  <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
                    {previewError}
                  </div>
                ) : null}

                {!previewLoading && previewUrl ? (
                  <div className="mt-3 rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="Clock selfie preview" className="mx-auto max-h-80 w-full object-contain" src={previewUrl} />
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={closePreview} type="button">
                    Close
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </SheetBody>
      </Sheet>
    </RoleGuard>
  );
}
