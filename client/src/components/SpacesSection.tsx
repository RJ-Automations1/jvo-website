/*
 * JVO Spaces Section — Real office photos, professional B&W design
 * Classroom: DSC01962 | Conf Room: DSC01987 | Private Large: DSC02027 | Private Small: DSC01947 | Lobby: DSC01967
 * Member/Non-Member pricing toggle — defaults to member pricing
 */

import { useRef, useEffect, useState } from "react";
import { Users, Monitor, Briefcase, Building2, Camera, CalendarDays, ArrowRight } from "lucide-react";
import { Link } from "wouter";

type Space = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  memberPrice: string;
  nonMemberPrice: string;
  priceUnit: string;
  icon: React.ElementType;
  image?: string;
  imageAlt?: string;
  featured?: boolean;
  placeholder?: boolean;
};

const spaces: Space[] = [
  {
    id: "classroom",
    title: "Classroom",
    subtitle: "Open Workspace",
    description:
      "A bright, open classroom with wall-mounted TVs, desk seating, comfortable sofas, and a collaborative atmosphere — perfect for training sessions, workshops, or focused work.",
    features: ["Seats up to 15", "Wall-mounted TVs", "High-speed WiFi", "Lounge area"],
    memberPrice: "$30",
    nonMemberPrice: "$75",
    priceUnit: "/hr",
    icon: Users,
    image: "/manus-storage/DSC01962_18019b80.jpg",
    imageAlt: "JVO classroom with sofas and desks",
  },
  {
    id: "private-large",
    title: "Private Office — Large",
    subtitle: "Executive Suite",
    description:
      "A spacious private office with a large L-shaped desk, dual monitors, wall-mounted TV, and motivational decor — built for serious business.",
    features: ["L-shaped executive desk", "Dual monitors", "Wall-mounted TV", "Private & secure"],
    memberPrice: "$15",
    nonMemberPrice: "$35",
    priceUnit: "/hr",
    icon: Briefcase,
    image: "/manus-storage/DSC02027_f0e91bbf.jpg",
    imageAlt: "JVO private office large with dual monitors and wall TV",
    featured: true,
  },
  {
    id: "private-small",
    title: "Private Office — Small",
    subtitle: "Focus Suite",
    description:
      "A clean, private office with a wood-top desk, ceiling fan, and industrial shelving — perfect for solo professionals who need their own space.",
    features: ["Private desk setup", "Ceiling fan", "Industrial shelving", "Quiet environment"],
    memberPrice: "$10",
    nonMemberPrice: "$25",
    priceUnit: "/hr",
    icon: Building2,
    image: "/manus-storage/DSC01947_c68ff148.jpg",
    imageAlt: "JVO private office small with desk and shelving",
  },
  {
    id: "conference",
    title: "Conference Room",
    subtitle: "Meeting Space",
    description:
      "A fully equipped conference room with an oval table, executive chairs, wall-mounted TV for presentations, and a professional setting for client meetings.",
    features: ["Seats 6 comfortably", "Wall-mounted TV", "Whiteboard", "Professional setting"],
    memberPrice: "$20",
    nonMemberPrice: "$50",
    priceUnit: "/hr",
    icon: Monitor,
    image: "/manus-storage/DSC01987_2aa723a3.jpg",
    imageAlt: "JVO conference room with oval table and TV",
  },
  {
    id: "content-studio",
    title: "Content Studio",
    subtitle: "Creative Space",
    description:
      "A dedicated studio for photography, podcasting, video editing, and music production. Professional-grade environment for creators and content professionals.",
    features: ["Photography setup", "Podcast ready", "Editing suite", "Soundproofed"],
    memberPrice: "$25",
    nonMemberPrice: "$40",
    priceUnit: "/hr",
    icon: Camera,
    image: "/manus-storage/GOD_6676-HDR_976bea0b.jpg",
    imageAlt: "JVO Content Studio with acoustic panels and creative setup",
  },
  {
    id: "corporate-event",
    title: "Corporate Event Space",
    subtitle: "Event Venue",
    description:
      "An open-air covered deck perfect for corporate events, seminars, networking gatherings, and business celebrations. Features bar seating, AV screens, string lighting, and scenic outdoor views.",
    features: ["Large open deck", "Bar seating", "AV screens", "String lighting"],
    memberPrice: "$75",
    nonMemberPrice: "$150",
    priceUnit: "/hr",
    icon: CalendarDays,
    image: "/manus-storage/DSC00304-HDR_0f1999cc.jpg",
    imageAlt: "JVO Corporate Event Space — open-air covered deck with bar seating and AV screens",
  },
];

function PlaceholderCard({ space, isMember, index }: { space: Space; isMember: boolean; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const Icon = space.icon;
  const price = isMember ? space.memberPrice : space.nonMemberPrice;

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.08 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="group flex flex-col"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(32px)",
        transition: `opacity 0.7s cubic-bezier(0.23,1,0.32,1) ${index * 0.1}s, transform 0.7s cubic-bezier(0.23,1,0.32,1) ${index * 0.1}s`,
      }}
    >
      {/* Placeholder image area */}
      <div className="relative overflow-hidden aspect-[4/3] mb-0 bg-black/8 border border-black/10 flex items-center justify-center">
        <div className="text-center px-6">
          <Icon size={32} className="text-black/20 mx-auto mb-3" />
          <p className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-black/30">Photos Coming Soon</p>
        </div>
        {/* Price tag */}
        <div className="absolute top-0 right-0 bg-black text-white px-3 py-2">
          <span className="font-mono text-xs font-medium tracking-wider">{price}{space.priceUnit}</span>
        </div>
        {/* Coming soon badge */}
        <div className="absolute top-0 left-0 bg-black/60 text-white px-3 py-2">
          <span className="font-sans text-[9px] font-semibold tracking-[0.2em] uppercase">Coming Soon</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 border-l border-r border-b border-black/15">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 border border-black/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Icon size={15} className="text-black/50" />
          </div>
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-0.5">{space.subtitle}</p>
            <h3 className="font-display text-2xl font-semibold text-black leading-tight">{space.title}</h3>
            <p className="font-sans text-xs text-black/40 mt-0.5">First come, first serve</p>
          </div>
        </div>
        <p className="font-sans text-sm text-black/55 leading-relaxed mb-4">{space.description}</p>
        <ul className="flex flex-col gap-1.5 mb-6">
          {space.features.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <div className="w-1 h-1 bg-black/35 rounded-full flex-shrink-0" />
              <span className="font-sans text-xs text-black/50">{f}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4">
          <Link
            href="/pricing"
            className="flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.15em] uppercase text-black hover:gap-3 transition-all duration-200 group/btn"
          >
            View Prices <ArrowRight size={13} className="group-hover/btn:translate-x-1 transition-transform" />
          </Link>
          <span className="text-black/20 text-xs">|</span>
          <a
            href="https://jvo.satellitedeskworks.com/member-sign-up"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.15em] uppercase text-black/50 hover:text-black hover:gap-3 transition-all duration-200 group/btn2"
          >
            Reserve <ArrowRight size={13} className="group-hover/btn2:translate-x-1 transition-transform" />
          </a>
        </div>
      </div>
    </div>
  );
}

function SpaceCard({ space, isMember, index }: { space: Space; isMember: boolean; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const Icon = space.icon;
  const price = isMember ? space.memberPrice : space.nonMemberPrice;

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.08 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="group flex flex-col"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(32px)",
        transition: `opacity 0.7s cubic-bezier(0.23,1,0.32,1) ${index * 0.1}s, transform 0.7s cubic-bezier(0.23,1,0.32,1) ${index * 0.1}s`,
      }}
    >
      {/* Image */}
      <div className="relative overflow-hidden aspect-[4/3] mb-0">
        <img
          src={space.image}
          alt={space.imageAlt}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-500" />
        {/* Price tag — animates on member toggle */}
        <div className="absolute top-0 right-0 bg-black text-white px-3 py-2 transition-all duration-300">
          <span className="font-mono text-xs font-medium tracking-wider">{price}{space.priceUnit}</span>
        </div>
        {space.featured && (
          <div className="absolute top-0 left-0 bg-black/80 text-white px-3 py-2">
            <span className="font-sans text-[9px] font-semibold tracking-[0.2em] uppercase">Most Popular</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 p-6 border-l border-r border-b ${space.featured ? "border-black" : "border-black/15"}`}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 border border-black/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Icon size={15} className="text-black/50" />
          </div>
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-0.5">{space.subtitle}</p>
            <h3 className="font-display text-2xl font-semibold text-black leading-tight">{space.title}</h3>
            <p className="font-sans text-xs text-black/40 mt-0.5">First come, first serve</p>
          </div>
        </div>
        <p className="font-sans text-sm text-black/55 leading-relaxed mb-4">{space.description}</p>
        <ul className="flex flex-col gap-1.5 mb-6">
          {space.features.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <div className="w-1 h-1 bg-black/35 rounded-full flex-shrink-0" />
              <span className="font-sans text-xs text-black/50">{f}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4">
          <Link
            href="/pricing"
            className="flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.15em] uppercase text-black hover:gap-3 transition-all duration-200 group/btn"
          >
            View Prices <ArrowRight size={13} className="group-hover/btn:translate-x-1 transition-transform" />
          </Link>
          <span className="text-black/20 text-xs">|</span>
          <a
            href="https://jvo.satellitedeskworks.com/member-sign-up"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.15em] uppercase text-black/50 hover:text-black hover:gap-3 transition-all duration-200 group/btn2"
          >
            Reserve <ArrowRight size={13} className="group-hover/btn2:translate-x-1 transition-transform" />
          </a>
        </div>
      </div>
    </div>
  );
}

export default function SpacesSection() {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(false);
  const [isMember, setIsMember] = useState(true);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setHeaderVisible(true); },
      { threshold: 0.15 }
    );
    if (headerRef.current) observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);

  const realSpaces = spaces.filter((s) => !s.placeholder);
  const placeholderSpaces = spaces.filter((s) => s.placeholder);

  return (
    <section id="spaces" className="py-24 md:py-32 bg-white">
      <div className="container">
        {/* Header */}
        <div
          ref={headerRef}
          className="mb-10"
          style={{
            opacity: headerVisible ? 1 : 0,
            transform: headerVisible ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1), transform 0.7s cubic-bezier(0.23,1,0.32,1)",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-px bg-black/30" />
            <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40">Our Spaces</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <h2 className="font-display text-5xl md:text-6xl font-semibold text-black leading-[0.95]">
                Spaces Built for
                <br />
                <em className="not-italic text-black/35">Professionals.</em>
              </h2>
              <p className="font-sans text-sm text-black/50 max-w-xs leading-relaxed mt-4">
                Every space at JVO is designed to help your business look and feel its best — no long-term leases required.
              </p>
            </div>

            {/* Member / Non-Member Pricing Toggle */}
            <div className="flex flex-col items-start md:items-end gap-2">
              <p className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-black/40">Pricing View</p>
              <div className="flex items-center gap-0 border border-black/15 overflow-hidden">
                <button
                  onClick={() => setIsMember(true)}
                  className={`px-5 py-2.5 font-sans text-[11px] font-semibold tracking-[0.15em] uppercase transition-all duration-200 ${
                    isMember ? "bg-black text-white" : "bg-white text-black/50 hover:text-black"
                  }`}
                >
                  Member
                </button>
                <button
                  onClick={() => setIsMember(false)}
                  className={`px-5 py-2.5 font-sans text-[11px] font-semibold tracking-[0.15em] uppercase transition-all duration-200 ${
                    !isMember ? "bg-black text-white" : "bg-white text-black/50 hover:text-black"
                  }`}
                >
                  Non-Member
                </button>
              </div>
              {isMember ? (
                <p className="font-sans text-xs text-black/40">Showing member rates — <button onClick={() => setIsMember(false)} className="underline hover:text-black transition-colors">view standard pricing</button></p>
              ) : (
                <p className="font-sans text-xs text-black/40">Become a member to unlock lower rates</p>
              )}
            </div>
          </div>
        </div>

        {/* Real Spaces Grid */}
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
          {realSpaces.map((space, i) => (
            <SpaceCard key={space.id} space={space} isMember={isMember} index={i} />
          ))}
        </div>

        {/* Placeholder Spaces Grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {placeholderSpaces.map((space, i) => (
            <PlaceholderCard key={space.id} space={space} isMember={isMember} index={i + realSpaces.length} />
          ))}
        </div>

        {/* Lobby photo strip */}
        <div className="mt-4 relative overflow-hidden h-56 md:h-64">
          <img
            src="/manus-storage/GOD_6631-HDR_8b199a55.jpg"
            alt="JVO lobby with neon sign and leather chairs"
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center">
              <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-white/50 mb-2">Our Location</p>
              <p className="font-display text-2xl md:text-3xl font-semibold text-white">
                127 Jonesboro Rd, Jonesboro, GA 30236
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
