import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { BedDouble, Shield, MessageCircle, CreditCard, Bell, MessageSquareWarning, ChevronRight, ChevronLeft, Quote, Menu, X, LogOut, Sun, Moon } from "lucide-react";
import { RoomCard } from "@/components/RoomCard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChatbotWidget } from "@/components/ChatbotWidget";
import { LocationMap } from "@/components/LocationMap";
import { RoomDetailsDialog } from "@/components/RoomDetailsDialog";
import { RatingStars } from "@/components/RatingStars";
import { Switch } from "@/components/ui/switch";
import { usePolling } from "@/hooks/usePolling";
import { API_BASE_URL, endpoints } from "@/lib/api";

import logo from "@/assets/logo.png";
import roomSingle from "@/assets/room-single.jpg";
import roomDouble from "@/assets/room-double.jpg";
import roomSuite from "@/assets/room-suite.jpg";
import heroSlide1 from "../../Promotion/773975397_1801893280820553_5956689233169011423_n (1).jpg";
import heroSlide2 from "../../Promotion/774069080_2917648111913793_64257836457754159_n.jpg";
import heroSlide3 from "../../Promotion/774190937_1063676902978628_1007580302922928254_n (1).jpg";
import heroSlide4 from "../../Promotion/774510572_1767684557577949_4655357441577790374_n (1).jpg";
import heroSlide5 from "../../Promotion/775047569_3053171715107193_4244530931739889398_n (1).jpg";
import heroSlide6 from "../../Promotion/776200076_1826458431856497_726356571030393406_n.jpg";
import heroSlide7 from "../../Promotion/776252609_1735827617653592_6187239454364844364_n.jpg";
import heroSlide8 from "../../Promotion/780748479_1044715208204598_5619881364332714695_n.jpg";

const heroSlides = [heroSlide1, heroSlide2, heroSlide3, heroSlide4, heroSlide5, heroSlide6, heroSlide7, heroSlide8];

const features = [
  { icon: BedDouble, title: "Real-Time Availability", desc: "Check room status and availability instantly, 24/7." },
  { icon: MessageCircle, title: "AI Chatbot", desc: "Get instant answers to your questions anytime." },
  { icon: Bell, title: "SMS Alerts", desc: "Stay updated with real-time notifications." },
  { icon: CreditCard, title: "Online Payments", desc: "Secure, hassle-free rent payments online." },
  { icon: Shield, title: "Maintenance Portal", desc: "Submit and track maintenance requests easily." },
  { icon: MessageSquareWarning, title: "Complaints", desc: "File a concern, track its status, and review management responses." },
];

type PublicReview = {
  stars: number;
  category: string;
  comment: string;
  created_at: string;
  full_name: string;
};

type PublicStats = {
  total_rooms: number;
  available_rooms: number;
  happy_tenants: number;
  avg_rating: number;
};

type RoomItem = { room_id?: number; image: string; name: string; price: string; status: "available" | "occupied" | "maintenance"; amenities: string[] };
const mockRooms: RoomItem[] = [
  { image: roomSingle, name: "Single Room A1", price: "₱3,500", status: "available", amenities: ["WiFi", "AC", "Desk"] },
  { image: roomDouble, name: "Double Room B2", price: "₱5,500", status: "available", amenities: ["WiFi", "AC", "TV", "Closet"] },
  { image: roomSuite, name: "Premium Suite C1", price: "₱8,000", status: "available", amenities: ["WiFi", "AC", "TV", "Bath", "Balcony"] },
  { image: roomSingle, name: "Single Room A2", price: "₱3,500", status: "available", amenities: ["WiFi", "AC", "Desk"] },
  { image: roomDouble, name: "Double Room B3", price: "₱5,500", status: "available", amenities: ["WiFi", "AC", "TV", "Closet"] },
  { image: roomSuite, name: "Premium Suite C2", price: "₱8,000", status: "available", amenities: ["WiFi", "AC", "TV", "Bath", "Balcony"] },
];

const imageForType = (type: string) =>
  type?.toLowerCase().includes("suite") ? roomSuite
  : type?.toLowerCase().includes("double") ? roomDouble
  : roomSingle;

const navItems = [
  { label: "Rooms", id: "rooms" },
  { label: "Features", id: "features" },
  { label: "Location", id: "location" },
  { label: "Reviews", id: "reviews" },
];

function ThemeControl({ showLabel = false }: { showLabel?: boolean }) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="flex items-center gap-2">
      {showLabel && <span className="mr-auto text-sm font-medium">Appearance</span>}
      <Sun size={16} className={!isDark ? "text-primary" : "text-muted-foreground"} aria-hidden="true" />
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label="Toggle dark mode"
      />
      <Moon size={16} className={isDark ? "text-primary" : "text-muted-foreground"} aria-hidden="true" />
    </div>
  );
}

const Index = () => {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [activeNavItem, setActiveNavItem] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomItem | null>(null);
  const roomsScrollRef = useRef<HTMLDivElement>(null);
  const reviewsScrollRef = useRef<HTMLDivElement>(null);

  // Live rooms from PHP backend (5s polling). Falls back to mock data if backend is offline.
  const { data: liveRooms } = usePolling<Array<{ room_id: number; room_number: string; room_type: string; monthly_rent: number; description: string; status: string; image?: string; }>>(
    `${endpoints.publicRooms}?action=list`,
    { intervalMs: 5000 }
  );
  const { data: publicReviews } = usePolling<PublicReview[]>(`${endpoints.publicInfo}?action=reviews`, { intervalMs: 10000 });
  const { data: publicStats } = usePolling<PublicStats>(`${endpoints.publicInfo}?action=stats`, { intervalMs: 10000 });

  const rooms: RoomItem[] = liveRooms && liveRooms.length > 0
    ? liveRooms.map(r => ({
        room_id: r.room_id,
        image: r.image
          ? (r.image.startsWith("http") ? r.image : `${API_BASE_URL}/uploads/rooms/${r.image}`)
          : imageForType(r.room_type),
        name: `${r.room_type} Room ${r.room_number}`,
        price: "₱" + Number(r.monthly_rent).toLocaleString(),
        status: (r.status === "Available" ? "available" : r.status === "Occupied" ? "occupied" : "maintenance") as "available" | "occupied" | "maintenance",
        amenities: (r.description || "").split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 5),
      }))
    : mockRooms;

  const reviews = (publicReviews ?? []).map((r) => {
    const initials = r.full_name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "UT";
    return {
      name: r.full_name,
      initials,
      role: "Tenant",
      rating: r.stars,
      category: r.category,
      comment: r.comment,
      date: new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    };
  });

  const avgRating = publicStats?.avg_rating ?? 0;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroSlides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll rooms carousel
  useEffect(() => {
    const container = roomsScrollRef.current;
    if (!container) return;
    const timer = setInterval(() => {
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (container.scrollLeft >= maxScroll - 10) {
        container.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        container.scrollBy({ left: 360, behavior: "smooth" });
      }
    }, 3500);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll reviews carousel
  useEffect(() => {
    const container = reviewsScrollRef.current;
    if (!container) return;
    const timer = setInterval(() => {
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (container.scrollLeft >= maxScroll - 10) {
        container.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        container.scrollBy({ left: 360, behavior: "smooth" });
      }
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const scrollTo = (id: string) => {
    setActiveNavItem(id);
    const el = document.getElementById(id);
    if (el) {
      const navbarHeight = 64;
      const targetTop = window.scrollY + el.getBoundingClientRect().top - navbarHeight;
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    }
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-40 glass">
        <div className="w-full px-6 h-16 flex items-center justify-between">
          <Link to="/" className="font-display font-bold text-xl text-primary flex items-center gap-2">
            <img src={logo} alt="Myle's Boarding House" className="h-8 w-8" />
            Myle's Boarding House
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className={`relative py-2 transition-colors hover:text-primary ${activeNavItem === item.id ? "text-primary" : ""}`}
                aria-current={activeNavItem === item.id ? "location" : undefined}
              >
                {item.label}
                {activeNavItem === item.id && (
                  <motion.span
                    layoutId="landing-nav-indicator"
                    className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center">
              <ThemeControl />
            </div>
            <Link to="/login" className="hidden sm:inline text-sm font-medium hover:text-primary transition-colors">Sign In</Link>
            <Link to="/signup" className="hidden sm:inline-flex bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity">
              Sign Up
            </Link>
            <button
              className="md:hidden p-2 rounded-md hover:bg-muted transition-colors relative z-50"
              onClick={() => setMobileMenuOpen(v => !v)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed top-16 left-0 w-full bg-background/95 backdrop-blur-md border-t border-border z-50 md:hidden">
          <div className="flex flex-col px-6 py-4 gap-3">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="text-left text-sm font-medium py-2 hover:text-primary transition-colors"
              >
                {item.label}
              </button>
            ))}
            <div className="border-t border-border pt-3 flex flex-col gap-2">
              <div className="flex items-center rounded-md bg-muted/50 px-3 py-2">
                <ThemeControl showLabel />
              </div>
              <Link to="/login" className="text-sm font-medium hover:text-primary transition-colors py-1" onClick={() => setMobileMenuOpen(false)}>Sign In</Link>
              <Link to="/signup" className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium text-center hover:opacity-90 transition-opacity" onClick={() => setMobileMenuOpen(false)}>
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="relative pt-16 min-h-[85vh] flex items-center overflow-hidden">
        <div className="absolute inset-0">
        <AnimatePresence mode="wait">
          <motion.img
            key={currentSlide}
            src={heroSlides[currentSlide]}
            alt="Myle's Boarding House"
            className="w-full h-full object-cover"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/55 to-black/35" />
        {/* Slide indicators */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-2">
          {heroSlides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentSlide(i)}
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${i === currentSlide ? "bg-white w-6" : "bg-white/50"}`}
            />
          ))}
        </div>
        </div>
        <div className="relative z-10 w-full px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="mx-auto max-w-3xl text-center"
          >
            <h1 className="font-display text-4xl md:text-6xl font-bold text-white leading-tight">
              Your Home,<br />
              <span className="text-accent">Simplified.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/85">
              Modern boarding house management with smart booking, secure payments, and real-time tracking — all in one place.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button onClick={() => navigate("/signup")} className="bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity flex items-center gap-2">
                Browse Rooms <ChevronRight size={18} />
              </button>
              <button onClick={() => scrollTo("features")} className="border border-white/40 text-white px-6 py-3 rounded-md font-medium hover:bg-white/10 transition-colors">
                Learn More
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Rooms */}
      <motion.section id="rooms" className="py-20 px-6" initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.6 }}>
        <div className="w-full">
          <h2 className="font-display text-3xl font-bold text-center">Rooms Preview</h2>
          <p className="text-muted-foreground text-center mt-2 max-w-md mx-auto">Find the perfect room that fits your lifestyle and budget.</p>
          <div className="relative mt-8">
            <div
              ref={roomsScrollRef}
              className="flex gap-4 sm:gap-6 overflow-x-auto scroll-smooth pb-4 snap-x snap-mandatory scrollbar-hide px-[7.5vw] sm:px-0"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {rooms.map((room) => (
                <div key={room.name} className="min-w-[85vw] sm:min-w-[300px] md:min-w-[340px] snap-center sm:snap-start flex-shrink-0">
                  <RoomCard {...room} showStatus={false} onView={() => setSelectedRoom(room)} />
                </div>
              ))}
            </div>
            <button
              onClick={() => roomsScrollRef.current?.scrollBy({ left: -360, behavior: "smooth" })}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 p-2 rounded-full bg-background/90 border border-border shadow-md hover:bg-accent transition-colors hidden md:flex items-center justify-center"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => roomsScrollRef.current?.scrollBy({ left: 360, behavior: "smooth" })}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 p-2 rounded-full bg-background/90 border border-border shadow-md hover:bg-accent transition-colors hidden md:flex items-center justify-center"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </motion.section>

      {/* Features */}
      <motion.section id="features" className="py-20 px-6 bg-muted/50" initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.6, delay: 0.1 }}>
        <div className="w-full">
          <h2 className="font-display text-3xl font-bold text-center">Smart Features</h2>
          <p className="text-muted-foreground text-center mt-2">Everything you need for a seamless boarding experience.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-10">
            {features.map((f) => (
              <motion.div
                key={f.title}
                whileHover={{ y: -4 }}
                className="rounded-lg border border-border bg-card p-6 hover:shadow-lg transition-shadow"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <f.icon className="text-primary" size={24} />
                </div>
                <h3 className="font-display font-semibold text-lg mt-4">{f.title}</h3>
                <p className="text-muted-foreground text-sm mt-2">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      <section className="px-6 py-12 flex justify-center">
        <iframe
          src="https://www.youtube.com/embed/KitgNbL8I4A"
          title="Myle's Boarding House YouTube Short"
          className="w-full max-w-[720px] aspect-video rounded-lg border border-border"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </section>

      {/* Location Map */}
      <LocationMap />

      {/* Tenant Reviews */}
      <motion.section id="reviews" className="py-20 px-6" initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.6, delay: 0.1 }}>
        <div className="w-full">
          <h2 className="font-display text-3xl font-bold text-center">What Our Tenants Say</h2>
          <p className="text-muted-foreground text-center mt-2 max-w-lg mx-auto">Real reviews from past and current tenants who called Myle's Boarding House home.</p>
          <div className="flex items-center justify-center gap-1 mt-4">
            <RatingStars value={avgRating} size={24} colorClass="fill-accent text-accent" emptyClass="text-muted-foreground/30" />
            <span className="ml-2 font-display font-bold text-lg">{avgRating.toFixed(1)}</span>
            <span className="text-muted-foreground text-sm ml-1">avg. rating</span>
          </div>
          <div className="relative mt-10">
            {reviews.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                {publicReviews ? "No tenant reviews available yet." : "Loading tenant reviews..."}
              </div>
            ) : (
              <>
                <div
                  ref={reviewsScrollRef}
                  className="flex gap-4 sm:gap-6 overflow-x-auto scroll-smooth pb-4 snap-x snap-mandatory px-[7.5vw] sm:px-0"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {reviews.map((r) => (
                    <motion.div
                      key={`${r.name}-${r.date}`}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      className="min-w-[85vw] max-w-[85vw] sm:min-w-[300px] sm:max-w-[300px] md:min-w-[360px] md:max-w-[360px] snap-center sm:snap-start flex-shrink-0 rounded-lg border border-border bg-card p-6 flex flex-col"
                    >
                      <Quote className="text-primary/30 mb-3" size={28} />
                      <p className="text-sm text-foreground/80 flex-1 italic line-clamp-4">"{r.comment}"</p>
                      <div className="flex items-center gap-1 mt-4">
                        <RatingStars value={Number(r.rating)} size={14} colorClass="fill-accent text-accent" emptyClass="text-muted-foreground/30" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{r.category}</p>
                      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{r.initials}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-semibold">{r.name}</p>
                          <p className="text-xs text-muted-foreground">{r.role} · {r.date}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
                <button
                  onClick={() => reviewsScrollRef.current?.scrollBy({ left: -360, behavior: "smooth" })}
                  className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 p-2 rounded-full bg-background/90 border border-border shadow-md hover:bg-accent transition-colors hidden md:flex items-center justify-center"
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={() => reviewsScrollRef.current?.scrollBy({ left: 360, behavior: "smooth" })}
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 p-2 rounded-full bg-background/90 border border-border shadow-md hover:bg-accent transition-colors hidden md:flex items-center justify-center"
                >
                  <ChevronRight size={20} />
                </button>
              </>
            )}
          </div>
        </div>
      </motion.section>

      <footer id="contact" className="py-12 px-6 bg-foreground text-background/80">
        <div className="w-full flex flex-col md:flex-row justify-between gap-8">
          <div>
            <span className="font-display font-bold text-xl text-primary flex items-center gap-2"><img src={logo} alt="Logo" className="h-8 w-8" /> Myle's Boarding House</span>
            <p className="mt-2 text-sm max-w-xs">Modern boarding house management for tenants and property owners.</p>
          </div>
          <div className="text-sm space-y-2">
            <p className="font-semibold text-background">Contact</p>
            <p>contact@boardinghub.com</p>
            <p>+63 912 345 6789</p>
          </div>
          <div className="text-sm space-y-2">
            <p className="font-semibold text-background">Quick Links</p>
            <Link to="/login" className="block hover:text-primary">Sign In</Link>
            <a href="#rooms" className="block hover:text-primary">Rooms</a>
            <a href="#features" className="block hover:text-primary">Features</a>
          </div>
        </div>
      </footer>

      <RoomDetailsDialog
        room={selectedRoom}
        open={!!selectedRoom}
        onOpenChange={(open) => { if (!open) setSelectedRoom(null); }}
      />
      <ChatbotWidget />
    </div>
  );
};

export default Index;
