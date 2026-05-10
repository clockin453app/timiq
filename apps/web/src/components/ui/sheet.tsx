import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

type SheetProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

type SheetHeaderProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

type SheetBodyProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Sheet({ children, className, ...props }: SheetProps) {
  return (
    <section className={cn("timiq-sheet", className)} {...props}>
      {children}
    </section>
  );
}

export function SheetHeader({ children, className, ...props }: SheetHeaderProps) {
  return (
    <div className={cn("timiq-sheet-header px-4 py-3", className)} {...props}>
      {children}
    </div>
  );
}

export function SheetBody({ children, className, ...props }: SheetBodyProps) {
  return (
    <div className={cn("p-4", className)} {...props}>
      {children}
    </div>
  );
}