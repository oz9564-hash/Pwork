const STORAGE_PREFIX = "pdf-text-mapper:last-workspace";

function storageKey(userId: string, category: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(category)}`;
}

export function getLastWorkspaceId(userId: string, category: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId, category));
  } catch {
    return null;
  }
}

export function saveLastWorkspaceId(userId: string, category: string, workspaceId: string) {
  try {
    window.localStorage.setItem(storageKey(userId, category), workspaceId);
  } catch {
    // The app still works when browser storage is unavailable; it just cannot restore the workspace.
  }
}

export function clearLastWorkspaceId(userId: string, category: string) {
  try {
    window.localStorage.removeItem(storageKey(userId, category));
  } catch {
    // Ignore unavailable browser storage.
  }
}
