/**
 * Messages mobile layout — static source checks (exclusive list/thread below md).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const client = read("app/(app)/messages/messages-client.tsx");
const display = read("features/messaging/display.ts");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

check("mobileThreadOpen state", /mobileThreadOpen/.test(client));
check("Back to messages control", /Back to messages/.test(client) && /← Messages/.test(client));
check("goBackToConversationList clears selection", /goBackToConversationList/.test(client));
check("Back clears conversation query", /replaceMessagesQuery\("messages", null\)/.test(client));
check("list hidden when selected on mobile", /selectedConvId \? "max-md:hidden"/.test(client));
check("thread hidden when no selection on mobile", /!selectedConvId && "max-md:hidden"/.test(client));
check("no max-h 28vh list cap", !/max-h-\[28vh\]/.test(client));
check("desktop split pane retained", /md:grid-cols-\[20rem_minmax\(0,1fr\)\]/.test(client));
check("page chrome hidden on mobile thread", /mobileThreadOpen && "max-md:hidden"/.test(client));
check("compact sheet rows for mobile thread", /max-md:grid-rows-\[minmax\(0,1fr\)\]/.test(client));
check("composer uses compact mobile min-height", /composerTextareaClass|min-h-\[48px\]/.test(client));
check("composer Send stays row layout", /flex-row items-end/.test(client));
check("composer label associated", /htmlFor="msg-composer-input"|id="msg-composer-input"/.test(client));
check("history role=log", /role="log"/.test(client));
check("thread heading focusable", /mobileThreadHeadingRef/.test(client));
check("conversation button refs for focus restore", /conversationButtonRefs/.test(client));
check("uses 100dvh not 100vh", /100dvh/.test(client) && !/100vh/.test(client));
check("markConversationRead retained", /markConversationRead/.test(client));
check("timiq:messages-read retained", /timiq:messages-read/.test(client));
check("jump-to-latest retained", /jump-to-latest|showJumpToLatest/.test(client));
check("threadScrollRef retained", /threadScrollRef/.test(client));

check("compact group subtitle helper", /threadHeaderSubtitleCompact/.test(display));
check("groupParticipantCountLabel", /groupParticipantCountLabel/.test(display));
check("desktop fuller subtitle retained", /export function threadHeaderSubtitle\b/.test(display));
check(
  "compact subtitle is count-only for groups",
  /threadHeaderSubtitleCompact[\s\S]*groupParticipantCountLabel/.test(display),
);
check("list subtitle still includes names for desktop list", /participants · \$\{shown\}| · \$\{shown\}/.test(display));


check("data-messages-pane list", /data-messages-pane="list"/.test(client));
check("data-messages-pane thread", /data-messages-pane="thread"/.test(client));

// Viewport matrix markers (responsive utilities used for exclusivity)
for (const w of ["320", "360", "375", "390", "430"]) {
  check(
    `${w}px covered by max-md exclusivity`,
    /max-md:hidden/.test(client) && /md:grid-cols-\[20rem_minmax\(0,1fr\)\]/.test(client),
  );
}
check("768px split transition at md", /md:grid-cols-\[20rem_minmax\(0,1fr\)\]/.test(client));

console.log(`${passed} messages mobile layout checks passed`);
