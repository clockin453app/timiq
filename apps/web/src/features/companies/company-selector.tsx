"use client";

type CompanySelectorProps = {
  companies: { id: string; name: string }[];
  value: string | null;
  onChange: (companyId: string) => void;
  className?: string;
  label?: string;
};

export function CompanySelector(props: CompanySelectorProps) {
  const label = props.label ?? "Company";
  return (
    <label
      className={
        props.className ??
        "flex items-center gap-2 text-xs text-[var(--color-text-muted)]"
      }
    >
      <span className="hidden sm:inline">{label}</span>
      <select
        className="max-w-[10rem] rounded border border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-2 py-1 text-xs text-[var(--color-text)] sm:max-w-[14rem]"
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">Select a company…</option>
        {props.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
