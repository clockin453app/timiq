"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, Printer, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { Badge, Button, Input, PageHeader, SheetBody } from "../../components/ui";
import { useCurrentUser } from "../../features/auth";
import {
  GUIDE_CATEGORIES,
  GUIDE_SECTIONS,
  type GuideAudience,
  type GuideCategory,
  type GuideSection,
} from "../../features/operational-guide/content";
import { cn } from "../../lib/cn";
import { useI18n } from "../../lib/i18n";

type AudienceFilter = "all" | "employee" | "admin" | "administrator";

const selectClass =
  "h-10 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm text-[var(--color-text)]";

function categoryLabelKey(category: GuideCategory): string {
  return `guide.category_${category}`;
}

function collectSearchText(section: GuideSection): string {
  const chunks: string[] = [section.title, section.summary];
  for (const item of section.items) {
    chunks.push(item.title);
    if (item.body) {
      chunks.push(item.body);
    }
    if (item.warning) {
      chunks.push(item.warning);
    }
    if (item.bullets) {
      chunks.push(...item.bullets);
    }
  }
  return chunks.join("\n").toLowerCase();
}

function sectionMatchesAudience(section: GuideSection, filter: AudienceFilter): boolean {
  if (filter === "all") {
    return true;
  }
  return section.audience.includes(filter);
}

function sectionMatchesCategory(section: GuideSection, category: GuideCategory | "all"): boolean {
  if (category === "all") {
    return true;
  }
  return section.category === category;
}

/** Which sections appear for the signed-in role before search / audience UI filters. */
function sectionVisibleForUserRole(section: GuideSection, role: "administrator" | "admin" | "employee"): boolean {
  if (role === "administrator") {
    return true;
  }
  if (role === "admin") {
    return section.audience.some((a) => a === "admin" || a === "employee");
  }
  return section.audience.includes("employee");
}

export function HelpCentreClient() {
  const { t } = useI18n();
  const user = useCurrentUser();

  const [query, setQuery] = useState("");
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<GuideCategory | "all">("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const baseSections = useMemo(() => {
    return GUIDE_SECTIONS.filter((section) => {
      if (section.category === "operator" && user.system_role !== "administrator") {
        return false;
      }
      return sectionVisibleForUserRole(section, user.system_role);
    });
  }, [user.system_role]);

  useLayoutEffect(() => {
    setExpandedIds(new Set(baseSections.map((s) => s.id)));
  }, [baseSections]);

  useEffect(() => {
    const onBeforePrint = () => {
      document.body.classList.add("timiq-help-print");
    };
    const onAfterPrint = () => {
      document.body.classList.remove("timiq-help-print");
    };
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      document.body.classList.remove("timiq-help-print");
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const visibleSections = useMemo(() => {
    return baseSections.filter((section) => {
      if (!sectionMatchesAudience(section, audienceFilter)) {
        return false;
      }
      if (!sectionMatchesCategory(section, categoryFilter)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return collectSearchText(section).includes(normalizedQuery);
    });
  }, [audienceFilter, baseSections, categoryFilter, normalizedQuery]);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(visibleSections.map((s) => s.id)));
  }, [visibleSections]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const toggleSection = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    setAudienceFilter("all");
    setCategoryFilter("all");
    setExpandedIds(new Set(baseSections.map((s) => s.id)));
  }, [baseSections]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const audienceBadgeTone = (a: GuideAudience) => {
    if (a === "administrator") {
      return "danger" as const;
    }
    if (a === "admin") {
      return "warning" as const;
    }
    return "default" as const;
  };

  const audienceBadgeLabel = useCallback(
    (a: GuideAudience) => {
      switch (a) {
        case "employee":
          return t("guide.audience_employee");
        case "admin":
          return t("guide.audience_admin");
        case "administrator":
          return t("guide.audience_administrator");
      }
    },
    [t],
  );

  return (
    <>
      <PageHeader description={t("guide.subtitle")} title={t("guide.title")} />

      <div className="timiq-help-print-toolbar border-b border-[var(--color-border)] bg-[var(--color-sheet)] px-3 py-3 sm:px-4 md:px-5">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="min-w-0 flex-1 basis-full lg:basis-[min(100%,20rem)]">
            <label className="sr-only" htmlFor="help-guide-search">
              {t("guide.search_placeholder")}
            </label>
            <Input
              autoComplete="off"
              className="w-full min-w-0"
              id="help-guide-search"
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("guide.search_placeholder")}
              value={query}
            />
          </div>

          <label className="block min-w-0 flex-1 basis-[calc(50%-0.375rem)] sm:basis-[12rem]">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              {t("guide.filter_audience", "Audience")}
            </span>
            <select
              className={selectClass}
              onChange={(e) => setAudienceFilter(e.target.value as AudienceFilter)}
              value={audienceFilter}
            >
              <option value="all">{t("guide.audience_all")}</option>
              <option value="employee">{t("guide.audience_employee")}</option>
              <option value="admin">{t("guide.audience_admin")}</option>
              <option value="administrator">{t("guide.audience_administrator")}</option>
            </select>
          </label>

          <label className="block min-w-0 flex-1 basis-[calc(50%-0.375rem)] sm:basis-[12rem]">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              {t("guide.filter_category", "Category")}
            </span>
            <select
              className={selectClass}
              onChange={(e) => setCategoryFilter(e.target.value as GuideCategory | "all")}
              value={categoryFilter}
            >
              <option value="all">{t("guide.category_all")}</option>
              {GUIDE_CATEGORIES.filter((c) => c !== "operator" || user.system_role === "administrator").map(
                (c) => (
                  <option key={c} value={c}>
                    {t(categoryLabelKey(c))}
                  </option>
                ),
              )}
            </select>
          </label>

          <div className="flex min-w-0 flex-wrap gap-2">
            <Button size="sm" type="button" variant="secondary" onClick={expandAll}>
              {t("guide.expand_all")}
            </Button>
            <Button size="sm" type="button" variant="secondary" onClick={collapseAll}>
              {t("guide.collapse_all")}
            </Button>
            <Button size="sm" type="button" variant="secondary" onClick={handlePrint}>
              <Printer aria-hidden className="mr-1 inline h-4 w-4" />
              {t("guide.print")}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={clearFilters}
              disabled={!query && audienceFilter === "all" && categoryFilter === "all"}
            >
              <RotateCcw aria-hidden className="mr-1 inline h-4 w-4" />
              {t("guide.clear_filters")}
            </Button>
          </div>
        </div>
      </div>

      <SheetBody className="min-w-0 space-y-6 !px-3 !py-4 sm:!px-4 md:!px-5 md:!py-5">
        {visibleSections.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
            {t("guide.no_results")}
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-6 xl:flex-row xl:items-start">
            <aside className="timiq-help-print-toc xl:w-56 xl:shrink-0 xl:sticky xl:top-2 xl:self-start xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto xl:border-r xl:border-[var(--color-border)] xl:pr-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                {t("guide.table_of_contents")}
              </p>
              <nav aria-label={t("guide.table_of_contents")} className="flex flex-col gap-1 text-sm">
                {visibleSections.map((section) => (
                  <a
                    className="rounded-[var(--radius-md)] border border-transparent px-2 py-1.5 text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]"
                    href={`#${section.id}`}
                    key={section.id}
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 flex-1 space-y-4">
              {visibleSections.map((section) => {
                const open = expandedIds.has(section.id);
                return (
                  <section
                    className="scroll-mt-24 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                    id={section.id}
                    key={section.id}
                  >
                    <button
                      className="flex w-full min-w-0 items-start justify-between gap-3 px-4 py-3 text-left sm:px-5"
                      type="button"
                      onClick={() => toggleSection(section.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="timiq-title block text-base font-bold text-[var(--color-text)]">
                          {section.title}
                        </span>
                        <span className="mt-1 block text-sm text-[var(--color-text-muted)]">{section.summary}</span>
                      </span>
                      {open ? (
                        <ChevronDown aria-hidden className="mt-1 h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
                      ) : (
                        <ChevronRight aria-hidden className="mt-1 h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
                      )}
                    </button>

                    {open ? (
                      <div className="space-y-4 border-t border-[var(--color-border)] px-4 pb-4 pt-3 sm:px-5">
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="default">{t(categoryLabelKey(section.category))}</Badge>
                          {section.audience.map((a) => (
                            <Badge key={a} tone={audienceBadgeTone(a)}>
                              {audienceBadgeLabel(a)}
                            </Badge>
                          ))}
                        </div>

                        <ul className="space-y-4">
                          {section.items.map((item, itemIdx) => (
                            <li
                              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] p-4"
                              key={`${section.id}-${itemIdx}`}
                            >
                              <p className="text-sm font-semibold text-[var(--color-text)]">{item.title}</p>
                              {item.body ? (
                                <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
                                  {item.body}
                                </p>
                              ) : null}
                              {item.bullets && item.bullets.length > 0 ? (
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-[var(--color-text-muted)]">
                                  {item.bullets.map((b) => (
                                    <li key={b}>{b}</li>
                                  ))}
                                </ul>
                              ) : null}
                              {item.warning ? (
                                <p
                                  className={cn(
                                    "mt-3 rounded-[var(--radius-md)] border border-[var(--color-warning-700)]",
                                    "bg-[var(--color-warning-50)] px-3 py-2 text-sm text-[var(--color-warning-800)]",
                                  )}
                                >
                                  {item.warning}
                                </p>
                              ) : null}
                              {item.linkHref && item.linkLabel ? (
                                <div className="mt-3">
                                  <Link
                                    className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]"
                                    href={item.linkHref}
                                  >
                                    {item.linkLabel}
                                  </Link>
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </SheetBody>
    </>
  );
}
