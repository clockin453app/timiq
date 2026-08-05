/**
 * Read/unread presentation contracts for Messages and Notifications.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(root, "src", rel), "utf8");
}

const messages = read("app/(app)/messages/messages-client.tsx");
assert.match(messages, /is_unread/);
assert.match(messages, /unread_count/);
assert.match(messages, /bg-sky-50/);
assert.match(messages, /font-bold/);
assert.match(messages, /aria-current=\{selected/);
assert.match(messages, /sr-only.*Unread/s);
assert.match(messages, /border-\[var\(--color-btn-active-border\)\]/);
assert.match(messages, /Could not mark conversation as read/);
assert.match(messages, /timiq:messages-read/);

const api = read("features/messaging/api.ts");
assert.match(api, /unread_count\?:/);
assert.match(api, /is_unread\?:/);

const bell = read("components/layout/notification-bell.tsx");
assert.match(bell, /bg-sky-50/);
assert.match(bell, /border-l-sky-500/);
assert.match(bell, /locallySeenKeys/);
assert.match(bell, /Unread notification/);
assert.match(bell, /Seen notification/);
assert.match(bell, /font-bold/);

const header = read("components/layout/messages-header-button.tsx");
assert.match(header, /timiq:messages-read/);
assert.match(header, /messages_unread_count/);

console.log("test-notification-read-state: ok");
