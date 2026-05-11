import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Override default title size (e.g. `timiq-title-lg` for primary pages). */
  titleClassName?: string;
};

export function PageHeader({ action, description, title, titleClassName }: PageHeaderProps) {
  return (
    <div className="timiq-sheet-header flex items-start justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5">
      <div className="min-w-0">
        <h1 className={titleClassName ?? "timiq-title-lg"}>{title}</h1>

        {description ? (
          <p className="timiq-caption mt-1">{description}</p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}