import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Expand, Loader2, MapPin, Minimize2, Navigation, Square } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  formatDistance,
  formatDuration,
  getDrivingRoute,
  shouldRefreshDrivingRoute,
  type DrivingRoute,
  type MapCoordinates,
} from "@/lib/locationRouting";

interface LocationDirectionsMapProps {
  destination: MapCoordinates;
  destinationAddress: string;
  className?: string;
}

function locationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission was denied. Allow location access in your browser settings, then try again.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Your device could not determine its location. Check that location services are enabled.";
  }
  if (error.code === error.TIMEOUT) {
    return "Finding your location timed out. Keep location services enabled and wait for another GPS reading, or try again.";
  }
  return "Could not access your device location. Please try again.";
}

const LocationDirectionsMap = ({
  destination,
  destinationAddress,
  className = "",
}: LocationDirectionsMapProps) => {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapFrame = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const destinationLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const liveLocationMarker = useRef<L.CircleMarker | null>(null);
  const watchId = useRef<number | null>(null);
  const tracking = useRef(false);
  const routeRequestInFlight = useRef(false);
  const routeAbortController = useRef<AbortController | null>(null);
  const routeRefreshTimer = useRef<number | null>(null);
  const scheduleRouteRefreshRef = useRef<((position: MapCoordinates) => void) | null>(null);
  const lastRoutedPosition = useRef<MapCoordinates | null>(null);
  const lastRouteRequestedAt = useRef(0);
  const pendingRoutePosition = useRef<MapCoordinates | null>(null);
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [currentPosition, setCurrentPosition] = useState<MapCoordinates | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasPosition, setHasPosition] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [usesNativeFullscreen, setUsesNativeFullscreen] = useState(false);
  const destinationLatitude = destination.latitude;
  const destinationLongitude = destination.longitude;

  useEffect(() => {
    if (!mapElement.current || mapInstance.current) return;
    const map = L.map(mapElement.current, { scrollWheelZoom: false }).setView(
      [destinationLatitude, destinationLongitude],
      15,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapInstance.current = map;
    destinationLayer.current = L.layerGroup().addTo(map);
    routeLayer.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapInstance.current = null;
      destinationLayer.current = null;
      routeLayer.current = null;
    };
  }, [destinationLatitude, destinationLongitude]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const nativeFullscreen = document.fullscreenElement === mapFrame.current;
      setIsFullscreen(nativeFullscreen);
      setUsesNativeFullscreen(nativeFullscreen);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    const frame = mapFrame.current;
    if (!frame || !isFullscreen) return;
    const resizeMap = window.setTimeout(() => mapInstance.current?.invalidateSize(), 100);
    return () => window.clearTimeout(resizeMap);
  }, [isFullscreen, usesNativeFullscreen]);

  useEffect(() => {
    if (!isFullscreen || usesNativeFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", exitOnEscape);
    };
  }, [isFullscreen, usesNativeFullscreen]);

  useEffect(() => {
    const map = mapInstance.current;
    const layerGroup = destinationLayer.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();
    L.circleMarker([destinationLatitude, destinationLongitude], {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: "#dc572d",
      fillOpacity: 1,
    }).bindTooltip("Myle's Boarding House", { permanent: true, direction: "top", offset: [0, -8] })
      .addTo(layerGroup);
  }, [destinationLatitude, destinationLongitude]);

  useEffect(() => {
    const map = mapInstance.current;
    const layerGroup = routeLayer.current;
    if (!map || !layerGroup || !route) return;

    layerGroup.clearLayers();
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
    bounds.extend([destinationLatitude, destinationLongitude]);
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
  }, [destinationLatitude, destinationLongitude, route]);

  const stopTracking = useCallback(() => {
    tracking.current = false;
    setIsTracking(false);
    setLoading(false);
    if (watchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (routeRefreshTimer.current !== null) {
      window.clearTimeout(routeRefreshTimer.current);
      routeRefreshTimer.current = null;
    }
    routeAbortController.current?.abort();
    routeAbortController.current = null;
    routeRequestInFlight.current = false;
    pendingRoutePosition.current = null;
  }, []);

  const requestRoute = useCallback(async (origin: MapCoordinates) => {
    if (!tracking.current) return;
    routeRequestInFlight.current = true;
    routeAbortController.current?.abort();
    const controller = new AbortController();
    routeAbortController.current = controller;
    lastRouteRequestedAt.current = Date.now();
    setLoading(true);
    try {
      const nextRoute = await getDrivingRoute(
        origin,
        { latitude: destinationLatitude, longitude: destinationLongitude },
        controller.signal,
      );
      if (!tracking.current || controller.signal.aborted) return;
      lastRoutedPosition.current = origin;
      setRoute(nextRoute);
      setErrorMessage(null);
    } catch (caught) {
      if (controller.signal.aborted || !tracking.current) return;
      setErrorMessage(caught instanceof Error ? caught.message : "Could not calculate directions.");
      pendingRoutePosition.current = null;
    } finally {
      if (routeAbortController.current === controller) {
        routeAbortController.current = null;
        routeRequestInFlight.current = false;
        setLoading(false);
        const pending = pendingRoutePosition.current;
        const lastRouted = lastRoutedPosition.current;
        if (pending && shouldRefreshDrivingRoute(lastRouted, pending)) {
          scheduleRouteRefreshRef.current?.(pending);
        }
      }
    }
  }, [destinationLatitude, destinationLongitude]);

  const scheduleRouteRefresh = useCallback((position: MapCoordinates) => {
    pendingRoutePosition.current = position;
    const lastRouted = lastRoutedPosition.current;
    if (!shouldRefreshDrivingRoute(lastRouted, position) || routeRequestInFlight.current) return;
    if (routeRefreshTimer.current !== null) window.clearTimeout(routeRefreshTimer.current);
    const wait = Math.max(0, 10000 - (Date.now() - lastRouteRequestedAt.current));
    routeRefreshTimer.current = window.setTimeout(() => {
      routeRefreshTimer.current = null;
      const latestPosition = pendingRoutePosition.current;
      if (tracking.current && latestPosition) void requestRoute(latestPosition);
    }, wait);
  }, [requestRoute]);
  scheduleRouteRefreshRef.current = scheduleRouteRefresh;

  const startTracking = useCallback(() => {
    if (!window.isSecureContext) {
      setErrorMessage("Device location requires a secure connection (HTTPS).");
      return;
    }
    if (!navigator.geolocation) {
      setErrorMessage("This browser does not support device location.");
      return;
    }

    stopTracking();
    lastRoutedPosition.current = null;
    lastRouteRequestedAt.current = 0;
    pendingRoutePosition.current = null;
    setRoute(null);
    setCurrentPosition(null);
    setHasPosition(false);
    setErrorMessage(null);
    setLoading(true);
    tracking.current = true;
    setIsTracking(true);
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!tracking.current) return;
        const position = { latitude: coords.latitude, longitude: coords.longitude };
        setCurrentPosition(position);
        setHasPosition(true);
        setErrorMessage(null);
        if (!lastRoutedPosition.current) {
          if (routeRequestInFlight.current) pendingRoutePosition.current = position;
          else void requestRoute(position);
        } else {
          scheduleRouteRefresh(position);
        }
      },
      (error) => {
        if (!tracking.current) return;
        setErrorMessage(locationErrorMessage(error));
        if (error.code === error.PERMISSION_DENIED) stopTracking();
        else setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 3000 },
    );
  }, [requestRoute, scheduleRouteRefresh, stopTracking]);

  useEffect(() => () => stopTracking(), [stopTracking]);

  const toggleFullscreen = async () => {
    const frame = mapFrame.current;
    if (!frame) return;

    if (isFullscreen) {
      if (document.fullscreenElement === frame && document.exitFullscreen) {
        await document.exitFullscreen();
      } else {
        setIsFullscreen(false);
        setUsesNativeFullscreen(false);
      }
      return;
    }

    if (document.fullscreenEnabled && frame.requestFullscreen) {
      try {
        await frame.requestFullscreen();
        return;
      } catch {
        setUsesNativeFullscreen(false);
      }
    }
    setIsFullscreen(true);
  };

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (liveLocationMarker.current) {
      liveLocationMarker.current.remove();
      liveLocationMarker.current = null;
    }
    if (currentPosition) {
      liveLocationMarker.current = L.circleMarker(
        [currentPosition.latitude, currentPosition.longitude],
        {
          radius: 8,
          color: "#ffffff",
          weight: 3,
          fillColor: "#2563eb",
          fillOpacity: 1,
        },
      ).bindTooltip("Your live location", { permanent: true, direction: "top", offset: [0, -8] })
        .addTo(map);
    }
  }, [currentPosition]);

  useEffect(() => {
    if (mapInstance.current && currentPosition && isTracking) {
      mapInstance.current.panTo([currentPosition.latitude, currentPosition.longitude]);
    }
  }, [currentPosition, isTracking]);

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Directions to Myle's Boarding House</p>
          <p className="mt-1 text-sm text-muted-foreground">{destinationAddress}</p>
        </div>
        <button
          type="button"
          onClick={isTracking ? stopTracking : startTracking}
          disabled={loading && !isTracking}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && !hasPosition ? <Loader2 size={16} className="animate-spin" /> : isTracking ? <Square size={15} /> : <Navigation size={16} />}
          {loading && !hasPosition ? "Finding your location..." : isTracking ? "Stop live tracking" : route ? "Start live tracking" : "Show route from my location"}
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
      {isTracking && hasPosition && (
        <p role="status" className="text-xs text-success">
          Live location tracking is on. The marker updates as your device moves; the driving route refreshes after you move at least 50 metres.
        </p>
      )}

      <div
        ref={mapFrame}
        className={`relative overflow-hidden border border-border bg-muted ${
          isFullscreen
            ? usesNativeFullscreen
              ? "h-[100dvh] w-screen"
              : "fixed inset-0 z-[1000] h-[100dvh] w-screen rounded-none"
            : "relative z-0 h-[360px] w-full rounded-lg sm:h-[440px]"
        }`}
      >
        <div
          ref={mapElement}
          role="application"
          aria-label="Map showing the boarding house and route from your location"
          className="absolute inset-0 h-full w-full"
        />
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          aria-label={isFullscreen ? "Exit fullscreen map" : "View fullscreen map"}
          title={isFullscreen ? "Exit fullscreen" : "View fullscreen"}
          className="absolute right-3 top-3 z-[1001] inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background/95 text-foreground shadow-md hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Expand size={18} />}
        </button>
      </div>

      {route && (
        <section aria-label="Driving directions" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-semibold">
            <span className="inline-flex items-center gap-2">
              <Navigation size={15} className="text-primary" />
              {formatDistance(route.distanceMeters)}
            </span>
            <span>{formatDuration(route.durationSeconds)} driving</span>
          </div>
          <ol className="max-h-64 space-y-3 overflow-y-auto border-t border-border pt-3">
            {route.steps.map((step, index) => (
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
      {!route && !errorMessage && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin size={14} className="text-primary" />
          Tap “Show route from my location” to request permission and display your driving route here.
        </p>
      )}
    </div>
  );
};

export default LocationDirectionsMap;
