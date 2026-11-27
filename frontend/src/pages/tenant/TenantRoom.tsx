import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BedDouble, CalendarPlus, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { sessionStore } from "@/lib/api";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { getAvailableTenantRooms, getMyTenantRoom } from "@/lib/tenantRoom";
import { requestStayExtension } from "@/lib/stayExtensions";
import { createTenantRoomChangeRequest } from "@/lib/tenantRequests";
import { formatRoomFloor } from "@/lib/roomFloor";
import { calculateMoveOutDate } from "@/lib/stayDates";
import { format } from "date-fns";

const TenantRoom = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const userId = session?.user_id;
  const loadMyRoom = useCallback(() => getMyTenantRoom(), []);
  const loadAvailableRooms = useCallback(() => getAvailableTenantRooms(), []);
  const { data: myRoom, error, refetch: refetchRoom } = useSupabasePolling(loadMyRoom, 5000, Boolean(userId));
  const { data: availableData } = useSupabasePolling(loadAvailableRooms, 5000);
  const available = availableData ?? [];
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState("");
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [extensionMonthsInput, setExtensionMonthsInput] = useState("1");
  const currentMoveOutDate = myRoom?.check_out_date ?? myRoom?.move_out_date ?? null;
  const extensionMonths = /^\d+$/.test(extensionMonthsInput) ? Number(extensionMonthsInput) : 0;
  const requestedMoveOutDate = currentMoveOutDate
    ? calculateMoveOutDate(currentMoveOutDate, extensionMonths)
    : "";
  const monthlyRent = Number(myRoom?.monthly_rent ?? 0);
  const extensionRent = monthlyRent * extensionMonths;
  const bookingAdvanceCredit = Math.min(monthlyRent, Number(myRoom?.available_advance_amount ?? 0));
  const newAdvanceDue = monthlyRent;
  const extensionPaymentDue = Math.max(0, extensionRent - bookingAdvanceCredit) + newAdvanceDue;

  const request = async () => {
    if (!myRoom || !target) return;
    try {
      const message = await createTenantRoomChangeRequest(Number(target), reason);
      toast({ title: message });
      setOpen(false);
      setReason("");
      setTarget("");
    } catch (cause) {
      toast({
        title: "Could not submit room-change request",
        description: cause instanceof Error ? cause.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const requestExtension = async () => {
    if (!requestedMoveOutDate) return;
    try {
      const message = await requestStayExtension(requestedMoveOutDate);
      toast({ title: message });
      setExtensionOpen(false);
      setExtensionMonthsInput("1");
      refetchRoom();
    } catch (cause) {
      toast({
        title: "Could not submit stay extension request",
        description: cause instanceof Error ? cause.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">My Room</h1>
        </div>
        {!userId && <div className="p-3 rounded-md border border-warning/30 bg-warning/10 text-warning text-xs">Sign in to view your room.</div>}
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {userId && !myRoom && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}

        {userId && !myRoom && error && (
          <div className="bg-card border border-warning/30 rounded-lg p-6 space-y-2">
            <div className="flex items-center gap-3">
              <BedDouble size={24} className="text-warning" />
              <p className="font-semibold">No room assignment found</p>
            </div>
            <p className="text-sm text-muted-foreground">Your tenant account does not have an active room assignment yet. Please contact the administrator.</p>
          </div>
        )}

        {myRoom && (
          <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-4 border-b border-border p-5 sm:p-6">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <BedDouble size={27} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-2xl font-bold leading-tight">Room {myRoom.room_number}</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatRoomFloor(myRoom.floor_number)} · Capacity {myRoom.capacity}</p>
              </div>
              <Badge variant="secondary" className="capitalize">{myRoom.status}</Badge>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              <p className="break-words text-sm leading-relaxed text-muted-foreground">
                {myRoom.description || "No room description provided."}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="min-w-0 rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-xs font-medium text-muted-foreground">Monthly rent per person</p>
                  <p className="mt-1 break-words text-lg font-semibold">₱{Number(myRoom.monthly_rent).toLocaleString()}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-xs font-medium text-muted-foreground">Move-in date</p>
                  <p className="mt-1 break-words font-semibold">{myRoom.move_in_date ?? "—"}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-xs font-medium text-muted-foreground">Move-out date</p>
                  <p className="mt-1 break-words font-semibold">{currentMoveOutDate ?? "—"}</p>
                </div>
              </div>
              {myRoom.roommates.length > 0 ? (
                <div className="rounded-lg border border-border p-4">
                  <div className="mb-3">
                    <h2 className="font-display text-lg font-semibold">My Roommates</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {myRoom.roommates.length} other tenant{myRoom.roommates.length === 1 ? "" : "s"} assigned to this room.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {myRoom.roommates.map((roommate) => (
                      <div key={roommate.tenant_id} className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
                        <p className="break-words font-medium text-sm">{roommate.full_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {roommate.gender || "Not provided"} · {roommate.move_in_date ?? "—"} to {roommate.move_out_date ?? "No move-out date"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border p-4">
                  <h2 className="font-display text-lg font-semibold">My Roommates</h2>
                  <p className="mt-1 text-sm text-muted-foreground">No other active tenants are assigned to this room.</p>
                </div>
              )}
            {myRoom.requested_move_out_date && (
              <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="font-medium">Extension request pending approval</p>
                <p className="text-muted-foreground">Requested move-out: {myRoom.requested_move_out_date}</p>
              </div>
            )}
            {!myRoom.requested_move_out_date && myRoom.extension_request_status === "Rejected" && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                Your latest stay extension request was not approved. You may submit a new date.
              </div>
            )}
              <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-start sm:justify-between">
                {currentMoveOutDate && (
                  <div className="min-w-0 space-y-2">
                    <Button className="w-full gap-2 sm:w-auto" onClick={() => setExtensionOpen(true)} disabled={!!myRoom.requested_move_out_date}>
                      <CalendarPlus size={16} />
                      {myRoom.requested_move_out_date ? "Extension Request Pending" : "Request to Extend Stay"}
                    </Button>
                    {!myRoom.requested_move_out_date && (
                      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                        You can request an extension anytime during your stay. Choose how many months to add for admin approval.
                      </p>
                    )}
                  </div>
                )}
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>Request Room Change</Button>
              </div>
            </div>
          </div>
        )}

        <div className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold">Available Rooms</h2>
            <p className="mt-1 text-sm text-muted-foreground">Rooms currently open for booking.</p>
          </div>
          {available.length === 0 && <p className="text-sm text-muted-foreground">No vacancies right now.</p>}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {available.map(r => (
              <div key={r.room_id} className="min-w-0 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">Room {r.room_number}</p>
                  <Badge variant="secondary" className="text-xs">{formatRoomFloor(r.floor_number)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">₱{Number(r.monthly_rent).toLocaleString()}/person/mo · cap {r.capacity}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader><DialogTitle>Request Room Change</DialogTitle><DialogDescription>Pick your desired room.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue placeholder="Choose room…" /></SelectTrigger>
              <SelectContent>
                {available.map(r => (
                  <SelectItem key={r.room_id} value={String(r.room_id)}>Room {r.room_number} · {formatRoomFloor(r.floor_number)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea rows={4} placeholder="Reason for change…" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={request} disabled={!target}>Send Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={extensionOpen} onOpenChange={setExtensionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Stay Extension</DialogTitle>
            <DialogDescription>Your new move-out date takes effect only after admin approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Current move-out date: {currentMoveOutDate ?? "—"}</p>
            <div className="grid gap-1.5">
              <Label htmlFor="extension-length-months">Extension length (months)</Label>
              <Input
                id="extension-length-months"
                type="number"
                min="1"
                step="1"
                required
                value={extensionMonthsInput}
                onChange={event => setExtensionMonthsInput(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="calculated-extension-move-out">New move-out date (calculated)</Label>
              <Input
                id="calculated-extension-move-out"
                readOnly
                value={requestedMoveOutDate
                  ? format(new Date(`${requestedMoveOutDate}T00:00:00`), "PPP")
                  : ""}
                placeholder="Select extension length to calculate date"
              />
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p>Extension rent: <strong>₱{extensionRent.toLocaleString()}</strong></p>
              <p>Available booking advance applied to the first extension month: <strong>−₱{bookingAdvanceCredit.toLocaleString()}</strong></p>
              <p>New one-month advance required after approval: <strong>₱{newAdvanceDue.toLocaleString()}</strong></p>
              <p className="mt-1 border-t border-border pt-2 font-semibold">
                Payment due after approval: ₱{extensionPaymentDue.toLocaleString()}
              </p>
              {bookingAdvanceCredit < monthlyRent && (
                <p className="mt-2 text-xs text-destructive">
                  A confirmed, unused one-month advance is required before this extension can be approved.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setExtensionOpen(false)}>Cancel</Button>
            <Button onClick={requestExtension} disabled={!requestedMoveOutDate || bookingAdvanceCredit < monthlyRent}>Submit Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default TenantRoom;
