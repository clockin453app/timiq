import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function PageHeader({ action, description, title }: PageHeaderProps) {
  return (
    <div className="timiq-sheet-header flex items-start justify-between gap-4 px-4 py-3">
      <div>
        <h1 className="timiq-title-md">{title}</h1>

        {description ? (
          <p className="timiq-caption mt-1">{description}</p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}