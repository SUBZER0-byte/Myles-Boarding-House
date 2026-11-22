import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomReservationSummary } from "@/components/RoomReservationSummary";

describe("RoomReservationSummary", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows active guest reservations with a live countdown and Philippine deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T00:00:00.000Z"));
    render(
      <RoomReservationSummary
        deadlines={[Math.floor(Date.parse("2026-11-26T00:00:00.000Z") / 1000)]}
      />,
    );

    expect(screen.getByText("Reserved by 1 guest")).toBeTruthy();
    expect(screen.getByText(/Next expires in 24h 0m 0s/)).toBeTruthy();
    expect(screen.getByText(/PHT/)).toBeTruthy();
  });

  it("shows the number of active reservations and uses the earliest expiration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T00:00:00.000Z"));
    const laterDeadline = Math.floor(Date.parse("2026-11-27T00:00:00.000Z") / 1000);
    const firstDeadline = Math.floor(Date.parse("2026-11-26T00:00:00.000Z") / 1000);
    render(<RoomReservationSummary deadlines={[laterDeadline, firstDeadline]} />);

    expect(screen.getByText("Reserved by 2 guests")).toBeTruthy();
    expect(screen.getByText(/Next expires in 24h 0m 0s/)).toBeTruthy();
  });

  it("uses the database clock instead of a skewed device clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T01:00:00.000Z"));
    const serverNowEpoch = Math.floor(Date.parse("2026-11-25T00:00:00.000Z") / 1000);
    const deadline = Math.floor(Date.parse("2026-11-25T00:30:00.000Z") / 1000);
    render(
      <RoomReservationSummary
        deadlines={[deadline]}
        serverNowEpoch={serverNowEpoch}
      />,
    );

    expect(screen.getByText(/Next expires in 0h 30m 0s/)).toBeTruthy();
  });

  it("keeps later reservations visible when the earliest one expires", () => {
    vi.useFakeTimers();
    const serverNowEpoch = Math.floor(Date.parse("2026-11-25T00:00:00.000Z") / 1000);
    vi.setSystemTime(serverNowEpoch * 1000);
    render(
      <RoomReservationSummary
        deadlines={[serverNowEpoch + 60, serverNowEpoch + 120]}
        serverNowEpoch={serverNowEpoch}
      />,
    );

    expect(screen.getByText("Reserved by 2 guests")).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));

    expect(screen.getByText("Reserved by 1 guest")).toBeTruthy();
    expect(screen.getByText(/Next expires in 0h 1m 0s/)).toBeTruthy();
  });

  it("does not display reservations whose deadlines have passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T00:00:00.000Z"));
    const expiredDeadline = Math.floor(Date.parse("2026-11-25T00:00:00.000Z") / 1000);
    const { container } = render(<RoomReservationSummary deadlines={[expiredDeadline]} />);

    expect(container.firstChild).toBeNull();
  });
});
