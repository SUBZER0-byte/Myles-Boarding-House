/** Local compatibility cache; Supabase Auth remains the source of truth. */
export const sessionStore = {
  set(user: { user_id: number | string; username: string; email: string; user_type: string; full_name?: string; phone?: string }) {
    localStorage.setItem("authUser", JSON.stringify(user));
  },
  get() {
    try {
      const raw = localStorage.getItem("authUser");
      return raw ? (JSON.parse(raw) as ReturnType<typeof sessionStore.get>) : null;
    } catch {
      return null;
    }
  },
  clear() {
    localStorage.removeItem("authUser");
  },
};
