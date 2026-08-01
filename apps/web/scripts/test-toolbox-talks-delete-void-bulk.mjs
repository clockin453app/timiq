import assert from "node:assert/strict";
import fs from "node:fs";

const readNormalized = (path) => fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const apiPath = new URL("../src/features/toolbox-talks/api.ts", import.meta.url);
const statusPath = new URL("../src/features/toolbox-talks/status.tsx", import.meta.url);
const detailPath = new URL(
  "../src/app/(app)/toolbox-talks/manage/toolbox-talk-detail-client.tsx",
  import.meta.url,
);
const managePath = new URL(
  "../src/app/(app)/toolbox-talks/manage/toolbox-talks-manage-client.tsx",
  import.meta.url,
);
const employeePath = new URL("../src/app/(app)/toolbox-talks/toolbox-talks-client.tsx", import.meta.url);
const detailPagePath = new URL("../src/app/(app)/toolbox-talks/manage/[talkId]/page.tsx", import.meta.url);

const api = readNormalized(apiPath);
const status = readNormalized(statusPath);
const detail = readNormalized(detailPath);
const manage = readNormalized(managePath);
const employee = readNormalized(employeePath);
const detailPage = readNormalized(detailPagePath);

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

// API client
check("voidToolboxTalk exported", /export async function voidToolboxTalk/.test(api));
check("void endpoint path", /\/api\/toolbox-talks\/\$\{talkId\}\/void/.test(api));
check("previewBulkToolboxTalkAttendees exported", /export async function previewBulkToolboxTalkAttendees/.test(api));
check("bulk preview query", /attendees\/bulk-preview\?\$\{q\}/.test(api));
check("bulkAssignToolboxTalkAttendees exported", /export async function bulkAssignToolboxTalkAttendees/.test(api));
check("bulk assign endpoint", /attendees\/bulk/.test(api) && /JSON\.stringify\(\{ scope \}\)/.test(api));
check("void fields on detail type", /voided_at:/.test(api) && /void_reason:/.test(api) && /voided_by_user_id:/.test(api));
check("API uses API_URL not hardcoded render", /from "\.\.\/\.\.\/config\/api"/.test(api) && !/onrender\.com/.test(api));

// Status badge
check("VOIDED label", /case "voided":\s*return "VOIDED"/.test(status));
check("voided distinct from completed styles", /status === "voided"/.test(status) && /status === "completed"/.test(status));
check("manage list uses status badge", /ToolboxTalkStatusBadge/.test(manage));
check("manage filter includes voided", /value="voided"/.test(manage));
check("employee list uses status badge", /ToolboxTalkStatusBadge/.test(employee));
check("employee voided notice", /voided_employee_notice|This Toolbox Talk was voided/.test(employee));
check("employee sign only when published", /myRow\?\.status === "pending" && detail\.status === "published"/.test(employee));

// Role gating
check("detail page RoleGuard admin/administrator", /allowedRoles=\{\["admin", "administrator"\]\}/.test(detailPage));

// Draft delete
check("draft shows Delete draft", /Delete draft/.test(detail));
check("delete uses Modal not window.confirm", /kind: "delete"/.test(detail) && !/window\.confirm/.test(detail));
check("delete danger styling", /Delete draft[\s\S]*?variant="danger"|variant="danger"[\s\S]*?Delete draft/.test(detail));
check("delete confirmation text permanent", /Permanently delete/.test(detail) && /cannot be\s+undone/.test(detail));
check("delete calls deleteToolboxTalk", /await deleteToolboxTalk\(detail\.id\)/.test(detail));

// Published void / no delete
check("published shows Void", /detail\.status === "published"[\s\S]*?Void/.test(detail));
check("void uses Modal with reason", /kind: "void"/.test(detail) && /tt-void-reason/.test(detail));
check("void requires trimmed reason", /voidReason\.trim\(\)/.test(detail));
check("void calls voidToolboxTalk", /await voidToolboxTalk\(detail\.id, reason\)/.test(detail));
check("void preserves reason on failure path", /setDialogError[\s\S]*setDialogSubmitting\(false\)/.test(detail));
check("published does not show Delete draft", !/detail\.status === "published"[\s\S]{0,400}Delete draft/.test(detail));
check("completed does not show Void button block", !/detail\.status === "completed"[\s\S]{0,200}openVoidDialog/.test(detail));
check("voided shows VOIDED panel", /detail\.status === "voided"/.test(detail) && /void_reason/.test(detail));

// Bulk assignment
check("Add all active employees label", /Add all active employees/.test(detail));
check("Add all site employees label", /Add all site employees/.test(detail));
check("no all_site_users button", !/Add all site users/.test(detail) && !/all_site_users:\s*true/.test(detail));
check("company preview before mutation", /previewBulkToolboxTalkAttendees\(detail\.id, scope\)/.test(detail));
check("bulk confirm uses scope from dialog", /bulkAssignToolboxTalkAttendees\(detail\.id, scope\)/.test(detail));
check("site button disabled without location", /disabled=\{busy \|\| bulkBusy \|\| !detail\.location_id\}/.test(detail));
check("site explanation text", /Assign a site to this Toolbox Talk before adding site employees/.test(detail));
check("bulk confirmation counts", /total_eligible/.test(detail) && /already_assigned/.test(detail) && /will_add/.test(detail));
check("bulk success refreshes via getToolboxTalk", /const next = await getToolboxTalk\(detail\.id\)/.test(detail));
check("bulk result summary", /were already assigned/.test(detail));
check("bulk actions only when canMutateAttendees", /canMutateAttendees \? \(/.test(detail));
check("canAssign draft or published only", /status === "draft" \|\| detail\?\.status === "published"/.test(detail));
check("duplicate bulk guarded", /if \(!detail \|\| bulkBusy\) return/.test(detail) && /dialogSubmitting/.test(detail));

// Attendee removal
check("remove only pending + canMutateAttendees", /a\.status === "pending" && canMutateAttendees/.test(detail));
check("remove confirmation copy", /Remove this pending attendee from the Toolbox Talk\?/.test(detail));
check("remove uses Modal", /kind: "remove"/.test(detail));

// Individual assignment retained
check("individual assign retained", /Assign employees/.test(detail) && /addToolboxTalkAttendees\(detail\.id, \{ user_ids: \[pickUserId\] \}\)/.test(detail));
check("eligible employees filter active not assigned", /u\.is_active && !assignedIds\.has\(u\.id\)/.test(detail));

// Mobile safety
check("action toolbar wraps", /flex-wrap gap-2/.test(detail));
check("employee selector full width mobile", /w-full min-w-0 flex-1/.test(detail));
check("bulk buttons stack on narrow", /flex-col gap-2 sm:flex-row/.test(detail));
check("modal width fits mobile", /max-w-\[calc\(100vw-24px\)\]/.test(detail));
check("no fixed 14rem selector", !/min-w-\[14rem\]/.test(detail));

// Completed/archived/voided action rules
check("archive only published or completed", /detail\.status === "published" \|\| detail\.status === "completed"/.test(detail));
check("edit link only draft", /detail\.status === "draft"[\s\S]*?\/edit/.test(detail));
check("manual sign only published", /canManualSign = detail\?\.status === "published"/.test(detail));

console.log(`${passed} toolbox talks delete/void/bulk UI source checks passed`);
