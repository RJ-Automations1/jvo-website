/*
 * JVO Memberships & Pricing Section — Professional Black / Grey / White
 * Clean editorial pricing cards, no red accents
 * Every plan CTA starts onboarding at the mailbox application (USPS Form 1583),
 * which then continues to Deskworks registration.
 * In-office requirement notice shown below cards
 */

import { useRef, useEffect, useState } from "react";
import { Check, MapPin, AlertCircle } from "lucide-react";
import { Link } from "wouter";

const plans = [
  {
    name: "Mail Only",
    price: "$39",
    period: "/month",
    tagline: "Just the address",
    description: "Get a professional corporate mailing address and virtual mailbox with app access. No physical space access.",
    features: [
      "Corporate mailing address",
      "Virtual mailbox with app",
      "Mail photo notifications",
      "Forward, scan, or shred options",
      "No long-term contract",
    ],
    cta: "Get Started",
    featured: false,
  },
  {
    name: "Business Essential",
    price: "$199",
    period: "/month",
    tagline: "Most popular",
    description: "Everything you need to run your business professionally — address, mail, and on-demand office access at member rates.",
    features: [
      "Everything in Mail Only",
      "24/7 building access",
      "Reservable private offices",
      "Conference room access",
      "Classroom access",
      "Printing services included",
      "Space access — first come, first serve",
      "Member pricing on all spaces",
    ],
    cta: "Join Now",
    featured: true,
  },
  {
    name: "Team",
    price: "$459",
    period: "/month",
    tagline: "For growing teams",
    description: "Scale your team with shared membership benefits, dedicated conference room hours, and premium perks for all members.",
    features: [
      "Everything in Business Essential",
      "4 team member memberships",
      "8 hrs conference room/month",
      "Free printing services",
      "$75/mo per additional member",
      "Digital name billboard listing",
      "Priority booking",
    ],
    cta: "Build Your Team",
    featured: false,
  },
];

const alaCarte = [
  { service: "Guest Pass / Walk-In", price: "$10", unit: "/day (member)" },
  { service: "Guest Pass / Walk-In", price: "$50", unit: "/day (non-member)" },
  { service: "Notary Services", price: "$5+", unit: "" },
  { service: "Print & Copy (B&W)", price: "$0.25", unit: "/page" },
  { service: "Color Copies", price: "$0.75", unit: "/page" },
  { service: "Scanning", price: "$2.50", unit: "first 10 pages" },
];

export default function MembershipsSection() {
  const headerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);

  useEffect(() => {
    const obs1 = new IntersectionObserver(([e]) => { if (e.isIntersecting) setHeaderVisible(true); }, { threshold: 0.15 });
    const obs2 = new IntersectionObserver(([e]) => { if (e.isIntersecting) setCardsVisible(true); }, { threshold: 0.05 });
    if (headerRef.current) obs1.observe(headerRef.current);
    if (cardsRef.current) obs2.observe(cardsRef.current);
    return () => { obs1.disconnect(); obs2.disconnect(); };
  }, []);

  return (
    <section id="memberships" className="py-24 md:py-32 bg-[#0A0A0A]">
      <div className="container">
        {/* Header */}
        <div
          ref={headerRef}
          className="mb-16"
          style={{
            opacity: headerVisible ? 1 : 0,
            transform: headerVisible ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1), transform 0.7s cubic-bezier(0.23,1,0.32,1)",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-px bg-white/30" />
            <span className="font-sans text-[10px] font-medium tracking-[0.3em] uppercase text-white/40">Membership Plans</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <h2 className="font-display text-5xl md:text-6xl font-semibold text-white leading-[0.95]">
              Simple, Transparent
              <br />
              <em className="not-italic text-white/35">Pricing.</em>
            </h2>
            <p className="font-sans text-sm text-white/40 max-w-xs leading-relaxed">
              No hidden fees. No long-term contracts required. Pick the plan that fits your business today.
            </p>
          </div>
        </div>

        {/* Pricing Cards */}
        <div ref={cardsRef} className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10 mb-8">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`relative flex flex-col p-8 transition-all duration-700 ${
                plan.featured ? "bg-white" : "bg-[#0A0A0A] hover:bg-[#141414]"
              }`}
              style={{
                opacity: cardsVisible ? 1 : 0,
                transform: cardsVisible ? "translateY(0)" : "translateY(32px)",
                transition: `opacity 0.7s cubic-bezier(0.23,1,0.32,1) ${i * 0.1}s, transform 0.7s cubic-bezier(0.23,1,0.32,1) ${i * 0.1}s, background-color 0.3s`,
              }}
            >
              {/* Featured badge */}
              {plan.featured && (
                <div className="absolute top-0 right-0 bg-black text-white px-3 py-1.5">
                  <span className="font-sans text-[9px] font-semibold tracking-[0.2em] uppercase">Most Popular</span>
                </div>
              )}

              {/* Plan Header */}
              <div className="mb-6">
                <p className={`font-sans text-[10px] font-medium tracking-[0.25em] uppercase mb-2 ${plan.featured ? "text-black/40" : "text-white/35"}`}>
                  {plan.tagline}
                </p>
                <h3 className={`font-display text-2xl font-semibold mb-4 ${plan.featured ? "text-black" : "text-white"}`}>
                  {plan.name}
                </h3>
                <div className="flex items-baseline gap-1">
                  <span className={`font-mono-price font-medium leading-none ${plan.featured ? "text-black" : "text-white"}`} style={{ fontSize: "clamp(2.5rem, 5vw, 3.5rem)" }}>
                    {plan.price}
                  </span>
                  <span className={`font-sans text-sm ${plan.featured ? "text-black/50" : "text-white/40"}`}>{plan.period}</span>
                </div>
              </div>

              <p className={`font-sans text-sm leading-relaxed mb-6 ${plan.featured ? "text-black/55" : "text-white/45"}`}>
                {plan.description}
              </p>

              {/* Features */}
              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map((feature, j) => (
                  <li key={j} className="flex items-start gap-2.5">
                    <Check size={14} className={`mt-0.5 flex-shrink-0 ${plan.featured ? "text-black/60" : "text-white/40"}`} />
                    <span className={`font-sans text-sm ${plan.featured ? "text-black/70" : "text-white/55"}`}>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={`/mailbox-application?plan=${encodeURIComponent(plan.name)}`}
                className={`w-full py-3.5 font-sans text-xs font-semibold tracking-[0.18em] uppercase border transition-all duration-200 active:scale-[0.97] text-center block ${
                  plan.featured
                    ? "bg-black text-white border-black hover:bg-black/80"
                    : "bg-transparent text-white border-white/20 hover:border-white hover:bg-white/5"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* In-Office Requirement Notice */}
        <div
          className="flex items-start gap-4 border border-white/15 bg-white/5 px-6 py-5 mb-16"
          style={{
            opacity: cardsVisible ? 1 : 0,
            transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1) 0.35s",
          }}
        >
          <MapPin size={16} className="text-white/50 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-sans text-xs font-semibold tracking-[0.15em] uppercase text-white/60 mb-1">
              In-Office Registration Required
            </p>
            <p className="font-sans text-sm text-white/40 leading-relaxed">
              After completing your online registration, all new members are required to visit our office in person to sign membership agreements and complete the onboarding process.{" "}
              <span className="text-white/60">127 Jonesboro Rd, Suite 100, Jonesboro, GA 30236</span>
            </p>
          </div>
        </div>

        {/* A La Carte Section */}
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-px bg-white/30" />
            <span className="font-sans text-[10px] font-medium tracking-[0.3em] uppercase text-white/40">A La Carte Services</span>
          </div>
          <p className="font-sans text-sm text-white/40 mb-8">No membership? No problem. Pay only for what you use.</p>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-white/10">
            {alaCarte.map((item, i) => (
              <div key={i} className="bg-[#0A0A0A] hover:bg-[#141414] p-5 text-center transition-colors duration-200">
                <div className="font-mono-price text-white text-xl font-medium mb-0.5">
                  {item.price}
                </div>
                <div className="font-sans text-white/35 text-[10px] mb-2">{item.unit}</div>
                <div className="font-sans text-white/55 text-xs leading-tight">{item.service}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
