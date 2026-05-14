"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, PageHeader } from "../../../../components/ui";
import { useCurrentUser } from "../../../../features/auth";
import { createSmartFormSubmission, getSmartFormTemplate, type SmartFormTemplate } from "../../../../features/smart-forms/api";
import { fetchWorkProgressMeOptions, type WorkProgressLocationOption } from "../../../../features/work-progress/api";
import { useI18n } from "../../../../lib/i18n";

export function FormStartClient({ templateId }: { templateId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const user = useCurrentUser();
  const [template, setTemplate] = useState<SmartFormTemplate | null>(null);
  const [locations, setLocations] = useState<WorkProgressLocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [navigatorOffline, setNavigatorOffline] = useState(false);

  useEffect(() => {
    setMounted(true);
    const sync = () => setNavigatorOffline(typeof navigator !== "undefined" && !navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const offlineBlock = mounted && navigatorOffline;

  const load = useCallback(async () => {
    setError("");
    try {
      const tpl = await getSmartFormTemplate(templateId);
      setTemplate(tpl);
      if (tpl.requires_location) {
        const opt = await fetchWorkProgressMeOptions();
        setLocations(opt.locations);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [templateId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    if (!template || offlineBlock) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const loc = template.requires_location ? locationId || null : null;
      if (template.requires_location && !loc) {
        setError(t("forms.required_field"));
        return;
      }
      const created = await createSmartFormSubmission(template.id, { location_id: loc });
      router.replace(`/forms/submissions/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6">
      <PageHeader title={template?.name ?? t("forms.start_form")} description={template?.description ?? undefined} />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {!user?.company_id ? <p className="text-sm text-amber-800">{t("forms.no_company")}</p> : null}
      {offlineBlock ? <p className="text-sm text-amber-800">{t("offline.banner")}</p> : null}
      {template?.requires_location ? (
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("forms.location_label")}</span>
          <select
            className="h-9 rounded border border-[var(--color-border)] bg-white px-2 text-[var(--color-text)]"
            onChange={(e) => setLocationId(e.target.value)}
            value={locationId}
          >
            <option value="">{t("forms.select_location")}</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Button disabled={busy || !user?.company_id || offlineBlock} onClick={() => void start()} type="button">
        {busy ? t("common.loading") : t("forms.continue")}
      </Button>
    </div>
  );
}
