import axios from "axios";

/**
 * Base URL for the PHP backend.
 * Override with VITE_API_BASE_URL, for example:
 * https://api.example.com/backend
 */
const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, "");
function defaultLocalBase(): string {
  // Apache serves this project from the XAMPP htdocs root. The backend lives
  // directly under the real project folder, not a stale legacy folder name.
  return "http://localhost/Myle's%20Boarding%20House/backend";
}

const apiBase = envBase || (import.meta.env.DEV ? defaultLocalBase() : "");
export const API_BASE_URL = apiBase;

export const api = axios.create({
  baseURL: apiBase,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
  timeout: 45000,
});

api.interceptors.request.use((config) => {
  if (import.meta.env.PROD && !envBase) {
    return Promise.reject(new Error(
      "VITE_API_BASE_URL is not configured for production. Set it to the public HTTPS URL of the PHP backend in Vercel, then redeploy.",
    ));
  }
  return config;
});

// Per-area endpoint helpers
export const endpoints = {
  // Landing-Page
  auth: "/Landing-Page/auth.php",
  publicRooms: "/Landing-Page/rooms.php",
  publicInfo: "/Landing-Page/public_info.php",
  booking: "/Landing-Page/booking.php",
  contact: "/Landing-Page/contact.php",

  // Admin
  adminDashboard: "/Admin/admindashboard.php",
  adminTenants: "/Admin/tenants.php",
  adminRooms: "/Admin/rooms.php",
  adminPayments: "/Admin/payments.php",
  refunds: "/Payments/refunds.php",
  fullPayments: "/Tenant/full_payment.php",
  adminFullPayments: "/Admin/full_payments.php",
  adminComplaints: "/Admin/complaints.php",
  adminMaintenance: "/Admin/maintenance.php",
  adminAnnouncements: "/Admin/announcements.php",
  adminRatings: "/Admin/ratings.php",
  adminNotifications: "/Admin/notifications.php",
  adminAnalytics: "/Admin/analytics.php",
  adminSettings: "/Admin/settings.php",
  adminLogs: "/Admin/logs.php",
  adminSms: "/Notifications/sms.php",

  // Tenant
  tenantDashboard: "/Tenant/tenantdashboard.php",
  tenantRoom: "/Tenant/room.php",
  tenantPayments: "/Tenant/payments.php",
  tenantComplaints: "/Tenant/complaints.php",
  tenantMaintenance: "/Tenant/maintenance.php",
  tenantAnnouncements: "/Tenant/announcements.php",
  tenantRatings: "/Tenant/ratings.php",
  tenantNotifications: "/Tenant/notifications.php",
  tenantSettings: "/Tenant/settings.php",
  tenantCancellations: "/Tenant/cancellations.php",

  // Admin — Cancellations
  adminCancellations: "/Admin/cancellations.php",

  // Guest — Booking status
  guestBooking: "/Landing-Page/booking.php",
} as const;

export type ApiResponse<T = unknown> = {
  type: "success" | "error";
  message?: string;
  data?: T;
  [k: string]: unknown;
};

/** Local session helpers (mirrors the User.jsx pattern) */
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

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)
      && error.response?.status === 401
      && !error.config?.url?.includes("action=signin")) {
      sessionStore.clear();
      window.dispatchEvent(new Event("mbh:session-expired"));
    }
    return Promise.reject(error);
  },
);
