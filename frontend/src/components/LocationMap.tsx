import { MapPin, Phone, Clock, Navigation } from "lucide-react";
import { endpoints } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";

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
  const { data: liveHouseInfo } = usePolling<Partial<typeof defaultHouseInfo>>(
    `${endpoints.publicInfo}?action=house_info`,
    { intervalMs: 5000 },
  );
  const houseInfo = { ...defaultHouseInfo, ...liveHouseInfo };
  const latitude = Number(houseInfo.house_map_lat);
  const longitude = Number(houseInfo.house_map_lng);
  const POSITION = {
    lat: Number.isFinite(latitude) ? latitude : 13.140572300741043,
    lng: Number.isFinite(longitude) ? longitude : 123.729307594821,
  };

  const mapSrc = `https://www.google.com/maps?q=${POSITION.lat},${POSITION.lng}&z=17&output=embed`;

  return (
    <section id="location" className="py-20 px-6 bg-muted/50">
      <div className="w-full">
        <h2 className="font-display text-3xl font-bold text-center">Find Us</h2>
        <p className="text-muted-foreground text-center mt-2 max-w-md mx-auto">
          Conveniently located near universities, malls, and public transport.
        </p>

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

            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${POSITION.lat},${POSITION.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-md font-medium hover:opacity-90 transition-opacity w-full"
            >
              <Navigation size={16} /> Get Directions
            </a>
          </div>

          <div className="lg:col-span-2 rounded-lg overflow-hidden border border-border h-[400px]">
            <iframe
              title="Myle's Boarding House Location"
              src={mapSrc}
              className="w-full h-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </section>
  );
};
