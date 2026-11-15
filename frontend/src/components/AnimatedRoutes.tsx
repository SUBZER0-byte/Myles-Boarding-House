import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthProvider";
import { signOutSupabase } from "@/lib/auth";
import { toast } from "sonner";
import Index from "@/pages/Index";
import Login from "@/pages/Login";
import SignUp from "@/pages/SignUp";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminTenants from "@/pages/admin/AdminTenants";
import AdminGuests from "@/pages/admin/AdminGuests";
import AdminRooms from "@/pages/admin/AdminRooms";
import AdminAnnouncements from "@/pages/admin/AdminAnnouncements";
import AdminComplaints from "@/pages/admin/AdminComplaints";
import AdminMaintenance from "@/pages/admin/AdminMaintenance";
import AdminPayments from "@/pages/admin/AdminPayments";
import AdminNotifications from "@/pages/admin/AdminNotifications";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminRatings from "@/pages/admin/AdminRatings";
import AdminAnalytics from "@/pages/admin/AdminAnalytics";
import AdminLogs from "@/pages/admin/AdminLogs";
import AdminCancellations from "@/pages/admin/AdminCancellations";
import AdminGuestBookingPayments from "@/pages/admin/AdminGuestBookingPayments";
import AdminRefunds from "@/pages/admin/AdminRefunds";
import AdminFullPayments from "@/pages/admin/AdminFullPayments";
import TenantDashboard from "@/pages/TenantDashboard";
import TenantRoom from "@/pages/tenant/TenantRoom";
import TenantPayments from "@/pages/tenant/TenantPayments";
import TenantAnnouncements from "@/pages/tenant/TenantAnnouncements";
import TenantComplaints from "@/pages/tenant/TenantComplaints";
import TenantMaintenance from "@/pages/tenant/TenantMaintenance";
import TenantSettings from "@/pages/tenant/TenantSettings";
import TenantRatings from "@/pages/tenant/TenantRatings";
import TenantNotifications from "@/pages/tenant/TenantNotifications";
import TenantCancellation from "@/pages/tenant/TenantCancellation";
import GuestDashboard from "@/pages/GuestDashboard";
import GuestRooms from "@/pages/guest/GuestRooms";
import GuestBooking from "@/pages/guest/GuestBooking";
import GuestSaved from "@/pages/guest/GuestSaved";
import GuestLocation from "@/pages/guest/GuestLocation";
import GuestNotifications from "@/pages/guest/GuestNotifications";
import GuestSettings from "@/pages/guest/GuestSettings";
import Chat from "@/pages/Chat";
import PaymentSuccess from "@/pages/PaymentSuccess";
import PaymentFailed from "@/pages/PaymentFailed";
import NotFound from "@/pages/NotFound";

const getDefaultRoute = (role: string) => {
  const normalized = (role || "guest").toLowerCase();
  if (normalized === "admin") return "/admin";
  if (normalized === "tenant") return "/tenant";
  return "/guest";
};

const ProtectedRoute = ({ children, allowedRoles }: { children: JSX.Element; allowedRoles: string[] }) => {
  const { profile, loading } = useAuth();
  if (loading) return <div className="p-6 text-center" role="status">Loading your account...</div>;
  const session = profile;
  const role = String(session?.user_type || "").toLowerCase();
  if (!session?.user_id) {
    return <Navigate to="/login" replace />;
  }
  if (!allowedRoles.includes(role)) {
    return <Navigate to={getDefaultRoute(role) || "/login"} replace />;
  }
  return children;
};

const PublicOnlyRoute = ({ children }: { children: JSX.Element }) => {
  const { profile, loading } = useAuth();
  if (loading) return <div className="p-6 text-center" role="status">Loading your account...</div>;
  const session = profile;
  if (session?.user_id) {
    return <Navigate to={getDefaultRoute(String(session.user_type || "guest"))} replace />;
  }
  return children;
};

const AnimatedRoutes = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleSessionExpired = () => {
      void signOutSupabase()
        .then(() => navigate("/login", {
          replace: true,
          state: { sessionExpired: true },
        }))
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Your session expired. Please sign in again.");
          navigate("/login", { replace: true });
        });
    };
    window.addEventListener("mbh:session-expired", handleSessionExpired);
    return () => window.removeEventListener("mbh:session-expired", handleSessionExpired);
  }, [navigate]);

  return (
    <>
    <Routes>
      <Route path="/" element={<PublicOnlyRoute><Index /></PublicOnlyRoute>} />
      <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
      <Route path="/signup" element={<PublicOnlyRoute><SignUp /></PublicOnlyRoute>} />
      {/* Admin Routes */}
      <Route path="/admin" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/tenants" element={<ProtectedRoute allowedRoles={["admin"]}><AdminTenants /></ProtectedRoute>} />
      <Route path="/admin/guests" element={<ProtectedRoute allowedRoles={["admin"]}><AdminGuests /></ProtectedRoute>} />
      <Route path="/admin/rooms" element={<ProtectedRoute allowedRoles={["admin"]}><AdminRooms /></ProtectedRoute>} />
      <Route path="/admin/announcements" element={<ProtectedRoute allowedRoles={["admin"]}><AdminAnnouncements /></ProtectedRoute>} />
      <Route path="/admin/complaints" element={<ProtectedRoute allowedRoles={["admin"]}><AdminComplaints /></ProtectedRoute>} />
      <Route path="/admin/maintenance" element={<ProtectedRoute allowedRoles={["admin"]}><AdminMaintenance /></ProtectedRoute>} />
      <Route path="/admin/payments" element={<ProtectedRoute allowedRoles={["admin"]}><AdminPayments /></ProtectedRoute>} />
      <Route path="/admin/notifications" element={<ProtectedRoute allowedRoles={["admin"]}><AdminNotifications /></ProtectedRoute>} />
      <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={["admin"]}><AdminSettings /></ProtectedRoute>} />
      <Route path="/admin/ratings" element={<ProtectedRoute allowedRoles={["admin"]}><AdminRatings /></ProtectedRoute>} />
      <Route path="/admin/analytics" element={<ProtectedRoute allowedRoles={["admin"]}><AdminAnalytics /></ProtectedRoute>} />
      <Route path="/admin/logs" element={<ProtectedRoute allowedRoles={["admin"]}><AdminLogs /></ProtectedRoute>} />
      <Route path="/admin/cancellations" element={<ProtectedRoute allowedRoles={["admin"]}><AdminCancellations /></ProtectedRoute>} />
      <Route path="/admin/booking-payments" element={<ProtectedRoute allowedRoles={["admin"]}><AdminGuestBookingPayments /></ProtectedRoute>} />
      <Route path="/admin/refunds" element={<ProtectedRoute allowedRoles={["admin"]}><AdminRefunds /></ProtectedRoute>} />
      <Route path="/admin/full-payments" element={<ProtectedRoute allowedRoles={["admin"]}><AdminFullPayments /></ProtectedRoute>} />
      <Route path="/admin/messages" element={<ProtectedRoute allowedRoles={["admin"]}><Chat /></ProtectedRoute>} />
      {/* Tenant Routes */}
      <Route path="/tenant" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantDashboard /></ProtectedRoute>} />
      <Route path="/tenant/room" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantRoom /></ProtectedRoute>} />
      <Route path="/tenant/payments" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantPayments /></ProtectedRoute>} />
      <Route path="/tenant/announcements" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantAnnouncements /></ProtectedRoute>} />
      <Route path="/tenant/complaints" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantComplaints /></ProtectedRoute>} />
      <Route path="/tenant/maintenance" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantMaintenance /></ProtectedRoute>} />
      <Route path="/tenant/settings" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantSettings /></ProtectedRoute>} />
      <Route path="/tenant/ratings" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantRatings /></ProtectedRoute>} />
      <Route path="/tenant/notifications" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantNotifications /></ProtectedRoute>} />
      <Route path="/tenant/cancellation" element={<ProtectedRoute allowedRoles={["tenant"]}><TenantCancellation /></ProtectedRoute>} />
      <Route path="/tenant/messages" element={<ProtectedRoute allowedRoles={["tenant"]}><Chat /></ProtectedRoute>} />
      {/* Guest Routes */}
      <Route path="/guest" element={<ProtectedRoute allowedRoles={["guest"]}><GuestDashboard /></ProtectedRoute>} />
      <Route path="/guest/rooms" element={<ProtectedRoute allowedRoles={["guest"]}><GuestRooms /></ProtectedRoute>} />
      <Route path="/guest/booking" element={<ProtectedRoute allowedRoles={["guest"]}><GuestBooking /></ProtectedRoute>} />
      <Route path="/guest/saved" element={<ProtectedRoute allowedRoles={["guest"]}><GuestSaved /></ProtectedRoute>} />
      <Route path="/guest/location" element={<ProtectedRoute allowedRoles={["guest"]}><GuestLocation /></ProtectedRoute>} />
      <Route path="/guest/notifications" element={<ProtectedRoute allowedRoles={["guest"]}><GuestNotifications /></ProtectedRoute>} />
      <Route path="/guest/settings" element={<ProtectedRoute allowedRoles={["guest"]}><GuestSettings /></ProtectedRoute>} />
      <Route path="/guest/messages" element={<ProtectedRoute allowedRoles={["guest"]}><Chat /></ProtectedRoute>} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/payment/success" element={<PaymentSuccess />} />
      <Route path="/payment/failed" element={<PaymentFailed />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
};

export default AnimatedRoutes;
