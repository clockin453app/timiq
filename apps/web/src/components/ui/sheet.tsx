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
    <section className={cn("timiq-sheet w-full min-w-0 max-w-full overflow-hidden", className)} {...props}>
      {children}
    </section>
  );
}

export function SheetHeader({ children, className, ...props }: SheetHeaderProps) {
  return (
    <div className={cn("timiq-sheet-header w-full min-w-0 px-2.5 py-2.5 sm:px-4 sm:py-3", className)} {...props}>
      {children}
    </div>
  );
}

export function SheetBody({ children, className, ...props }: SheetBodyProps) {
  return (
    <div className={cn("w-full min-w-0 px-2.5 py-3 sm:px-5 sm:py-4 md:p-5", className)} {...props}>
      {children}
    </div>
  );
}