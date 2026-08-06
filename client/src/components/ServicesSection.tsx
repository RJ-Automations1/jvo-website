/*
 * JVO Services Section — Professional Black / Grey / White
 * Clean grid layout, no red accents, editorial typography
 */

import { useRef, useEffect, useState } from "react";
import { MapPin, Mail, Building2, Users, Mic, Printer } from "lucide-react";

const services = [
  {
    icon: MapPin,
    title: "Professional Business Address",
    description:
      "Establish credibility with a prestigious Jonesboro business address. Use it on your website, business cards, and legal documents — no physical office required.",
    highlight: "From $39/mo",
  },
  {
    icon: Mail,
    title: "Virtual Mailbox",
    description:
      "Manage your mail from anywhere. When mail arrives, we photograph it and upload it instantly. Choose to forward, scan, shred, or hold for pickup.",
    highlight: "App Included",
  },
  {
    icon: Building2,
    title: "Private Offices",
    description:
      "Reserve a private office whenever you need focused work time. Available in small and large configurations, bookable by the hour with 24/7 access.",
    // Lowest real rate: member, small office. See /pricing for the full
    // member/non-member table — these "From" figures are the member column.
    highlight: "From $10/hr",
  },
  {
    icon: Users,
    title: "Conference Rooms",
    description:
      "Host client meetings, team collaborations, or presentations in our fully-equipped conference room. Seats up to 6 with display screen and high-speed WiFi.",
    highlight: "From $20/hr",
  },
  {
    icon: Mic,
    title: "Creative Studio",
    description:
      "A dedicated studio space for podcast recording, photography sessions, and content editing. Professional-grade environment for your creative projects.",
    highlight: "Reserve Now",
  },
  {
    icon: Printer,
    title: "Business Support Services",
    description:
      "Access printing, copying, fax, paper shredding, and notary services. A live receptionist greets your guests during business hours.",
    highlight: "Included",
  },
];

export default function ServicesSection() {
  const headerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(false);
  const [gridVisible, setGridVisible] = useState(false);

  useEffect(() => {
    const obs1 = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setHeaderVisible(true); },
      { threshold: 0.15 }
    );
    const obs2 = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setGridVisible(true); },
      { threshold: 0.05 }
    );
    if (headerRef.current) obs1.observe(headerRef.current);
    if (gridRef.current) obs2.observe(gridRef.current);
    return () => { obs1.disconnect(); obs2.disconnect(); };
  }, []);

  return (
    <section id="services" className="py-24 md:py-32 bg-[#F7F7F7]">
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
            <div className="w-8 h-px bg-black/30" />
            <span className="section-label">What We Offer</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <h2 className="font-display text-5xl md:text-6xl font-semibold text-black leading-[0.95]">
              Everything Your Business
              <br />
              <em className="not-italic text-black/35">Needs to Grow.</em>
            </h2>
            <p className="font-sans text-sm text-black/50 max-w-xs leading-relaxed">
              From a professional mailing address to fully-equipped private offices — JVO has the tools to keep your business moving forward.
            </p>
          </div>
        </div>

        {/* Services Grid */}
        <div ref={gridRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-black/10">
          {services.map((service, i) => {
            const Icon = service.icon;
            return (
              <div
                key={i}
                className="bg-[#F7F7F7] p-8 hover:bg-white transition-colors duration-300 group"
                style={{
                  opacity: gridVisible ? 1 : 0,
                  transform: gridVisible ? "translateY(0)" : "translateY(24px)",
                  transition: `opacity 0.6s cubic-bezier(0.23,1,0.32,1) ${i * 0.07}s, transform 0.6s cubic-bezier(0.23,1,0.32,1) ${i * 0.07}s`,
                }}
              >
                {/* Icon */}
                <div className="w-10 h-10 border border-black/15 flex items-center justify-center mb-6 group-hover:border-black/40 transition-colors duration-300">
                  <Icon size={18} className="text-black/50 group-hover:text-black/80 transition-colors duration-300" />
                </div>

                {/* Content */}
                <h3 className="font-sans font-semibold text-black text-base mb-3 leading-snug">
                  {service.title}
                </h3>
                <p className="font-sans text-black/50 text-sm leading-relaxed mb-5">
                  {service.description}
                </p>

                {/* Highlight */}
                <span className="font-mono-price text-black/70 text-xs font-medium tracking-wider border-b border-black/20 pb-0.5">
                  {service.highlight}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
