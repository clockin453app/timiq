import { cn } from "../../lib/cn";

import { TimIQMark } from "./timiq-mark";

export const TIMIQ_LOGO_SRC = "/branding/timiq-logo-approved.png";
export const TIMIQ_LOGO_NATIVE_WIDTH = 839;
export const TIMIQ_LOGO_NATIVE_HEIGHT = 369;

type TimIQBrandLockupProps = {
  className?: string;
  /** Display height for mark or horizontal logo; width follows native aspect. */
  markSize?: number;
  /** @deprecated Logo raster includes subtitle; retained for call-site compatibility. */
  showSubtitle?: boolean;
  /** @deprecated Logo raster includes subtitle; retained for call-site compatibility. */
  subtitle?: string;
  /** @deprecated Unused with approved raster logo. */
  subtitleClassName?: string;
  /** @deprecated Approved rasters are not recoloured; retained for call-site compatibility. */
  tone?: "default" | "inverse";
  variant?: "mark" | "compact" | "full";
  /** @deprecated Logo raster includes wordmark; retained for call-site compatibility. */
  wordmarkClassName?: string;
};

/**
 * Approved TimIQ branding lockup.
 * - full: horizontal logo raster (mark + wordmark + subtitle)
 * - mark / compact: mark raster only
 */
export function TimIQBrandLockup({
  className,
  markSize,
  variant = "full",
}: TimIQBrandLockupProps) {
  const markOnly = variant === "mark" || variant === "compact";
  const height = markSize ?? (markOnly ? 26 : 28);

  if (markOnly) {
    return (
      <span className={cn("inline-flex min-w-0 max-w-full items-center justify-center", className)}>
        <TimIQMark decorative size={height} />
      </span>
    );
  }

  const width = Math.round((height * TIMIQ_LOGO_NATIVE_WIDTH) / TIMIQ_LOGO_NATIVE_HEIGHT);

  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- approved static brand asset */}
      <img
        alt="TimIQ"
        className="block max-w-full shrink-0 object-contain"
        decoding="async"
        draggable={false}
        height={height}
        src={TIMIQ_LOGO_SRC}
        style={{ width, height, objectFit: "contain" }}
        width={width}
      />
    </span>
  );
}
