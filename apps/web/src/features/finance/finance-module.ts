/** Runtime Finance module flag (server is the source of truth). */

export type FinanceModuleStatus = {
  enabled: boolean;
  readonly: boolean;
};

export async function fetchFinanceModuleStatus(
  signal?: AbortSignal,
): Promise<FinanceModuleStatus> {
  const response = await fetch("/api/finance/module-status", {
    method: "GET",
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    // Fail closed: hide Finance UI if status cannot be confirmed.
    return { enabled: false, readonly: true };
  }
  const body = (await response.json()) as Partial<FinanceModuleStatus>;
  return {
    enabled: body.enabled === true,
    readonly: body.readonly !== false,
  };
}
