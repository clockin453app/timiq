import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Override default title size (e.g. `timiq-title-lg` for primary pages). */
  titleClassName?: string;
};

export function PageHeader({ action, description, title, titleClassName }: PageHeaderProps) {
  return (
    <div className={cn(uiClasses.pageHeader)}>
      <div className="min-w-0 flex-1">
        <h1 className={cn("break-words text-balance", titleClassName ?? "timiq-title-lg")}>{title}</h1>

        {description ? (
          <p className="timiq-caption mt-1.5 max-w-[72ch] break-words">{description}</p>
        ) : null}
      </div>

      {action ? (
        <div className="flex min-w-0 w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{action}</div>
      ) : null}
    </div>
  );
}
