"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import {
  ShieldCheck,
  Activity,
  Users,
  ChevronRight,
  ChevronLeft,
  Mic,
  User,
  Cpu,
  AlertTriangle,
  CheckCircle,
  Clock,
  Calendar,
  ArrowRight,
  MapPin,
  Phone,
  Mail,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import LandingBackground from "@/components/LandingBackground";

const slides = [
  {
    src: "/sanctuary_exterior.png",
    tag: "Architectural Render",
    title: "Golden Hearth Wellness Residence",
    desc: "A stunning, organic modern exterior set in lush, tranquil gardens designed for peace and recovery."
  },
  {
    src: "/sanctuary_lounge.png",
    tag: "Lobby & Lounge",
    title: "The Fireplace Atrium",
    desc: "A warm, double-height community lounge featuring floor-to-ceiling windows looking onto Japanese gardens."
  },
  {
    src: "/sanctuary_garden.png",
    tag: "Wellness Park",
    title: "Tranquility Gardens",
    desc: "Lush walking paths, serene ponds, and outdoor therapeutic areas promoting mobility and nature connection."
  },
  {
    src: "/sanctuary_suite.png",
    tag: "Private Living",
    title: "Luxury Care Suite",
    desc: "Elegant private apartments featuring subtle ambient monitoring technology and bespoke smart comfort systems."
  },
  {
    src: "/sanctuary_dining.png",
    tag: "Gourmet Dining",
    title: "The Hearth Bistro",
    desc: "Restaurant-grade dining spaces serving custom nutritional menu options crafted by professional chefs."
  }
];

interface RoadmapStep {
  title: string;
  tag: string;
  desc: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  subTasks: string[];
  kpis: { label: string; value: string }[];
}

const SYSTEM_FLOW_DATA: RoadmapStep[] = [
  {
    title: "Resident Welcome & Secure Setup",
    tag: "Step 1: Onboarding",
    desc: "We establish secure wellness records, room assignments, and customized comfort goals for the new resident.",
    icon: User,
    subTasks: ["Review welcome evaluation details", "Customize room and care settings", "Securely create care profile"],
    kpis: [{ label: "Intake", value: "Complete" }, { label: "Records Status", value: "Secured" }]
  },
  {
    title: "Suite Safety Sensor Calibration",
    tag: "Step 2: Suite Protection",
    desc: "Configure and test non-intrusive safety sensors inside the private suite to enable fall detection.",
    icon: Cpu,
    subTasks: ["Verify sensor placement", "Check fall detection sensitivity", "Test privacy-first security locks"],
    kpis: [{ label: "Sensors Status", value: "Online" }, { label: "Privacy Shields", value: "Active" }]
  },
  {
    title: "Daily Assisted Living Coordination",
    tag: "Step 3: Daily Support",
    desc: "Caregivers execute daily schedules including dining services, comfort check-ins, and mobility assistance.",
    icon: Users,
    subTasks: ["Coordinate morning meals", "Assist with daily walks and gardens", "Verify daily assistance list"],
    kpis: [{ label: "Shift Coverage", value: "100%" }, { label: "Daily Comfort Index", value: "9.8/10" }]
  },
  {
    title: "Continuous Health & Vitals Tracking",
    tag: "Step 4: Continuous Care",
    desc: "Track health trends (like oxygen levels, sleep quality, and heart rate) to notice health changes early.",
    icon: Activity,
    subTasks: ["Log automatic heart rate trends", "Record oxygen level averages", "Analyze daily sleep quality"],
    kpis: [{ label: "Vitals Tracking", value: "Active" }, { label: "Device Power", value: "95%" }]
  },
  {
    title: "Hands-Free Voice Care Notes",
    tag: "Step 5: Documentation",
    desc: "Care staff dictate progress updates naturally, which are typed instantly into charts using smart voice assistant technology.",
    icon: Mic,
    subTasks: ["Record spoken nurse feedback", "Instantly transcribe audio to notes", "Save update directly to records"],
    kpis: [{ label: "Transcription", value: "Instant" }, { label: "Hands-Free Status", value: "Enabled" }]
  },
  {
    title: "Immediate Warning Alert Dispatch",
    tag: "Step 6: Quick Response",
    desc: "If a fall or safety incident occurs, the system immediately sounds a notification at the nurse station.",
    icon: AlertTriangle,
    subTasks: ["Detect posture changes instantly", "Trigger nursing station alerts", "Create secure incident logs"],
    kpis: [{ label: "Alert Dispatch", value: "<1 min" }, { label: "Alert Precision", value: "99.8%" }]
  },
  {
    title: "Family Portal Sync & Collaboration",
    tag: "Step 7: Transparency",
    desc: "Family sponsors securely log in to review daily comfort updates, vital logs, and monthly invoices.",
    icon: CheckCircle,
    subTasks: ["Sync daily wellness summary", "Publish monthly billing breakdown", "Schedule visitation requests"],
    kpis: [{ label: "Family Portal Sync", value: "Live" }, { label: "Invoices Status", value: "Delivered" }]
  }
];

export default function Home() {
  const fadeInUp = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } }
  } as const;

  const [activeIndex, setActiveIndex] = useState(0);
  const [invitationCallback, setInvitationCallback] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamic CMS content
  const [siteContent, setSiteContent] = useState<Record<string, string>>({});
  const [blogPosts, setBlogPosts] = useState<Array<{
    id: string; title: string; description: string; imageUrl?: string;
    author: string; publishedAt: string; published: boolean;
  }>>([]);
  const [plans, setPlans] = useState<Array<{
    id: string; key: string; name: string; description?: string | null;
    maxCommunities?: number | null; maxActiveResidents?: number | null; maxStaffSeats?: number | null;
    modules: number; priceMonthly: number | null; currency: string; tagline: string; highlight: boolean;
  }>>([]);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const callbackType = hash.get("type");
    if (accessToken && refreshToken && ["invite", "signup"].includes(callbackType || "")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      void Promise.resolve().then(() => {
        setInvitationCallback("Completing your secure workspace invitation…");
        return fetch("/api/auth/invitation-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, refreshToken }),
        });
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Invitation could not be completed");
        window.location.replace(result.redirectUrl);
      }).catch((error) => setInvitationCallback(error instanceof Error ? error.message : "Invitation could not be completed"));
    }

    // Fetch site content
    fetch("/api/public/site-content", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        const map: Record<string, string> = {};
        for (const row of json.data || []) map[row.id] = row.value;
        setSiteContent(map);
      })
      .catch(() => {});

    // Fetch published blog posts
    fetch("/api/public/blog-posts?f_published=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setBlogPosts(json.data || []))
      .catch(() => {});

    // Fetch live subscription plans created by the platform admin
    fetch("/api/public/plans", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setPlans(json.plans || []))
      .catch(() => {});
  }, []);

  const formatPrice = (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
    } catch {
      return `${currency} ${amount.toLocaleString()}`;
    }
  };

  const sc = (key: string, fallback: string) => siteContent[key] || fallback;
  // Scroll hooks for cinematic parallax scroll effect
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"]
  });

  // Calculate parallax y-offset (shifts the image vertically inside the container as the user scrolls)
  const parallaxY = useTransform(scrollYProgress, [0, 1], ["-10%", "10%"]);
  // Calculate subtle cinematic zoom based on scroll position
  const parallaxScale = useTransform(scrollYProgress, [0, 0.5, 1], [1.08, 1.02, 1.08]);

  // Autoplay functionality
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % slides.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const nextSlide = () => {
    setActiveIndex((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setActiveIndex((prev) => (prev - 1 + slides.length) % slides.length);
  };

  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center pt-24">
      {invitationCallback && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-blue-400/20 bg-slate-900 p-6 text-center text-white shadow-2xl"><ShieldCheck className="mx-auto h-8 w-8 text-blue-400"/><h2 className="mt-3 text-xl font-bold">Secure workspace invitation</h2><p className="mt-2 text-sm text-slate-300">{invitationCallback}</p></div></div>}
      <LandingBackground />
      <Navbar />
      {/* Golden Hearth Background Element */}
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[800px] h-[800px] opacity-30 pointer-events-none mix-blend-screen">
        <Image 
          src="/golden_hearth_glow.jpg" 
          alt="Premium Background Accent" 
          fill
          className="object-cover blur-3xl rounded-full"
          priority
        />
      </div>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center justify-center min-h-[90vh] text-center px-6 max-w-5xl mx-auto">
        <motion.div 
          initial="hidden"
          animate="visible"
          variants={fadeInUp}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-sm font-medium text-muted-foreground mb-8"
        >
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "var(--lp-accent, #f59e0b)" }} />
          Next-Gen Wellness Platform Live
        </motion.div>

        <motion.h1 
          initial="hidden"
          animate="visible"
          variants={fadeInUp}
          className="text-4xl sm:text-6xl md:text-8xl font-black tracking-tighter heading-gradient mb-6"
        >
          {sc("hero_title", "Care Redefined.")} <br />
          <span className="text-muted-foreground font-light italic text-2xl sm:text-4xl md:text-6xl">{sc("hero_subtitle", "For Peaceful Living.")}</span>
        </motion.h1>

        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 1 }}
          className="text-lg md:text-xl text-muted-foreground max-w-2xl font-light mb-10 leading-relaxed"
        >
          {sc("hero_description", "A cinematic, minimalist approach to elder care management. Equipped with Real-Time Optical Safety Matrices and friendly, responsive voice assistants. Engineered for deep empathy and supreme operational efficiency.")}
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <Link href={plans.length ? "#plans" : "/signup"} className="px-8 py-4 rounded-xl bg-foreground text-background font-semibold tracking-wide hover:scale-105 transition-transform flex items-center gap-2 shadow-lg dark:shadow-[0_0_40px_rgba(255,255,255,0.15)] cursor-pointer">
            Register Your Company <ChevronRight className="w-4 h-4" />
          </Link>
          <Link href="/login" className="px-8 py-4 rounded-xl glass-panel text-foreground hover:bg-foreground/5 transition-all flex items-center gap-2 cursor-pointer">
            <User className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" /> Log In
          </Link>
        </motion.div>
      </section>

      {/* Showcase Section */}
      <section id="showcase" className="relative z-10 w-full px-6 py-16 max-w-7xl mx-auto flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            The Sanctuary
          </h2>
          <p className="text-muted-foreground font-light max-w-2xl mx-auto">
            A visual overview of the premium Golden Hearth Care facility, designed specifically for luxury living, wellness, and comfort for the aged.
          </p>
        </motion.div>

        <motion.div
          ref={containerRef}
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="relative w-full aspect-[16/9] md:aspect-[21/9] max-w-5xl rounded-3xl overflow-hidden glass-panel p-2 group shadow-[0_0_50px_rgba(234,179,8,0.1)] border-amber-500/20"
        >
          {/* Subtle Accent Glows */}
          <div className="absolute -top-12 -left-12 w-64 h-64 bg-amber-500/10 blur-3xl rounded-full pointer-events-none group-hover:bg-amber-500/20 transition-all duration-700 z-20" />
          <div className="absolute -bottom-12 -right-12 w-64 h-64 bg-yellow-500/10 blur-3xl rounded-full pointer-events-none group-hover:bg-yellow-500/20 transition-all duration-700 z-20" />

          {/* Carousel Frame */}
          <div className="relative w-full h-full rounded-2xl overflow-hidden bg-zinc-950">
            <AnimatePresence initial={false}>
              <motion.div
                key={activeIndex}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeInOut" }}
                className="absolute top-[-10%] left-0 w-full h-[120%]"
                style={{ y: parallaxY, scale: parallaxScale }}
              >
                <Image
                  src={slides[activeIndex].src}
                  alt={slides[activeIndex].title}
                  fill
                  className="object-cover"
                  priority
                />
              </motion.div>
            </AnimatePresence>

            {/* Gradient Overlay for Text Readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent z-10 pointer-events-none" />

            {/* Cinematic Slide Captions */}
            <div className="absolute bottom-6 left-6 right-6 md:bottom-10 md:left-10 z-20 text-left max-w-xl pointer-events-none">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeIndex}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  <p className="text-amber-400 text-xs md:text-sm font-semibold tracking-widest uppercase mb-2">
                    {slides[activeIndex].tag}
                  </p>
                  <h3 className="text-white text-2xl md:text-4xl font-extrabold tracking-tight mb-2">
                    {slides[activeIndex].title}
                  </h3>
                  <p className="text-gray-300 text-sm md:text-base font-light leading-relaxed">
                    {slides[activeIndex].desc}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Navigation Dots */}
            <div className="absolute bottom-6 right-6 md:bottom-10 md:right-10 z-30 flex gap-2">
              {slides.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`h-2.5 rounded-full transition-all duration-500 cursor-pointer ${
                    idx === activeIndex
                      ? "w-8 bg-[var(--lp-accent,#f59e0b)] shadow-[0_0_10px_var(--lp-accent-30,rgba(245,158,11,0.3))]"
                      : "w-2.5 bg-white/40 hover:bg-white/70"
                  }`}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>

            {/* Next/Prev Navigation Buttons */}
            <button
              onClick={prevSlide}
              className="absolute left-6 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 text-white transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-sm"
              aria-label="Previous slide"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={nextSlide}
              className="absolute right-6 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 text-white transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-sm"
              aria-label="Next slide"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </motion.div>
      </section>

      {/* Operational Process Roadmap Section */}
      <section id="roadmap" className="relative z-10 w-full px-6 py-24 max-w-5xl mx-auto flex flex-col items-center border-t border-white/5">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Operational Process Roadmap
          </h2>
          <p className="text-muted-foreground font-light max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
            Follow our step-by-step care journey, showing the complete flow from resident onboarding to daily support and continuous wellness monitoring.
          </p>
        </motion.div>

        {/* Roadmap Timeline */}
        <div className="relative pl-6 md:pl-10 border-l border-[var(--lp-accent,#f59e0b)]/20 ml-3 md:ml-6 space-y-12 w-full text-left">
          {SYSTEM_FLOW_DATA.map((step, stepIdx) => {
            const StepIcon = step.icon;

            return (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: stepIdx * 0.1 }}
                className="relative"
              >
                {/* Timeline Pin Indicator */}
                <div className="absolute -left-[35px] md:-left-[51px] top-1.5 w-7 h-7 md:w-9 md:h-9 rounded-full flex items-center justify-center border border-[var(--lp-accent,#f59e0b)]/30 bg-[var(--lp-accent,#f59e0b)]/10 text-[var(--lp-accent,#f59e0b)] shadow-[0_0_15px_var(--lp-accent-20,rgba(245,158,11,0.15))] z-10">
                  <StepIcon className="w-3.5 h-3.5 md:w-4 h-4" />
                </div>

                {/* Step Card */}
                <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-[var(--lp-accent,#f59e0b)]/20 hover:shadow-[0_0_30px_var(--lp-accent-10,rgba(245,158,11,0.03))] transition-all duration-300">
                  {/* Step Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                    <div>
                      <span className="text-[10px] font-bold text-[var(--lp-accent,#f59e0b)] uppercase tracking-widest block mb-1">
                        {step.tag}
                      </span>
                      <h3 className="text-base md:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                        {step.title}
                      </h3>
                    </div>
                    
                    {/* KPIs badges */}
                    <div className="flex flex-wrap gap-2">
                      {step.kpis.map((kpi, kIdx) => (
                        <div
                          key={kIdx}
                          className="px-2.5 py-1 rounded-lg bg-foreground/5 border border-border/50 text-[10px] font-medium text-muted-foreground flex gap-1.5"
                        >
                          <span className="opacity-70">{kpi.label}:</span>
                          <span className="font-bold text-foreground">{kpi.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs md:text-sm text-muted-foreground font-light leading-relaxed mb-4">
                    {step.desc}
                  </p>

                  <hr className="border-border/50 my-4" />

                  {/* Static Milestones Grid */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Operational Milestones
                    </p>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                      {step.subTasks.map((sub, subIdx) => (
                        <li
                          key={subIdx}
                          className="text-xs text-muted-foreground font-light flex items-center gap-2.5"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-accent,#f59e0b)]/80 shrink-0" />
                          <span>{sub}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Feature Section */}
      <section id="features" className="relative z-10 w-full px-6 py-32 max-w-7xl mx-auto border-t border-white/5">
        <motion.div 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.2 } }
          }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8"
        >
          {[
            { icon: Activity, title: sc("feature_1_title", "Optical Matrix"), desc: sc("feature_1_desc", "Real-time edge-computed anomaly and fall detection ensuring absolute resident safety.") },
            { icon: Mic, title: sc("feature_2_title", "Voice Assistant"), desc: sc("feature_2_desc", "Low-latency conversational AI for hands-free charting and friendly companionship.") },
            { icon: ShieldCheck, title: sc("feature_3_title", "Secure Family Portal"), desc: sc("feature_3_desc", "Private health logs and vitals synced in real-time with family dashboards.") }
          ].map((feat, i) => (
            <motion.div 
              key={i}
              variants={fadeInUp}
              className="glass-panel p-8 rounded-2xl hover:-translate-y-2 transition-transform duration-500 group"
            >
              <div className="w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-[var(--lp-accent,#f59e0b)]/20 transition-all">
                <feat.icon className="w-6 h-6 text-muted-foreground group-hover:text-[var(--lp-accent,#f59e0b)] transition-colors" />
              </div>
              <h3 className="text-xl font-semibold mb-3 text-foreground">{feat.title}</h3>
              <p className="text-muted-foreground font-light leading-relaxed">{feat.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>
      
      {/* Plans / Pricing Section — live from the platform admin's plans */}
      {plans.length > 0 && (
        <section id="plans" className="relative z-10 w-full px-6 py-24 max-w-7xl mx-auto border-t border-white/5 flex flex-col items-center">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
              {sc("plans_title", "Plans & Pricing")}
            </h2>
            <p className="text-muted-foreground font-light max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
              {sc("plans_subtitle", "Choose the plan that fits your organization. Scale communities, residents, and staff seats as you grow.")}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full items-stretch">
            {plans.map((plan, i) => {
              const bullets = [
                `${plan.maxCommunities ?? "Unlimited"} ${plan.maxCommunities === 1 ? "community" : "communities"}`,
                `${plan.maxActiveResidents ?? "Unlimited"} residents`,
                `${plan.maxStaffSeats ?? "Unlimited"} staff seats`,
                plan.modules > 0 ? `${plan.modules} care modules included` : "Core clinical modules",
              ];
              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className={`relative glass-panel rounded-3xl p-8 flex flex-col hover:-translate-y-2 transition-all duration-500 ${plan.highlight ? "border-2 border-[var(--lp-accent,#f59e0b)]/50 shadow-[0_0_40px_var(--lp-accent-20,rgba(245,158,11,0.15))]" : "border border-white/5"}`}
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-[var(--lp-accent,#f59e0b)] text-background">
                      Most Popular
                    </span>
                  )}
                  <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
                  {plan.tagline ? (
                    <p className="mt-1 text-sm text-muted-foreground font-light">{plan.tagline}</p>
                  ) : plan.description ? (
                    <p className="mt-1 text-sm text-muted-foreground font-light line-clamp-2">{plan.description}</p>
                  ) : null}

                  <div className="mt-6 mb-6">
                    {plan.priceMonthly !== null ? (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-4xl font-black tracking-tight text-foreground">{formatPrice(plan.priceMonthly, plan.currency)}</span>
                        <span className="text-sm text-muted-foreground font-light">/ month</span>
                      </div>
                    ) : (
                      <span className="text-2xl font-bold tracking-tight text-foreground">Custom pricing</span>
                    )}
                  </div>

                  <ul className="space-y-3 mb-8 flex-1">
                    {bullets.map((bullet, bIdx) => (
                      <li key={bIdx} className="flex items-center gap-3 text-sm text-muted-foreground font-light">
                        <CheckCircle className="w-4 h-4 text-[var(--lp-accent,#f59e0b)] shrink-0" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/signup"
                    className={`w-full py-3 rounded-xl text-center text-sm font-semibold transition-all flex items-center justify-center gap-2 ${plan.highlight ? "bg-foreground text-background hover:scale-105 shadow-lg" : "glass-panel text-foreground hover:bg-foreground/5"}`}
                  >
                    Get Started <ChevronRight className="w-4 h-4" />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* Blog Section */}
      {blogPosts.length > 0 && (
        <section id="blog" className="relative z-10 w-full px-6 py-24 max-w-7xl mx-auto border-t border-white/5">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
              Latest Updates
            </h2>
            <p className="text-muted-foreground font-light max-w-2xl mx-auto">
              News, insights, and wellness updates from the Golden Hearth team.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {blogPosts.slice(0, 6).map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <Link
                  href={`/blog/${post.id}`}
                  className="group glass-panel rounded-2xl overflow-hidden hover:-translate-y-2 transition-all duration-500 block"
                >
                  {post.imageUrl && (
                    <div className="relative h-48 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={post.imageUrl}
                        alt={post.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    </div>
                  )}
                  <div className="p-6">
                    <h3 className="text-lg font-bold text-foreground mb-2 group-hover:text-[var(--lp-accent,#f59e0b)] transition-colors line-clamp-2">
                      {post.title}
                    </h3>
                    <p className="text-sm text-muted-foreground font-light mb-4 line-clamp-2">
                      {post.description}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {post.author}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(post.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-[var(--lp-accent,#f59e0b)] text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                      Read More <ArrowRight className="w-4 h-4" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Contact Section */}
      <section id="contact" className="relative z-10 w-full px-6 py-24 max-w-7xl mx-auto border-t border-white/5 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Connect With Us
          </h2>
          <p className="text-muted-foreground font-light max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
            Have questions about our premium assisted living community? Reach out to our concierge team or visit our residence in Bonifacio Global City.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full">
          {/* Contact Details Card */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="glass-panel p-8 md:p-10 rounded-3xl border border-white/5 hover:border-[var(--lp-accent,#f59e0b)]/20 transition-all duration-500 flex flex-col justify-between space-y-8 shadow-[0_0_50px_rgba(234,179,8,0.02)]"
          >
            <div className="space-y-6">
              <h3 className="text-2xl font-bold text-foreground">Golden Hearth Residence</h3>
              <p className="text-muted-foreground font-light text-sm md:text-base leading-relaxed">
                Experience a new standard of personalized, technology-enhanced assisted living. Our team is available 24/7 to assist with admissions, tours, and care coordination.
              </p>
              
              <div className="space-y-6 pt-4">
                {/* Address */}
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center border border-white/10 text-[var(--lp-accent,#f59e0b)] shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Our Address</h4>
                    <p className="text-sm md:text-base text-foreground font-light whitespace-pre-line leading-relaxed">
                      {sc("contact_address", "123 Golden Hearth Lane,\nBonifacio Global City, Taguig,\nMetro Manila, Philippines")}
                    </p>
                  </div>
                </div>

                {/* Phone */}
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center border border-white/10 text-[var(--lp-accent,#f59e0b)] shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Phone Number</h4>
                    <p className="text-sm md:text-base text-foreground font-light leading-relaxed">
                      <a href={`tel:${sc("contact_phone", "+63 (2) 8888-7777")}`} className="hover:text-[var(--lp-accent,#f59e0b)] transition-colors">
                        {sc("contact_phone", "+63 (2) 8888-7777")}
                      </a>
                    </p>
                  </div>
                </div>

                {/* Email */}
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center border border-white/10 text-[var(--lp-accent,#f59e0b)] shrink-0">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Email Address</h4>
                    <p className="text-sm md:text-base text-foreground font-light leading-relaxed">
                      <a href={`mailto:${sc("contact_email", "concierge@goldenhearth.com")}`} className="hover:text-[var(--lp-accent,#f59e0b)] transition-colors">
                        {sc("contact_email", "concierge@goldenhearth.com")}
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-white/5 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[var(--lp-accent,#f59e0b)]" /> 24/7 Intake & Response
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--lp-accent,#f59e0b)]" /> Fully Verified Facility
              </span>
            </div>
          </motion.div>

          {/* Map Card */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="glass-panel p-2 rounded-3xl border border-white/5 hover:border-[var(--lp-accent,#f59e0b)]/20 transition-all duration-500 overflow-hidden min-h-[400px] h-full shadow-[0_0_50px_rgba(234,179,8,0.02)] flex"
          >
            <iframe
              src={sc("contact_map_url", "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3861.9701041113264!2d121.0494499!3d14.5484443!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3397c8eb3c7849bd%3A0xc34b3e83b8a3e746!2sBonifacio%20Global%20City!5e0!3m2!1sen!2sph!4v1720610000000!5m2!1sen!2sph")}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen={true}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="rounded-2xl opacity-90 hover:opacity-100 transition-opacity duration-300 w-full min-h-[400px]"
            />
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer id="about" className="relative z-10 w-full px-6 py-12 max-w-7xl mx-auto border-t border-white/5 light:border-black/5 flex flex-col md:flex-row items-center justify-between gap-6 text-gray-500 text-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2">
          <span className="text-foreground font-bold tracking-tight">Golden Hearth</span>
          <span>{sc("footer_text", "© 2026 AI Powered Assisted Living. All rights reserved.")}</span>
        </div>
        <div className="flex gap-6">
          <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
          <a href="#" className="hover:text-foreground transition-colors">Contact</a>
        </div>
      </footer>
    </main>
  );
}
