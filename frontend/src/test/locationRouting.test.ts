import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatDistance,
  formatDuration,
  formatRouteStep,
  getDrivingRoute,
} from "@/lib/locationRouting";

describe("in-site location routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a driving route and converts OSRM steps into directions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{
          distance: 1250,
          duration: 480,
          geometry: { coordinates: [[123.7, 13.1], [123.71, 13.11]] },
          legs: [{
            steps: [
              { distance: 120, duration: 40, name: "Lerma Street", maneuver: { type: "depart" } },
              { distance: 1130, duration: 440, name: "Rizal Avenue", maneuver: { type: "turn", modifier: "right" } },
              { distance: 0, duration: 0, name: "", maneuver: { type: "arrive" } },
            ],
          }],
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDrivingRoute(
      { latitude: 13.1, longitude: 123.7 },
      { latitude: 13.11, longitude: 123.71 },
    )).resolves.toEqual({
      coordinates: [[123.7, 13.1], [123.71, 13.11]],
      distanceMeters: 1250,
      durationSeconds: 480,
      steps: [
        { instruction: "Start onto Lerma Street", distanceMeters: 120, durationSeconds: 40 },
        { instruction: "Turn right onto Rizal Avenue", distanceMeters: 1130, durationSeconds: 440 },
        { instruction: "Arrive at the boarding house", distanceMeters: 0, durationSeconds: 0 },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/route/v1/driving/123.7,13.1;123.71,13.11?"),
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("reports unavailable routes instead of showing an empty directions result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: "NoRoute", message: "No route found", routes: [] }),
    }));

    await expect(getDrivingRoute(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 1 },
    )).rejects.toThrow("No route found");
  });

  it("formats route instructions and distances for display", () => {
    expect(formatRouteStep("turn", "left", "Main Street")).toBe("Turn left onto Main Street");
    expect(formatRouteStep("arrive", undefined, "")).toBe("Arrive at the boarding house");
    expect(formatDistance(560)).toBe("560 m");
    expect(formatDistance(1250)).toBe("1.3 km");
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(3660)).toBe("1 hr 1 min");
  });
});
