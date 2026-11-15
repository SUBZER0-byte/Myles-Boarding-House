import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { loadMyProfile, refreshSupabaseProfile, type AuthProfile } from "@/lib/auth";
import { sessionStore } from "@/lib/api";

type AuthContextValue = {
  profile: AuthProfile | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ profile: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let refreshInProgress = false;

    const refresh = async () => {
      if (refreshInProgress) return;
      refreshInProgress = true;
      try {
        const nextProfile = await refreshSupabaseProfile();
        if (active) setProfile(nextProfile);
      } catch (error) {
        console.error("Could not refresh the Supabase profile", error);
      } finally {
        refreshInProgress = false;
        if (active) setLoading(false);
      }
    };

    const syncAuthState = (session: Session | null) => {
      if (!session) {
        sessionStore.clear();
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      if (active) setLoading(true);
      void Promise.resolve()
        .then(() => loadMyProfile())
        .then((nextProfile) => {
          if (!active) return;
          sessionStore.set(nextProfile);
          setProfile(nextProfile);
        })
        .catch((error: unknown) => {
          console.error("Could not load the Supabase profile", error);
          if (active) setProfile(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    void refresh();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      syncAuthState(session);
    });
    const interval = window.setInterval(() => void refresh(), 10_000);
    window.addEventListener("focus", refresh);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
