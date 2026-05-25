let activeGroupChatId: string | null = null;

export function setActiveGroupChatId(groupId: string | null) {
  activeGroupChatId = groupId;
}

export function clearActiveGroupChatId(groupId: string) {
  if (activeGroupChatId === groupId) {
    activeGroupChatId = null;
  }
}

export function getActiveGroupChatId() {
  return activeGroupChatId;
}
