/**
 * Work Progress Pictures — compact filter toolbar + panel overlap fix source checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const client = read("app/(app)/work-progress-review/work-progress-review-client.tsx");
const toolbar = read("components/ui/filter-toolbar.tsx");
const index = read("components/ui/index.ts");
const globals = read("styles/globals.css");
const appShell = read("components/layout/app-shell.tsx");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// --- Phase 1 preserved behaviour ---
check("large Filters card removed", !/uppercase tracking-wider text-\[var\(--color-text-soft\)\]">Filters</.test(client));
check("no pale multi-row Filters section card", !/section className="rounded-\[var\(--radius-md\)\] border border-\[var\(--color-border-dark\)\] bg-\[var\(--color-header\)\] p-3"/.test(client));
check("compact FilterToolbar used", /FilterToolbar/.test(client) && /data-testid="filter-toolbar"/.test(toolbar));
check("FilterSearch used for category/elevation", /FilterSearch/.test(client) && /Search category\/elevation/.test(client));
check("title search maps to titleSearch / title_search", /setTitleSearch/.test(client) && /title_search: titleSearch\.trim\(\)/.test(client));
check("work category filter in panel and API", /work-progress-work-category-filter/.test(client) && /work_category: workCategory/.test(client) && /setWorkCategory/.test(client));
check("elevation filter in panel and API", /work-progress-elevation-filter/.test(client) && /elevation: elevation/.test(client) && /setElevation/.test(client));
check("level filter maps Level label to int", /work-progress-level-filter/.test(client) && /level: level === "" \? undefined : Number\(level\)/.test(client) && /LEVEL_OPTIONS/.test(client));
check("Site filter present with MapPin", /MapPin/.test(client) && /setLocationId/.test(client) && /All sites/.test(client));
check("location_id still in baseFilters", /location_id: locationId \|\| undefined/.test(client));
check("employee filtering preserved", /setEmployeeId/.test(client) && /user_id: employeeId/.test(client));
check("date filters preserved", /setDateFrom/.test(client) && /setDateTo/.test(client) && /date_from: dateFrom/.test(client));
check("archived toggle preserved", /Include archived submissions/.test(client) && /include_archived: includeArchived/.test(client));
check("activeFilterCount counts non-defaults", /activeFilterCount/.test(client) && /includeArchived/.test(client));
{
  const start = client.indexOf("const activeFilterCount = useMemo");
  const end = client.indexOf("function clearFilters", start);
  const body = client.slice(start, end > start ? end : start + 800);
  check("active count includes title/site/employee/dates/archived/classification",
    /titleSearch/.test(body) && /locationId/.test(body) && /employeeId/.test(body) && /dateFrom/.test(body) && /dateTo/.test(body) && /includeArchived/.test(body) && /workCategory/.test(body) && /elevation/.test(body) && /level/.test(body));
  check("company not counted in activeFilterCount", !/companyId/.test(body));
}
check("Clear restores defaults", /function clearFilters/.test(client) && /FilterClearAction/.test(client));
{
  const start = client.indexOf("function clearFilters()");
  const end = client.indexOf("const selectClass", start);
  const body = client.slice(start, end > start ? end : start + 500);
  check("clear resets classification filters", /setWorkCategory\(""\)/.test(body) && /setElevation\(""\)/.test(body) && /setLevel\(""\)/.test(body));
  check("clear does not reset companyId", /setIncludeArchived\(false\)/.test(body) && !/setCompanyId/.test(body));
}
check("pagination resets via clearForFilterChange", /function updateFilter[\s\S]*clearForFilterChange/.test(client) && /setSubmissionOffset\(0\)/.test(client) && /setPictureOffset\(0\)/.test(client));
check("bulk ZIP remains", /Download ZIP/.test(client) && /bulkDownloadWorkProgressAttachments/.test(client));
check("bulk delete remains", /Delete selected/.test(client) && /bulkDeleteWorkProgressAttachments/.test(client));
check("FilterButton and popover/sheet", /FilterButton/.test(client) && /FilterPopover/.test(client) && /MobileFilterSheet/.test(client));
check("mobile filter sheet exists", /data-testid="mobile-filter-sheet"/.test(toolbar) || /MobileFilterSheet/.test(client));
check("320 overflow safety", /min-w-0 max-w-full/.test(client) && /layout-mobile-bottom-nav-height/.test(client));
check("immediate filtering not Apply-only", /updateFilter\(\(\) => setTitleSearch/.test(client) && !/Apply filters/.test(client));
check("shared primitives exported", /FilterToolbar/.test(index) && /FilterSearch/.test(index) && /FilterButton/.test(index));
check("lucide Search and Filter icons", /from \"lucide-react\"/.test(toolbar) && /Filter/.test(toolbar) && /Search/.test(toolbar));
check("FilterPopover keyboard Escape", /Escape/.test(toolbar));
check("existing FilterActionRow retained", /export function FilterActionRow/.test(toolbar));

// --- Search icon overlap fix ---
{
  const fnStart = toolbar.indexOf("export function FilterSearch");
  const fnEnd = toolbar.indexOf("export type FilterButtonProps", fnStart);
  const searchFn = toolbar.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);
  check("FilterSearch uses flex gutter (not absolute overlay)",
    /flex w-full min-w-0 items-center gap-2/.test(searchFn) && !/absolute left-/.test(searchFn));
  check("FilterSearch icon is shrink-0 / fixed in gutter",
    /data-testid="filter-search-icon"/.test(searchFn) && /shrink-0/.test(searchFn));
  check("FilterSearch input has flex-1 min-w-0 (text beside icon)",
    /min-w-0 flex-1/.test(searchFn) && /type="search"/.test(searchFn));
  check("FilterSearch does not use timiq-input (avoids padding fight)",
    !/timiq-input/.test(searchFn));
  check("FilterSearch focus ring on shell (not clipped)",
    /focus-within:outline/.test(searchFn));
  check("FilterSearch has h-11 control height",
    (/h-11 min-h-11/.test(toolbar) && /controlHeight/.test(searchFn)) || /h-11/.test(searchFn));
}
check("globals .timiq-input has horizontal padding (overlap root cause context)",
  /\.timiq-input\s*\{[\s\S]*?padding/.test(globals) || /padding-left|padding:\s*|px-/.test(globals));

// --- Desktop / mobile toolbar layout ---
{
  const rowBlockStart = client.indexOf('data-testid="work-progress-filter-row"');
  const rowBlock = client.slice(Math.max(0, rowBlockStart - 200), rowBlockStart + 1200);
  check("desktop toolbar single-row (md:flex-row md:flex-nowrap)",
    /md:flex-row/.test(rowBlock) && /md:flex-nowrap/.test(rowBlock));
  check("mobile intentionally two-row (flex-col then site+filters)",
    /flex-col gap-2 md:flex-row/.test(rowBlock) && /flex w-full min-w-0 items-center gap-2 md:w-auto/.test(rowBlock));
  check("Search is flexible largest control",
    /FilterSearch[\s\S]*?className="min-w-0 flex-1/.test(rowBlock));
  check("Site width ~220–280px on desktop",
    /md:w-\[15rem\]/.test(rowBlock) && /md:max-w-\[17\.5rem\]/.test(rowBlock));
  check("no Search-only full separate desktop row",
    /md:flex-row md:flex-nowrap/.test(rowBlock) && /FilterSearch/.test(rowBlock));
}

// --- Toolbar surface ---
{
  const shellStart = toolbar.indexOf("export function FilterToolbar");
  const shellEnd = toolbar.indexOf("export type FilterSearchProps", shellStart);
  const shell = toolbar.slice(shellStart, shellEnd > shellStart ? shellEnd : shellStart + 800);
  check("toolbar surface uses cell bg + subtle border + compact padding",
    /bg-\[var\(--color-cell\)\]/.test(shell) && /border border-\[var\(--color-border\)\]/.test(shell) && /px-3 py-3/.test(shell));
}

// --- Popover portal / collision / clipping fix ---
{
  const popStart = toolbar.indexOf("export function FilterPopover");
  const popEnd = toolbar.indexOf("export function MobileFilterSheet", popStart);
  const pop = toolbar.slice(popStart, popEnd > popStart ? popEnd : popStart + 4000);
  check("FilterPopover uses createPortal to document.body",
    /createPortal\(/.test(pop) && /document\.body/.test(pop));
  check("FilterPopover uses fixed positioning (not absolute in-tree)",
    /position:\s*"fixed"/.test(pop) && !/className=\{cn\(\s*"absolute right-0/.test(pop));
  check("FilterPopover collision padding / viewport-safe",
    /computeFilterPopoverPosition/.test(toolbar) && /viewportPad = 16/.test(toolbar) && /data-collision-padding="16"/.test(pop));
  check("FilterPopover flips above when insufficient space below",
    /placeBelow/.test(toolbar) && /spaceAbove/.test(toolbar) && /spaceBelow/.test(toolbar));
  check("FilterPopover max width calc(100vw - 24px)",
    /maxWidth:\s*"calc\(100vw - 24px\)"/.test(pop));
  check("FilterPopover maxHeight from collision (~100vh-32)",
    /window\.innerHeight - 32/.test(toolbar) && /maxHeight: position\.maxHeight/.test(pop));
  check("FilterPopover sticky header + scroll body + sticky footer",
    /shrink-0[\s\S]*Close filters[\s\S]*flex-1[\s\S]*overflow-y-auto[\s\S]*footer/.test(pop));
  check("FilterPopover z-index above table (1300)",
    /FILTER_PANEL_Z = 1300/.test(toolbar) && /zIndex: FILTER_PANEL_Z/.test(pop));
  check("FilterPopover focus returns to Filters button",
    /anchor\.focus/.test(pop) || /anchorRef/.test(pop));
  check("no absolute in-tree FilterPopover class (ancestor clip root cause)",
    !/absolute right-0 z-40 mt-2/.test(toolbar));
}
check("AppShell page scroll ancestor can clip absolute children (documented cause)",
  /overflow-auto/.test(appShell) && /timiq-app-main[\s\S]*overflow-hidden/.test(appShell));

// --- Mobile sheet ---
{
  const sheetStart = toolbar.indexOf("export function MobileFilterSheet");
  const sheet = toolbar.slice(sheetStart);
  check("MobileFilterSheet uses createPortal (not in-tree Modal absolute)",
    /createPortal\(/.test(sheet) && /document\.body/.test(sheet));
  check("MobileFilterSheet is bottom-fixed with max-h 90dvh",
    /fixed inset-x-0 bottom-0/.test(sheet) && /max-h-\[90dvh\]/.test(sheet));
  check("MobileFilterSheet has backdrop + high z-index",
    /mobile-filter-sheet-backdrop/.test(sheet) && /FILTER_PANEL_Z/.test(sheet));
  check("MobileFilterSheet locks body scroll",
    /document\.body\.style\.overflow = "hidden"/.test(sheet));
  check("MobileFilterSheet sticky header and footer with safe-area",
    /shrink-0/.test(sheet) && /Close filters/.test(sheet) && /overflow-y-auto/.test(sheet) && /safe-area-inset-bottom/.test(sheet));
  check("MobileFilterSheet rounded top corners",
    /rounded-t-\[var\(--radius-lg\)\]/.test(sheet));
}
check("responsive switch popover vs sheet at md (768)",
  /min-width: 768px/.test(client) && /isDesktopFilters \? \(/.test(client) && /MobileFilterSheet/.test(client));
check("no More filters title on Work Progress", !/More filters/.test(client));
check("FilterPopover titled Filters with footer Reset/Done",
  /FilterPopover[\s\S]*?title="Filters"/.test(client) && />\s*Reset\s*</.test(client) && />\s*Done\s*</.test(client));
check("MobileFilterSheet titled Filters with Reset/Done footer",
  /MobileFilterSheet[\s\S]*?title="Filters"/.test(client) && /filterPanelFooter/.test(client));
check("mobile dates stack until md (grid-cols-1 md:grid-cols-2)",
  /grid grid-cols-1 gap-3 md:grid-cols-2/.test(client));
check("footer does not cover final field (body scrolls with padding)",
  /flex-1[\s\S]*overflow-y-auto[\s\S]*pb-4/.test(toolbar) || /overscroll-contain px-4 py-3/.test(toolbar));

// --- Employee filter usability ---
check("Search employees label", /Search employees/.test(client));
check("Employee selector label", />\s*Employee\s*\n\s*<select/.test(client) || /Employee\n\s*<select/.test(client));
check("employee search placeholder", /Search by name or email/.test(client));
check("All employees placeholder option", /<option value="">All employees<\/option>/.test(client));
check("employee select has truncation + right padding for arrow",
  /truncate/.test(client) && /pr-10/.test(client));
check("selected employee title/tooltip", /selectedEmployeeTitle/.test(client) && /title=\{selectedEmployeeTitle\}/.test(client));
check("display name then email in options", /employeeLabel\(employee\)\} — \{employee\.email\}/.test(client));

console.log(`${passed} work-progress filter panel overlap / toolbar checks passed`);
