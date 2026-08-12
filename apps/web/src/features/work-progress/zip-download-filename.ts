/**
 * Browser-visible Work Progress ZIP download filename from active structured filters.
 * Free-text search is intentionally excluded from the name.
 */

import {
  ELEVATION_CUSTOM_VALUE,
  ELEVATION_OPTIONS,
  WORK_CATEGORY_OPTIONS,
  formatLevelDisplay,
} from "./api";

export const WORK_PROGRESS_ZIP_BASENAME_MAX = 180;

const UNSAFE = /[/\\:*?"<>|\x00-\x1f]/g;

export type WorkProgressZipFilenameFilters = {
  siteLabel?: string | null;
  workCategory?: string | null;
  elevation?: string | null;
  level?: number | string | null;
  employeeLabel?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  downloadDate?: Date | string;
};

function collapseSeparators(value: string): string {
  return value
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Friendly label segment for ZIP outer filename (hyphenated). */
export function sanitizeZipFilenameSegment(
  label: string | null | undefined,
  fallback = "Unknown",
  options?: { titleCase?: boolean },
): string {
  const raw = (label ?? "").trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(UNSAFE, "-").replace(/\./g, "-");
  const collapsed = collapseSeparators(cleaned);
  if (!collapsed) return fallback;
  const titleCase = options?.titleCase !== false;
  const segment = titleCase
    ? collapsed
        .split("-")
        .filter(Boolean)
        .map((part) => {
          if (/^\d+$/.test(part)) return part;
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join("-")
    : collapsed;
  return segment.slice(0, 80);
}

function categoryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const found = WORK_CATEGORY_OPTIONS.find((o) => o.value === value);
  return found?.label ?? value;
}

function elevationLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === ELEVATION_CUSTOM_VALUE) return "Custom Elevation";
  const found = ELEVATION_OPTIONS.find((o) => o.value === value);
  return found?.label ?? value;
}

function levelLabel(level: number | string | null | undefined): string | null {
  if (level === "" || level == null) return null;
  const n = typeof level === "number" ? level : Number.parseInt(String(level), 10);
  if (!Number.isFinite(n)) return null;
  const padded = formatLevelDisplay(n);
  return padded == null ? null : `Level ${padded}`;
}

function formatDownloadDate(value: Date | string | undefined): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const d = value instanceof Date ? value : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateRangeSegment(dateFrom?: string | null, dateTo?: string | null): string | null {
  const from = (dateFrom || "").trim();
  const to = (dateTo || "").trim();
  if (from && to) return `${from}-to-${to}`;
  if (from) return from;
  if (to) return to;
  return null;
}

/**
 * Build `TimIQ_Work-Progress_….zip` from active structured filters only.
 */
export function buildWorkProgressZipDownloadFilename(filters: WorkProgressZipFilenameFilters): string {
  const downloadDate = formatDownloadDate(filters.downloadDate);
  const parts: string[] = ["TimIQ", "Work-Progress"];

  const site = (filters.siteLabel || "").trim();
  const category = categoryLabel(filters.workCategory);
  const elevation = elevationLabel(filters.elevation);
  const level = levelLabel(filters.level);
  const employee = (filters.employeeLabel || "").trim();
  const range = dateRangeSegment(filters.dateFrom, filters.dateTo);

  const hasStructured = Boolean(site || category || elevation || level || employee || range);
  if (!hasStructured) {
    parts.push("All");
  } else {
    if (site) parts.push(sanitizeZipFilenameSegment(site));
    if (category) parts.push(sanitizeZipFilenameSegment(category));
    if (elevation) parts.push(sanitizeZipFilenameSegment(elevation));
    if (level) parts.push(sanitizeZipFilenameSegment(level));
    if (employee) parts.push(sanitizeZipFilenameSegment(employee));
    if (range) parts.push(sanitizeZipFilenameSegment(range, range, { titleCase: false }));
  }

  parts.push(downloadDate);

  let basename = parts.join("_");
  // Cap length while keeping prefix + download date.
  if (basename.length > WORK_PROGRESS_ZIP_BASENAME_MAX) {
    const suffix = `_${downloadDate}`;
    const prefix = "TimIQ_Work-Progress_";
    const budget = WORK_PROGRESS_ZIP_BASENAME_MAX - prefix.length - suffix.length;
    const middle = parts.slice(2, -1).join("_").slice(0, Math.max(8, budget));
    basename = `${prefix}${collapseSeparators(middle)}${suffix}`.slice(0, WORK_PROGRESS_ZIP_BASENAME_MAX);
  }

  if (basename.toLowerCase().endsWith(".zip")) {
    return basename;
  }
  return `${basename}.zip`;
}
