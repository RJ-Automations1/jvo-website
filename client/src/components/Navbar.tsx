/*
 * JVO Navbar — Professional Black / Grey / White
 * Transparent on hero, white on scroll, clean editorial style
 */

import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { Link } from "wouter";

const navLinks = [
  { label: "Services", href: "#services" },
  { label: "Spaces", href: "#spaces" },
  { label: "Memberships", href: "#memberships" },
  { label: "Contact", href: "#contact" },
];

const JVO_EVENTS_URL = "https://jvoevents.com";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleNavClick = (href: string) => {
    setMobileOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-400 ${
          scrolled
            ? "bg-white border-b border-black/10 shadow-sm"
            : "bg-transparent"
        }`}
      >
        <div className="container">
          <nav className="flex items-center justify-between h-16 lg:h-20">
            {/* Logo */}
            <a
              href="#"
              className="flex items-center gap-3 group"
              onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            >
              {/* Diamond logo mark matching JVO's actual logo */}
              <div className="relative w-9 h-9 flex items-center justify-center">
                <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-9 h-9">
                  <rect x="9" y="9" width="18" height="18" stroke={scrolled ? "#0A0A0A" : "#FFFFFF"} strokeWidth="1.5" transform="rotate(45 18 18)" />
                  <rect x="11.5" y="11.5" width="13" height="13" stroke={scrolled ? "#0A0A0A" : "#FFFFFF"} strokeWidth="1" transform="rotate(45 18 18)" />
                  <text x="18" y="22" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontSize="9" fontWeight="600" fill={scrolled ? "#0A0A0A" : "#FFFFFF"}>JVO</text>
                </svg>
              </div>
              <div className="flex flex-col leading-none">
                <span className={`font-display font-semibold text-base tracking-[0.08em] transition-colors ${scrolled ? "text-black" : "text-white"}`}>
                  JONESBORO
                </span>
                <span className={`font-sans text-[9px] font-medium tracking-[0.22em] uppercase transition-colors ${scrolled ? "text-black/40" : "text-white/60"}`}>
                  Virtual Office
                </span>
              </div>
            </a>

            {/* Desktop Nav */}
            <ul className="hidden lg:flex items-center gap-10">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <button
                    onClick={() => handleNavClick(link.href)}
                    className={`font-sans text-[11px] font-medium tracking-[0.18em] uppercase transition-all duration-200 hover:opacity-50 ${
                      scrolled ? "text-black" : "text-white"
                    }`}
                  >
                    {link.label}
                  </button>
                </li>
              ))}
              <li>
                {/* Gold, like the Weddings tab on the events site — a doorway to the sister brand. */}
                <a
                  href={JVO_EVENTS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-baseline gap-1 font-sans text-[11px] font-semibold tracking-[0.18em] uppercase transition-all duration-200 hover:opacity-70"
                  style={{ color: "#c9a96a" }}
                >
                  JVO Events
                  <span className="text-[#c9a96a]/70 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </li>
            </ul>

            {/* CTA */}
            <div className="hidden lg:flex items-center gap-3 ml-8">
              <Link
                href="/booking"
                className={`font-sans text-[11px] font-semibold tracking-[0.18em] uppercase px-5 py-2.5 transition-all duration-200 ${
                  scrolled
                    ? "bg-black text-white hover:bg-black/80"
                    : "bg-white text-black hover:bg-white/90"
                }`}
              >
                Reserve a Space
              </Link>
              <button
                onClick={() => handleNavClick("#memberships")}
                className={`font-sans text-[11px] font-semibold tracking-[0.18em] uppercase px-5 py-2.5 border transition-all duration-200 ${
                  scrolled
                    ? "border-black text-black hover:bg-black hover:text-white"
                    : "border-white text-white hover:bg-white hover:text-black"
                }`}
              >
                Become a Member
              </button>
            </div>

            {/* Mobile Toggle */}
            <button
              className={`lg:hidden p-2 transition-colors ${scrolled ? "text-black" : "text-white"}`}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </nav>
        </div>
      </header>

      {/* Mobile Fullscreen Menu */}
      <div
        className={`fixed inset-0 z-40 bg-white flex flex-col transition-all duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex flex-col h-full pt-24 pb-12 px-8">
          <nav className="flex flex-col gap-0 flex-1">
            {navLinks.map((link, i) => (
              <button
                key={link.href}
                onClick={() => handleNavClick(link.href)}
                className="text-left font-display text-5xl font-medium text-black py-4 border-b border-black/10 hover:pl-4 transition-all duration-200"
                style={{ transitionDelay: mobileOpen ? `${i * 60}ms` : "0ms" }}
              >
                {link.label}
              </button>
            ))}
            <a
              href={JVO_EVENTS_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileOpen(false)}
              className="text-left font-display text-5xl font-medium py-4 border-b border-black/10 hover:pl-4 transition-all duration-200 block"
              style={{ color: "#c9a96a" }}
            >
              JVO Events <span aria-hidden="true">↗</span>
            </a>
            <button
              onClick={() => handleNavClick("#memberships")}
              className="text-left font-display text-5xl font-medium text-black py-4 border-b border-black/10 hover:pl-4 transition-all duration-200"
            >
              Become a Member
            </button>
          </nav>
          <div className="mt-auto pt-8">
            <p className="section-label mb-2">Location</p>
            <p className="font-sans text-sm text-black/50">127 Jonesboro Rd, Jonesboro, GA 30236</p>
            <p className="font-sans text-sm text-black/50 mt-1">(678) 519-4723</p>
          </div>
        </div>
      </div>
    </>
  );
}
