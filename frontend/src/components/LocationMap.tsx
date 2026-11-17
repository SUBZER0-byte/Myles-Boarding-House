import { MapPin, Phone, Clock } from "lucide-react";
import LocationDirectionsMap from "@/components/LocationDirectionsMap";
import { usePublicHouseInfo } from "@/hooks/usePublicInfo";

const defaultHouseInfo = {
  house_address_line_1: "Lerma St., Brgy. Bañadero,",
  house_address_line_2: "Old Albay District, Legazpi City, Albay 4500",
  house_contact_phone: "+63 912 345 6789",
  house_contact_email: "contact@boardinghub.com",
  house_office_hours_line_1: "Weekdays: 8:00 AM – 6:00 PM",
  house_office_hours_line_2: "Weekends: By appointment",
  house_map_lat: "13.140572300741043",
  house_map_lng: "123.729307594821",
};

export const LocationMap = () => {
  const { houseInfo: liveHouseInfo, error } = usePublicHouseInfo();
  const houseInfo = { ...defaultHouseInfo, ...liveHouseInfo };
  const latitude = Number(houseInfo.house_map_lat);
  const longitude = Number(houseInfo.house_map_lng);
  const POSITION = {
    lat: Number.isFinite(latitude) ? latitude : 13.140572300741043,
    lng: Number.isFinite(longitude) ? longitude : 123.729307594821,
  };

  return (
    <section id="location" className="py-20 px-6 bg-muted/50">
      <div className="w-full">
        <h2 className="font-display text-3xl font-bold text-center">Find Us</h2>
        <p className="text-muted-foreground text-center mt-2 max-w-md mx-auto">
          Conveniently located near universities, malls, and public transport.
        </p>
        {error && (
          <p className="text-destructive text-xs text-center mt-2">
            Could not load the latest house information: {error.message}
          </p>
        )}

        <div className="grid lg:grid-cols-3 gap-8 mt-10">
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <MapPin className="text-primary" size={20} />
              </div>
              <div>
                <p className="font-semibold text-sm">Address</p>
                <p className="text-muted-foreground text-sm mt-1">
                  {houseInfo.house_address_line_1}<br />{houseInfo.house_address_line_2}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Phone className="text-primary" size={20} />
              </div>
              <div>
                <p className="font-semibold text-sm">Contact</p>
                <p className="text-muted-foreground text-sm mt-1">{houseInfo.house_contact_phone}</p>
                <p className="text-muted-foreground text-sm">{houseInfo.house_contact_email}</p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="text-primary" size={20} />
              </div>
              <div>
                <p className="font-semibold text-sm">Office Hours</p>
                <p className="text-muted-foreground text-sm mt-1">{houseInfo.house_office_hours_line_1}</p>
                <p className="text-muted-foreground text-sm">{houseInfo.house_office_hours_line_2}</p>
              </div>
            </div>

          </div>

          <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
            <LocationDirectionsMap
              destination={{ latitude: POSITION.lat, longitude: POSITION.lng }}
              destinationAddress={`${houseInfo.house_address_line_1} ${houseInfo.house_address_line_2}`}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
