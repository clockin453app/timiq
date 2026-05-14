"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, Input, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui";
import { isAdministrator, isAdmin, useCurrentUser } from "../../../features/auth";
import {
  archiveSmartFormTemplate,
  createSmartFormTemplate,
  EXAMPLE_SMART_FORM_SCHEMA,
  listSmartFormTemplates,
  patchSmartFormTemplate,
  type SmartFormTemplate,
  type SmartFormTemplateCreateBody,
} from "../../../features/smart-forms/api";
import { useI18n } from "../../../lib/i18n";

export function FormsManageClient() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const [items, setItems] = useState<SmartFormTemplate[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("Daily site checklist");
  const [category, setCategory] = useState("daily_checklist");
  const [schemaText, setSchemaText] = useState(JSON.stringify(EXAMPLE_SMART_FORM_SCHEMA, null, 2));
  const [companyId, setCompanyId] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const rows = await listSmartFormTemplates();
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const schema_json = JSON.parse(schemaText) as (typeof EXAMPLE_SMART_FORM_SCHEMA);
      const body: SmartFormTemplateCreateBody = {
        name,
        category,
        schema_json,
        status: "draft",
      };
      if (user && isAdministrator(user)) {
        body.company_id = companyId.trim() ? companyId.trim() : null;
      }
      await createSmartFormTemplate(body);
      setSchemaText(JSON.stringify(EXAMPLE_SMART_FORM_SCHEMA, null, 2));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    setBusy(true);
    setError("");
    try {
      await patchSmartFormTemplate(id, { status: "active" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  function canManageRow(row: SmartFormTemplate): boolean {
    if (!user) {
      return false;
    }
    if (isAdministrator(user)) {
      return true;
    }
    if (isAdmin(user) && user.company_id && row.company_id === user.company_id) {
      return true;
    }
    return false;
  }

  async function archive(id: string) {
    setBusy(true);
    setError("");
    try {
      await archiveSmartFormTemplate(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap gap-2">
        <Link className="text-sm text-[var(--color-text-muted)] hover:underline" href="/forms">
          ← {t("forms.page_title")}
        </Link>
      </div>
      <PageHeader description={t("forms.manage_intro")} title={t("forms.manage_title")} />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {user && isAdministrator(user) ? (
        <label className="flex max-w-md flex-col gap-1 text-sm">
          <span>Company ID (optional, global if empty)</span>
          <Input onChange={(e) => setCompanyId(e.target.value)} placeholder="UUID" value={companyId} />
        </label>
      ) : null}

      <section className="space-y-2 rounded border border-[var(--color-border)] bg-white p-4">
        <h2 className="text-base font-semibold">{t("forms.create_template")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            {t("forms.template_name")}
            <Input onChange={(e) => setName(e.target.value)} value={name} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("forms.category")}
            <Input onChange={(e) => setCategory(e.target.value)} value={category} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          {t("forms.schema_json")}
          <textarea
            className="timiq-input min-h-[200px] w-full font-mono text-xs"
            onChange={(e) => setSchemaText(e.target.value)}
            value={schemaText}
          />
        </label>
        <Button disabled={busy} onClick={() => void create()} type="button">
          {t("forms.create_template")}
        </Button>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("forms.manage_title")}</h2>
          <Button disabled={busy} onClick={() => void load()} type="button" variant="ghost">
            {t("common.refresh")}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("forms.template_name")}</TableHead>
              <TableHead>{t("forms.category")}</TableHead>
              <TableHead>{t("forms.status")}</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.category}</TableCell>
                <TableCell className="capitalize">{row.status}</TableCell>
                <TableCell className="space-x-2 text-right">
                  {canManageRow(row) && row.status !== "active" ? (
                    <Button disabled={busy} onClick={() => void activate(row.id)} size="sm" type="button" variant="secondary">
                      {t("forms.activate")}
                    </Button>
                  ) : null}
                  {canManageRow(row) && row.status !== "archived" ? (
                    <Button disabled={busy} onClick={() => void archive(row.id)} size="sm" type="button" variant="danger">
                      {t("forms.archive")}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
