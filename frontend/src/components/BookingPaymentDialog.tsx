import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { api, API_BASE_URL, endpoints, type ApiResponse } from "@/lib/api";

interface BookingPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomName?: string;
  /** e.g. "₱1,000.00" — used only for display. The numeric peso amount is passed via `amountPHP`. */
  amount?: string;
  amountPHP?: number;
  paymentId?: number;
  bookingId?: number;
  paymentExpiresAtEpoch?: number;
  serverNowEpoch?: number;
  allowedMethods?: Method[];
  title?: string;
  description?: string;
  successTitle?: string;
  successDescription?: string;
  allowScreenshot?: boolean;
  onPaid: (method: string, reference: string, captureId?: string, orderId?: string, screenshot?: File) => void | Promise<void>;
}

type Step = "method" | "awaiting" | "success" | "failed";
type Method = "gcash";
type GcashQr = { path: string; amount: number | null };

const methodLabel: Record<Method, string> = { gcash: "GCash" };
const qrImageByAmount: Record<number, string> = {
  2500: `${API_BASE_URL}/qr-payment/gcash-2500-crop.jpg`,
  4000: `${API_BASE_URL}/qr-payment/gcash-4000-crop.jpg`,
  5000: `${API_BASE_URL}/qr-payment/gcash-5000-crop.jpg`,
  10000: `${API_BASE_URL}/qr-payment/gcash-10000-crop.jpg`,
};

export function BookingPaymentDialog({
  open, onOpenChange, roomName, amount, amountPHP = 1000,
  paymentExpiresAtEpoch,
  serverNowEpoch,
  allowedMethods = ["gcash"],
  title = "Reservation Payment",
  description,
  successTitle = "Payment Submitted",
  successDescription = "Your GCash transaction reference was submitted for admin review.",
  allowScreenshot = false,
  onPaid,
}: BookingPaymentDialogProps) {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method>(allowedMethods[0] ?? "gcash");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [gcashQrs, setGcashQrs] = useState<GcashQr[]>([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrLoadError, setQrLoadError] = useState("");
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setQrLoading(true);
    setQrLoadError("");
    api.get<ApiResponse<{ images: GcashQr[] }>>(`${endpoints.publicInfo}?action=gcash_qr`)
      .then((res) => {
        if (!active) return;
        if (res.data.type !== "success") throw new Error(res.data.message || "Could not load the GCash QR.");
        setGcashQrs(res.data.data?.images ?? []);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setGcashQrs([]);
        setQrLoadError(error instanceof Error ? error.message : "Could not load the GCash QR. Try reopening payment.");
      })
      .finally(() => {
        if (active) setQrLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !paymentExpiresAtEpoch || !serverNowEpoch) {
      setSecondsRemaining(null);
      return;
    }

    const durationMs = Math.max(0, (paymentExpiresAtEpoch - serverNowEpoch) * 1000);
    const startedAt = performance.now();
    const updateRemaining = () => {
      setSecondsRemaining(Math.max(0, Math.ceil((durationMs - (performance.now() - startedAt)) / 1000)));
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 250);
    return () => window.clearInterval(timer);
  }, [open, paymentExpiresAtEpoch, serverNowEpoch]);

  const fixedAmount = Math.round(amountPHP * 100) / 100;
  const matchingQr = gcashQrs.find(qr => qr.amount !== null && Math.abs(Number(qr.amount) - fixedAmount) < 0.01);
  const qrImage = matchingQr ? undefined : qrImageByAmount[amountPHP];
  const hasGcashQr = Boolean(matchingQr || qrImage);
  const formattedAmount = amount ?? `₱${amountPHP.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

  const reset = () => {
    setStep("method");
    setMethod(allowedMethods[0] ?? "gcash");
    setPaymentRef("");
    setPaymentScreenshot(null);
    setErrorMsg("");
    setSaving(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submitPayment = async () => {
    if (secondsRemaining === 0) {
      setErrorMsg("The payment deadline has passed. This temporary reservation has expired.");
      return;
    }
    const reference = paymentRef.trim();
    if (!reference && !paymentScreenshot) {
      setErrorMsg("Enter the GCash transaction reference or upload a payment screenshot.");
      return;
    }

    setSaving(true);
    setErrorMsg("");
    try {
      await onPaid(methodLabel[method], reference, undefined, undefined, paymentScreenshot ?? undefined);
      setStep("success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not submit your GCash payment.";
      setErrorMsg(message);
      toast({ title: "Payment submission failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {description ?? (roomName ? `Securing ${roomName}` : "Pay reservation fee")}{" "}
            {amount || amountPHP ? `• Amount due: ${formattedAmount}` : ""}
          </DialogDescription>
        </DialogHeader>

        {paymentExpiresAtEpoch && serverNowEpoch && secondsRemaining !== null && (
          <div className={`rounded-md border p-3 text-xs ${secondsRemaining === 0 ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-foreground"}`}>
            <p className="font-semibold">
              Payment deadline: {new Date(paymentExpiresAtEpoch * 1000).toLocaleString()}
            </p>
            <p>
              {secondsRemaining === 0
                ? "The payment deadline has passed. This temporary reservation has expired."
                : `Time remaining: ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`}
            </p>
          </div>
        )}

        {step === "method" && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Choose a payment method:</p>
            {allowedMethods.map((m) => (
              <button
                key={m}
                type="button"
                disabled={qrLoading || Boolean(qrLoadError) || !hasGcashQr || secondsRemaining === 0}
                onClick={() => {
                  setMethod(m);
                  setStep("awaiting");
                }}
                className="w-full flex items-center gap-3 p-4 rounded-md border border-border enabled:hover:border-primary enabled:hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60 transition-colors text-left"
              >
                <div className="p-2 rounded-md bg-primary/10 text-primary">
                  <Wallet size={18} />
                </div>
                <div>
                  <p className="font-medium text-sm">{methodLabel[m]}</p>
                  <p className="text-xs text-muted-foreground">
                    {qrLoading
                      ? "Loading GCash QR…"
                      : qrLoadError || (hasGcashQr
                        ? `Pay ${formattedAmount} using a saved fixed-amount GCash QR.`
                        : `No GCash QR is configured for ${formattedAmount}.`)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === "awaiting" && (
          <div className="py-3 flex flex-col items-center gap-3 text-center">
            {hasGcashQr ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {gcashQrs.length > 0
                    ? `Scan this fixed-amount GCash QR to pay ${formattedAmount}.`
                    : `Scan this GCash QR code and pay ${formattedAmount}.`}
                </p>
                {matchingQr ? (
                  <div className="w-full rounded-lg border border-primary/20 bg-white p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between rounded-md bg-primary/5 px-3 py-2 text-left">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fixed QR amount</span>
                      <span className="font-display text-sm font-bold text-primary">{formattedAmount}</span>
                    </div>
                    <img
                      src={`${API_BASE_URL}/${matchingQr.path}`}
                      alt={`GCash QR code for ${formattedAmount}`}
                      className="mx-auto h-[min(62vh,600px)] w-full object-contain"
                    />
                  </div>
                ) : qrImage ? (
                  <div className="w-full rounded-lg border bg-white p-2">
                    <img src={qrImage} alt={`GCash QR code for ${formattedAmount}`} className="mx-auto aspect-square w-full max-w-96 object-contain" />
                    <p className="mt-2 text-xs text-center text-gray-600">Pay {formattedAmount} using GCash</p>
                  </div>
                ) : null}
                <div className="w-full space-y-2 text-left">
                  <Label htmlFor="gcash-reference">GCash transaction reference</Label>
                  <Input
                    id="gcash-reference"
                    value={paymentRef}
                    onChange={(event) => setPaymentRef(event.target.value)}
                    maxLength={120}
                    autoComplete="off"
                    placeholder="Enter the reference from your GCash receipt (optional with screenshot)"
                  />
                  {allowScreenshot && (
                    <div className="space-y-1.5">
                      <Label htmlFor="gcash-screenshot">GCash payment screenshot (optional with reference)</Label>
                      <Input
                        id="gcash-screenshot"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={event => setPaymentScreenshot(event.target.files?.[0] ?? null)}
                      />
                      <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP; maximum 5MB. Provide a transaction reference or screenshot.</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Your payment will remain submitted until an admin verifies the transaction.
                  </p>
                  {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
                  <Button className="w-full" disabled={saving || secondsRemaining === 0 || (!paymentRef.trim() && !paymentScreenshot)} onClick={submitPayment}>
                    {saving ? "Submitting…" : "I’ve paid — submit for review"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="p-3 rounded-full bg-destructive/10 text-destructive"><XCircle size={36} /></div>
                <p className="text-sm text-muted-foreground">
                  No GCash QR is configured for {formattedAmount}.
                </p>
                <Button variant="outline" className="w-full" onClick={() => setStep("method")}>Back</Button>
              </>
            )}
          </div>
        )}

        {step === "success" && (
          <div className="py-6 flex flex-col items-center gap-3 text-center">
            <div className="p-3 rounded-full bg-success/10 text-success">
              <CheckCircle2 size={36} />
            </div>
            <p className="font-display text-lg font-semibold">{successTitle}</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              {successDescription}{paymentRef ? ` Reference: ${paymentRef}` : paymentScreenshot ? " Screenshot attached for admin review." : ""}
            </p>
            <Button className="w-full mt-2" onClick={() => handleOpenChange(false)}>Done</Button>
          </div>
        )}

        {step === "failed" && (
          <div className="py-6 flex flex-col items-center gap-3 text-center">
            <div className="p-3 rounded-full bg-destructive/10 text-destructive"><XCircle size={36} /></div>
            <p className="font-display text-lg font-semibold">Payment Not Completed</p>
            <p className="text-xs text-muted-foreground max-w-xs">{errorMsg || "Please try again."}</p>
            <Button variant="outline" className="w-full" onClick={() => handleOpenChange(false)}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
