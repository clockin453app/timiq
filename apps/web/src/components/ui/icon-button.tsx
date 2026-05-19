import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

type IconButtonVariant = "default" | "ghost" | "danger";
type IconButtonSize = "sm" | "md" | "lg";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
};

const variantClasses: Record<IconButtonVariant, string> = {
  default:
    "border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]",
  ghost:
    "border border-transparent bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  danger:
    "border border-[var(--color-danger-700)]/30 bg-[var(--color-danger-50)] text-[var(--color-danger-700)] hover:bg-[var(--color-danger-700)] hover:text-white",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-10 w-10",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className, size = "md", type = "button", variant = "default", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)]",
        uiClasses.transitionColors,
        uiClasses.focusRing,
        uiClasses.touchTarget,
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
});
