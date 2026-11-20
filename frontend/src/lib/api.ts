type CachedUser = {
  user_id: number | string;
  username: string;
  email: string;
  user_type: string;
  full_name?: string;
  phone?: string;
  gender?: string | null;
};

/** Local compatibility cache; Supabase Auth remains the source of truth. */
export const sessionStore = {
  set(user: CachedUser) {
    localStorage.setItem("authUser", JSON.stringify(user));
  },
  get(): CachedUser | null {
    try {
      const raw = localStorage.getItem("authUser");
      return raw ? (JSON.parse(raw) as CachedUser) : null;
    } catch {
      return null;
    }
  },
  clear() {
    localStorage.removeItem("authUser");
  },
};
