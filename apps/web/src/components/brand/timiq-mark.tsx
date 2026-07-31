import { cn } from "../../lib/cn";

export const TIMIQ_MARK_SRC = "/branding/timiq-mark-approved.png";
export const TIMIQ_MARK_NATIVE_WIDTH = 322;
export const TIMIQ_MARK_NATIVE_HEIGHT = 369;

type TimIQMarkProps = {
  className?: string;
  decorative?: boolean;
  label?: string;
  /** Display height in CSS pixels; width follows native aspect with object-fit: contain. */
  size?: number;
};

/**
 * Approved TimIQ mark raster. Do not recolour, filter, crop, or redraw.
 */
export function TimIQMark({
  className,
  decorative = false,
  label = "TimIQ",
  size = 28,
}: TimIQMarkProps) {
  const width = Math.round((size * TIMIQ_MARK_NATIVE_WIDTH) / TIMIQ_MARK_NATIVE_HEIGHT);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- approved static brand asset
    <img
      alt={decorative ? "" : label}
      aria-hidden={decorative || undefined}
      className={cn("block shrink-0 object-contain", className)}
      decoding="async"
      draggable={false}
      height={size}
      src={TIMIQ_MARK_SRC}
      style={{ width, height: size, objectFit: "contain" }}
      width={width}
    />
  );
}
