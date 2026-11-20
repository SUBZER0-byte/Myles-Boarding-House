export function formatRoomFloor(floorNumber: number | null | undefined): string {
  if (!Number.isInteger(floorNumber) || floorNumber === undefined || floorNumber === null || floorNumber < 1) {
    return "Floor not provided";
  }

  const lastTwoDigits = floorNumber % 100;
  const suffix = lastTwoDigits >= 11 && lastTwoDigits <= 13
    ? "th"
    : floorNumber % 10 === 1
      ? "st"
      : floorNumber % 10 === 2
        ? "nd"
        : floorNumber % 10 === 3
          ? "rd"
          : "th";
  return `${floorNumber}${suffix} Floor`;
}
