import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, ArrowLeft, User, Check, X as XIcon, Loader2, Smartphone, PhoneCall, MapPin, CalendarDays, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthSlideshow } from "@/hooks/useAuthSlideshow";
import { authAction, signUpGuest } from "@/lib/auth";
import { toast } from "sonner";
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

type Availability = "idle" | "checking" | "available" | "taken" | "invalid";

const SignUp = () => {
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [birthday, setBirthday] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [phoneStatus, setPhoneStatus] = useState<Availability>("idle");
  const [otp, setOtp] = useState("");
  const [otpStatus, setOtpStatus] = useState<"idle" | "sending" | "sent" | "verifying" | "verified">("idle");
  const [otpMessage, setOtpMessage] = useState("");
  const [generatedOtp, setGeneratedOtp] = useState("");
  const [isMockOtp, setIsMockOtp] = useState(false);
  const [profilePicture, setProfilePicture] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<Availability>("idle");
  const [emailStatus, setEmailStatus] = useState<Availability>("idle");

  const { currentSlide, setCurrentSlide } = useAuthSlideshow(slides.length);
  const navigate = useNavigate();

  // Real-time AJAX: check username availability (debounced)
  useEffect(() => {
    const u = username.trim();
    if (!u) { setUsernameStatus("idle"); return; }
    if (u.length < 3) { setUsernameStatus("invalid"); return; }
    setUsernameStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await authAction<{ type: "success"; available: boolean }>(
          "check_username",
          { username: u },
        );
        setUsernameStatus(res.available ? "available" : "taken");
      } catch {
        setUsernameStatus("idle");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [username]);

  // Real-time AJAX: check email availability (debounced)
  useEffect(() => {
    const e = email.trim();
    if (!e) { setEmailStatus("idle"); return; }
    if (!/^\S+@\S+\.\S+$/.test(e)) { setEmailStatus("invalid"); return; }
    setEmailStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await authAction<{ type: "success"; available: boolean }>(
          "check_email",
          { email: e },
        );
        setEmailStatus(res.available ? "available" : "taken");
      } catch {
        setEmailStatus("idle");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [email]);

  useEffect(() => {
    const normalized = phone.trim();
    if (!normalized) {
      setPhoneStatus("idle");
      return;
    }

    const digitsOnly = normalized.replace(/\D/g, "");
    const looksLikePhilippineMobile = /^09\d{9}$/.test(normalized) || /^\+639\d{9}$/.test(normalized);
    if (!looksLikePhilippineMobile) {
      setPhoneStatus("invalid");
      return;
    }

    if (digitsOnly.length !== 11 || digitsOnly === "09111111111" || /^(\d)\1{9}$/.test(digitsOnly)) {
      setPhoneStatus("invalid");
      return;
    }

    setPhoneStatus("available");
  }, [phone]);

  useEffect(() => {
    setOtp("");
    setOtpStatus("idle");
    setOtpMessage("");
    setGeneratedOtp("");
    setIsMockOtp(false);
  }, [phone, email]);

  const canSendOtp = otpStatus !== "sending" && phoneStatus === "available";
  const canVerifyOtp = otpStatus !== "verifying" && otpStatus !== "verified" && otp.length === 6;
  const currentDate = new Date();
  const maxBirthday = [
    currentDate.getFullYear(),
    String(currentDate.getMonth() + 1).padStart(2, "0"),
    String(currentDate.getDate()).padStart(2, "0"),
  ].join("-");
  const calculatedAge = (() => {
    if (!birthday) return "";
    const birthDate = new Date(`${birthday}T00:00:00`);
    if (Number.isNaN(birthDate.getTime())) return "";
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    if (
      today.getMonth() < birthDate.getMonth() ||
      (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
    ) {
      age -= 1;
    }
    return age >= 0 ? String(age) : "";
  })();

  const requestOtp = async () => {
    setError("");
    setOtpMessage("");
    if (phoneStatus !== "available") {
      setError("Please enter a valid Philippine mobile number first.");
      return;
    }

    setOtpStatus("sending");
    try {
      const res = await authAction<{ type: "success"; code?: string; message?: string }>(
        "send_otp",
        { phone, email },
      );
      if (res.type === "success") {
        const mockCode = typeof res.code === "string" ? res.code : "";
        setGeneratedOtp(mockCode);
        setIsMockOtp(Boolean(mockCode));
        setOtpStatus("sent");
        setOtpMessage(
          mockCode
            ? `Mock OTP generated: ${mockCode}. Enter it below to verify.`
            : (res.message || "OTP sent to your phone. Enter the code below to continue.")
        );
        setOtp("");
      }
    } catch (err: unknown) {
      setOtpStatus("idle");
      setError(err instanceof Error ? err.message : "Could not send OTP.");
    }
  };

  const verifyOtp = async () => {
    setError("");
    setOtpMessage("");
    if (!/^\d{6}$/.test(otp)) {
      setError("Please enter the 6-digit OTP.");
      return;
    }

    setOtpStatus("verifying");
    try {
      const res = await authAction<{ type: "success"; message?: string }>(
        "verify_otp",
        { phone, otp },
      );
      if (res.type === "success") {
        setOtpStatus("verified");
        setOtpMessage(res.message || "OTP verified successfully.");
      }
    } catch (err: unknown) {
      setOtpStatus("sent");
      setError(err instanceof Error ? err.message : "OTP verification failed.");
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (phoneStatus !== "available") {
      setError("Please enter a valid Philippine mobile number (for example: 09171234567).");
      return;
    }
    if (!address.trim() || address.trim().length > 255) {
      setError("Please enter your address (maximum 255 characters).");
      return;
    }
    if (!birthday || !calculatedAge || Number(calculatedAge) > 120) {
      setError("Please enter a valid birthday.");
      return;
    }
    if (!emergencyContactName.trim() || emergencyContactName.trim().length > 150) {
      setError("Please enter the emergency contact's name (maximum 150 characters).");
      return;
    }
    if (!/^09\d{9}$/.test(emergencyContactPhone)) {
      setError("Enter an 11-digit Philippine mobile number for the emergency contact (09XXXXXXXXX).");
      return;
    }
    if (otpStatus !== "verified") {
      setError("Please verify your phone number with the OTP first.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters long");
      setTimeout(() => setError(""), 3000);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setTimeout(() => setError(""), 3000);
      return;
    }
    if (usernameStatus === "taken" || emailStatus === "taken") {
      setError("Please pick an available username and email.");
      return;
    }

    setLoading(true);
    try {
      const fullName = [firstName, middleName, lastName]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
      const { profile, profilePictureError } = await signUpGuest({
        full_name: fullName,
        username: username || email.split("@")[0],
        email,
        phone,
        address: address.trim(),
        birthday,
        age: Number(calculatedAge),
        emergency_contact_name: emergencyContactName.trim(),
        emergency_contact_phone: emergencyContactPhone,
        otp,
        password,
      }, profilePicture);
      if (profilePictureError) {
        toast.error(`Account created, but the profile picture could not be saved: ${profilePictureError}`);
      }
      const name = profile.username || profile.email || "Guest";
      const initials = name.split(/[\s@.]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "G";
      localStorage.setItem("guestUser", JSON.stringify({ name, initials }));
      navigate("/guest", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  const renderStatus = (status: Availability) => {
    if (status === "checking") return <Loader2 size={14} className="animate-spin text-muted-foreground" />;
    if (status === "available") return <Check size={14} className="text-success" />;
    if (status === "taken") return <XIcon size={14} className="text-destructive" />;
    if (status === "invalid") return <XIcon size={14} className="text-warning" />;
    return null;
  };

  return (
    <div className="min-h-screen flex bg-muted/50">
      {/* Left decorative panel */}
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

      {/* Right sign up form */}
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
              <p className="text-muted-foreground mt-1">Create your account</p>
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
                  <div
                    className="flex items-center gap-3 rounded-full border border-[#f7c9c2] bg-[#fff3f1] px-4 py-3 text-sm text-[#7a1f1f] shadow-[0_12px_28px_rgba(15,23,42,0.18)]"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ef4444] text-white">
                      <CircleAlert className="h-4 w-4" />
                    </div>
                    <div className="leading-snug">
                      <div className="font-medium">{error}</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.form onSubmit={handleSignUp} className="space-y-4" variants={containerVariants}>
              {/* Name fields are combined into the existing full_name database value. */}
              <motion.div className="space-y-3" variants={itemVariants}>
                <motion.div className="relative" variants={itemVariants}>
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                  <motion.input type="text" id="signup-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder=" " required className="peer w-full bg-muted rounded-md pl-10 pr-3 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300" whileFocus={{ scale: 1.01 }} />
                  <label htmlFor="signup-first-name" className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${firstName ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"} peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}>First Name</label>
                </motion.div>
                <motion.div className="relative" variants={itemVariants}>
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                  <motion.input type="text" id="signup-middle-name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder=" " className="peer w-full bg-muted rounded-md pl-10 pr-4 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]" whileFocus={{ scale: 1.01 }} />
                  <label htmlFor="signup-middle-name" className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${middleName ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"} peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}>Middle Name</label>
                </motion.div>
                <motion.div className="relative" variants={itemVariants}>
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                  <motion.input type="text" id="signup-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder=" " required className="peer w-full bg-muted rounded-md pl-10 pr-4 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]" whileFocus={{ scale: 1.01 }} />
                  <label htmlFor="signup-last-name" className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${lastName ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"} peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}>Last Name</label>
                </motion.div>
              </motion.div>

              {/* Username - Floating Label + real-time AJAX check */}
              <motion.div className="relative" variants={itemVariants}>
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                <motion.input
                  type="text"
                  id="signup-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder=" "
                  required
                  className="peer w-full bg-muted rounded-md pl-10 pr-10 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]"
                  whileFocus={{ scale: 1.01 }}
                />
                <label
                  htmlFor="signup-username"
                  className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                    username ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                  } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                >
                  Username
                </label>
                <div className="absolute right-3 top-1/2 -translate-y-1/2">{renderStatus(usernameStatus)}</div>
              </motion.div>

              {/* Email - Floating Label + real-time AJAX check */}
              <motion.div className="relative" variants={itemVariants}>
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                <motion.input
                  type="email"
                  id="signup-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder=" "
                  required
                  className="peer w-full bg-muted rounded-md pl-10 pr-10 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]"
                  whileFocus={{ scale: 1.01 }}
                />
                <label
                  htmlFor="signup-email"
                  className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                    email ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                  } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                >
                  Email
                </label>
                <div className="absolute right-3 top-1/2 -translate-y-1/2">{renderStatus(emailStatus)}</div>
              </motion.div>

              <motion.div className="space-y-3" variants={itemVariants}>
                <div className="relative">
                  <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                  <motion.input
                    type="text"
                    id="signup-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder=" "
                    maxLength={255}
                    required
                    className="peer w-full bg-muted rounded-md pl-10 pr-3 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300"
                    whileFocus={{ scale: 1.01 }}
                  />
                  <label
                    htmlFor="signup-address"
                    className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                      address ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                    } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                  >
                    Address
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="signup-birthday" className="mb-1 block text-xs text-muted-foreground">Birthday</label>
                    <div className="relative">
                      <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="date"
                        id="signup-birthday"
                        value={birthday}
                        max={maxBirthday}
                        onChange={(e) => setBirthday(e.target.value)}
                        required
                        className="w-full bg-muted rounded-md pl-10 pr-3 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="signup-age" className="mb-1 block text-xs text-muted-foreground">Age</label>
                    <input
                      type="number"
                      id="signup-age"
                      value={calculatedAge}
                      readOnly
                      placeholder="From birthday"
                      aria-describedby="signup-age-help"
                      className="w-full bg-muted rounded-md px-3 py-3 text-sm outline-none border-2 border-transparent"
                    />
                    <p id="signup-age-help" className="mt-1 text-xs text-muted-foreground">Calculated from your birthday.</p>
                  </div>
                </div>
              </motion.div>

              {/* Phone - Floating Label */}
              <motion.div variants={itemVariants}>
                <div className="relative">
                  <Smartphone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                  <motion.input
                    type="tel"
                    id="signup-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    placeholder=" "
                    inputMode="numeric"
                    pattern="09[0-9]{9}"
                    maxLength={11}
                    required
                    className="peer w-full bg-muted rounded-md pl-10 pr-10 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]"
                    whileFocus={{ scale: 1.01 }}
                  />
                  <label
                    htmlFor="signup-phone"
                    className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                      phone ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                    } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                  >
                    Phone Number
                  </label>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">{renderStatus(phoneStatus)}</div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Use a real Philippine mobile number. We will use it to verify your account.
                </p>
              </motion.div>

              <motion.div className="space-y-3 rounded-md border border-border p-3" variants={itemVariants}>
                <div>
                  <p className="text-sm font-medium">Emergency Contact</p>
                  <p className="text-xs text-muted-foreground">Someone we can contact in case of an emergency.</p>
                </div>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                  <motion.input
                    type="text"
                    id="signup-emergency-contact-name"
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                    placeholder=" "
                    maxLength={150}
                    required
                    className="peer w-full bg-muted rounded-md pl-10 pr-3 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300"
                    whileFocus={{ scale: 1.01 }}
                  />
                  <label
                    htmlFor="signup-emergency-contact-name"
                    className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                      emergencyContactName ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                    } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                  >
                    Contact Name
                  </label>
                </div>
                <div>
                  <div className="relative">
                    <PhoneCall size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                    <motion.input
                      type="tel"
                      id="signup-emergency-contact-phone"
                      value={emergencyContactPhone}
                      onChange={(e) => setEmergencyContactPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                      placeholder=" "
                      inputMode="numeric"
                      pattern="09[0-9]{9}"
                      maxLength={11}
                      required
                      className="peer w-full bg-muted rounded-md pl-10 pr-3 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300"
                      whileFocus={{ scale: 1.01 }}
                    />
                    <label
                      htmlFor="signup-emergency-contact-phone"
                      className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                        emergencyContactPhone ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                      } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                    >
                      Contact Phone Number
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Use a Philippine mobile number (09XXXXXXXXX).</p>
                </div>
              </motion.div>

              <motion.div className="space-y-2" variants={itemVariants}>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Enter 6-digit OTP"
                    className="w-full bg-muted rounded-md px-4 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all"
                    maxLength={6}
                  />
                  <Button type="button" variant="outline" onClick={requestOtp} disabled={!canSendOtp}>
                    {otpStatus === "sending" ? "Sending..." : otpStatus === "sent" || otpStatus === "verified" ? "Resend" : "Send OTP"}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={verifyOtp} disabled={!canVerifyOtp}>
                    {otpStatus === "verifying" ? "Verifying..." : otpStatus === "verified" ? "Verified" : "Verify OTP"}
                  </Button>
                </div>
                {generatedOtp && (
                  <p className="text-xs text-amber-600 dark:text-amber-300">Mock OTP for testing: <span className="font-semibold">{generatedOtp}</span></p>
                )}
                {otpMessage && <p className={`text-xs ${otpStatus === "verified" ? "text-success" : "text-primary"}`}>{otpMessage}</p>}
                {otpStatus === "verified" && <p className="text-xs text-success">Phone number verified successfully. You can continue creating your account.</p>}
                <p className="text-xs text-muted-foreground">
                  {isMockOtp
                    ? "Development mode: enter the generated 6-digit code above to continue."
                    : "Enter the 6-digit code sent to your phone to continue."}
                </p>
              </motion.div>

              {/* Profile picture */}
              <motion.div className="space-y-2" variants={itemVariants}>
                <label htmlFor="signup-profile-picture" className="block text-sm font-medium text-muted-foreground">
                  Upload your profile picture (optional)
                </label>
                <input
                  id="signup-profile-picture"
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (!file) {
                      setProfilePicture(null);
                      return;
                    }

                    const isAllowedType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
                    const maxSize = 10 * 1024 * 1024;

                    if (!isAllowedType) {
                      setError("Please upload a profile picture in JPG, PNG, or WEBP format.");
                      setProfilePicture(null);
                      return;
                    }
                    if (file.size > maxSize) {
                      setError("Profile picture must be 10MB or smaller.");
                      setProfilePicture(null);
                      return;
                    }
                    setError("");
                    setProfilePicture(file);
                  }}
                  className="w-full text-sm text-muted-foreground"
                />
                {profilePicture && (
                  <p className="text-xs text-muted-foreground">Selected file: {profilePicture.name}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Upload a clear JPG, PNG, or WEBP image up to 10MB, or leave this blank.
                </p>
              </motion.div>

              {/* Password - Floating Label */}
              <motion.div className="relative" variants={itemVariants}>
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                <motion.input
                  type={showPass ? "text" : "password"}
                  id="signup-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder=" "
                  required
                  className="peer w-full bg-muted rounded-md pl-10 pr-10 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]"
                  whileFocus={{ scale: 1.01 }}
                />
                <label
                  htmlFor="signup-password"
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

              {/* Confirm Password - Floating Label */}
              <motion.div className="relative" variants={itemVariants}>
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                <motion.input
                  type={showConfirm ? "text" : "password"}
                  id="signup-confirm"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder=" "
                  required
                  className="peer w-full bg-muted rounded-md pl-10 pr-10 py-3 text-sm outline-none border-2 border-transparent focus:border-primary/50 transition-all duration-300 hover:scale-[1.01]"
                  whileFocus={{ scale: 1.01 }}
                />
                <label
                  htmlFor="signup-confirm"
                  className={`absolute left-10 transition-all duration-300 pointer-events-none text-muted-foreground ${
                    confirmPassword ? "-top-2 text-xs text-primary bg-card px-1" : "top-3 text-sm"
                  } peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:bg-card peer-focus:px-1`}
                >
                  Confirm Password
                </label>
                <motion.button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </motion.button>
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
                    {loading
                      ? "CREATING ACCOUNT..."
                      : "Create Account"}
                  </motion.button>
                </Button>
              </motion.div>
            </motion.form>

            <motion.p className="text-xs text-muted-foreground text-center mt-3" variants={itemVariants}>
              Already have an account? <Link to="/login" className="text-primary font-medium hover:underline">Sign In</Link>
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
    </div>
  );
};

export default SignUp;
