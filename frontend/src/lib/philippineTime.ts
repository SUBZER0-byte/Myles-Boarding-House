const PHILIPPINE_TIME_ZONE = "Asia/Manila";
const PHILIPPINE_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;

type DateTimeValue = string | number | Date | null | undefined;

export function toPhilippineISOString(date = new Date()): string {
  return new Date(date.getTime() + PHILIPPINE_OFFSET_MILLISECONDS)
    .toISOString()
    .replace("Z", "+08:00");
}

function parseDateTime(value: DateTimeValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00+08:00`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value)
      && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)
      ? `${value.replace(" ", "T")}+08:00`
      : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPhilippineTime(
  value: DateTimeValue,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = parseDateTime(value);
  return date
    ? new Intl.DateTimeFormat("en-PH", {
        ...options,
        timeZone: PHILIPPINE_TIME_ZONE,
      }).format(date)
    : "—";
}

export function formatPhilippineDateTime(value: DateTimeValue): string {
  return formatPhilippineTime(value, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatPhilippineDate(value: DateTimeValue): string {
  return formatPhilippineTime(value, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

export function formatPhilippineClockTime(value: DateTimeValue): string {
  return formatPhilippineTime(value, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
