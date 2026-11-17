import { DashboardLayout } from "@/components/DashboardLayout";
import { Clock, MapPin, Phone } from "lucide-react";
import LocationDirectionsMap from "@/components/LocationDirectionsMap";
import { usePublicHouseInfo } from "@/hooks/usePublicInfo";

const defaultHouseInfo = {
  house_address_line_1: "Lerma St., Brgy. Bañadero,",
  house_address_line_2: "Old Albay District, Legazpi City, Albay 4500",
  house_contact_phone: "+63 912 345 6789",
  house_contact_email: "contact@boardinghub.com",
  house_office_hours_line_1: "Weekdays: 8:00 AM – 6:00 PM",
  house_office_hours_line_2: "Weekends: By appointment",
  house_map_lat: "13.140576",
  house_map_lng: "123.729441",
};

const GuestLocation = () => {
  const { houseInfo: liveHouseInfo, error } = usePublicHouseInfo();
  const houseInfo = { ...defaultHouseInfo, ...liveHouseInfo };
  const latitude = Number(houseInfo.house_map_lat);
  const longitude = Number(houseInfo.house_map_lng);
  const POSITION = {
    lat: Number.isFinite(latitude) ? latitude : 13.140576,
    lng: Number.isFinite(longitude) ? longitude : 123.729441,
  };
  return (
    <DashboardLayout role="guest">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Location</h1>
          <p className="text-muted-foreground text-sm mt-1">Find Myle's Boarding House from the guest portal.</p>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            Could not load the latest house information: {error.message}
          </div>
        )}

        <div className="bg-card border border-border rounded-lg p-5">
          <div className="grid lg:grid-cols-[1fr_1.6fr] gap-6">
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <MapPin className="text-primary" size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Address</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      {houseInfo.house_address_line_1}
                      <br />
                      {houseInfo.house_address_line_2}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Phone className="text-primary" size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Contact</p>
                    <p className="text-muted-foreground text-sm mt-1">{houseInfo.house_contact_phone}</p>
                    <p className="text-muted-foreground text-sm">{houseInfo.house_contact_email}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Clock className="text-primary" size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Office Hours</p>
                    <p className="text-muted-foreground text-sm mt-1">{houseInfo.house_office_hours_line_1}</p>
                    <p className="text-muted-foreground text-sm">{houseInfo.house_office_hours_line_2}</p>
                  </div>
                </div>
              </div>

            </div>

            <div className="rounded-lg border border-border bg-muted p-5">
              <LocationDirectionsMap
                destination={{ latitude: POSITION.lat, longitude: POSITION.lng }}
                destinationAddress={`${houseInfo.house_address_line_1} ${houseInfo.house_address_line_2}`}
              />
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default GuestLocation;
