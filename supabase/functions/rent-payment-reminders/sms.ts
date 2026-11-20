export function normalizePhilippineSmsPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  const localNumber = digits.startsWith("63")
    ? `0${digits.slice(2)}`
    : digits.length === 10 && digits.startsWith("9")
      ? `0${digits}`
      : digits;
  if (!/^09\d{9}$/.test(localNumber)) {
    throw new Error("Tenant phone number is not a valid Philippine mobile number.");
  }
  return `+63${localNumber.slice(1)}`;
}

export function buildRentPaymentReminderMessage(amount: number, dueDate: string): string {
  if (!Number.isFinite(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error("Rent reminder amount or due date is invalid.");
  }
  const formattedAmount = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `Reminder: your rent payment of PHP ${formattedAmount} is due on ${dueDate} (in 3 days). Please pay before the due date. - Myle's Boarding House`;
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
