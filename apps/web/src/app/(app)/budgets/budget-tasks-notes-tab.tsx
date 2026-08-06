"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  cancelBudgetTask,
  completeBudgetTask,
  createBudgetNote,
  createBudgetTask,
  deleteBudgetNote,
  deleteBudgetTask,
  fetchTaskSummary,
  listBudgetNotes,
  listBudgetTasks,
  patchBudgetNote,
  patchBudgetTask,
  pinBudgetNote,
  reopenBudgetTask,
  unpinBudgetNote,
  type BudgetProjectNoteResponse,
  type BudgetTaskResponse,
  type BudgetTaskSummaryResponse,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
} from "@/features/budgets/api";
import { type AuthUser } from "@/features/auth/api";
import { listManagedUsers } from "@/features/auth/user-management-api";

type Props = {
  budgetId: string;
  archived: boolean;
};

const NOTE_BODY_MAX = 5000;

function fieldLabelClass() {
  return "block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]";
}

function selectClass() {
  return "mt-1.5 h-10 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]";
}

function textareaClass() {
  return "mt-1.5 min-h-[80px] w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 py-2 text-sm text-[var(--color-text)]";
}

function modalClass() {
  return "flex min-h-full w-full min-w-0 max-w-full flex-col rounded-none border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg sm:min-h-0 sm:max-w-lg sm:rounded-[var(--radius-md)]";
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

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    to_do: "To do",
    in_progress: "In progress",
    blocked: "Blocked",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return map[status] || status;
}

function priorityLabel(priority: string): string {
  if (!priority) {
    return priority;
  }
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function categoryLabel(category: string): string {
  if (!category) {
    return category;
  }
  return category.charAt(0).toUpperCase() + category.slice(1);
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

function dateTimeDisplay(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return String(iso);
  }
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TaskStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const label = statusLabel(s);
  if (s === "completed") {
    return <Badge tone="success">{label}</Badge>;
  }
  if (s === "blocked") {
    return <Badge tone="danger">{label}</Badge>;
  }
  if (s === "in_progress") {
    return <Badge tone="info">{label}</Badge>;
  }
  if (s === "cancelled") {
    return (
      <Badge
        className="border-[var(--color-border-dark)] bg-transparent text-[var(--color-text-muted)]"
        tone="default"
      >
        {label}
      </Badge>
    );
  }
  if (s === "to_do") {
    return <Badge tone="default">{label}</Badge>;
  }
  return <Badge tone="default">{label}</Badge>;
}

function SummaryChip(props: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div
      className={
        props.emphasis
          ? "min-w-0 rounded-[var(--radius-md)] border border-[var(--color-danger-700)]/40 bg-[var(--color-danger-50)] px-2.5 py-1.5"
          : "min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2.5 py-1.5"
      }
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">{props.label}</p>
      <p
        className={
          props.emphasis
            ? "text-sm font-semibold tabular-nums text-[var(--color-danger-700)]"
            : "text-sm font-semibold tabular-nums text-[var(--color-text)]"
        }
      >
        {props.value}
      </p>
    </div>
  );
}

export function BudgetTasksNotesTab({ budgetId, archived }: Props) {
  const [summary, setSummary] = useState<BudgetTaskSummaryResponse | null>(null);
  const [tasks, setTasks] = useState<BudgetTaskResponse[]>([]);
  const [notes, setNotes] = useState<BudgetProjectNoteResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const [showCompleted, setShowCompleted] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterOverdue, setFilterOverdue] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");

  const [quickTitle, setQuickTitle] = useState("");
  const [quickDue, setQuickDue] = useState("");
  const [quickPriority, setQuickPriority] = useState<TaskPriority>("normal");
  const [quickCategory, setQuickCategory] = useState<TaskCategory>("general");
  const quickSavingRef = useRef(false);

  const [editTask, setEditTask] = useState<BudgetTaskResponse | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<TaskPriority>("normal");
  const [editCategory, setEditCategory] = useState<TaskCategory>("general");
  const [editDue, setEditDue] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("to_do");
  const [editAssigneeId, setEditAssigneeId] = useState("");
  const [editFormError, setEditFormError] = useState("");
  const editSavingRef = useRef(false);
  const [managerOptions, setManagerOptions] = useState<AuthUser[]>([]);
  const [managersLoadError, setManagersLoadError] = useState("");

  const [noteDraft, setNoteDraft] = useState("");
  const [showNoteComposer, setShowNoteComposer] = useState(false);
  const noteSavingRef = useRef(false);

  const [editNote, setEditNote] = useState<BudgetProjectNoteResponse | null>(null);
  const [editNoteBody, setEditNoteBody] = useState("");
  const [editNoteError, setEditNoteError] = useState("");
  const noteEditSavingRef = useRef(false);

  const reload = useCallback(async (opts?: { quiet?: boolean }): Promise<boolean> => {
    if (!opts?.quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const overdueParam =
        filterOverdue === "true" ? true : filterOverdue === "false" ? false : null;
      const [sum, taskRows, noteRows] = await Promise.all([
        fetchTaskSummary(budgetId),
        listBudgetTasks(budgetId, {
          status: filterStatus || null,
          priority: filterPriority || null,
          category: filterCategory || null,
          overdue: overdueParam,
          includeCompleted: showCompleted,
          search: searchApplied.trim() || null,
        }),
        listBudgetNotes(budgetId),
      ]);
      setSummary(sum);
      setTasks(taskRows);
      setNotes(noteRows);
      return true;
    } catch (err) {
      if (!opts?.quiet) {
        setError(err instanceof Error ? err.message : "Could not load tasks and notes.");
        setSummary(null);
        setTasks([]);
        setNotes([]);
      }
      return false;
    } finally {
      if (!opts?.quiet) {
        setLoading(false);
      }
    }
  }, [
    budgetId,
    filterCategory,
    filterOverdue,
    filterPriority,
    filterStatus,
    searchApplied,
    showCompleted,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    async function loadManagers() {
      setManagersLoadError("");
      try {
        const companyId = summary?.company_id;
        const users = await listManagedUsers(companyId || undefined);
        if (cancelled) {
          return;
        }
        setManagerOptions(
          users.filter((u) => u.system_role === "admin" || u.system_role === "administrator"),
        );
      } catch {
        if (!cancelled) {
          setManagerOptions([]);
          setManagersLoadError("Could not load management assignees.");
        }
      }
    }
    void loadManagers();
    return () => {
      cancelled = true;
    };
  }, [summary?.company_id]);

  useEffect(() => {
    if (!actionSuccess) {
      return;
    }
    const t = window.setTimeout(() => setActionSuccess(""), 4000);
    return () => window.clearTimeout(t);
  }, [actionSuccess]);

  function managerLabel(userId: string | null | undefined): string {
    if (!userId) {
      return "—";
    }
    const found = managerOptions.find((u) => u.id === userId);
    if (!found) {
      return userId;
    }
    const name = [found.profile_first_name, found.profile_last_name].filter(Boolean).join(" ").trim();
    return name ? `${name} (${found.email})` : found.email;
  }

  async function refreshAfterSave(saveOkMessage: string) {
    const ok = await reload({ quiet: true });
    if (ok) {
      setActionSuccess(saveOkMessage);
    } else {
      setActionError("Saved successfully, but the list could not be refreshed. Reload the page to see updates.");
    }
  }

  async function submitQuickAdd(ev: FormEvent) {
    ev.preventDefault();
    if (archived || quickSavingRef.current) {
      return;
    }
    setActionError("");
    const title = quickTitle.trim();
    if (!title) {
      setActionError("Task title is required.");
      return;
    }
    quickSavingRef.current = true;
    setBusy(true);
    try {
      await createBudgetTask(budgetId, {
        client_action_id: newClientActionId(),
        title,
        due_date: quickDue.trim() || null,
        priority: quickPriority,
        category: quickCategory,
      });
      setQuickTitle("");
      setQuickDue("");
      setQuickPriority("normal");
      setQuickCategory("general");
      await refreshAfterSave("Task created.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not create task.");
    } finally {
      quickSavingRef.current = false;
      setBusy(false);
    }
  }

  function openEditTask(row: BudgetTaskResponse) {
    setEditTask(row);
    setEditTitle(row.title);
    setEditDescription(row.description || "");
    setEditPriority((row.priority as TaskPriority) || "normal");
    setEditCategory((row.category as TaskCategory) || "general");
    setEditDue(row.due_date ? String(row.due_date).slice(0, 10) : "");
    setEditStatus((row.status as TaskStatus) || "to_do");
    setEditAssigneeId(row.assignee_user_id || "");
    setEditFormError("");
  }

  function closeEditTask() {
    setEditTask(null);
    setEditFormError("");
    editSavingRef.current = false;
  }

  async function submitEditTask(ev: FormEvent) {
    ev.preventDefault();
    if (!editTask || archived || editSavingRef.current) {
      return;
    }
    setEditFormError("");
    if (!editTitle.trim()) {
      setEditFormError("Title is required.");
      return;
    }
    const terminal = editTask.status === "completed" || editTask.status === "cancelled";
    if (terminal) {
      setEditFormError("Completed or cancelled tasks cannot be edited; reopen first.");
      return;
    }
    editSavingRef.current = true;
    setBusy(true);
    try {
      await patchBudgetTask(budgetId, editTask.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        priority: editPriority,
        category: editCategory,
        due_date: editDue.trim() || null,
        status: editStatus,
        assignee_user_id: editAssigneeId.trim() || null,
      });
      closeEditTask();
      await refreshAfterSave("Task updated.");
    } catch (err) {
      setEditFormError(err instanceof Error ? err.message : "Could not save task.");
    } finally {
      editSavingRef.current = false;
      setBusy(false);
    }
  }

  async function runTaskAction(
    label: string,
    fn: () => Promise<unknown>,
  ) {
    if (archived || busy) {
      return;
    }
    setActionError("");
    setBusy(true);
    try {
      await fn();
      await refreshAfterSave(`${label} succeeded.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Could not ${label.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleStart(row: BudgetTaskResponse) {
    await runTaskAction("Start", () =>
      patchBudgetTask(budgetId, row.id, { status: "in_progress" }),
    );
  }

  async function handleBlock(row: BudgetTaskResponse) {
    await runTaskAction("Block", () => patchBudgetTask(budgetId, row.id, { status: "blocked" }));
  }

  async function handleComplete(row: BudgetTaskResponse) {
    await runTaskAction("Complete", () => completeBudgetTask(budgetId, row.id));
  }

  async function handleReopen(row: BudgetTaskResponse) {
    await runTaskAction("Reopen", () => reopenBudgetTask(budgetId, row.id, { target_status: "to_do" }));
  }

  async function handleCancel(row: BudgetTaskResponse) {
    if (!window.confirm(`Cancel task “${row.title}”?`)) {
      return;
    }
    await runTaskAction("Cancel", () => cancelBudgetTask(budgetId, row.id));
  }

  async function handleDelete(row: BudgetTaskResponse) {
    if (row.status !== "to_do") {
      return;
    }
    if (!window.confirm(`Delete task “${row.title}”? Only never-started to-do tasks can be deleted.`)) {
      return;
    }
    await runTaskAction("Delete", () => deleteBudgetTask(budgetId, row.id));
  }

  async function submitNote(ev: FormEvent) {
    ev.preventDefault();
    if (archived || noteSavingRef.current) {
      return;
    }
    setActionError("");
    const body = noteDraft.trim();
    if (!body) {
      setActionError("Note body is required.");
      return;
    }
    if (body.length > NOTE_BODY_MAX) {
      setActionError(`Note must be at most ${NOTE_BODY_MAX} characters.`);
      return;
    }
    noteSavingRef.current = true;
    setBusy(true);
    try {
      await createBudgetNote(budgetId, {
        client_action_id: newClientActionId(),
        body,
      });
      setNoteDraft("");
      setShowNoteComposer(false);
      await refreshAfterSave("Note saved.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save note.");
    } finally {
      noteSavingRef.current = false;
      setBusy(false);
    }
  }

  function openEditNote(row: BudgetProjectNoteResponse) {
    setEditNote(row);
    setEditNoteBody(row.body);
    setEditNoteError("");
  }

  function closeEditNote() {
    setEditNote(null);
    setEditNoteError("");
    noteEditSavingRef.current = false;
  }

  async function submitEditNote(ev: FormEvent) {
    ev.preventDefault();
    if (!editNote || archived || noteEditSavingRef.current) {
      return;
    }
    setEditNoteError("");
    const body = editNoteBody.trim();
    if (!body) {
      setEditNoteError("Note body is required.");
      return;
    }
    if (body.length > NOTE_BODY_MAX) {
      setEditNoteError(`Note must be at most ${NOTE_BODY_MAX} characters.`);
      return;
    }
    noteEditSavingRef.current = true;
    setBusy(true);
    try {
      await patchBudgetNote(budgetId, editNote.id, { body });
      closeEditNote();
      await refreshAfterSave("Note updated.");
    } catch (err) {
      setEditNoteError(err instanceof Error ? err.message : "Could not update note.");
    } finally {
      noteEditSavingRef.current = false;
      setBusy(false);
    }
  }

  async function handlePinToggle(row: BudgetProjectNoteResponse) {
    if (archived || busy) {
      return;
    }
    setActionError("");
    setBusy(true);
    try {
      if (row.is_pinned) {
        await unpinBudgetNote(budgetId, row.id);
        await refreshAfterSave("Note unpinned.");
      } else {
        await pinBudgetNote(budgetId, row.id);
        await refreshAfterSave("Note pinned.");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update pin.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteNote(row: BudgetProjectNoteResponse) {
    if (archived || busy) {
      return;
    }
    if (!window.confirm("Delete this project note?")) {
      return;
    }
    setActionError("");
    setBusy(true);
    try {
      await deleteBudgetNote(budgetId, row.id);
      await refreshAfterSave("Note deleted.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete note.");
    } finally {
      setBusy(false);
    }
  }

  function renderTaskActions(row: BudgetTaskResponse) {
    const s = row.status;
    const btn = "min-h-[44px]";
    const active = s === "to_do" || s === "in_progress" || s === "blocked";
    const terminal = s === "completed" || s === "cancelled";

    if (archived) {
      return (
        <span className="text-xs text-[var(--color-text-muted)]">Read only</span>
      );
    }

    return (
      <div className="flex min-w-0 flex-wrap gap-1">
        {active ? (
          <Button
            aria-label={`Edit task ${row.title}`}
            className={btn}
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => openEditTask(row)}
          >
            Edit
          </Button>
        ) : null}
        {s === "to_do" || s === "blocked" ? (
          <Button
            aria-label={`Start task ${row.title}`}
            className={btn}
            disabled={busy}
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => void handleStart(row)}
          >
            Start
          </Button>
        ) : null}
        {(s === "to_do" || s === "in_progress") ? (
          <Button
            aria-label={`Block task ${row.title}`}
            className={btn}
            disabled={busy}
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => void handleBlock(row)}
          >
            Block
          </Button>
        ) : null}
        {active ? (
          <Button
            aria-label={`Complete task ${row.title}`}
            className={btn}
            disabled={busy}
            size="sm"
            type="button"
            onClick={() => void handleComplete(row)}
          >
            Complete
          </Button>
        ) : null}
        {terminal ? (
          <Button
            aria-label={`Reopen task ${row.title}`}
            className={btn}
            disabled={busy}
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => void handleReopen(row)}
          >
            Reopen
          </Button>
        ) : null}
        {active ? (
          <Button
            aria-label={`Cancel task ${row.title}`}
            className={btn}
            disabled={busy}
            size="sm"
            type="button"
            variant="danger"
            onClick={() => void handleCancel(row)}
          >
            Cancel
          </Button>
        ) : null}
        {s === "to_do" ? (
          <Button
            aria-label={`Delete task ${row.title}`}
            className={btn}
            disabled={busy}
            size="sm"
            type="button"
            variant="danger"
            onClick={() => void handleDelete(row)}
          >
            Delete
          </Button>
        ) : null}
      </div>
    );
  }

  function taskMetaLine(row: BudgetTaskResponse) {
    return (
      <>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[var(--color-text)]">{statusLabel(row.status)}</span>
          <TaskStatusBadge status={row.status} />
        </span>
        <span> · {priorityLabel(row.priority)}</span>
        <span> · {categoryLabel(row.category)}</span>
        <span> · Due {dateDisplay(row.due_date)}</span>
        {row.is_overdue ? (
          <span className="font-medium text-[var(--color-danger-700)]"> · Overdue</span>
        ) : null}
        {row.assignee_user_id ? (
          <span className="text-[var(--color-text-muted)]"> · Assignee {managerLabel(row.assignee_user_id)}</span>
        ) : null}
      </>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-6">
      {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading tasks and notes…</p> : null}
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

      {/* —— Tasks —— */}
      <section className="min-w-0 max-w-full space-y-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Tasks</h3>
            {summary ? (
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {summary.outstanding} outstanding
                {summary.overdue > 0 ? (
                  <span className="text-[var(--color-danger-700)]"> · {summary.overdue} overdue</span>
                ) : (
                  <span> · {summary.overdue} overdue</span>
                )}
              </p>
            ) : null}
          </div>
          <Button
            className="min-h-[44px] shrink-0"
            type="button"
            variant="secondary"
            onClick={() => setShowCompleted((v) => !v)}
          >
            {showCompleted ? "Hide completed" : "Show completed"}
          </Button>
        </div>

        {summary ? (
          <div className="grid min-w-0 max-w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryChip label="Outstanding" value={summary.outstanding} />
            <SummaryChip label="In progress" value={summary.in_progress} />
            <SummaryChip label="Blocked" value={summary.blocked} />
            <SummaryChip emphasis={summary.overdue > 0} label="Overdue" value={summary.overdue} />
            <SummaryChip label="Completed" value={summary.completed} />
          </div>
        ) : null}

        {!archived ? (
          <form
            className="min-w-0 max-w-full space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3"
            onSubmit={(ev) => void submitQuickAdd(ev)}
          >
            <p className="text-xs font-semibold text-[var(--color-text)]">Quick add</p>
            <div className="grid min-w-0 max-w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className={`min-w-0 sm:col-span-2 lg:col-span-1 ${fieldLabelClass()}`}>
                <span className="text-[var(--color-text)]">Title</span>
                <Input
                  className="mt-1 min-h-[44px]"
                  onChange={(e) => setQuickTitle(e.target.value)}
                  placeholder="Task title"
                  value={quickTitle}
                />
              </label>
              <label className={`min-w-0 ${fieldLabelClass()}`}>
                <span className="text-[var(--color-text)]">Due date</span>
                <Input
                  className="mt-1 min-h-[44px]"
                  onChange={(e) => setQuickDue(e.target.value)}
                  type="date"
                  value={quickDue}
                />
              </label>
              <label className={`min-w-0 ${fieldLabelClass()}`}>
                <span className="text-[var(--color-text)]">Priority</span>
                <select
                  className={`${selectClass()} min-h-[44px]`}
                  onChange={(e) => setQuickPriority(e.target.value as TaskPriority)}
                  value={quickPriority}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`min-w-0 ${fieldLabelClass()}`}>
                <span className="text-[var(--color-text)]">Category</span>
                <select
                  className={`${selectClass()} min-h-[44px]`}
                  onChange={(e) => setQuickCategory(e.target.value as TaskCategory)}
                  value={quickCategory}
                >
                  {TASK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Button className="min-h-[44px]" disabled={busy} type="submit">
              {busy && quickSavingRef.current ? "Adding…" : "Add task"}
            </Button>
          </form>
        ) : null}

        <div className="flex min-w-0 max-w-full flex-wrap gap-2">
          <label className={`min-w-0 grow basis-[140px] ${fieldLabelClass()}`}>
            <span className="text-[var(--color-text)]">Status</span>
            <select
              className={`${selectClass()} min-h-[44px]`}
              onChange={(e) => setFilterStatus(e.target.value)}
              value={filterStatus}
            >
              <option value="">All</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className={`min-w-0 grow basis-[140px] ${fieldLabelClass()}`}>
            <span className="text-[var(--color-text)]">Priority</span>
            <select
              className={`${selectClass()} min-h-[44px]`}
              onChange={(e) => setFilterPriority(e.target.value)}
              value={filterPriority}
            >
              <option value="">All</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className={`min-w-0 grow basis-[140px] ${fieldLabelClass()}`}>
            <span className="text-[var(--color-text)]">Category</span>
            <select
              className={`${selectClass()} min-h-[44px]`}
              onChange={(e) => setFilterCategory(e.target.value)}
              value={filterCategory}
            >
              <option value="">All</option>
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className={`min-w-0 grow basis-[140px] ${fieldLabelClass()}`}>
            <span className="text-[var(--color-text)]">Overdue</span>
            <select
              className={`${selectClass()} min-h-[44px]`}
              onChange={(e) => setFilterOverdue(e.target.value)}
              value={filterOverdue}
            >
              <option value="">All</option>
              <option value="true">Overdue only</option>
              <option value="false">Not overdue</option>
            </select>
          </label>
          <label className={`min-w-0 grow basis-full sm:basis-[180px] ${fieldLabelClass()}`}>
            <span className="text-[var(--color-text)]">Search</span>
            <Input
              className="mt-1 min-h-[44px]"
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Search title or description"
              value={filterSearch}
            />
          </label>
          <div className="flex min-w-0 items-end">
            <Button
              className="min-h-[44px]"
              type="button"
              variant="secondary"
              onClick={() => setSearchApplied(filterSearch)}
            >
              Apply search
            </Button>
          </div>
        </div>

        {tasks.length === 0 && !loading ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-8 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">No tasks match the current filters.</p>
          </div>
        ) : (
          <>
            <div className="hidden w-full min-w-0 max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-0 max-w-[220px]">
                        <p className="truncate text-sm font-medium text-[var(--color-text)]">{row.title}</p>
                        {row.description ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-text-muted)]">
                            {row.description}
                          </p>
                        ) : null}
                        {row.is_overdue ? (
                          <p className="mt-0.5 text-xs font-medium text-[var(--color-danger-700)]">Overdue</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="text-xs text-[var(--color-text)]">{statusLabel(row.status)}</span>
                          <TaskStatusBadge status={row.status} />
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{priorityLabel(row.priority)}</TableCell>
                      <TableCell className="text-sm">{categoryLabel(row.category)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {dateDisplay(row.due_date)}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs text-[var(--color-text-muted)]">
                        {managerLabel(row.assignee_user_id)}
                      </TableCell>
                      <TableCell>{renderTaskActions(row)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2 sm:hidden">
              {tasks.map((row) => (
                <div
                  key={row.id}
                  className="min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3"
                >
                  <p className="min-w-0 break-words text-sm font-semibold text-[var(--color-text)]">{row.title}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{taskMetaLine(row)}</p>
                  {row.description ? (
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-[var(--color-text)]">
                      {row.description}
                    </p>
                  ) : null}
                  <div className="mt-2">{renderTaskActions(row)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* —— Project notes (separate from tasks) —— */}
      <section className="min-w-0 max-w-full space-y-3 border-t border-[var(--color-border)] pt-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Project notes</h3>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Free-form notes for this budget. Pinned notes appear first.
            </p>
          </div>
          {!archived && !showNoteComposer ? (
            <Button
              className="min-h-[44px]"
              type="button"
              onClick={() => {
                setShowNoteComposer(true);
                setNoteDraft("");
                setActionError("");
              }}
            >
              Add note
            </Button>
          ) : null}
        </div>

        {!archived && showNoteComposer ? (
          <form
            className="min-w-0 max-w-full space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3"
            onSubmit={(ev) => void submitNote(ev)}
          >
            <label className={fieldLabelClass()}>
              <span className="text-[var(--color-text)]">Note</span>
              <textarea
                className={textareaClass()}
                maxLength={NOTE_BODY_MAX}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Write a project note…"
                value={noteDraft}
              />
            </label>
            <p className="text-xs text-[var(--color-text-muted)]">
              {noteDraft.length}/{NOTE_BODY_MAX}
            </p>
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button className="min-h-[44px]" disabled={busy} type="submit">
                {busy && noteSavingRef.current ? "Saving…" : "Save"}
              </Button>
              <Button
                className="min-h-[44px]"
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowNoteComposer(false);
                  setNoteDraft("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {notes.length === 0 && !loading ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">No project notes yet.</p>
          </div>
        ) : (
          <div className="min-w-0 max-w-full space-y-2">
            {notes.map((row) => (
              <div
                key={row.id}
                className="min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {row.is_pinned ? (
                    <span className="text-xs font-semibold text-[var(--color-text)]">Pinned</span>
                  ) : null}
                  <span className="text-xs text-[var(--color-text-muted)]">
                    Author {row.created_by_user_id || "—"}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--color-text)]">{row.body}</p>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Created {dateTimeDisplay(row.created_at)}
                  {row.updated_at && row.updated_at !== row.created_at
                    ? ` · Updated ${dateTimeDisplay(row.updated_at)}`
                    : ""}
                </p>
                {!archived ? (
                  <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                    <Button
                      aria-label="Edit note"
                      className="min-h-[44px]"
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => openEditNote(row)}
                    >
                      Edit
                    </Button>
                    <Button
                      aria-label={row.is_pinned ? "Unpin note" : "Pin note"}
                      className="min-h-[44px]"
                      disabled={busy}
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={() => void handlePinToggle(row)}
                    >
                      {row.is_pinned ? "Unpin" : "Pin"}
                    </Button>
                    <Button
                      aria-label="Delete note"
                      className="min-h-[44px]"
                      disabled={busy}
                      size="sm"
                      type="button"
                      variant="danger"
                      onClick={() => void handleDeleteNote(row)}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {editTask ? (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/40 sm:flex sm:items-start sm:justify-center sm:p-4">
          <div className={modalClass()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Edit task</h3>
              <Button className="min-h-[44px]" type="button" variant="ghost" onClick={closeEditTask}>
                Close
              </Button>
            </div>
            <form className="min-w-0 space-y-3" onSubmit={(ev) => void submitEditTask(ev)}>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Title</span>
                <Input
                  className="mt-1 min-h-[44px]"
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  value={editTitle}
                />
              </label>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Description</span>
                <textarea
                  className={textareaClass()}
                  onChange={(e) => setEditDescription(e.target.value)}
                  value={editDescription}
                />
              </label>
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Status</span>
                  <select
                    className={`${selectClass()} min-h-[44px]`}
                    onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                    value={editStatus}
                  >
                    {(["to_do", "in_progress", "blocked"] as const).map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Priority</span>
                  <select
                    className={`${selectClass()} min-h-[44px]`}
                    onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
                    value={editPriority}
                  >
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {priorityLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Category</span>
                  <select
                    className={`${selectClass()} min-h-[44px]`}
                    onChange={(e) => setEditCategory(e.target.value as TaskCategory)}
                    value={editCategory}
                  >
                    {TASK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={fieldLabelClass()}>
                  <span className="text-[var(--color-text)]">Due date</span>
                  <Input
                    className="mt-1 min-h-[44px]"
                    onChange={(e) => setEditDue(e.target.value)}
                    type="date"
                    value={editDue}
                  />
                </label>
              </div>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Assignee (management only)</span>
                <select
                  aria-label="Task assignee"
                  className={`${selectClass()} min-h-[44px]`}
                  onChange={(e) => setEditAssigneeId(e.target.value)}
                  value={editAssigneeId}
                >
                  <option value="">Unassigned</option>
                  {managerOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {managerLabel(u.id)}
                    </option>
                  ))}
                </select>
              </label>
              {managersLoadError ? (
                <p className="text-xs text-[var(--color-text-muted)]">{managersLoadError}</p>
              ) : null}
              {editFormError ? <p className="text-sm text-[var(--color-danger-700)]">{editFormError}</p> : null}
              <Button className="min-h-[44px]" disabled={busy} type="submit">
                {busy && editSavingRef.current ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {editNote ? (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/40 sm:flex sm:items-start sm:justify-center sm:p-4">
          <div className={modalClass()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Edit note</h3>
              <Button className="min-h-[44px]" type="button" variant="ghost" onClick={closeEditNote}>
                Close
              </Button>
            </div>
            <form className="min-w-0 space-y-3" onSubmit={(ev) => void submitEditNote(ev)}>
              <label className={fieldLabelClass()}>
                <span className="text-[var(--color-text)]">Note</span>
                <textarea
                  className={textareaClass()}
                  maxLength={NOTE_BODY_MAX}
                  onChange={(e) => setEditNoteBody(e.target.value)}
                  value={editNoteBody}
                />
              </label>
              <p className="text-xs text-[var(--color-text-muted)]">
                {editNoteBody.length}/{NOTE_BODY_MAX}
              </p>
              {editNoteError ? <p className="text-sm text-[var(--color-danger-700)]">{editNoteError}</p> : null}
              <Button className="min-h-[44px]" disabled={busy} type="submit">
                {busy && noteEditSavingRef.current ? "Saving…" : "Save"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
