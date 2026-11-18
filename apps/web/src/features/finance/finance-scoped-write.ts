/** Client mirror of server scoped Finance write paths (fail closed). */

export const SCOPED_WRITE_PATH_PREFIXES = [
  "/api/finance/contract-value",
  "/api/finance/budgets",
  "/api/finance/cost-to-complete",
  "/api/finance/variations",
  "/api/finance/dayworks",
  "/api/finance/commitments",
  "/api/finance/applications",
  "/api/finance/certificates",
  "/api/finance/retention-releases",
  "/api/finance/customer-receipts",
  "/api/finance/customer-receipt-allocations",
  "/api/finance/counterparties",
  "/api/finance/cost-codes",
  "/api/finance/funding",
  "/api/finance/opening-balances",
  "/api/finance/cis-splits",
  "/api/finance/hmrc-payments",
  "/api/finance/worker-allocations",
  "/api/finance/worker-payments",
  "/api/finance/supplier-payment-allocations",
  "/api/finance/supplier-payments",
  "/api/finance/customer-invoices",
  "/api/finance/cost-documents",
  "/api/finance/cis/import",
  "/api/finance/paye/import",
] as const;

/** Still blocked client-side even when scoped write is on (not activated). */
export const BLOCKED_WRITE_PATH_PREFIXES = [
  "/api/finance/projects",
  "/api/finance/project-links",
] as const;

export function isScopedWritePath(path: string): boolean {
  const clean = path.split("?")[0] ?? path;
  return SCOPED_WRITE_PATH_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`),
  );
}

export type FinancePreviewModeBody = {
  readonly?: boolean;
  preview_mode_readonly?: boolean;
  write_allowed?: boolean;
  scoped_operations?: string[];
};

/** Fail-closed interpretation of server preview-mode for UI chips/controls. */
export function interpretFinanceWriteState(body: FinancePreviewModeBody | null | undefined): {
  previewModeReadonly: boolean;
  writeAllowed: boolean;
  effectiveReadonly: boolean;
  chip: "SCOPED WRITE" | "READ-ONLY" | "LIVE WRITE";
} {
  if (!body) {
    return {
      previewModeReadonly: true,
      writeAllowed: false,
      effectiveReadonly: true,
      chip: "READ-ONLY",
    };
  }
  const previewModeReadonly =
    body.preview_mode_readonly === true
    || (body.preview_mode_readonly == null && body.readonly !== false);
  const writeAllowed = body.write_allowed === true;
  const effectiveReadonly = previewModeReadonly && !writeAllowed;
  const chip = writeAllowed
    ? "SCOPED WRITE"
    : previewModeReadonly
      ? "READ-ONLY"
      : "LIVE WRITE";
  return { previewModeReadonly, writeAllowed, effectiveReadonly, chip };
}

export function clientMaySendFinanceMutation(
  path: string,
  state: { previewModeReadonly: boolean; writeAllowed: boolean },
): boolean {
  if (!state.previewModeReadonly) return true;
  return state.writeAllowed && isScopedWritePath(path);
}
