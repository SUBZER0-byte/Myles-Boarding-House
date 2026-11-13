import { supabase } from "@/lib/supabase";

const bucket = "mbh-financial-evidence";
const maxEvidenceSize = 5 * 1024 * 1024;
const allowedEvidenceTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface FullPaymentInstallment {
  payment_id: number;
  amount: number;
  due_date: string | null;
  description: string | null;
  status: string;
  payment_status?: string;
}

export interface FullPaymentPreview {
  total_amount: number;
  installments: FullPaymentInstallment[];
  eligible: boolean;
}

export interface TenantFullPaymentRequest {
  request_id: number;
  total_amount: number;
  status: "Requested" | "Approved" | "Rejected" | "Submitted" | "Confirmed" | "Cancelled";
  admin_note: string | null;
  reference_number: string | null;
  qr_url: string | null;
  installments: FullPaymentInstallment[];
}

export interface AdminFullPaymentRequest extends TenantFullPaymentRequest {
  tenant_id: number;
  user_id: number;
  created_at: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  room_number: string | null;
  installment_count: number;
  has_screenshot: boolean;
  screenshot_url: string | null;
}

export interface EligibleRefundPayment {
  payment_id: number;
  booking_id: number | null;
  amount: number;
  remaining_amount: number;
  method: string | null;
  reference_number: string | null;
  description: string | null;
  due_date: string | null;
  has_pending_request: boolean;
}

export interface RefundRequest {
  refund_id: number;
  payment_id: number;
  user_id: number;
  refund_amount: number;
  gcash_account_name: string;
  gcash_number: string;
  transaction_reference: string | null;
  screenshot_path?: string | null;
  screenshot_url?: string | null;
  transfer_reference: string | null;
  transfer_screenshot_path?: string | null;
  transfer_screenshot_url?: string | null;
  reason: string | null;
  status: "Pending" | "Approved" | "Rejected";
  admin_note: string | null;
  created_at: string;
  acted_at?: string | null;
  payment_amount?: number;
  method?: string | null;
  reference_number?: string | null;
  description?: string | null;
  payment_type?: string | null;
  booking_id?: number | null;
  due_date?: string | null;
  payer_name?: string | null;
  payer_email?: string | null;
}

interface RpcResponse<T> {
  type: "success";
  message?: string;
  data: T;
}

async function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const { data: response, error } = await supabase.rpc("manage_financial_workflows", {
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message || "Could not process the financial request.");
  if (!response || typeof response !== "object" || Array.isArray(response) || response.type !== "success") {
    throw new Error("The financial service returned an invalid response.");
  }
  if (!Object.prototype.hasOwnProperty.call(response, "data")) {
    throw new Error("The financial service returned an incomplete response.");
  }
  return (response as RpcResponse<T>).data;
}

function requireId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`A valid ${label} is required.`);
}

function requireUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("A valid request identifier is required.");
  }
}

function validateEvidence(file: File) {
  if (!allowedEvidenceTypes.has(file.type) || file.size <= 0 || file.size > maxEvidenceSize) {
    throw new Error("Evidence must be a JPG, PNG, or WEBP image up to 5 MB.");
  }
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

async function uploadEvidence(path: string, file: File) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(error.message || "Could not upload the evidence.");
  }
}

async function signedUrl(path: string | null | undefined) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error) throw new Error(error.message || "Could not open the evidence.");
  return data.signedUrl;
}

async function currentAuthId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message || "Could not verify your account.");
  if (!data.user) throw new Error("Sign in to continue.");
  return data.user.id;
}

export function newFinancialRequestId() {
  return crypto.randomUUID();
}

export function getMyFullPaymentPreview() {
  return call<FullPaymentPreview>("tenant_full_preview");
}

export async function getMyFullPaymentRequest(): Promise<TenantFullPaymentRequest | null> {
  const request = await call<(Omit<TenantFullPaymentRequest, "qr_url"> & { qr_path: string | null }) | null>(
    "tenant_full_current",
  );
  if (!request) return null;
  return {
    ...request,
    qr_url: await signedUrl(request.qr_path),
  };
}

export function requestMyFullPayment() {
  return call<{ request_id: number; total_amount: number }>("tenant_full_request");
}

export function cancelMyFullPayment(requestId: number) {
  requireId(requestId, "full payment request");
  return call<null>("tenant_full_cancel", { request_id: requestId });
}

export async function submitMyFullPaymentProof(
  requestId: number,
  reference: string,
  screenshot: File,
  idempotencyKey: string,
) {
  requireId(requestId, "full payment request");
  requireUuid(idempotencyKey);
  const transactionReference = reference.trim();
  if (!transactionReference || transactionReference.length > 120) {
    throw new Error("Enter a valid GCash transaction number.");
  }
  const extension = validateEvidence(screenshot);
  const userId = await currentAuthId();
  const path = `${userId}/full-payment/${requestId}/${idempotencyKey}.${extension}`;
  await uploadEvidence(path, screenshot);
  return call<null>("tenant_full_submit_proof", {
    request_id: requestId,
    reference_number: transactionReference,
    screenshot_path: path,
    idempotency_key: idempotencyKey,
  });
}

export async function listAdminFullPaymentRequests(
  status?: string,
  search?: string,
): Promise<AdminFullPaymentRequest[]> {
  const rows = await call<Array<AdminFullPaymentRequest & { qr_path: string | null; screenshot_path: string | null }>>(
    "admin_full_list",
    { status: status === "All" ? undefined : status, search: search?.trim() || undefined },
  );
  if (!Array.isArray(rows)) throw new Error("The financial service returned an invalid full payment list.");
  return Promise.all(rows.map(async row => ({
    ...row,
    qr_url: await signedUrl(row.qr_path),
    screenshot_url: await signedUrl(row.screenshot_path),
  })));
}

export async function approveAdminFullPayment(
  requestId: number,
  note: string,
  qrImage: File,
  idempotencyKey: string,
) {
  requireId(requestId, "full payment request");
  requireUuid(idempotencyKey);
  const extension = validateEvidence(qrImage);
  const userId = await currentAuthId();
  const path = `${userId}/full-payment-qr/${requestId}/${idempotencyKey}.${extension}`;
  await uploadEvidence(path, qrImage);
  return call<null>("admin_full_approve", {
    request_id: requestId,
    admin_note: note.trim(),
    qr_path: path,
  });
}

export function decideAdminFullPayment(
  requestId: number,
  action: "admin_full_reject" | "admin_full_confirm" | "admin_full_reject_proof",
  note: string,
) {
  requireId(requestId, "full payment request");
  return call<null>(action, { request_id: requestId, admin_note: note.trim() });
}

export function getEligibleRefundPayments(filters: { payment_id?: number; booking_id?: number } = {}) {
  if (filters.payment_id !== undefined) requireId(filters.payment_id, "payment");
  if (filters.booking_id !== undefined) requireId(filters.booking_id, "booking");
  return call<EligibleRefundPayment[]>("refund_eligible", filters);
}

export async function listMyRefundRequests(): Promise<RefundRequest[]> {
  const rows = await call<RefundRequest[]>("refund_mine");
  if (!Array.isArray(rows)) throw new Error("The financial service returned an invalid refund list.");
  return Promise.all(rows.map(async row => ({
    ...row,
    transfer_screenshot_url: await signedUrl(row.transfer_screenshot_path),
  })));
}

export async function submitMyRefundRequest(input: {
  payment_id: number;
  gcash_account_name: string;
  gcash_number: string;
  transaction_reference: string;
  reason: string;
  screenshot?: File | null;
  idempotency_key: string;
}) {
  requireId(input.payment_id, "payment");
  requireUuid(input.idempotency_key);
  const userId = await currentAuthId();
  let screenshotPath: string | null = null;
  if (input.screenshot) {
    const extension = validateEvidence(input.screenshot);
    screenshotPath = `${userId}/refund/${input.payment_id}/${input.idempotency_key}.${extension}`;
    await uploadEvidence(screenshotPath, input.screenshot);
  }
  return call<{ refund_id: number; refund_amount: number }>("refund_submit", {
    payment_id: input.payment_id,
    gcash_account_name: input.gcash_account_name.trim(),
    gcash_number: input.gcash_number.trim(),
    transaction_reference: input.transaction_reference.trim(),
    reason: input.reason.trim(),
    screenshot_path: screenshotPath,
    idempotency_key: input.idempotency_key,
  });
}

export async function listAdminRefundRequests(): Promise<RefundRequest[]> {
  const rows = await call<RefundRequest[]>("refund_admin_list");
  if (!Array.isArray(rows)) throw new Error("The financial service returned an invalid refund list.");
  return Promise.all(rows.map(async row => ({
    ...row,
    screenshot_url: await signedUrl(row.screenshot_path),
    transfer_screenshot_url: await signedUrl(row.transfer_screenshot_path),
  })));
}

export async function decideAdminRefund(input: {
  refund_id: number;
  decision: "Approved" | "Rejected";
  admin_note: string;
  transfer_reference?: string;
  transfer_screenshot?: File | null;
  idempotency_key?: string;
}) {
  requireId(input.refund_id, "refund request");
  let transferScreenshotPath: string | null = null;
  if (input.decision === "Approved" && input.transfer_screenshot) {
    const extension = validateEvidence(input.transfer_screenshot);
    const userId = await currentAuthId();
    const key = input.idempotency_key || newFinancialRequestId();
    requireUuid(key);
    transferScreenshotPath = `${userId}/refund-transfer/${input.refund_id}/${key}.${extension}`;
    await uploadEvidence(transferScreenshotPath, input.transfer_screenshot);
  }
  return call<null>("refund_decide", {
    refund_id: input.refund_id,
    decision: input.decision,
    admin_note: input.admin_note.trim(),
    transfer_reference: input.transfer_reference?.trim() || "",
    transfer_screenshot_path: transferScreenshotPath,
  });
}
