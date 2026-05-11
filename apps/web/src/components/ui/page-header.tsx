import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Override default title size (e.g. `timiq-title-lg` for primary pages). */
  titleClassName?: string;
};

export function PageHeader({ action, description, title, titleClassName }: PageHeaderProps) {
  return (
    <div className="timiq-sheet-header flex w-full min-w-0 flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between md:px-5 md:py-3.5">
      <div className="min-w-0 flex-1">
        <h1 className={cn("break-words", titleClassName ?? "timiq-title-lg")}>{title}</h1>

        {description ? (
          <p className="timiq-caption mt-1 break-words">{description}</p>
        ) : null}
      </div>

      {action ? (
        <div className="flex min-w-0 w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">{action}</div>
      ) : null}
    </div>
  );
}