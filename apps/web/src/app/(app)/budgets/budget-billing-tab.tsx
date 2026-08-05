"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import {
  PAYMENT_METHOD_OPTIONS,
  createBudgetInvoice,
  createInvoicePayment,
  deleteBudgetInvoice,
  downloadBudgetInvoiceDocument,
  fetchBillingSummary,
  fetchBudgetInvoiceDocumentBlob,
  issueBudgetInvoice,
  listBudgetInvoices,
  listInvoicePayments,
  patchBudgetInvoice,
  reverseInvoicePayment,
  updateContractValue,
  uploadBudgetInvoiceDocument,
  voidBudgetInvoice,
  type BillingSummaryResponse,
  type InvoiceDisplayStatus,
  type InvoiceResponse,
  type PaymentMethod,
  type PaymentResponse,
} from "@/features/budgets/api";
import { formatMoney } from "@/features/payroll/format";
import { isoTodayYmd, moneyDisplay } from "./budget-ui";

type Props = {
  budgetId: string;
  archived: boolean;
  defaultCustomerName?: string | null;
};

type InvoiceModalMode = "create" | "edit" | "view";

type VatPreset = "0" | "5" | "20" | "custom";

function fieldLabelClass() {
  return "block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]";
}

function selectClass() {
  return "mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]";
}

function textareaClass() {
  return "mt-1.5 min-h-[64px] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2 text-sm text-[var(--color-text)]";
}

function invoiceModalClass() {
  return "w-full max-w-lg rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg sm:max-w-xl";
}

function billingMoney(value: string | number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const code = (currency || "GBP").trim().toUpperCase() || "GBP";
  if (code === "GBP") {
    return moneyDisplay(value);
  }
  const inner = formatMoney(String(value));
  if (inner === "—") {
    return "—";
  }
  return `${inner} ${code}`;
}

function moneyNumber(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toMoneyString(n: number): string {
  return round2(n).toFixed(2);
}

function displayStatusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "part_paid") {
    return "Part paid";
  }
  if (!s) {
    return status;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function paymentMethodLabel(method: string): string {
  const found = PAYMENT_METHOD_OPTIONS.find((o) => o.value === method);
  return found?.label || method;
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase() as InvoiceDisplayStatus | string;
  const label = displayStatusLabel(s);
  if (s === "void") {
    return (
      <Badge
        className="border-[var(--color-border-dark)] bg-transparent text-[var(--color-text-muted)]"
        tone="default"
      >
        Void
      </Badge>
    );
  }
  if (s === "overdue") {
    return <Badge tone="danger">{label}</Badge>;
  }
  if (s === "issued") {
    return <Badge tone="info">{label}</Badge>;
  }
  if (s === "part_paid") {
    return <Badge tone="warning">{label}</Badge>;
  }
  if (s === "paid") {
    return <Badge tone="success">{label}</Badge>;
  }
  return <Badge tone="default">{label}</Badge>;
}

function dateDisplay(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return String(iso).slice(0, 10);
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function newClientActionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function BudgetBillingTab({ budgetId, archived, defaultCustomerName }: Props) {
  const [summary, setSummary] = useState<BillingSummaryResponse | null>(null);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const [showContractModal, setShowContractModal] = useState(false);
  const [contractNet, setContractNet] = useState("");
  const [contractCurrency, setContractCurrency] = useState("GBP");
  const [contractError, setContractError] = useState("");

  const [invoiceModal, setInvoiceModal] = useState<InvoiceModalMode | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceResponse | null>(null);
  const [clientActionId, setClientActionId] = useState(() => newClientActionId());
  const [customerName, setCustomerName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [netAmount, setNetAmount] = useState("");
  const [vatAmount, setVatAmount] = useState("0.00");
  const [vatPreset, setVatPreset] = useState<VatPreset>("20");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [invoiceFormError, setInvoiceFormError] = useState("");
  const savingRef = useRef(false);

  const [voidTarget, setVoidTarget] = useState<InvoiceResponse | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidConfirm, setVoidConfirm] = useState(false);
  const [voidError, setVoidError] = useState("");

  const [uploadTarget, setUploadTarget] = useState<InvoiceResponse | null>(null);
  const [uploadError, setUploadError] = useState("");

  const [previewInvoice, setPreviewInvoice] = useState<InvoiceResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const [actionSuccess, setActionSuccess] = useState("");

  const [paymentTarget, setPaymentTarget] = useState<InvoiceResponse | null>(null);
  const [paymentClientActionId, setPaymentClientActionId] = useState(() => newClientActionId());
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const paymentSavingRef = useRef(false);

  const [historyTarget, setHistoryTarget] = useState<InvoiceResponse | null>(null);
  const [historyPayments, setHistoryPayments] = useState<PaymentResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [reverseTarget, setReverseTarget] = useState<PaymentResponse | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseConfirm, setReverseConfirm] = useState(false);
  const [reverseError, setReverseError] = useState("");

  const currencyHint = summary?.billing_currency || "GBP";

  const grossAmount = useMemo(() => {
    const net = Number(netAmount);
    const vat = Number(vatAmount);
    if (!Number.isFinite(net) || !Number.isFinite(vat)) {
      return "";
    }
    return toMoneyString(net + vat);
  }, [netAmount, vatAmount]);

  const overInvoiced = summary?.over_invoiced != null ? moneyNumber(summary.over_invoiced) : 0;

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sum, rows] = await Promise.all([
        fetchBillingSummary(budgetId),
        listBudgetInvoices(budgetId),
      ]);
      setSummary(sum);
      setInvoices(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load billing.");
      setSummary(null);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [budgetId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function applyVatPreset(preset: VatPreset, netStr: string) {
    setVatPreset(preset);
    if (preset === "custom") {
      return;
    }
    const net = Number(netStr);
    if (!Number.isFinite(net)) {
      setVatAmount("0.00");
      return;
    }
    const rate = Number(preset) / 100;
    setVatAmount(toMoneyString(net * rate));
  }

  function openContractModal() {
    setContractNet(
      summary?.contract_value_net != null && summary.contract_value_net !== ""
        ? String(summary.contract_value_net)
        : "",
    );
    setContractCurrency((summary?.billing_currency || "GBP").toUpperCase());
    setContractError("");
    setShowContractModal(true);
  }

  async function submitContract(ev: FormEvent) {
    ev.preventDefault();
    if (busy || archived) {
      return;
    }
    setContractError("");
    setBusy(true);
    try {
      const trimmed = contractNet.trim();
      const body =
        trimmed === ""
          ? { contract_value_net: null, billing_currency: contractCurrency.trim().toUpperCase() || null }
          : {
              contract_value_net: trimmed,
              billing_currency: contractCurrency.trim().toUpperCase() || "GBP",
            };
      const next = await updateContractValue(budgetId, body);
      setSummary(next);
      setShowContractModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update contract value.";
      setContractError(msg);
      if (msg.includes("Contract value cannot be lower than the active invoiced amount.")) {
        setContractError("Contract value cannot be lower than the active invoiced amount.");
      }
    } finally {
      setBusy(false);
    }
  }

  function resetInvoiceForm(forCreate: boolean) {
    setClientActionId(newClientActionId());
    setCustomerName(forCreate ? (defaultCustomerName?.trim() || "") : "");
    setInvoiceNumber("");
    setInvoiceDate(forCreate ? isoTodayYmd() : "");
    setDueDate("");
    setCurrency((summary?.billing_currency || "GBP").toUpperCase());
    setNetAmount("");
    setVatAmount("0.00");
    setVatPreset("20");
    setDescription("");
    setReference("");
    setPaymentTerms("");
    setPendingFile(null);
    setInvoiceFormError("");
    setEditingInvoice(null);
  }

  function openCreateInvoice() {
    resetInvoiceForm(true);
    applyVatPreset("20", "");
    setInvoiceModal("create");
  }

  function openEditInvoice(row: InvoiceResponse) {
    setClientActionId(row.client_action_id || newClientActionId());
    setEditingInvoice(row);
    setCustomerName(row.customer_name);
    setInvoiceNumber(row.invoice_number || "");
    setInvoiceDate(row.invoice_date ? String(row.invoice_date).slice(0, 10) : "");
    setDueDate(row.due_date ? String(row.due_date).slice(0, 10) : "");
    setCurrency((row.currency || "GBP").toUpperCase());
    setNetAmount(toMoneyString(moneyNumber(row.net_amount)));
    setVatAmount(toMoneyString(moneyNumber(row.vat_amount)));
    setVatPreset("custom");
    setDescription(row.description || "");
    setReference(row.reference || "");
    setPaymentTerms(row.payment_terms || "");
    setPendingFile(null);
    setInvoiceFormError("");
    setInvoiceModal("edit");
  }

  function openViewInvoice(row: InvoiceResponse) {
    setEditingInvoice(row);
    setCustomerName(row.customer_name);
    setInvoiceNumber(row.invoice_number || "");
    setInvoiceDate(row.invoice_date ? String(row.invoice_date).slice(0, 10) : "");
    setDueDate(row.due_date ? String(row.due_date).slice(0, 10) : "");
    setCurrency((row.currency || "GBP").toUpperCase());
    setNetAmount(toMoneyString(moneyNumber(row.net_amount)));
    setVatAmount(toMoneyString(moneyNumber(row.vat_amount)));
    setDescription(row.description || "");
    setReference(row.reference || "");
    setPaymentTerms(row.payment_terms || "");
    setPendingFile(null);
    setInvoiceFormError("");
    setInvoiceModal("view");
  }

  function closeInvoiceModal() {
    setInvoiceModal(null);
    setEditingInvoice(null);
    setPendingFile(null);
    setInvoiceFormError("");
  }

  async function submitInvoice(ev: FormEvent) {
    ev.preventDefault();
    if (invoiceModal === "view" || archived || savingRef.current) {
      return;
    }
    setInvoiceFormError("");
    if (!customerName.trim()) {
      setInvoiceFormError("Customer name is required.");
      return;
    }
    if (!netAmount.trim() || !Number.isFinite(Number(netAmount))) {
      setInvoiceFormError("Net amount is required.");
      return;
    }
    if (!grossAmount || !Number.isFinite(Number(grossAmount))) {
      setInvoiceFormError("Gross amount is invalid.");
      return;
    }

    savingRef.current = true;
    setBusy(true);
    try {
      let saved: InvoiceResponse;
      if (invoiceModal === "create") {
        saved = await createBudgetInvoice(budgetId, {
          client_action_id: clientActionId,
          customer_name: customerName.trim(),
          invoice_number: invoiceNumber.trim() || null,
          invoice_date: invoiceDate.trim() || null,
          due_date: dueDate.trim() || null,
          currency: currency.trim().toUpperCase() || "GBP",
          net_amount: toMoneyString(Number(netAmount)),
          vat_amount: toMoneyString(Number(vatAmount || 0)),
          gross_amount: grossAmount,
          description: description.trim() || null,
          reference: reference.trim() || null,
          payment_terms: paymentTerms.trim() || null,
        });
        if (pendingFile) {
          saved = await uploadBudgetInvoiceDocument(budgetId, saved.id, pendingFile);
        }
        setClientActionId(newClientActionId());
      } else if (invoiceModal === "edit" && editingInvoice) {
        saved = await patchBudgetInvoice(budgetId, editingInvoice.id, {
          customer_name: customerName.trim(),
          invoice_number: invoiceNumber.trim() || null,
          invoice_date: invoiceDate.trim() || null,
          due_date: dueDate.trim() || null,
          currency: currency.trim().toUpperCase() || "GBP",
          net_amount: toMoneyString(Number(netAmount)),
          vat_amount: toMoneyString(Number(vatAmount || 0)),
          gross_amount: grossAmount,
          description: description.trim() || null,
          reference: reference.trim() || null,
          payment_terms: paymentTerms.trim() || null,
        });
        if (pendingFile) {
          saved = await uploadBudgetInvoiceDocument(budgetId, saved.id, pendingFile);
        }
      } else {
        return;
      }
      void saved;
      closeInvoiceModal();
      await reload();
    } catch (err) {
      setInvoiceFormError(err instanceof Error ? err.message : "Could not save invoice.");
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  async function handleIssue(row: InvoiceResponse) {
    if (archived || busy) {
      return;
    }
    setActionError("");
    if (!row.has_document) {
      setActionError("A document is required before issuing. Upload or replace the invoice document first.");
      return;
    }
    setBusy(true);
    try {
      await issueBudgetInvoice(budgetId, row.id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not issue invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(row: InvoiceResponse) {
    if (archived || busy) {
      return;
    }
    if (!window.confirm(`Delete draft invoice ${row.invoice_number || row.id}?`)) {
      return;
    }
    setActionError("");
    setBusy(true);
    try {
      await deleteBudgetInvoice(budgetId, row.id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function submitVoid(ev: FormEvent) {
    ev.preventDefault();
    if (!voidTarget || busy) {
      return;
    }
    setVoidError("");
    if (!voidConfirm) {
      setVoidError("Confirm must be checked to void an invoice.");
      return;
    }
    if (!voidReason.trim()) {
      setVoidError("A reason is required.");
      return;
    }
    setBusy(true);
    try {
      await voidBudgetInvoice(budgetId, voidTarget.id, {
        confirm: true,
        reason: voidReason.trim(),
      });
      setVoidTarget(null);
      setVoidReason("");
      setVoidConfirm(false);
      await reload();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : "Could not void invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function submitUpload(ev: FormEvent) {
    ev.preventDefault();
    if (!uploadTarget || !pendingFile || busy || archived) {
      return;
    }
    setUploadError("");
    setBusy(true);
    try {
      await uploadBudgetInvoiceDocument(budgetId, uploadTarget.id, pendingFile);
      setUploadTarget(null);
      setPendingFile(null);
      await reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload document.");
    } finally {
      setBusy(false);
    }
  }

  async function openDocumentPreview(row: InvoiceResponse) {
    if (!row.has_document) {
      setActionError("No document attached to this invoice.");
      return;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setPreviewInvoice(row);
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewType(null);
    try {
      const { blob, contentType } = await fetchBudgetInvoiceDocumentBlob(budgetId, row.id);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewType(contentType || row.document_content_type || blob.type || null);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Could not load document.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function closeDocumentPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setPreviewInvoice(null);
    setPreviewType(null);
    setPreviewError("");
    setPreviewLoading(false);
  }

  async function handleDownload(row: InvoiceResponse) {
    setActionError("");
    setActionSuccess("");
    try {
      await downloadBudgetInvoiceDocument(budgetId, row.id, row.document_filename);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not download document.");
    }
  }

  function openRecordPayment(row: InvoiceResponse) {
    setPaymentTarget(row);
    setPaymentClientActionId(newClientActionId());
    setPaymentDate(isoTodayYmd());
    setPaymentAmount(toMoneyString(moneyNumber(row.outstanding_gross)));
    setPaymentMethod("bank_transfer");
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentError("");
    setActionSuccess("");
    setActionError("");
  }

  function closeRecordPayment() {
    setPaymentTarget(null);
    setPaymentError("");
    paymentSavingRef.current = false;
  }

  async function submitPayment(ev: FormEvent) {
    ev.preventDefault();
    if (!paymentTarget || archived || paymentSavingRef.current) {
      return;
    }
    setPaymentError("");
    setActionSuccess("");
    const amountNum = Number(paymentAmount);
    if (!paymentDate.trim()) {
      setPaymentError("Payment date is required.");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setPaymentError("Payment amount must be greater than zero.");
      return;
    }
    const outstanding = moneyNumber(paymentTarget.outstanding_gross);
    if (round2(amountNum) > round2(outstanding)) {
      setPaymentError("Payment exceeds the invoice outstanding balance.");
      return;
    }

    paymentSavingRef.current = true;
    setBusy(true);
    const startedAt = Date.now();
    try {
      const saved = await createInvoicePayment(budgetId, paymentTarget.id, {
        client_action_id: paymentClientActionId,
        payment_date: paymentDate.trim(),
        amount: toMoneyString(amountNum),
        payment_method: paymentMethod,
        reference: paymentReference.trim() || null,
        notes: paymentNotes.trim() || null,
        currency: (paymentTarget.currency || "GBP").toUpperCase(),
      });
      const createdMs = new Date(saved.created_at).getTime();
      const already =
        Number.isFinite(createdMs) && createdMs < startedAt - 500;
      setActionSuccess(
        already
          ? "Payment was already recorded successfully."
          : "Payment recorded successfully.",
      );
      closeRecordPayment();
      await reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not record payment.";
      if (msg.includes("Payment exceeds the invoice outstanding balance.")) {
        setPaymentError("Payment exceeds the invoice outstanding balance.");
      } else {
        setPaymentError(msg);
      }
    } finally {
      paymentSavingRef.current = false;
      setBusy(false);
    }
  }

  async function openPaymentHistory(row: InvoiceResponse) {
    setHistoryTarget(row);
    setHistoryPayments([]);
    setHistoryError("");
    setHistoryLoading(true);
    setReverseTarget(null);
    setReverseReason("");
    setReverseConfirm(false);
    setReverseError("");
    setActionError("");
    try {
      const rows = await listInvoicePayments(budgetId, row.id);
      setHistoryPayments(rows);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Could not load payments.");
    } finally {
      setHistoryLoading(false);
    }
  }

  function closePaymentHistory() {
    setHistoryTarget(null);
    setHistoryPayments([]);
    setHistoryError("");
    setReverseTarget(null);
    setReverseReason("");
    setReverseConfirm(false);
    setReverseError("");
  }

  async function submitReverse(ev: FormEvent) {
    ev.preventDefault();
    if (!historyTarget || !reverseTarget || busy) {
      return;
    }
    setReverseError("");
    if (!reverseConfirm) {
      setReverseError("Confirm must be checked to reverse a payment.");
      return;
    }
    if (!reverseReason.trim()) {
      setReverseError("A reason is required.");
      return;
    }
    setBusy(true);
    try {
      await reverseInvoicePayment(budgetId, historyTarget.id, reverseTarget.id, {
        confirm: true,
        reason: reverseReason.trim(),
      });
      setReverseTarget(null);
      setReverseReason("");
      setReverseConfirm(false);
      const rows = await listInvoicePayments(budgetId, historyTarget.id);
      setHistoryPayments(rows);
      await reload();
    } catch (err) {
      setReverseError(err instanceof Error ? err.message : "Could not reverse payment.");
    } finally {
      setBusy(false);
    }
  }

  function renderActions(row: InvoiceResponse) {
    const ds = row.display_status.toLowerCase();
    const btn = "min-h-[44px]";
    if (ds === "draft") {
      return (
        <div className="flex min-w-0 flex-wrap gap-1">
          {!archived ? (
            <>
              <Button className={btn} size="sm" type="button" variant="ghost" onClick={() => openEditInvoice(row)}>
                Edit
              </Button>
              <Button
                className={btn}
                size="sm"
                type="button"
                variant="secondary"
                onClick={() => {
                  setPendingFile(null);
                  setUploadError("");
                  setUploadTarget(row);
                }}
              >
                {row.has_document ? "Replace document" : "Upload document"}
              </Button>
              <Button
                className={btn}
                disabled={busy}
                size="sm"
                type="button"
                onClick={() => void handleIssue(row)}
              >
                Issue
              </Button>
              <Button
                className={btn}
                disabled={busy}
                size="sm"
                type="button"
                variant="danger"
                onClick={() => void handleDelete(row)}
              >
                Delete
              </Button>
            </>
          ) : (
            <Button className={btn} size="sm" type="button" variant="ghost" onClick={() => openViewInvoice(row)}>
              View
            </Button>
          )}
        </div>
      );
    }

    const viewDownload = (
      <>
        <Button className={btn} size="sm" type="button" variant="ghost" onClick={() => openViewInvoice(row)}>
          View
        </Button>
        {row.has_document ? (
          <Button className={btn} size="sm" type="button" variant="secondary" onClick={() => void handleDownload(row)}>
            Download
          </Button>
        ) : null}
      </>
    );

    const historyBtn = (
      <Button className={btn} size="sm" type="button" variant="secondary" onClick={() => void openPaymentHistory(row)}>
        Payment history
      </Button>
    );

    if (ds === "void") {
      return (
        <div className="flex min-w-0 flex-wrap gap-1">
          {historyBtn}
          {viewDownload}
        </div>
      );
    }

    if (ds === "paid") {
      return (
        <div className="flex min-w-0 flex-wrap gap-1">
          {historyBtn}
          {viewDownload}
          {!archived ? (
            <Button
              className={btn}
              size="sm"
              type="button"
              variant="danger"
              onClick={() => {
                setVoidReason("");
                setVoidConfirm(false);
                setVoidError("");
                setVoidTarget(row);
              }}
            >
              Void
            </Button>
          ) : null}
        </div>
      );
    }

    if (ds === "issued" || ds === "part_paid" || ds === "overdue") {
      return (
        <div className="flex min-w-0 flex-wrap gap-1">
          {!archived ? (
            <Button className={btn} size="sm" type="button" onClick={() => openRecordPayment(row)}>
              Record payment
            </Button>
          ) : null}
          {historyBtn}
          {viewDownload}
          {!archived ? (
            <Button
              className={btn}
              size="sm"
              type="button"
              variant="danger"
              onClick={() => {
                setVoidReason("");
                setVoidConfirm(false);
                setVoidError("");
                setVoidTarget(row);
              }}
            >
              Void
            </Button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="flex min-w-0 flex-wrap gap-1">
        {historyBtn}
        {viewDownload}
      </div>
    );
  }

  const readOnly = invoiceModal === "view" || archived;

  return (
    <div className="min-w-0 max-w-full space-y-4">
      {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading billing…</p> : null}
      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
          {error}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
          {actionError}
        </div>
      ) : null}
      {actionSuccess ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-success-700)]/30 bg-[var(--color-success-50)] px-3 py-2 text-sm text-[var(--color-success-700)]">
          {actionSuccess}
        </div>
      ) : null}

      {summary ? (
        <>
          <section className="min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 sm:p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Contract value</h3>
                <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                  Planned budget = costs. Contract value = customer revenue.
                </p>
                {summary.contract_value_net == null ? (
                  <p className="text-lg font-semibold text-[var(--color-text-muted)]">Not configured</p>
                ) : (
                  <p className="text-lg font-semibold tabular-nums text-[var(--color-text)]">
                    Net {billingMoney(summary.contract_value_net, summary.billing_currency)}
                    {summary.billing_currency ? (
                      <span className="ml-2 text-sm font-medium text-[var(--color-text-muted)]">
                        {summary.billing_currency}
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
              {!archived ? (
                <Button className="min-h-[44px] shrink-0" type="button" variant="secondary" onClick={openContractModal}>
                  {summary.contract_value_net == null ? "Set contract value" : "Edit contract value"}
                </Button>
              ) : null}
            </div>
          </section>

          <section className="min-w-0 max-w-full space-y-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Billing summary</h3>
            <div className="grid min-w-0 max-w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryCard
                label="Contract value Net"
                value={
                  summary.contract_value_net == null
                    ? "Not configured"
                    : billingMoney(summary.contract_value_net, currencyHint)
                }
              />
              <SummaryCard
                label="Amount invoiced Net"
                value={billingMoney(summary.active_invoiced_net, currencyHint)}
              />
              <SummaryCard label="VAT invoiced" value={billingMoney(summary.vat_invoiced, currencyHint)} />
              <SummaryCard label="Gross invoiced" value={billingMoney(summary.gross_invoiced, currencyHint)} />
              <SummaryCard
                label="Payments received — Gross"
                value={billingMoney(summary.payments_received_gross, currencyHint)}
              />
              <SummaryCard
                label="Outstanding — Gross"
                value={billingMoney(summary.outstanding_gross, currencyHint)}
              />
              <SummaryCard
                label="Overdue outstanding — Gross"
                value={billingMoney(summary.overdue_outstanding_gross, currencyHint)}
              />
              <SummaryCard
                label="Remaining to invoice"
                value={
                  summary.remaining_to_invoice == null
                    ? "—"
                    : billingMoney(summary.remaining_to_invoice, currencyHint)
                }
              />
              {overInvoiced > 0 ? (
                <SummaryCard
                  label="Over-invoiced"
                  value={billingMoney(summary.over_invoiced, currencyHint)}
                  danger
                />
              ) : null}
              <SummaryCard label="Draft count" value={String(summary.draft_count)} />
              <SummaryCard label="Overdue count" value={String(summary.overdue_count)} />
            </div>
          </section>

          <section className="min-w-0 max-w-full space-y-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Invoices</h3>
              {!archived ? (
                <Button className="min-h-[44px]" type="button" onClick={openCreateInvoice}>
                  + Create invoice
                </Button>
              ) : null}
            </div>

            {invoices.length === 0 ? (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-8 text-center">
                <p className="text-sm text-[var(--color-text-muted)]">No customer invoices yet.</p>
                {!archived ? (
                  <Button className="mt-3 min-h-[44px]" type="button" onClick={openCreateInvoice}>
                    Create first invoice
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="hidden w-full min-w-0 max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice number</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Invoice date</TableHead>
                        <TableHead>Due date</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Document</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm font-medium">{row.invoice_number || "—"}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-sm">{row.customer_name}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm tabular-nums">
                            {dateDisplay(row.invoice_date)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm tabular-nums">
                            {dateDisplay(row.due_date)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {billingMoney(row.net_amount, row.currency)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {billingMoney(row.vat_amount, row.currency)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {billingMoney(row.gross_amount, row.currency)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {billingMoney(row.payments_received_gross, row.currency)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {billingMoney(row.outstanding_gross, row.currency)}
                          </TableCell>
                          <TableCell>
                            <InvoiceStatusBadge status={row.display_status} />
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.has_document ? (
                              <button
                                className="min-h-[44px] text-left text-sm font-medium text-[var(--color-text)] underline decoration-dotted"
                                type="button"
                                onClick={() => void openDocumentPreview(row)}
                              >
                                {row.document_filename || "View"}
                              </button>
                            ) : (
                              <span className="text-[var(--color-text-muted)]">None</span>
                            )}
                          </TableCell>
                          <TableCell>{renderActions(row)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-2 md:hidden">
                  {invoices.map((row) => (
                    <div
                      key={row.id}
                      className="min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-[var(--color-text)]">
                          {row.invoice_number || "No number"}
                        </p>
                        <InvoiceStatusBadge status={row.display_status} />
                      </div>
                      <p className="mt-1 truncate text-sm text-[var(--color-text-muted)]">{row.customer_name}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {dateDisplay(row.invoice_date)} · due {dateDisplay(row.due_date)}
                      </p>
                      <p className="mt-2 text-sm tabular-nums text-[var(--color-text)]">
                        Net {billingMoney(row.net_amount, row.currency)} · VAT{" "}
                        {billingMoney(row.vat_amount, row.currency)} · Gross{" "}
                        {billingMoney(row.gross_amount, row.currency)}
                      </p>
                      <p className="mt-1 text-sm tabular-nums text-[var(--color-text)]">
                        Paid {billingMoney(row.payments_received_gross, row.currency)} · Outstanding{" "}
                        {billingMoney(row.outstanding_gross, row.currency)}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        Document:{" "}
                        {row.has_document ? (
                          <button
                            className="min-h-[44px] font-medium text-[var(--color-text)] underline decoration-dotted"
                            type="button"
                            onClick={() => void openDocumentPreview(row)}
                          >
                            {row.document_filename || "View"}
                          </button>
                        ) : (
                          "None"
                        )}
                      </p>
                      <div className="mt-2">{renderActions(row)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p className="text-xs text-[var(--color-text-muted)]">
              Billing CSV and print exports will be added later. Use the Reports tab for cost reports.
            </p>
          </section>
        </>
      ) : null}

      {showContractModal ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className={invoiceModalClass()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                {summary?.contract_value_net == null ? "Set contract value" : "Edit contract value"}
              </h3>
              <Button type="button" variant="ghost" onClick={() => setShowContractModal(false)}>
                Close
              </Button>
            </div>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              Planned budget tracks costs. Contract value is the customer revenue figure used for billing.
              Leave Net blank to clear (Not configured).
            </p>
            <form className="space-y-3" onSubmit={(ev) => void submitContract(ev)}>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Contract value Net</span>
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  onChange={(e) => setContractNet(e.target.value)}
                  placeholder="Leave blank = Not configured"
                  value={contractNet}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Currency</span>
                <Input
                  className="mt-1 uppercase"
                  maxLength={3}
                  onChange={(e) => setContractCurrency(e.target.value.toUpperCase())}
                  value={contractCurrency}
                />
              </label>
              {contractError ? <p className="text-sm text-[var(--color-danger-700)]">{contractError}</p> : null}
              <Button className="min-h-[44px]" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {invoiceModal ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className={invoiceModalClass()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                {invoiceModal === "create"
                  ? "Create invoice"
                  : invoiceModal === "edit"
                    ? "Edit invoice"
                    : "View invoice"}
              </h3>
              <Button type="button" variant="ghost" onClick={closeInvoiceModal}>
                Close
              </Button>
            </div>
            <form className="space-y-3" onSubmit={(ev) => void submitInvoice(ev)}>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Customer name</span>
                <Input
                  className="mt-1"
                  disabled={readOnly}
                  onChange={(e) => setCustomerName(e.target.value)}
                  required={!readOnly}
                  value={customerName}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Invoice number</span>
                <Input
                  className="mt-1"
                  disabled={readOnly}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  value={invoiceNumber}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Invoice date</span>
                  <Input
                    className="mt-1"
                    disabled={readOnly}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    type="date"
                    value={invoiceDate}
                  />
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Due date</span>
                  <Input
                    className="mt-1"
                    disabled={readOnly}
                    onChange={(e) => setDueDate(e.target.value)}
                    type="date"
                    value={dueDate}
                  />
                </label>
              </div>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Currency</span>
                <Input
                  className="mt-1 uppercase"
                  disabled={readOnly}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  value={currency}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Net</span>
                <Input
                  className="mt-1"
                  disabled={readOnly}
                  inputMode="decimal"
                  onChange={(e) => {
                    const v = e.target.value;
                    setNetAmount(v);
                    if (vatPreset !== "custom") {
                      applyVatPreset(vatPreset, v);
                    }
                  }}
                  required={!readOnly}
                  value={netAmount}
                />
              </label>
              {!readOnly ? (
                <div>
                  <p className={`${fieldLabelClass()} text-[var(--color-text)]`}>VAT helpers</p>
                  <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
                    {(["0", "5", "20", "custom"] as const).map((p) => (
                      <Button
                        key={p}
                        className="min-h-[44px]"
                        size="sm"
                        type="button"
                        variant={vatPreset === p ? "primary" : "secondary"}
                        onClick={() => applyVatPreset(p, netAmount)}
                      >
                        {p === "custom" ? "Custom" : `${p}%`}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">VAT</span>
                <Input
                  className="mt-1"
                  disabled={readOnly || vatPreset !== "custom"}
                  inputMode="decimal"
                  onChange={(e) => {
                    setVatPreset("custom");
                    setVatAmount(e.target.value);
                  }}
                  value={vatAmount}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Gross (Net + VAT)</span>
                <Input className="mt-1" disabled readOnly value={grossAmount} />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Description</span>
                <textarea
                  className={textareaClass()}
                  disabled={readOnly}
                  onChange={(e) => setDescription(e.target.value)}
                  value={description}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Reference</span>
                <Input
                  className="mt-1"
                  disabled={readOnly}
                  onChange={(e) => setReference(e.target.value)}
                  value={reference}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Payment terms</span>
                <Input
                  className="mt-1"
                  disabled={readOnly}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  value={paymentTerms}
                />
              </label>
              {!readOnly ? (
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Document (PDF, JPEG, PNG)</span>
                  <Input
                    accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                    className="mt-1"
                    onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                    type="file"
                  />
                  {editingInvoice?.has_document && !pendingFile ? (
                    <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                      Current: {editingInvoice.document_filename || "attached"}
                    </span>
                  ) : null}
                </label>
              ) : editingInvoice?.has_document ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Document: {editingInvoice.document_filename || "attached"}
                </p>
              ) : null}
              {invoiceFormError ? <p className="text-sm text-[var(--color-danger-700)]">{invoiceFormError}</p> : null}
              {!readOnly ? (
                <Button className="min-h-[44px]" disabled={busy} type="submit">
                  {busy ? "Saving…" : invoiceModal === "create" ? "Create invoice" : "Save changes"}
                </Button>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}

      {voidTarget ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className={invoiceModalClass()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Void invoice</h3>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setVoidTarget(null);
                  setVoidError("");
                }}
              >
                Close
              </Button>
            </div>
            <p className="mb-3 text-sm text-[var(--color-text-muted)]">
              Void {voidTarget.invoice_number || voidTarget.id}? This cannot be undone from the UI.
            </p>
            <form className="space-y-3" onSubmit={(ev) => void submitVoid(ev)}>
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  checked={voidConfirm}
                  type="checkbox"
                  onChange={(e) => setVoidConfirm(e.target.checked)}
                />
                I confirm I want to void this invoice
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Reason</span>
                <textarea
                  className={textareaClass()}
                  onChange={(e) => setVoidReason(e.target.value)}
                  required
                  value={voidReason}
                />
              </label>
              {voidError ? <p className="text-sm text-[var(--color-danger-700)]">{voidError}</p> : null}
              <Button className="min-h-[44px]" disabled={busy} type="submit" variant="danger">
                {busy ? "Voiding…" : "Void invoice"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {uploadTarget ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className={invoiceModalClass()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                {uploadTarget.has_document ? "Replace document" : "Upload document"}
              </h3>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setUploadTarget(null);
                  setPendingFile(null);
                  setUploadError("");
                }}
              >
                Close
              </Button>
            </div>
            <form className="space-y-3" onSubmit={(ev) => void submitUpload(ev)}>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">File (PDF, JPEG, PNG)</span>
                <Input
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  className="mt-1"
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                  required
                  type="file"
                />
              </label>
              {uploadError ? <p className="text-sm text-[var(--color-danger-700)]">{uploadError}</p> : null}
              <Button className="min-h-[44px]" disabled={busy || !pendingFile} type="submit">
                {busy ? "Uploading…" : "Upload"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {paymentTarget ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className={`${invoiceModalClass()} min-w-0 max-w-full`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Record payment</h3>
              <Button className="min-h-[44px]" type="button" variant="ghost" onClick={closeRecordPayment}>
                Close
              </Button>
            </div>
            <div className="mb-3 min-w-0 space-y-1 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
              <p className="font-medium text-[var(--color-text)]">
                {paymentTarget.invoice_number || "No number"} · {paymentTarget.customer_name}
              </p>
              <p className="tabular-nums text-[var(--color-text-muted)]">
                Gross {billingMoney(paymentTarget.gross_amount, paymentTarget.currency)}
              </p>
              <p className="tabular-nums text-[var(--color-text-muted)]">
                Received {billingMoney(paymentTarget.payments_received_gross, paymentTarget.currency)}
              </p>
              <p className="tabular-nums text-[var(--color-text)]">
                Outstanding {billingMoney(paymentTarget.outstanding_gross, paymentTarget.currency)}
              </p>
            </div>
            <form className="space-y-3" onSubmit={(ev) => void submitPayment(ev)}>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Payment date</span>
                <Input
                  className="mt-1 min-h-[44px]"
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                  type="date"
                  value={paymentDate}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Amount</span>
                <Input
                  className="mt-1 min-h-[44px]"
                  inputMode="decimal"
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  required
                  value={paymentAmount}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Payment method</span>
                <select
                  className={`${selectClass()} min-h-[44px]`}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  value={paymentMethod}
                >
                  {PAYMENT_METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Reference</span>
                <Input
                  className="mt-1 min-h-[44px]"
                  onChange={(e) => setPaymentReference(e.target.value)}
                  value={paymentReference}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Notes</span>
                <textarea
                  className={textareaClass()}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  value={paymentNotes}
                />
              </label>
              {paymentError ? <p className="text-sm text-[var(--color-danger-700)]">{paymentError}</p> : null}
              <Button className="min-h-[44px]" disabled={busy} type="submit">
                {busy ? "Saving…" : "Record payment"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {historyTarget ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className={`${invoiceModalClass()} min-w-0 max-w-full sm:max-w-2xl`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-base font-semibold text-[var(--color-text)]">
                Payment history · {historyTarget.invoice_number || "No number"}
              </h3>
              <Button className="min-h-[44px] shrink-0" type="button" variant="ghost" onClick={closePaymentHistory}>
                Close
              </Button>
            </div>
            {historyLoading ? <p className="text-sm text-[var(--color-text-muted)]">Loading payments…</p> : null}
            {historyError ? <p className="text-sm text-[var(--color-danger-700)]">{historyError}</p> : null}
            {!historyLoading && !historyError && historyPayments.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No payments recorded yet.</p>
            ) : null}
            <div className="min-w-0 max-w-full space-y-2">
              {historyPayments.map((pay) => (
                <div
                  key={pay.id}
                  className="min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3"
                >
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold tabular-nums text-[var(--color-text)]">
                        {billingMoney(pay.amount, pay.currency)} · {dateDisplay(pay.payment_date)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {paymentMethodLabel(pay.payment_method)}
                        {pay.reference ? ` · Ref ${pay.reference}` : ""}
                      </p>
                      {pay.notes ? (
                        <p className="text-xs text-[var(--color-text-muted)]">{pay.notes}</p>
                      ) : null}
                      {pay.is_reversed || pay.reversed_at ? (
                        <p className="text-xs font-medium text-[var(--color-danger-700)]">
                          Reversed{pay.reversal_reason ? `: ${pay.reversal_reason}` : ""}
                        </p>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </div>
                    {!archived && !pay.is_reversed && !pay.reversed_at ? (
                      <Button
                        className="min-h-[44px]"
                        size="sm"
                        type="button"
                        variant="danger"
                        onClick={() => {
                          setReverseTarget(pay);
                          setReverseReason("");
                          setReverseConfirm(false);
                          setReverseError("");
                        }}
                      >
                        Reverse
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {reverseTarget && historyTarget ? (
        <div className="fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className={`${invoiceModalClass()} min-w-0 max-w-full`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Reverse payment</h3>
              <Button
                className="min-h-[44px]"
                type="button"
                variant="ghost"
                onClick={() => {
                  setReverseTarget(null);
                  setReverseError("");
                }}
              >
                Close
              </Button>
            </div>
            <p className="mb-3 text-sm text-[var(--color-text-muted)]">
              Reverse {billingMoney(reverseTarget.amount, reverseTarget.currency)} dated{" "}
              {dateDisplay(reverseTarget.payment_date)}? This cannot be undone from the UI.
            </p>
            <form className="space-y-3" onSubmit={(ev) => void submitReverse(ev)}>
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  checked={reverseConfirm}
                  type="checkbox"
                  onChange={(e) => setReverseConfirm(e.target.checked)}
                />
                I confirm I want to reverse this payment
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Reason</span>
                <textarea
                  className={textareaClass()}
                  onChange={(e) => setReverseReason(e.target.value)}
                  required
                  value={reverseReason}
                />
              </label>
              {reverseError ? <p className="text-sm text-[var(--color-danger-700)]">{reverseError}</p> : null}
              <Button className="min-h-[44px]" disabled={busy} type="submit" variant="danger">
                {busy ? "Reversing…" : "Reverse payment"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {previewInvoice ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="w-full min-w-0 max-w-3xl rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-base font-semibold text-[var(--color-text)]">
                {previewInvoice.document_filename || "Invoice document"}
              </h3>
              <Button type="button" variant="ghost" onClick={closeDocumentPreview}>
                Close
              </Button>
            </div>
            {previewLoading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}
            {previewError ? <p className="text-sm text-[var(--color-danger-700)]">{previewError}</p> : null}
            {previewUrl ? (
              previewType?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" className="max-h-[70vh] w-full object-contain" src={previewUrl} />
              ) : (
                <iframe className="h-[70vh] w-full min-w-0 rounded border border-[var(--color-border)]" src={previewUrl} title="Invoice document" />
              )
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="min-h-[44px]"
                type="button"
                variant="secondary"
                onClick={() => void handleDownload(previewInvoice)}
              >
                Download
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard(props: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">{props.label}</p>
      </div>
      <div className="px-3 py-3">
        <p
          className={
            props.danger
              ? "text-lg font-semibold tabular-nums text-[var(--color-danger-700)]"
              : "text-lg font-semibold tabular-nums text-[var(--color-text)]"
          }
        >
          {props.value}
        </p>
      </div>
    </div>
  );
}
