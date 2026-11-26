export function formatPhilippineTimestamp(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("SMS timestamp is invalid.");
  }
  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(value => value.type === type)?.value ?? "";
  return `${part("month")} ${part("day")}, ${part("year")} ${part("hour")}:${part("minute")} ${part("dayPeriod")} PHT`;
}

export function normalizePhilippineSmsPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  const localNumber = digits.startsWith("63")
    ? `0${digits.slice(2)}`
    : digits.length === 10 && digits.startsWith("9")
      ? `0${digits}`
      : digits;
  if (!/^09\d{9}$/.test(localNumber)) {
    throw new Error("Phone number is not a valid Philippine mobile number.");
  }
  return `+63${localNumber.slice(1)}`;
}

export function buildRentPaymentReminderMessage(
  amount: number,
  dueDate: string,
  reminderType: string = "upcoming",
  timestamp: Date = new Date(),
): string {
  if (
    !Number.isFinite(amount)
    || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
    || (reminderType !== "upcoming" && reminderType !== "overdue")
  ) {
    throw new Error("Rent reminder amount, due date, or type is invalid.");
  }
  const formattedAmount = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const formattedTimestamp = formatPhilippineTimestamp(timestamp);
  if (reminderType === "upcoming") {
    return `Reminder: your rent payment of PHP ${formattedAmount} is due on ${dueDate}. Please pay by the due date. Timestamp: ${formattedTimestamp}. - Myle's Boarding House`;
  }
  return `Overdue notice: your rent payment of PHP ${formattedAmount} was due on ${dueDate} and remains unpaid. Please pay as soon as possible. Timestamp: ${formattedTimestamp}. - Myle's Boarding House`;
}

export async function sendTextBeeSms(
  recipient: string,
  message: string,
  config: { apiBase: string; apiKey: string; deviceId?: string },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`${config.apiBase.replace(/\/+$/, "")}/gateway/send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify({
      recipients: [normalizePhilippineSmsPhone(recipient)],
      message,
      ...(config.deviceId ? { deviceId: config.deviceId } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`TextBee rejected SMS with HTTP ${response.status}.`);
  }
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") {
      throw new Error("TextBee returned a non-object response.");
    }
  } catch {
    throw new Error(`TextBee returned an invalid response with HTTP ${response.status}.`);
  }
}
