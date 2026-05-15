import type { Colleague, ConversationListItem, MessageParticipantSummary } from "./api";

export type ParticipantLookup = Map<string, MessageParticipantSummary>;

export function buildParticipantLookup(
  colleagues: Colleague[],
  conversations: ConversationListItem[],
): ParticipantLookup {
  const map: ParticipantLookup = new Map();
  for (const c of colleagues) {
    map.set(c.user_id, {
      user_id: c.user_id,
      display_name: c.display_name,
      email: c.email,
    });
  }
  for (const conv of conversations) {
    for (const p of conv.participants ?? []) {
      map.set(p.user_id, p);
    }
  }
  return map;
}

function otherParticipant(
  conv: ConversationListItem,
  viewerId: string,
): MessageParticipantSummary | undefined {
  return (
    conv.participants?.find((p) => p.user_id !== viewerId) ??
    conv.participants?.[0]
  );
}

export function directConversationTitle(conv: ConversationListItem, viewerId: string): string {
  const other = otherParticipant(conv, viewerId);
  const fromList = conv.other_user_display_name?.trim();
  if (fromList) {
    return fromList;
  }
  if (other?.display_name?.trim()) {
    return other.display_name.trim();
  }
  if (other?.email?.trim()) {
    return other.email.trim();
  }
  return "Conversation";
}

export function conversationListTitle(conv: ConversationListItem, viewerId: string): string {
  if (conv.conversation_type === "group") {
    return conv.title?.trim() || "Group chat";
  }
  return directConversationTitle(conv, viewerId);
}

export function conversationListSubtitle(conv: ConversationListItem, viewerId: string): string | null {
  if (conv.conversation_type === "group") {
    const names = (conv.participants ?? [])
      .filter((p) => p.user_id !== viewerId)
      .map((p) => p.display_name?.trim() || p.email?.trim() || "")
      .filter(Boolean);
    if (names.length === 0) {
      return `${conv.participant_count} participants`;
    }
    const shown = names.slice(0, 4).join(", ");
    const suffix = names.length > 4 ? ` +${names.length - 4} more` : "";
    return `${conv.participant_count} participants · ${shown}${suffix}`;
  }
  const other = otherParticipant(conv, viewerId);
  const title = directConversationTitle(conv, viewerId);
  if (other?.email && other.email !== title) {
    return other.email;
  }
  return null;
}

export function threadHeaderSubtitle(conv: ConversationListItem, viewerId: string): string | null {
  if (conv.conversation_type === "group") {
    return conversationListSubtitle(conv, viewerId);
  }
  const other = otherParticipant(conv, viewerId);
  return other?.email?.trim() || null;
}

export function senderLabel(
  senderUserId: string,
  viewerId: string,
  lookup: ParticipantLookup,
  senderDisplayName?: string | null,
): string {
  if (senderUserId === viewerId) {
    return "You";
  }
  const fromMessage = senderDisplayName?.trim();
  if (fromMessage) {
    return fromMessage;
  }
  const row = lookup.get(senderUserId);
  if (row?.display_name?.trim()) {
    return row.display_name.trim();
  }
  if (row?.email?.trim()) {
    return row.email.trim();
  }
  return "Unknown";
}
