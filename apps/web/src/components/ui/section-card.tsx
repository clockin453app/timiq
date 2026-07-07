import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

type SectionCardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
};

export function SectionCard({
  action,
  children,
  className,
  description,
  title,
  ...props
}: SectionCardProps) {
  return (
    <section className={cn(uiClasses.card, "overflow-hidden", className)} {...props}>
      {title || description || action ? (
        <div
          className={cn(
            uiClasses.cardHeader,
            "flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between",
          )}
        >
          <div className="min-w-0 flex-1">
            {title ? <h2 className="timiq-title-md">{title}</h2> : null}
            {description ? <p className="timiq-caption mt-1.5 max-w-[72ch]">{description}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      <div className={uiClasses.cardBody}>{children}</div>
    </section>
  );
}
