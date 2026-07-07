"use client";

import { useMemo } from "react";

import { UserAvatar } from "../../components/user-avatar";

import type { ConversationListItem } from "./api";
import { conversationListTitle, directConversationTitle } from "./display";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "??";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function otherParticipantUserId(conv: ConversationListItem, viewerId: string): string | null {
  const fromParticipants = conv.participants?.find((p) => p.user_id !== viewerId)?.user_id;
  if (fromParticipants) {
    return fromParticipants;
  }
  const fromIds = conv.participant_user_ids.find((id) => id !== viewerId);
  return fromIds ?? null;
}

type ConversationAvatarProps = {
  conversation: ConversationListItem;
  viewerId: string;
  sizeClassName?: string;
  className?: string;
};

export function ConversationAvatar({
  conversation,
  viewerId,
  sizeClassName = "h-10 w-10",
  className = "",
}: ConversationAvatarProps) {
  const isGroup = conversation.conversation_type === "group";

  const directPeer = useMemo(() => {
    if (isGroup) {
      return null;
    }
    const userId = otherParticipantUserId(conversation, viewerId);
    const participant = conversation.participants?.find((p) => p.user_id === userId);
    return {
      userId: userId ?? viewerId,
      name: directConversationTitle(conversation, viewerId),
      email: participant?.email ?? null,
    };
  }, [conversation, isGroup, viewerId]);

  if (isGroup) {
    const label = conversationListTitle(conversation, viewerId);
    return (
      <span
        aria-hidden="true"
        className={`${sizeClassName} inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-border-dark)] bg-[var(--color-header)] text-xs font-bold text-[var(--color-text)] ${className}`.trim()}
      >
        {initialsFromName(label)}
      </span>
    );
  }

  if (!directPeer) {
    return (
      <span
        aria-hidden="true"
        className={`${sizeClassName} inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-border-dark)] bg-slate-100 text-xs font-bold text-slate-700 ${className}`.trim()}
      >
        ??
      </span>
    );
  }

  return (
    <UserAvatar
      className={className}
      email={directPeer.email}
      name={directPeer.name}
      sizeClassName={sizeClassName}
      userId={directPeer.userId}
    />
  );
}
