import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Clock, Home } from "lucide-react";

export type ReceiptData = {
  id?: number | string;
  tenant?: string;
  room?: string;
  month: string;
  amount: string;
  status: string;
  method: string;
  date: string;
  reference?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: ReceiptData | null;
};

export const PaymentReceiptDialog = ({ open, onOpenChange, receipt }: Props) => {
  if (!receipt) return null;

  const receiptNo = `MBH-${String(receipt.id ?? Date.now()).slice(-6).padStart(6, "0")}`;
  const statusIcon =
    receipt.status === "Paid" ? (
      <CheckCircle2 size={12} className="mr-1" />
    ) : receipt.status === "Overdue" ? (
      <AlertCircle size={12} className="mr-1" />
    ) : (
      <Clock size={12} className="mr-1" />
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-0">
        <div id="receipt-printable" className="p-6">
          {/* Header */}
          <div className="text-center border-b border-dashed border-border pb-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-2">
              <Home className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display font-bold text-lg">Myle's Boarding House</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Official Payment Receipt</p>
          </div>

          {/* Meta */}
          <div className="flex justify-between text-xs text-muted-foreground py-3 border-b border-dashed border-border">
            <div>
              <p className="font-medium text-foreground">Receipt No.</p>
              <p className="font-mono">{receiptNo}</p>
            </div>
            <div className="text-right">
              <p className="font-medium text-foreground">Date Issued</p>
              <p>{receipt.date}</p>
            </div>
          </div>

          {/* Details */}
          <dl className="py-3 space-y-2 text-sm border-b border-dashed border-border">
            {receipt.tenant && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tenant</dt>
                <dd className="font-medium">{receipt.tenant}</dd>
              </div>
            )}
            {receipt.room && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Room</dt>
                <dd className="font-medium">{receipt.room}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Billing Period</dt>
              <dd className="font-medium">{receipt.month}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Payment Method</dt>
              <dd className="font-medium">{receipt.method || "—"}</dd>
            </div>
            {receipt.reference && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Reference No.</dt>
                <dd className="font-mono text-xs">{receipt.reference}</dd>
              </div>
            )}
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge
                  variant={receipt.status === "Paid" ? "default" : receipt.status === "Overdue" ? "destructive" : "secondary"}
                  className="text-xs"
                >
                  {statusIcon}
                  {receipt.status}
                </Badge>
              </dd>
            </div>
          </dl>

          {/* Total */}
          <div className="py-4 border-b border-dashed border-border">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-muted-foreground">Monthly Rent</span>
              <span className="text-sm">{receipt.amount}</span>
            </div>
            <div className="flex justify-between items-baseline mt-2">
              <span className="font-display font-semibold">Total Amount</span>
              <span className="font-display font-bold text-xl text-primary">{receipt.amount}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Thank you for your payment!</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              This is a system-generated receipt and does not require a signature.
            </p>
          </div>
        </div>

        <DialogFooter className="p-4 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
