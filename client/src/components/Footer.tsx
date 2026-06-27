/*
 * JVO Footer — Professional Black / Grey / White
 * Dark footer with clean typography, no red accents
 */

import { MapPin, Phone, Mail, Facebook, Instagram } from "lucide-react";

const footerLinks = {
  Services: [
    { label: "Corporate Address", href: "#virtual-mail" },
    { label: "Virtual Mailbox", href: "#virtual-mail" },
    { label: "Private Offices", href: "#spaces" },
    { label: "Conference Room", href: "#spaces" },
    { label: "Co-Working", href: "#spaces" },
    { label: "Creative Studio", href: "#spaces" },
  ],
  Memberships: [
    { label: "Mail Only — $39/mo", href: "#memberships" },
    { label: "Solo Member — $199/mo", href: "#memberships" },
    { label: "Team Plan — $399/mo", href: "#memberships" },
    { label: "A La Carte Pricing", href: "#memberships" },
    { label: "Book a Space", href: "#booking" },
  ],
  Company: [
    { label: "About JVO", href: "#services" },
    { label: "Schedule a Tour", href: "#booking" },
    { label: "Contact Us", href: "#contact" },
  ],
};

export default function Footer() {
  const handleNav = (href: string) => {
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <footer className="bg-[#0A0A0A]">
      {/* CTA Banner */}
      <div className="border-t border-white/10 py-16">
        <div className="container">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h3 className="font-display text-3xl md:text-4xl font-semibold text-white leading-tight mb-2">
                Ready to Elevate Your Business?
              </h3>
              <p className="font-sans text-white/40 text-sm">
                Join JVO today — professional address, mail services, and on-demand office space from $39/month.
              </p>
            </div>
            <button
              onClick={() => handleNav("#booking")}
              className="flex-shrink-0 bg-white text-black font-sans text-xs font-semibold tracking-[0.18em] uppercase px-8 py-4 hover:bg-white/90 transition-colors duration-200"
            >
              Get Started Today
            </button>
          </div>
        </div>
      </div>

      {/* Main Footer */}
      <div className="border-t border-white/10">
        <div className="container py-16">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
            {/* Brand Column */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="flex flex-col leading-none">
                  <span className="font-display text-2xl font-semibold text-white tracking-tight">JVO</span>
                  <span className="font-sans text-[10px] text-white/35 tracking-[0.2em] uppercase">Virtual Office</span>
                </div>
              </div>
              <p className="font-sans text-white/40 text-sm leading-relaxed mb-6 max-w-xs">
                Jonesboro Virtual Office provides professional workspace solutions for entrepreneurs, freelancers, and small businesses in the greater Atlanta area.
              </p>

              {/* Contact Info */}
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <MapPin size={14} className="text-white/35 mt-0.5 flex-shrink-0" />
                  <span className="font-sans text-white/40 text-sm">
                    127 Jonesboro Rd<br />Jonesboro, GA 30236
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone size={14} className="text-white/35 flex-shrink-0" />
                  <a href="tel:6785194723" className="font-sans text-white/40 text-sm hover:text-white/70 transition-colors">
                    (678) 519-4723
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <Mail size={14} className="text-white/35 flex-shrink-0" />
                  <a href="mailto:jonesborovirtualoffice@gmail.com" className="font-sans text-white/40 text-sm hover:text-white/70 transition-colors">
                    jonesborovirtualoffice@gmail.com
                  </a>
                </div>
              </div>

              {/* Social Links */}
              <div className="flex gap-3 mt-6">
                <a
                  href="https://www.facebook.com/jvoevents"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 border border-white/15 flex items-center justify-center text-white/40 hover:text-white hover:border-white/40 transition-all duration-200"
                >
                  <Facebook size={15} />
                </a>
                <a
                  href="https://www.instagram.com/jvoevents"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 border border-white/15 flex items-center justify-center text-white/40 hover:text-white hover:border-white/40 transition-all duration-200"
                >
                  <Instagram size={15} />
                </a>
              </div>
            </div>

            {/* Links Columns */}
            {Object.entries(footerLinks).map(([category, links]) => (
              <div key={category}>
                <h4 className="font-sans font-semibold text-white/60 text-[10px] uppercase tracking-[0.25em] mb-5">
                  {category}
                </h4>
                <ul className="space-y-3">
                  {links.map((link) => (
                    <li key={link.label}>
                      <button
                        onClick={() => handleNav(link.href)}
                        className="font-sans text-white/35 text-sm hover:text-white/70 transition-colors duration-150 text-left"
                      >
                        {link.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/8 py-5">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-sans text-white/25 text-xs">
            © {new Date().getFullYear()} Jonesboro Virtual Office (JVO). All rights reserved.
          </p>
          <p className="font-sans text-white/25 text-xs">
            Professional workspace solutions in Jonesboro, GA
          </p>
        </div>
      </div>
    </footer>
  );
}
