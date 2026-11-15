import { supabase } from "@/lib/supabase";

const bucket = "mbh-payment-qrs";
const maxQrSize = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

interface RpcResponse<T> {
  type: "success";
  message?: string;
  data: T;
}

interface GcashQrRecord {
  filename: string;
  amount: number | null;
  uploaded_at: number;
  is_active: boolean;
}

export interface AdminGcashQrImage extends GcashQrRecord {
  path: string;
}

export interface PublicGcashQr {
  path: string;
  amount: number | null;
}

async function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const { data: response, error } = await supabase.rpc("manage_gcash_qrs", {
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message || "Could not process the GCash QR request.");
  if (!response || typeof response !== "object" || Array.isArray(response) || response.type !== "success") {
    throw new Error("The GCash QR service returned an invalid response.");
  }
  if (!Object.prototype.hasOwnProperty.call(response, "data")) {
    throw new Error("The GCash QR service returned an incomplete response.");
  }
  return (response as RpcResponse<T>).data;
}

function validateQr(file: File) {
  if (!allowedTypes.has(file.type) || file.size <= 0 || file.size > maxQrSize) {
    throw new Error("GCash QR must be a JPG, PNG, or WEBP image up to 10 MB.");
  }
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

function validateAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount - Number(amount.toFixed(2))) > 1e-8) {
    throw new Error("Enter a valid fixed amount for this GCash QR.");
  }
}

function newPath(file: File) {
  return `gcash-qr/${crypto.randomUUID()}.${validateQr(file)}`;
}

async function uploadQr(path: string, file: File) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message || "Could not upload the GCash QR image.");
}

async function removeQr(path: string) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message || "Could not remove the GCash QR image.");
}

async function signedUrl(path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error) throw new Error(error.message || "Could not open the GCash QR image.");
  return data.signedUrl;
}

async function withSignedPath(row: GcashQrRecord): Promise<AdminGcashQrImage> {
  return { ...row, path: await signedUrl(row.filename) };
}

export async function listAdminGcashQrs(): Promise<AdminGcashQrImage[]> {
  const rows = await call<GcashQrRecord[]>("admin_list");
  if (!Array.isArray(rows)) throw new Error("The GCash QR service returned an invalid image list.");
  return Promise.all(rows.map(withSignedPath));
}

export async function listPublicGcashQrs(): Promise<PublicGcashQr[]> {
  const rows = await call<GcashQrRecord[]>("public_list");
  if (!Array.isArray(rows)) throw new Error("The GCash QR service returned an invalid image list.");
  return Promise.all(rows.map(async row => ({
    path: await signedUrl(row.filename),
    amount: row.amount,
  })));
}

export async function uploadAdminGcashQr(file: File, amount: number) {
  validateAmount(amount);
  const path = newPath(file);
  await uploadQr(path, file);
  try {
    await call<null>("admin_upload", { filename: path, amount });
  } catch (error) {
    try {
      await removeQr(path);
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : "Could not save the GCash QR."} The uploaded file also needs cleanup: ${cleanupError instanceof Error ? cleanupError.message : "Storage cleanup failed."}`,
      );
    }
    throw error;
  }
}

export async function updateAdminGcashQrAmount(filename: string, amount: number) {
  validateAmount(amount);
  return call<null>("admin_update_amount", { filename, amount });
}

export async function getAdminGcashQrImage(filename: string) {
  if (!filename.trim()) throw new Error("GCash QR image is unavailable.");
  return signedUrl(filename);
}

export async function replaceAdminGcashQrImage(filename: string, file: File) {
  const replacementPath = newPath(file);
  await uploadQr(replacementPath, file);
  try {
    await call<null>("admin_replace", { filename, replacement_path: replacementPath });
  } catch (error) {
    try {
      await removeQr(replacementPath);
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : "Could not replace the GCash QR."} The uploaded file also needs cleanup: ${cleanupError instanceof Error ? cleanupError.message : "Storage cleanup failed."}`,
      );
    }
    throw error;
  }
  try {
    await removeQr(filename);
  } catch (error) {
    throw new Error(
      `The GCash QR was replaced, but the previous Storage image could not be removed: ${error instanceof Error ? error.message : "Storage cleanup failed."}`,
    );
  }
}

export async function deleteAdminGcashQr(filename: string): Promise<{ cleanupWarning?: string }> {
  await call<null>("admin_delete", { filename });
  try {
    await removeQr(filename);
    return {};
  } catch (error) {
    return {
      cleanupWarning: `The QR record was deleted, but its Storage image could not be removed: ${error instanceof Error ? error.message : "Storage cleanup failed."}`,
    };
  }
}
