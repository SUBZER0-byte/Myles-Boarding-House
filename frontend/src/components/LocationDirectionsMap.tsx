import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, MapPin, Navigation } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  formatDistance,
  formatDuration,
  getDrivingRoute,
  type DrivingRoute,
  type MapCoordinates,
} from "@/lib/locationRouting";

interface LocationDirectionsMapProps {
  destination: MapCoordinates;
  destinationAddress: string;
  className?: string;
}

interface RouteState {
  origin: MapCoordinates;
  route: DrivingRoute;
}

function getDeviceLocation(): Promise<MapCoordinates> {
  if (!window.isSecureContext) {
    return Promise.reject(new Error("Device location requires a secure connection (HTTPS)."));
  }
  if (!navigator.geolocation) {
    return Promise.reject(new Error("This browser does not support device location."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("Location permission was denied. Allow location access in your browser settings, then try again."));
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          reject(new Error("Your device could not determine its location. Check that location services are enabled."));
        } else if (error.code === error.TIMEOUT) {
          reject(new Error("Finding your location timed out. Please try again."));
        } else {
          reject(new Error("Could not access your device location. Please try again."));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

const LocationDirectionsMap = ({
  destination,
  destinationAddress,
  className = "",
}: LocationDirectionsMapProps) => {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersAndRoute = useRef<L.LayerGroup | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const destinationLatitude = destination.latitude;
  const destinationLongitude = destination.longitude;

  useEffect(() => {
    if (!mapElement.current || mapInstance.current) return;
    const map = L.map(mapElement.current, { scrollWheelZoom: false }).setView(
      [destination.latitude, destination.longitude],
      15,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapInstance.current = map;
    markersAndRoute.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapInstance.current = null;
      markersAndRoute.current = null;
    };
  }, [destinationLatitude, destinationLongitude]);

  useEffect(() => {
    const map = mapInstance.current;
    const layerGroup = markersAndRoute.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();
    L.circleMarker([destination.latitude, destination.longitude], {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: "#dc572d",
      fillOpacity: 1,
    }).bindTooltip("Myle's Boarding House", { permanent: true, direction: "top", offset: [0, -8] })
      .addTo(layerGroup);

    if (routeState) {
      const { origin, route } = routeState;
      L.circleMarker([origin.latitude, origin.longitude], {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
      }).bindTooltip("Your location", { permanent: true, direction: "top", offset: [0, -8] })
        .addTo(layerGroup);
      L.polyline(route.coordinates.map(([longitude, latitude]) => [latitude, longitude]), {
        color: "#dc572d",
        weight: 6,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layerGroup);
      const bounds = L.latLngBounds(
        route.coordinates.map(([longitude, latitude]) => L.latLng(latitude, longitude)),
      );
      bounds.extend([origin.latitude, origin.longitude]);
      bounds.extend([destination.latitude, destination.longitude]);
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
    } else {
      map.setView([destination.latitude, destination.longitude], 15);
    }
  }, [destinationLatitude, destinationLongitude, routeState]);

  const showRoute = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const origin = await getDeviceLocation();
      const route = await getDrivingRoute(origin, destination);
      setRouteState({ origin, route });
    } catch (caught) {
      setErrorMessage(caught instanceof Error ? caught.message : "Could not calculate directions.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Directions to Myle's Boarding House</p>
          <p className="mt-1 text-sm text-muted-foreground">{destinationAddress}</p>
        </div>
        <button
          type="button"
          onClick={showRoute}
          disabled={loading}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Navigation size={16} />}
          {loading ? "Finding route..." : routeState ? "Refresh my route" : "Show route from my location"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Your location is requested only when you tap the button and is used to calculate this route. Routing is provided by OpenStreetMap-based OSRM and is not stored by this site.
      </p>

      {errorMessage && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div
        ref={mapElement}
        role="application"
        aria-label="Map showing the boarding house and route from your location"
        className="h-[360px] w-full overflow-hidden rounded-lg border border-border bg-muted sm:h-[440px]"
      />

      {routeState && (
        <section aria-label="Driving directions" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-semibold">
            <span className="inline-flex items-center gap-2">
              <Navigation size={15} className="text-primary" />
              {formatDistance(routeState.route.distanceMeters)}
            </span>
            <span>{formatDuration(routeState.route.durationSeconds)} driving</span>
          </div>
          <ol className="max-h-64 space-y-3 overflow-y-auto border-t border-border pt-3">
            {routeState.route.steps.map((step, index) => (
              <li key={`${index}-${step.instruction}`} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span>
                  <span className="block font-medium">{step.instruction}</span>
                  {step.distanceMeters > 0 && (
                    <span className="text-xs text-muted-foreground">{formatDistance(step.distanceMeters)}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {!routeState && !errorMessage && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin size={14} className="text-primary" />
          Tap “Show route from my location” to request permission and display your driving route here.
        </p>
      )}
    </div>
  );
};

export default LocationDirectionsMap;
