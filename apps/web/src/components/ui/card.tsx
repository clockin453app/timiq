import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** When true, apply default card padding. */
  padded?: boolean;
};

export function Card({ children, className, padded = false, ...props }: CardProps) {
  return (
    <div
      className={cn(uiClasses.card, padded && uiClasses.cardPadding, uiClasses.transitionColors, className)}
      {...props}
    >
      {children}
    </div>
  );
}

type CardBodyProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function CardBody({ children, className, ...props }: CardBodyProps) {
  return (
    <div className={cn(uiClasses.cardBody, className)} {...props}>
      {children}
    </div>
  );
}
