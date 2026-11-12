import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, ArrowLeft, KeyRound, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthSlideshow } from "@/hooks/useAuthSlideshow";
import { authAction, signInWithIdentifier } from "@/lib/auth";
import slide1 from "../../Promotion/Promotion_2/795696821_2068750914002786_4444334205767913973_n.jpg";
import slide2 from "../../Promotion/Promotion_2/793924181_2511856059334424_2316540071660421728_n.jpg";
import slide3 from "../../Promotion/Promotion_2/792584856_1324396436253243_842653748892513400_n.jpg";

const slides = [
  { src: slide1, title: "Cozy Rooms", desc: "Comfortable, well-furnished rooms that feel like home." },
  { src: slide2, title: "Shared Kitchen", desc: "Modern communal kitchen for a true community experience." },
  { src: slide3, title: "Relaxing Lounge", desc: "Unwind in our spacious common areas after a long day." },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.6, staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const buttonVariants = {
  hover: { scale: 1.03, transition: { duration: 0.2 } },
  tap: { scale: 0.97 },
};

type PasswordResetResponse = {
  type: "success" | "error";
  message?: string;
  phone_hint?: string;
  code?: string;
  reset_token?: string;
};

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<"identifier" | "code" | "reset" | "done">("identifier");
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [forgotPhoneHint, setForgotPhoneHint] = useState("");
  const [forgotResetToken, setForgotResetToken] = useState("");
  const [forgotMockCode, setForgotMockCode] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showForgotPass, setShowForgotPass] = useState(false);
  const [showForgotConfirmPass, setShowForgotConfirmPass] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const { currentSlide, setCurrentSlide } = useAuthSlideshow(slides.length);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const state = location.state as { sessionExpired?: boolean } | null;
    if (state?.sessionExpired) {
      setError("Your session expired. Please sign in again.");
    }
  }, [location.state]);

  const resetForgot = () => {
    setForgotOpen(false);
    setTimeout(() => {
      setForgotStep("identifier");
      setForgotIdentifier("");
      setForgotPhoneHint("");
      setForgotResetToken("");
      setForgotMockCode("");
      setForgotCode("");
      setNewPass("");
      setConfirmPass("");
      setShowForgotPass(false);
      setShowForgotConfirmPass(false);
      setForgotError("");
    }, 300);
  };

  const resendForgotCode = async () => {
    setForgotError("");
    setForgotLoading(true);
    try {
      const response = await authAction<PasswordResetResponse>(
        "request_password_reset",
        { identifier: forgotIdentifier.trim() },
      );
      if (response.type !== "success") {
        throw new Error(response.message || "Unable to request a reset code.");
      }
      setForgotPhoneHint(response.phone_hint ?? "");
      setForgotMockCode(response.code ?? "");
      setForgotCode("");
      setForgotResetToken("");
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Unable to resend the reset code.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");
    if (forgotStep === "identifier" && !forgotIdentifier.trim()) {
      setForgotError("Enter your username or email address.");
      return;
    }
    if (forgotStep === "code" && !/^\d{6}$/.test(forgotCode)) {
      setForgotError("Enter the 6-digit code.");
      return;
    }
    if (forgotStep === "reset") {
      if (newPass.length < 6 || newPass.length > 200) {
        setForgotError("Password must be 6–200 characters long.");
        return;
      }
      if (newPass !== confirmPass) {
        setForgotError("Passwords do not match.");
        return;
      }
    }

    setForgotLoading(true);
    try {
      if (forgotStep === "identifier") {
        const response = await authAction<PasswordResetResponse>(
          "request_password_reset",
          { identifier: forgotIdentifier.trim() },
        );
        if (response.type !== "success") {
          throw new Error(response.message || "Unable to request a reset code.");
        }
        setForgotPhoneHint(response.phone_hint ?? "");
        setForgotMockCode(response.code ?? "");
        setForgotCode("");
        setForgotStep("code");
        setForgotError("");
      } else if (forgotStep === "code") {
        const response = await authAction<PasswordResetResponse>(
          "verify_password_reset",
          { identifier: forgotIdentifier.trim(), otp: forgotCode },
        );
        if (response.type !== "success" || !response.reset_token) {
          throw new Error(response.message || "Unable to verify the reset code.");
        }
        setForgotResetToken(response.reset_token);
        setForgotStep("reset");
      } else if (forgotStep === "reset") {
        const response = await authAction<PasswordResetResponse>(
          "reset_password",
          { new_password: newPass, reset_token: forgotResetToken },
        );
        if (response.type !== "success") {
          throw new Error(response.message || "Unable to reset your password.");
        }
        setForgotStep("done");
      }
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Password reset failed. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const profile = await signInWithIdentifier(email, password);
      const type = String(profile.user_type || "").toLowerCase();
      const path = type === "admin" ? "/admin"
        : type === "tenant" ? "/tenant"
        : "/guest";
      if (type === "guest") {
        const name = profile.username || profile.email || "Guest";
        const initials = name.split(/[\s@.]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "G";
        localStorage.setItem("guestUser", JSON.stringify({ name, initials }));
      }
      navigate(path, { replace: false });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid username or password.");
    } finally {
      setLoading(false);
      setTimeout(() => setError(""), 4000);
    }
  };

  return (
    <div className="min-h-screen flex bg-muted/50">
      {/* Left decorative panel - hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.img
            key={currentSlide}
            src={slides[currentSlide].src}
            alt={slides[currentSlide].title}
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 w-full h-full object-cover"
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/40 to-transparent" />
        <div className="relative z-10 flex flex-col justify-end p-10 text-white">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSlide}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
            </motion.div>
          </AnimatePresence>
          <div className="flex gap-2 mt-6">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentSlide(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentSlide ? "w-8 bg-white" : "w-4 bg-white/40"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="w-full"
        >
          <motion.div className="mb-5" variants={itemVariants}>
            <div className="text-center">
              <Link to="/" className="font-display font-bold text-2xl text-primary">Myle's Boarding House</Link>
              <p className="text-muted-foreground mt-1">Sign in to your account</p>
              <motion.div
                className="mx-auto mt-2 w-10 h-1 rounded-full bg-primary"
                variants={itemVariants}
              />
            </div>
          </motion.div>

          <motion.div
            className="bg-card border border-border rounded-lg p-5 shadow-sm"
            variants={itemVariants}
          >
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  className="fixed bottom-4 right-4 z-50 w-[min(92vw,360px)] pointer-events-auto"
                >
                  <div className="flex items-center gap-3 rounded-full border border-[#f7c9c2] bg-[#fff3f1] px-4 py-3 text-[#7a1f1f] shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ef4444] text-white">
                      <CircleAlert className="h-4 w-4" />
                    </div>
                    <div className="text-sm font-medium leading-snug">{error}</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email/Password Form */}
            <motion.form onSubmit={handleLogin} className="space-y-4" variants={containerVariants}>
              {/* Email - Floating Label */}
              <motion.div className="relative" variants={itemVariants}>
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                <motion.input
                  type="text"
                  id="login-email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder=" "
                  className="peer w-full bg-muted rounded-md pl-10 pr-4 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]"
                  whileFocus={{ scale: 1.01 }}
                />
                <label
                  htmlFor="login-email"
                  className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                    email ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                  } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                >
                  Email or username
                </label>
              </motion.div>

              {/* Password - Floating Label */}
              <motion.div className="relative" variants={itemVariants}>
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                <motion.input
                  type={showPass ? "text" : "password"}
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder=" "
                  className="peer w-full bg-muted rounded-md pl-10 pr-10 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]"
                  whileFocus={{ scale: 1.01 }}
                />
                <label
                  htmlFor="login-password"
                  className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                    password ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                  } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                >
                  Password
                </label>
                <motion.button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </motion.button>
              </motion.div>

              <motion.div className="flex justify-end -mt-2" variants={itemVariants}>
                <button
                  type="button"
                  onClick={() => setForgotOpen(true)}
                  className="text-xs text-primary font-medium hover:underline"
                >
                  Forgot password?
                </button>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Button
                  type="submit"
                  className="w-full transition-all duration-300 shadow-md hover:shadow-lg"
                  disabled={loading}
                  asChild
                >
                  <motion.button
                    type="submit"
                    disabled={loading}
                    variants={buttonVariants}
                    whileHover="hover"
                    whileTap="tap"
                  >
                    {loading ? "SIGNING IN..." : "Sign In"}
                  </motion.button>
                </Button>
              </motion.div>
            </motion.form>

            <motion.p className="text-xs text-muted-foreground text-center mt-3" variants={itemVariants}>
              Don't have an account? <Link to="/signup" className="text-primary font-medium hover:underline">Sign Up</Link>
            </motion.p>
            <motion.div className="mt-3 pt-3 border-t border-border" variants={itemVariants}>
              <Link to="/" className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium bg-muted hover:bg-muted/80 transition-colors group">
                <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
                Back to Home
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      <AnimatePresence>
        {forgotOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-foreground/60 backdrop-blur-sm"
              onClick={resetForgot}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="relative w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-6"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  {forgotStep === "done" ? <CheckCircle2 size={20} /> : <KeyRound size={20} />}
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg">
                    {forgotStep === "identifier" && "Forgot Password"}
                    {forgotStep === "code" && "Verify Code"}
                    {forgotStep === "reset" && "New Password"}
                    {forgotStep === "done" && "Password Reset"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {forgotStep === "identifier" && "Enter your username or email to receive a reset code by SMS."}
                    {forgotStep === "code" && "If the account is eligible, a 6-digit code was sent to its registered mobile number."}
                    {forgotStep === "reset" && "Choose a new secure password."}
                    {forgotStep === "done" && "You can now sign in with your new password."}
                  </p>
                </div>
              </div>

              <AnimatePresence>
                {forgotError && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mb-3 p-2.5 bg-destructive/10 border border-destructive/30 text-destructive rounded-md text-xs"
                  >
                    {forgotError}
                  </motion.div>
                )}
              </AnimatePresence>

              {forgotStep !== "done" ? (
                <form onSubmit={handleForgotSubmit} className="space-y-3">
                  {forgotStep === "identifier" && (
                    <input
                      type="text"
                      autoFocus
                      autoComplete="username"
                      value={forgotIdentifier}
                      onChange={(e) => setForgotIdentifier(e.target.value)}
                      placeholder="Username or email"
                      className="w-full bg-muted rounded-md px-3 py-2.5 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-colors"
                    />
                  )}
                  {forgotStep === "code" && (
                    <>
                      <label htmlFor="forgot-phone-destination" className="block text-xs font-medium text-muted-foreground">
                        Registered mobile number (masked)
                      </label>
                      <input
                        id="forgot-phone-destination"
                        type="text"
                        readOnly
                        value={forgotPhoneHint || "•••••••••••"}
                        aria-label="Masked registered phone number"
                        className="w-full bg-muted/60 rounded-md px-3 py-2.5 text-sm text-muted-foreground outline-none border border-border"
                      />
                      <input
                        type="text"
                        autoFocus
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        value={forgotCode}
                        onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="123456"
                        className="w-full bg-muted rounded-md px-3 py-2.5 text-center text-lg tracking-[0.5em] font-semibold outline-none border-2 border-transparent focus:border-primary/50 transition-colors"
                      />
                      {forgotMockCode && (
                        <p className="text-xs text-amber-600 dark:text-amber-300">
                          Development mode: reset code <span className="font-semibold">{forgotMockCode}</span>
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => void resendForgotCode()}
                        disabled={forgotLoading}
                        className="text-xs text-primary hover:underline disabled:opacity-50"
                      >
                        Resend reset code
                      </button>
                    </>
                  )}
                  {forgotStep === "reset" && (
                    <>
                      <div className="relative">
                        <input
                          type={showForgotPass ? "text" : "password"}
                          autoFocus
                          autoComplete="new-password"
                          value={newPass}
                          onChange={(e) => setNewPass(e.target.value)}
                          placeholder="New password"
                          className="w-full bg-muted rounded-md px-3 py-2.5 pr-10 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowForgotPass(current => !current)}
                          aria-label={showForgotPass ? "Hide new password" : "Show new password"}
                          aria-pressed={showForgotPass}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                        >
                          {showForgotPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showForgotConfirmPass ? "text" : "password"}
                          autoComplete="new-password"
                          value={confirmPass}
                          onChange={(e) => setConfirmPass(e.target.value)}
                          placeholder="Confirm new password"
                          className="w-full bg-muted rounded-md px-3 py-2.5 pr-10 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowForgotConfirmPass(current => !current)}
                          aria-label={showForgotConfirmPass ? "Hide password confirmation" : "Show password confirmation"}
                          aria-pressed={showForgotConfirmPass}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                        >
                          {showForgotConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button type="button" variant="outline" className="flex-1" onClick={resetForgot}>
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1" disabled={forgotLoading}>
                      {forgotLoading
                        ? "Please wait..."
                        : forgotStep === "identifier"
                          ? "Send Reset Code"
                          : forgotStep === "code"
                            ? "Verify"
                            : "Reset Password"}
                    </Button>
                  </div>
                </form>
              ) : (
                <Button className="w-full" onClick={resetForgot}>
                  Back to Sign In
                </Button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Login;
