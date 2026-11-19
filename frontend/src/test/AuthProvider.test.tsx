import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authStateListener, loadMyProfile, refreshSupabaseProfile } = vi.hoisted(() => ({
  authStateListener: {
    current: null as null | ((event: string, session: unknown) => void),
  },
  loadMyProfile: vi.fn(),
  refreshSupabaseProfile: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        authStateListener.current = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

vi.mock("@/lib/auth", () => ({ loadMyProfile, refreshSupabaseProfile }));
vi.mock("@/lib/api", () => ({
  sessionStore: { set: vi.fn(), clear: vi.fn() },
}));

import { AuthProvider, useAuth } from "@/lib/AuthProvider";

const profile = {
  user_id: 7,
  username: "tenant",
  full_name: "A Tenant",
  email: "tenant@example.test",
  phone: "555-0100",
  user_type: "tenant",
};

function StatefulScreen() {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <button onClick={() => setDraft("unfinished form data")}>Save draft</button>
      <p>Draft: {draft}</p>
    </div>
  );
}

function ProtectedScreen() {
  const { profile: currentProfile, loading } = useAuth();
  if (loading || !currentProfile) return <p>Loading account</p>;
  return <StatefulScreen />;
}

describe("AuthProvider", () => {
  beforeEach(() => {
    authStateListener.current = null;
    loadMyProfile.mockReset().mockResolvedValue(profile);
    refreshSupabaseProfile.mockReset().mockResolvedValue(profile);
  });

  afterEach(() => cleanup());

  it("keeps the active page mounted when focus returns and Supabase refreshes its token", async () => {
    render(<AuthProvider><ProtectedScreen /></AuthProvider>);
    const session = { user: { id: "auth-user-7" } };
    await act(async () => {
      authStateListener.current?.("INITIAL_SESSION", session);
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save draft" }));
    expect(screen.getByText("Draft: unfinished form data")).toBeTruthy();

    await act(async () => {
      authStateListener.current?.("TOKEN_REFRESHED", session);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("Draft: unfinished form data")).toBeTruthy();
    });
    expect(loadMyProfile).toHaveBeenCalledTimes(1);
    expect(refreshSupabaseProfile).not.toHaveBeenCalled();
  });
});
