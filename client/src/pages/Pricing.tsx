/*
 * JVO Pricing Page — /pricing
 * Mirrors the physical price list: Rentals & Services (Member vs Non-Member) + Print & Copy Services
 * Design: Professional Black / Grey / White, editorial table layout
 */

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Tag, Lock } from "lucide-react";
import { Link, useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const rentalRows = [
  {
    service: "Private Office (Small)",
    member: "$10/hr",
    nonMember: "$25/hr",
  },
  {
    service: "Private Office (Large)",
    member: "$15/hr",
    nonMember: "$35/hr",
  },
  {
    service: "Conference Room (seats 6)",
    member: "$20/hr",
    nonMember: "$50/hr",
  },
  {
    service: "Meeting / Classroom (seats 15)",
    member: "$30/hr",
    nonMember: "$75/hr",
  },
  {
    service: "Content Studio (photography, podcast, editing, music)",
    member: "$25/hr",
    nonMember: "$40/hr",
  },
  {
    service: "Corporate Event Space / Business Events (weekdays)",
    member: "$75/hr",
    nonMember: "$150/hr",
  },
  {
    service: "Walk-In / Guest Pass",
    member: "$10/day",
    nonMember: "$50/day",
  },
  {
    service: "Notary Services",
    member: "$5 and up",
    nonMember: "$5 and up",
  },
];

const printRows = [
  { service: "Black & White Copies", price: "$0.25 per page" },
  { service: "Color Copies", price: "$0.75 per page" },
  { service: "Specialty Paper", price: "$1.00 per page" },
  { service: "Scanning", price: "$2.50 first 10 pages, $0.25 each add'l page" },
  { service: "Faxing", price: "$2.25 first 10 pages, $0.25 each add'l page" },
  { service: "Binding", price: "$2.50 + $0.25/page (Thermal)" },
];

export default function Pricing() {
  const [visible, setVisible] = useState(false);
  const [, setLocation] = useLocation();

  const goToMemberships = () => {
    setLocation("/");
    setTimeout(() => {
      const el = document.getElementById("memberships");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  };

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-white text-black">
      <Navbar />

      <main className="pt-28 pb-24">
        <div className="container max-w-5xl">

          {/* Back link */}
          <div
            className="mb-10"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(16px)",
              transition: "opacity 0.5s cubic-bezier(0.23,1,0.32,1), transform 0.5s cubic-bezier(0.23,1,0.32,1)",
            }}
          >
            <Link
              href="/"
              className="inline-flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase text-black/40 hover:text-black transition-colors"
            >
              <ArrowLeft size={13} /> Back to Home
            </Link>
          </div>

          {/* Page Header */}
          <div
            className="mb-14"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.6s cubic-bezier(0.23,1,0.32,1) 0.05s, transform 0.6s cubic-bezier(0.23,1,0.32,1) 0.05s",
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-px bg-black/30" />
              <span className="font-sans text-[10px] font-semibold tracking-[0.25em] uppercase text-black/40">
                Rental &amp; Services
              </span>
            </div>
            <h1
              className="font-display font-semibold text-black leading-[0.92] mb-4"
              style={{ fontSize: "clamp(3rem, 7vw, 6rem)" }}
            >
              Price List
            </h1>
            <p className="font-sans text-sm text-black/50 max-w-lg leading-relaxed">
              Members unlock significantly lower rates on every space. All spaces are first come, first serve unless reserved in advance.
            </p>
          </div>

          {/* Member Savings Banner */}
          <div
            className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-black text-white px-8 py-5 mb-10"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(16px)",
              transition: "opacity 0.6s cubic-bezier(0.23,1,0.32,1) 0.1s, transform 0.6s cubic-bezier(0.23,1,0.32,1) 0.1s",
            }}
          >
            <div className="flex items-center gap-3 flex-1">
              <Tag size={16} className="text-white/50 flex-shrink-0" />
              <div>
                <p className="font-sans text-xs font-semibold tracking-[0.15em] uppercase text-white/70 mb-0.5">
                  Member Pricing Available
                </p>
                <p className="font-sans text-sm text-white/50">
                  Members save up to <strong className="text-white">60%</strong> on space rentals. Starting at $39/month.
                </p>
              </div>
            </div>
            <button
              onClick={goToMemberships}
              className="flex-shrink-0 flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-white/30 px-5 py-2.5 hover:bg-white hover:text-black transition-all duration-200"
            >
              View Plans <ArrowRight size={12} />
            </button>
          </div>

          {/* ── Rentals & Services Table ── */}
          <div
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1) 0.15s, transform 0.7s cubic-bezier(0.23,1,0.32,1) 0.15s",
            }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-6 h-px bg-black/30" />
              <span className="font-sans text-[10px] font-semibold tracking-[0.25em] uppercase text-black/40">
                Rentals &amp; Services
              </span>
            </div>

            <div className="border border-black/12 overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-12 bg-black text-white">
                <div className="col-span-6 px-6 py-4">
                  <span className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-white/60">Space / Service</span>
                </div>
                <div className="col-span-3 px-6 py-4 border-l border-white/10">
                  <div className="flex items-center gap-1.5">
                    <Tag size={11} className="text-white/50" />
                    <span className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-white/80">Member</span>
                  </div>
                </div>
                <div className="col-span-3 px-6 py-4 border-l border-white/10">
                  <div className="flex items-center gap-1.5">
                    <Lock size={11} className="text-white/50" />
                    <span className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-white/60">Non-Member</span>
                  </div>
                </div>
              </div>

              {/* Table Rows */}
              {rentalRows.map((row, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-12 border-t border-black/8 transition-colors duration-150 hover:bg-black/[0.02] ${
                    i % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"
                  }`}
                >
                  <div className="col-span-6 px-6 py-4">
                    <span className="font-sans text-sm text-black/80 leading-snug">{row.service}</span>
                  </div>
                  <div className="col-span-3 px-6 py-4 border-l border-black/8">
                    <span className="font-mono-price text-base font-medium text-black">{row.member}</span>
                  </div>
                  <div className="col-span-3 px-6 py-4 border-l border-black/8">
                    <span className="font-mono-price text-base font-medium text-black/40">{row.nonMember}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Footnote */}
            <p className="font-sans text-xs text-black/35 mt-3 leading-relaxed">
              * All spaces are first come, first serve. Advance reservations recommended.
              Member rates apply to active membership holders only.
            </p>
          </div>

          {/* ── Print & Copy Services ── */}
          <div
            className="mt-16"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1) 0.25s, transform 0.7s cubic-bezier(0.23,1,0.32,1) 0.25s",
            }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-6 h-px bg-black/30" />
              <span className="font-sans text-[10px] font-semibold tracking-[0.25em] uppercase text-black/40">
                Print &amp; Copy Services
              </span>
            </div>

            <div className="border border-black/12 overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-12 bg-[#1A1A1A] text-white">
                <div className="col-span-6 px-6 py-4">
                  <span className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-white/60">Service</span>
                </div>
                <div className="col-span-6 px-6 py-4 border-l border-white/10">
                  <span className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-white/60">Rate</span>
                </div>
              </div>

              {/* Rows */}
              {printRows.map((row, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-12 border-t border-black/8 transition-colors duration-150 hover:bg-black/[0.02] ${
                    i % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"
                  }`}
                >
                  <div className="col-span-6 px-6 py-4">
                    <span className="font-sans text-sm text-black/80">{row.service}</span>
                  </div>
                  <div className="col-span-6 px-6 py-4 border-l border-black/8">
                    <span className="font-sans text-sm text-black/60">{row.price}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── CTA Strip ── */}
          <div
            className="mt-16 grid sm:grid-cols-2 gap-px bg-black/10 border border-black/10"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1) 0.3s, transform 0.7s cubic-bezier(0.23,1,0.32,1) 0.3s",
            }}
          >
            <div className="bg-white p-8">
              <p className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-black/40 mb-2">Ready to Reserve?</p>
              <h3 className="font-display text-2xl font-semibold text-black mb-4">Book a Space</h3>
              <p className="font-sans text-sm text-black/50 leading-relaxed mb-6">
                Submit a reservation request for any space. We'll confirm within 24 hours.
              </p>
              <a
                href="https://jvo.satellitedeskworks.com/member-sign-up"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase bg-black text-white px-6 py-3 hover:bg-black/80 transition-all duration-200"
              >
                Reserve Now <ArrowRight size={13} />
              </a>
            </div>
            <div className="bg-[#F5F5F3] p-8">
              <p className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-black/40 mb-2">Save on Every Visit</p>
              <h3 className="font-display text-2xl font-semibold text-black mb-4">Become a Member</h3>
              <p className="font-sans text-sm text-black/50 leading-relaxed mb-3">
                Starting at $39/month. Unlock member rates on all spaces and services.
              </p>
              <p className="font-sans text-xs text-black/40 leading-relaxed mb-5 flex items-start gap-1.5">
                <span className="mt-0.5">📍</span> In-person visit required to complete registration.
              </p>
              <a
                href="https://jvo.satellitedeskworks.com/member-sign-up"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-black text-black px-6 py-3 hover:bg-black hover:text-white transition-all duration-200"
              >
                Register Now <ArrowRight size={13} />
              </a>
            </div>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}
