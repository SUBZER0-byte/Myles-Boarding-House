export interface MapCoordinates {
  latitude: number;
  longitude: number;
}

export interface DrivingRoute {
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  steps: {
    instruction: string;
    distanceMeters: number;
    durationSeconds: number;
  }[];
}

interface OsrmRouteResponse {
  code?: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: {
      coordinates: [number, number][];
    };
    legs: {
      steps: {
        distance: number;
        duration: number;
        name: string;
        maneuver: {
          type: string;
          modifier?: string;
        };
      }[];
    }[];
  }[];
}

function describeManeuver(type: string, modifier?: string): string {
  const direction = modifier ? ` ${modifier}` : "";
  switch (type) {
    case "depart":
      return "Start";
    case "turn":
    case "end of road":
    case "fork":
      return `Turn${direction}`;
    case "new name":
    case "continue":
      return "Continue";
    case "merge":
      return "Merge";
    case "on ramp":
      return "Take the ramp";
    case "off ramp":
      return "Take the exit";
    case "roundabout":
    case "rotary":
      return "Enter the roundabout";
    case "roundabout turn":
      return `At the roundabout, take${direction}`;
    case "arrive":
      return "Arrive at the boarding house";
    case "use lane":
      return "Use the indicated lane";
    default:
      return "Continue";
  }
}

export function formatRouteStep(type: string, modifier: string | undefined, streetName: string): string {
  const instruction = describeManeuver(type, modifier);
  if (type === "arrive" || type === "use lane" || !streetName.trim()) return instruction;
  return `${instruction} onto ${streetName.trim()}`;
}

export async function getDrivingRoute(
  origin: MapCoordinates,
  destination: MapCoordinates,
  signal?: AbortSignal,
): Promise<DrivingRoute> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error("The route service is temporarily unavailable. Please try again.");
  }

  const result = await response.json() as OsrmRouteResponse;
  const route = result.routes?.[0];
  if (result.code !== "Ok" || !route || !route.legs?.length || !route.geometry?.coordinates?.length) {
    throw new Error(result.message || "No driving route could be found from your location.");
  }

  return {
    coordinates: route.geometry.coordinates,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    steps: route.legs.flatMap((leg) => leg.steps.map((step) => ({
      instruction: formatRouteStep(step.maneuver.type, step.maneuver.modifier, step.name),
      distanceMeters: step.distance,
      durationSeconds: step.duration,
    }))),
  };
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${totalMinutes} min`;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}
