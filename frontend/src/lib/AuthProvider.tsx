import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { loadMyProfile, type AuthProfile } from "@/lib/auth";
import { sessionStore } from "@/lib/api";

type AuthContextValue = {
  profile: AuthProfile | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ profile: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const authUserId = useRef<string | null>(null);
  const hasProfile = useRef(false);

  useEffect(() => {
    let active = true;

    const syncAuthState = (event: AuthChangeEvent, session: Session | null) => {
      if (!session) {
        authUserId.current = null;
        hasProfile.current = false;
        sessionStore.clear();
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const sameUser = authUserId.current === session.user.id;
      authUserId.current = session.user.id;
      if (event === "TOKEN_REFRESHED" && sameUser && hasProfile.current) return;
      if (active && (!sameUser || !hasProfile.current)) {
        setLoading(true);
      }
      void Promise.resolve()
        .then(() => loadMyProfile())
        .then((nextProfile) => {
          if (!active) return;
          sessionStore.set(nextProfile);
          hasProfile.current = true;
          setProfile(nextProfile);
        })
        .catch((error: unknown) => {
          console.error("Could not load the Supabase profile", error);
          if (active) {
            hasProfile.current = false;
            setProfile(null);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      syncAuthState(event, session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
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
