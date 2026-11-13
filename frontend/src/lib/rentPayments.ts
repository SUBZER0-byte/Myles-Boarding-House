import { supabase } from "@/lib/supabase";

const evidenceBucket = "mbh-financial-evidence";
const maxEvidenceSize = 5 * 1024 * 1024;
const allowedEvidenceTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface RentPayment {
  payment_id: number;
  tenant_id?: number;
  full_name?: string;
  room_number?: string | null;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  method: string | null;
  reference_number: string | null;
  has_payment_screenshot: boolean;
  screenshot_path?: string | null;
  status: string;
  display_status?: string;
  description: string | null;
  refunded_amount?: number | null;
  refund_available?: boolean | number;
  check_in_date?: string | null;
  check_out_date?: string | null;
}

export interface RentPaymentTenant {
  tenant_id: number;
  full_name: string;
  email: string | null;
  room_number: string | null;
  move_in_date: string | null;
  move_out_date: string | null;
  is_active: number;
}

interface RpcResponse<T> {
  type: "success";
  message?: string;
  data: T;
}

async function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const { data: response, error } = await supabase.rpc("manage_rent_ledger", {
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message || "Could not process the rent payment request.");
  if (!response || typeof response !== "object" || Array.isArray(response) || response.type !== "success") {
    throw new Error("The rent payment service returned an invalid response.");
  }
  if (!Object.prototype.hasOwnProperty.call(response, "data")) {
    throw new Error("The rent payment service returned an incomplete response.");
  }
  return (response as RpcResponse<T>).data;
}

function requireId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`A valid ${label} is required.`);
}

function validateEvidence(file: File) {
  if (!allowedEvidenceTypes.has(file.type) || file.size <= 0 || file.size > maxEvidenceSize) {
    throw new Error("Evidence must be a JPG, PNG, or WEBP image up to 5 MB.");
  }
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

function requireUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("A valid payment submission identifier is required.");
  }
}

export function newRentPaymentSubmissionId() {
  return crypto.randomUUID();
}

export function listMyRentPayments() {
  return call<RentPayment[]>("tenant_history");
}

export async function submitMyRentPayment(input: {
  payment_id: number;
  reference: string;
  screenshot?: File;
  submission_id: string;
}) {
  requireId(input.payment_id, "payment");
  requireUuid(input.submission_id);
  const reference = input.reference.trim();
  if (reference.length > 120 || (!reference && !input.screenshot)) {
    throw new Error("Enter a GCash transaction reference or upload a payment screenshot.");
  }

  let screenshotPath: string | null = null;
  if (input.screenshot) {
    const extension = validateEvidence(input.screenshot);
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(error.message || "Could not verify your account.");
    if (!data.user) throw new Error("Sign in to submit a rent payment.");
    screenshotPath = `${data.user.id}/rent-payment/${input.payment_id}/${input.submission_id}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(evidenceBucket)
      .upload(screenshotPath, input.screenshot, { contentType: input.screenshot.type, upsert: false });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
      throw new Error(uploadError.message || "Could not upload the payment screenshot.");
    }
  }

  return call<null>("tenant_submit", {
    payment_id: input.payment_id,
    reference,
    screenshot_path: screenshotPath,
  });
}

export function listAdminRentPaymentTenants() {
  return call<RentPaymentTenant[]>("admin_tenants");
}

export function listAdminRentPayments(input: { tenant_id?: number; status?: string } = {}) {
  if (input.tenant_id !== undefined) requireId(input.tenant_id, "tenant");
  return call<RentPayment[]>("admin_list", {
    ...(input.tenant_id !== undefined && { tenant_id: input.tenant_id }),
    ...(input.status && { status: input.status }),
  });
}

export function getAdminRentPaymentSummary(tenantId: number) {
  requireId(tenantId, "tenant");
  return call<Array<{ status: string; cnt: number; total: number }>>("admin_summary", { tenant_id: tenantId });
}

export function createAdminRentPayment(input: {
  tenant_id: number;
  amount: number;
  due_date: string;
  description: string;
  status: string;
}) {
  requireId(input.tenant_id, "tenant");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a valid payment amount.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) throw new Error("Enter a valid due date.");
  return call<{ payment_id: number }>("admin_create", input);
}

export function updateAdminRentPaymentStatus(input: {
  payment_id: number;
  status: string;
  method?: "Cash" | "GCash";
  reference?: string;
}) {
  requireId(input.payment_id, "payment");
  if ((input.reference ?? "").trim().length > 120) throw new Error("Payment reference must be 120 characters or fewer.");
  return call<null>("admin_update_status", {
    ...input,
    reference: input.reference?.trim() ?? "",
  });
}

export function deleteAdminRentPayment(paymentId: number) {
  requireId(paymentId, "payment");
  return call<null>("admin_delete", { payment_id: paymentId });
}

export function generateNextMonthRentPayments() {
  return call<{ count: number }>("admin_generate_next_month");
}

export async function getAdminRentPaymentScreenshot(path: string) {
  if (!path.trim()) throw new Error("Payment screenshot is unavailable.");
  const { data, error } = await supabase.storage.from(evidenceBucket).createSignedUrl(path, 300);
  if (error) throw new Error(error.message || "Could not open the payment screenshot.");
  return data.signedUrl;
}
