/**
 * Budget Tasks & Project Notes Phase 4 — static source checks (web UI).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const saved = read("app/(app)/budgets/budgets-saved-tab.tsx");
const tasksTab = read("app/(app)/budgets/budget-tasks-notes-tab.tsx");
const api = read("features/budgets/api.ts");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// Tab label Tasks & notes after Billing before Reports
check(
  "Tab order Billing → Tasks & notes → Reports",
  /\["billing", "Billing"\][\s\S]*\["tasks", "Tasks & notes"\][\s\S]*\["reports", "Reports"\]/.test(saved),
);
check('BudgetDetailTab includes "tasks"', /type BudgetDetailTab =[\s\S]*"tasks"/.test(saved));
check(
  "renders BudgetTasksNotesTab",
  /BudgetTasksNotesTab/.test(saved) && /detailTab === "tasks"/.test(saved),
);
check("exact label Tasks & notes", /"Tasks & notes"/.test(saved));

// Tasks section + Project notes section
check("Tasks section heading", />\s*Tasks\s*</.test(tasksTab) || /"Tasks"/.test(tasksTab));
check("Project notes section", /Project notes/.test(tasksTab));
check("Quick add", /Quick add/.test(tasksTab));
check("filters status priority category overdue search",
  /filterStatus|Status/.test(tasksTab) &&
    /filterPriority|Priority/.test(tasksTab) &&
    /filterCategory|Category/.test(tasksTab) &&
    /Overdue/.test(tasksTab) &&
    /Search|filterSearch/.test(tasksTab),
);
check("Overdue text indicator", /Overdue/.test(tasksTab));
check("complete reopen cancel",
  /completeBudgetTask/.test(tasksTab) &&
    /reopenBudgetTask/.test(tasksTab) &&
    /cancelBudgetTask/.test(tasksTab),
);
check("pin unpin notes", /pinBudgetNote/.test(tasksTab) && /unpinBudgetNote/.test(tasksTab));
check("Pinned text indicator", /Pinned/.test(tasksTab));

// Touch targets + overflow
check("min-h-[44px] action targets", /min-h-\[44px\]/.test(tasksTab));
check("min-w-0 overflow guards", /min-w-0/.test(tasksTab) && /min-w-0 max-w-full/.test(tasksTab));

// API helpers
for (const name of [
  "fetchTaskSummary",
  "listBudgetTasks",
  "createBudgetTask",
  "getBudgetTask",
  "patchBudgetTask",
  "deleteBudgetTask",
  "completeBudgetTask",
  "reopenBudgetTask",
  "cancelBudgetTask",
  "listBudgetNotes",
  "createBudgetNote",
  "patchBudgetNote",
  "deleteBudgetNote",
  "pinBudgetNote",
  "unpinBudgetNote",
]) {
  check(`API helper ${name}`, new RegExp(`export async function ${name}\\b`).test(api));
}

check("TaskStatus type", /export type TaskStatus =/.test(api));
check("TaskPriority type", /export type TaskPriority =/.test(api));
check("TaskCategory type", /export type TaskCategory =/.test(api));
check("BudgetTaskResponse is_overdue", /is_overdue/.test(api));
check("BudgetTaskSummaryResponse", /export type BudgetTaskSummaryResponse/.test(api));
check("BudgetProjectNoteResponse", /export type BudgetProjectNoteResponse/.test(api));
check("client_action_id on create bodies", /client_action_id/.test(api));
check("task-summary endpoint", /task-summary/.test(api));
check("tasks endpoint", /\/tasks/.test(api));
check("notes endpoint", /\/notes/.test(api));

// No notifications / no HTML injection for notes
check("no notification imports in tasks tab", !/notification/i.test(tasksTab));
check("no dangerouslySetInnerHTML for notes", !/dangerouslySetInnerHTML/.test(tasksTab));
check("whitespace-pre-wrap for note body", /whitespace-pre-wrap/.test(tasksTab));

// Aria labels on key actions
check("aria-label Edit task", /aria-label=\{`Edit task/.test(tasksTab) || /aria-label="Edit task/.test(tasksTab));
check("aria-label Complete task", /aria-label=\{`Complete task/.test(tasksTab));
check("aria-label Reopen task", /aria-label=\{`Reopen task/.test(tasksTab));
check("aria-label Cancel task", /aria-label=\{`Cancel task/.test(tasksTab));
check("aria-label Pin/Unpin note", /aria-label=\{row\.is_pinned \? "Unpin note" : "Pin note"\}/.test(tasksTab));
check("aria-label Delete note", /aria-label="Delete note"/.test(tasksTab));

// Archived read-only
check("archived prop read-only", /archived/.test(tasksTab) && /archived/.test(saved));

// Hide/show completed
check("hide/show completed toggle", /Show completed|Hide completed/.test(tasksTab));

// Character count for notes
check("note character count /5000", /5000/.test(tasksTab) && /NOTE_BODY_MAX|\/\$\{NOTE_BODY_MAX\}|\/5000/.test(tasksTab));

// Double-submit guards
check("prevent double submit refs", /quickSavingRef|SavingRef/.test(tasksTab));

// Responsive list
check("desktop table / mobile cards", /hidden[\s\S]*sm:block|sm:hidden/.test(tasksTab));

// Management assignee picker (employees excluded via API filter)
check("assignee select in editor", /Task assignee|Assignee \(management only\)/.test(tasksTab));
check("listManagedUsers for assignees", /listManagedUsers/.test(tasksTab));
check("filters admin roles for assignee", /system_role === "admin"|system_role === "administrator"/.test(tasksTab));

console.log(`${passed} budget tasks notes phase4 checks passed`);
