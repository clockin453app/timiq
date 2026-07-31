"use client";

import Link from "next/link";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

const SHIFT_CLOCK_ICONS = {
  clockOutline: "/icons/shift-clock/clock-outline.svg",
  arrowRight: "/icons/shift-clock/arrow-right.svg",
  mapPin: "/icons/shift-clock/map-pin.svg",
  calendarClock: "/icons/shift-clock/calendar-clock.svg",
} as const;

const RING_OUT = "#2563EB";
const RING_IN = "#16A34A";
const ACTION_BLUE = "#2563EB";

export type EmployeeShiftClockProps = {
  isClockedIn: boolean;
  clockInAt?: string | null;
  siteName?: string | null;
  assignedLocationCount: number | null;
  /** Live HH:MM:SS from useLiveShiftDurationParts (derived from clockInAt). */
  elapsedHms: string;
  href?: string;
  clockLoading?: boolean;
  clockError?: string;
  className?: string;
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
};

function formatClockedInAtLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ShiftClockIcon(props: { src: string; size: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- supplied static SVG pack
    <img
      alt=""
      aria-hidden="true"
      className={cn("shrink-0", props.className)}
      height={props.size}
      src={props.src}
      width={props.size}
    />
  );
}

/**
 * Circular employee Dashboard shift clock — navigates to /clock.
 * Display-only; does not clock in/out.
 */
export function EmployeeShiftClock({
  assignedLocationCount,
  className,
  clockError,
  clockInAt,
  clockLoading,
  elapsedHms,
  href = "/clock",
  isClockedIn,
  siteName,
  t,
}: EmployeeShiftClockProps) {
  const ringColor = isClockedIn ? RING_IN : RING_OUT;
  const accessibleName = isClockedIn
    ? t("dashboard.shift_clock_a11y_in", "Shift in progress, open Clock In / Out")
    : t("dashboard.shift_clock_a11y_out", "Open Clock In / Out");

  const clockedInLocal = clockInAt ? formatClockedInAtLocal(clockInAt) : "";
  const descriptionId = "employee-shift-clock-desc";

  const staticActiveDescription = isClockedIn
    ? [
        t("dashboard.shift_in_progress", "Shift in progress"),
        elapsedHms || null,
        siteName || null,
        clockedInLocal
          ? t("dashboard.clocked_in_at", "Clocked in at {{time}}", { time: clockedInLocal })
          : null,
      ]
        .filter(Boolean)
        .join(". ")
    : t("dashboard.not_currently_clocked_in", "You are not currently clocked in");

  return (
    <div
      className={cn(
        "mx-auto flex w-full min-w-0 max-w-md flex-col items-center gap-3 overflow-x-hidden px-1 py-1 sm:gap-3.5",
        className,
      )}
      data-testid="employee-shift-clock"
    >
      <Link
        aria-describedby={descriptionId}
        aria-label={accessibleName}
        className={cn(
          "group relative flex aspect-square w-[clamp(13.5rem,64vw,15.5rem)] max-w-[min(100%,18rem)] shrink-0 flex-col items-center justify-center rounded-full border-[3px] bg-[var(--color-sheet)] text-center no-underline",
          "shadow-[0_8px_24px_rgba(15,23,42,0.08)]",
          "transition-[box-shadow,transform] duration-150 hover:shadow-[0_10px_28px_rgba(15,23,42,0.12)] active:scale-[0.99]",
          "md:w-[clamp(14rem,42vw,17.5rem)]",
          uiClasses.focusRing,
          "focus-visible:ring-2 focus-visible:ring-offset-2",
        )}
        data-clocked-in={isClockedIn ? "true" : "false"}
        data-testid="employee-shift-clock-control"
        href={href}
        onKeyDown={(event) => {
          if (event.key !== " ") {
            return;
          }
          event.preventDefault();
          event.currentTarget.click();
        }}
        style={{
          borderColor: ringColor,
          ["--tw-ring-color" as string]: ringColor,
        }}
      >
        <span className="sr-only" id={descriptionId}>
          {staticActiveDescription}
        </span>

        {clockLoading ? (
          <p className="px-4 text-[15px] font-medium text-[var(--color-text-muted)]">
            {t("dashboard.checking_status", "Checking status…")}
          </p>
        ) : isClockedIn ? (
          <div className="flex w-full min-w-0 flex-col items-center gap-1.5 px-3.5 py-2 sm:gap-2 sm:px-4">
            <p
              className="text-[14px] font-semibold leading-tight sm:text-[15px]"
              style={{ color: RING_IN }}
            >
              {t("dashboard.shift_in_progress", "Shift in progress")}
            </p>
            <p
              aria-live="off"
              className="max-w-full truncate font-mono text-[clamp(1.65rem,8.5vw,2.75rem)] font-bold tabular-nums leading-none tracking-tight text-[var(--color-brand-navy-dark)]"
              data-testid="employee-shift-clock-timer"
              suppressHydrationWarning
            >
              {elapsedHms || "00:00:00"}
            </p>
            {siteName ? (
              <p className="max-w-full truncate text-[16px] font-semibold leading-snug text-[var(--color-brand-navy)] sm:text-[17px]">
                {siteName}
              </p>
            ) : null}
            {clockedInLocal ? (
              <p className="text-[14px] leading-snug text-[var(--color-text-muted)] sm:text-[15px]">
                {t("dashboard.clocked_in_at", "Clocked in at {{time}}", { time: clockedInLocal })}
              </p>
            ) : null}
            <span className="mt-0.5" style={{ color: RING_IN }}>
              <ShiftClockIcon size={28} src={SHIFT_CLOCK_ICONS.calendarClock} />
            </span>
          </div>
        ) : (
          <div className="flex w-full min-w-0 flex-col items-center gap-2 px-4 py-3 sm:gap-2.5">
            <span style={{ color: ACTION_BLUE }}>
              <ShiftClockIcon size={32} src={SHIFT_CLOCK_ICONS.clockOutline} />
            </span>
            <p className="max-w-[12.5rem] text-[15px] font-medium leading-snug text-[var(--color-brand-navy)] sm:text-[16px]">
              {t("dashboard.not_currently_clocked_in", "You are not currently clocked in")}
            </p>
            <p
              className="text-[clamp(1.75rem,8vw,2.125rem)] font-bold leading-none tracking-tight"
              style={{ color: ACTION_BLUE }}
            >
              {t("dashboard.open_clock", "Open clock")}
            </p>
            <span style={{ color: ACTION_BLUE }}>
              <ShiftClockIcon size={30} src={SHIFT_CLOCK_ICONS.arrowRight} />
            </span>
          </div>
        )}
      </Link>

      <div className="flex w-full min-w-0 flex-col items-center gap-1.5 text-center">
        {isClockedIn && !clockLoading ? (
          <p className="text-[13px] font-medium text-[var(--color-text-muted)]">
            {t("dashboard.tap_to_open_clock", "Tap to open clock")}
          </p>
        ) : null}

        <p
          className="inline-flex max-w-full items-center justify-center gap-1.5 px-2 text-[13px] leading-snug text-[var(--color-text-muted)] sm:text-[14px]"
          data-testid="employee-shift-clock-locations"
        >
          <span style={{ color: ACTION_BLUE }}>
            <ShiftClockIcon size={16} src={SHIFT_CLOCK_ICONS.mapPin} />
          </span>
          <span className="min-w-0 break-words">
            {t("dashboard.assigned_locations", "Assigned active locations")}:{" "}
            <span className="font-semibold tabular-nums text-[var(--color-text)]">
              {clockLoading || assignedLocationCount === null ? "—" : assignedLocationCount}
            </span>
          </span>
        </p>

        {clockError ? (
          <p className="text-xs text-[var(--color-danger-700)]" role="alert">
            {clockError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export { SHIFT_CLOCK_ICONS };
