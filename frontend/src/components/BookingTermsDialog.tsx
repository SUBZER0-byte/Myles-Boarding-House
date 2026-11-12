import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ShieldCheck, FileText, AlertTriangle } from "lucide-react";

interface BookingTermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  roomName?: string;
}

const termsSections = [
  {
    title: "1. Booking & Reservation",
    body: "Clicking Book Now temporarily holds the room for 5 minutes while you complete the booking details. After submitting your booking, complete the initial payment within 15 minutes. GCash payments submitted for review are not confirmed until an administrator verifies them.",
  },
  {
    title: "2. Payment Terms",
    body: "Monthly rent is due on or before the 5th day of each month. A late fee of ₱100/day will be applied after a 3-day grace period. Online payments are processed securely through PayPal.",
  },
  {
    title: "3. Length of Stay",
    body: "The minimum length of stay is one (1) month. Tenants must give at least 30 days' written notice prior to moving out, otherwise the security deposit may be forfeited.",
  },
  {
    title: "4. House Rules",
    body: "No smoking inside the building. Quiet hours are observed from 10:00 PM to 6:00 AM. Visitors are allowed only in common areas and must leave by 9:00 PM. Pets are not permitted unless explicitly stated for the room.",
  },
  {
    title: "5. Use of Common Areas",
    body: "Tenants are expected to keep shared kitchen, lounge, and bathroom areas clean after each use. Personal belongings left in common areas may be removed by management.",
  },
  {
    title: "6. Damage & Liability",
    body: "Tenants are responsible for any damage to the room or furnishings beyond normal wear and tear. Repair costs will be deducted from the security deposit.",
  },
  {
    title: "7. Termination",
    body: "Management reserves the right to terminate the agreement for repeated violations of house rules, non-payment, or behavior that disturbs other tenants.",
  },
  {
    title: "8. Privacy",
    body: "Personal information collected during booking is used solely for tenancy management and will not be shared with third parties without consent.",
  },
];

export function BookingTermsDialog({ open, onOpenChange, onAccept, roomName }: BookingTermsDialogProps) {
  const [agreed, setAgreed] = useState(false);

  const handleAccept = () => {
    if (!agreed) return;
    setAgreed(false);
    onAccept();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setAgreed(false);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg h-[85vh] flex flex-col p-0 overflow-hidden gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <FileText size={18} />
            </div>
            <div>
              <DialogTitle className="font-display text-xl">Terms & Agreement</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {roomName ? `Booking: ${roomName}` : "Please review before booking"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 px-6 py-4">
          <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/30 text-xs text-foreground mb-4">
            <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
            <p>
              By proceeding, you acknowledge that you have read and agree to the boarding house rules,
              payment terms, and tenancy policies of <strong>Myle's Boarding House</strong>.
            </p>
          </div>

          <div className="space-y-4">
            {termsSections.map((section) => (
              <div key={section.title}>
                <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-1">
                  <ShieldCheck size={13} className="text-primary" />
                  {section.title}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">{section.body}</p>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="px-6 py-4 border-t bg-muted/30 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <span className="text-foreground leading-snug">
              I have read and agree to the Terms & Agreement and House Rules.
            </span>
          </label>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!agreed} onClick={handleAccept}>
              Agree & Continue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
