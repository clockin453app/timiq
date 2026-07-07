import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-[var(--color-btn-primary-border)] bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-btn-primary-hover-bg)] hover:border-[var(--color-btn-primary-hover-bg)]",
  secondary:
    "border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-btn-default-hover)]",
  ghost:
    "border border-transparent bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  danger:
    "border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-danger-700)] hover:text-white",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-base md:text-sm",
  md: "h-9 px-4 text-base md:text-sm",
  lg: "h-10 px-5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className, variant = "primary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius-md)] font-semibold active:translate-y-[0.5px] disabled:pointer-events-none disabled:opacity-60",
        uiClasses.transitionColors,
        uiClasses.focusRing,
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
