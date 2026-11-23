export type AvailabilityDateRange = {
  checkInDate: string;
  checkOutDate: string;
};

export type PublicRoomAvailability = {
  room_number: string;
  floor_number: number;
  capacity: number;
  monthly_rent: number;
  status: string;
  available_beds: number;
  available_for_dates: boolean;
  description: string | null;
};

export function getCurrentManilaAvailabilityDateRange(now: Date = new Date()): AvailabilityDateRange {
  if (Number.isNaN(now.getTime())) throw new Error("The current date is invalid.");

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Could not determine the current Manila date.");

  const checkInDate = `${year}-${month}-${day}`;
  const checkOutDate = new Date(`${checkInDate}T00:00:00.000Z`);
  checkOutDate.setUTCDate(checkOutDate.getUTCDate() + 1);

  return {
    checkInDate,
    checkOutDate: checkOutDate.toISOString().slice(0, 10),
  };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseAvailabilityDateRange(
  value: unknown,
  now: Date = new Date(),
): AvailabilityDateRange {
  if (value === undefined) return getCurrentManilaAvailabilityDateRange(now);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The requested room availability dates are invalid.");
  }

  const record = value as Record<string, unknown>;
  const checkInDate = record.check_in_date;
  const checkOutDate = record.check_out_date;
  const today = getCurrentManilaAvailabilityDateRange(now).checkInDate;
  if (
    typeof checkInDate !== "string" ||
    typeof checkOutDate !== "string" ||
    !isIsoDate(checkInDate) ||
    !isIsoDate(checkOutDate) ||
    checkInDate < today ||
    checkOutDate <= checkInDate
  ) {
    throw new Error("The requested room availability dates are invalid.");
  }

  return { checkInDate, checkOutDate };
}

export function toPublicRoomAvailability(value: unknown): PublicRoomAvailability[] {
  if (!Array.isArray(value)) throw new Error("The room availability response is invalid.");

  return value.map((room, index) => {
    if (!room || typeof room !== "object" || Array.isArray(room)) {
      throw new Error(`Room availability entry ${index} is invalid.`);
    }

    const record = room as Record<string, unknown>;
    const description = record.description;
    if (
      typeof record.room_number !== "string" ||
      typeof record.floor_number !== "number" ||
      typeof record.capacity !== "number" ||
      typeof record.monthly_rent !== "number" ||
      typeof record.status !== "string" ||
      typeof record.available_beds !== "number" ||
      typeof record.available_for_dates !== "boolean" ||
      (typeof description !== "string" && description !== null)
    ) {
      throw new Error(`Room availability entry ${index} is missing required data.`);
    }

    return {
      room_number: record.room_number,
      floor_number: record.floor_number,
      capacity: record.capacity,
      monthly_rent: record.monthly_rent,
      status: record.status,
      available_beds: record.available_beds,
      available_for_dates: record.available_for_dates,
      description: typeof description === "string" ? description : null,
    };
  });
}