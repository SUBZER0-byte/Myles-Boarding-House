const STORAGE_KEY = "guestSavedRooms";

export function readSavedRoomIds(): number[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return [...new Set(parsed
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0))];
  } catch {
    return [];
  }
}

export function writeSavedRoomIds(ids: number[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}
