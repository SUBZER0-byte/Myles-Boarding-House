export function normalizePhilippineSmsPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, "");
  const localNumber = digits.startsWith("63")
    ? "0" + digits.slice(2)
    : digits.length === 10 && digits.startsWith("9")
      ? "0" + digits
      : digits;
  if (!/^09[0-9]{9}$/.test(localNumber)) {
    throw new Error("Phone number is not a valid Philippine mobile number.");
  }
  return "+63" + localNumber.slice(1);
}

export function formatPhilippineTimestamp(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("SMS timestamp is invalid.");
  }
  const formatted = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return formatted + " PHT";
}

export function buildRentPaymentReminderMessage(
  amount: number,
  dueDate: string,
  reminderType: string = "upcoming",
  sentAt: Date = new Date(),
): string {
  if (
    !Number.isFinite(amount)
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dueDate)
    || (reminderType !== "upcoming" && reminderType !== "overdue")
  ) {
    throw new Error("Rent reminder amount, due date, or type is invalid.");
  }
  const formattedAmount = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const sentTimestamp = formatPhilippineTimestamp(sentAt);
  if (reminderType === "upcoming") {
    return "Reminder: your rent payment of PHP " + formattedAmount + " is due on " + dueDate + ". Please pay by the due date. Sent " + sentTimestamp + ". - Myle's Boarding House";
  }
  return "Overdue notice: your rent payment of PHP " + formattedAmount + " was due on " + dueDate + " and remains unpaid. Please pay as soon as possible. Sent " + sentTimestamp + ". - Myle's Boarding House";
}

export async function sendTextBeeSms(
  recipient: string,
  message: string,
  config: { apiBase: string; apiKey: string; deviceId?: string },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(config.apiBase.replace(/\/+$/, "") + "/gateway/send-sms", {
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
    throw new Error("TextBee rejected SMS with HTTP " + response.status + ".");
  }
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") {
      throw new Error("TextBee returned a non-object response.");
    }
  } catch {
    throw new Error("TextBee returned an invalid response with HTTP " + response.status + ".");
  }
}
