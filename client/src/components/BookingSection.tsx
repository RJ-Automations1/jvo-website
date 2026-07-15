/*
 * JVO Booking / Contact Section — Professional Black / Grey / White
 * Two-column layout: compact reserve CTA + contact info
 * Reserve/book CTAs go to the /booking page (live Google Calendar availability).
 */

import { useState, useRef, useEffect } from "react";
import { Calendar, Clock, Phone, Mail, MapPin, ArrowRight } from "lucide-react";
import { Link } from "wouter";

const BOOKING_PATH = "/booking";

export default function BookingSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.05 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="booking" className="py-24 md:py-32 bg-[#F7F7F7]">
      <div className="container" ref={ref}>
        {/* Header */}
        <div
          className="mb-14"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1), transform 0.7s cubic-bezier(0.23,1,0.32,1)",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-px bg-black/30" />
            <span className="section-label">Schedule & Book</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <h2 className="font-display text-5xl md:text-6xl font-semibold text-black leading-[0.95]">
              Ready to Get Started?
              <br />
              <em className="not-italic text-black/35">Book Your Space Today.</em>
            </h2>
            <p className="font-sans text-sm text-black/50 max-w-xs leading-relaxed">
              Schedule a tour, reserve a space, or set up your virtual office membership.
            </p>
          </div>
        </div>

        {/* Two-column layout */}
        <div
          className="grid grid-cols-1 lg:grid-cols-2 gap-8"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1) 0.15s, transform 0.7s cubic-bezier(0.23,1,0.32,1) 0.15s",
          }}
        >
          {/* Left: Reserve Space compact CTA + Quick Options */}
          <div className="flex flex-col gap-4">
            {/* Reserve Space card */}
            <div className="border border-black/15 p-6 flex items-center justify-between gap-4 bg-white">
              <div>
                <p className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-black/40 mb-1">Online Booking</p>
                <h3 className="font-display text-2xl font-semibold text-black leading-tight">Reserve a Space</h3>
                <p className="font-sans text-xs text-black/45 mt-1">Pick a date, choose a time, confirm in minutes.</p>
              </div>
              <Link
                href={BOOKING_PATH}
                className="inline-flex items-center gap-2 font-sans text-[11px] font-semibold tracking-[0.18em] uppercase bg-black text-white px-5 py-3 hover:bg-black/80 transition-all duration-200 flex-shrink-0"
              >
                Book Space <ArrowRight size={12} />
              </Link>
            </div>

            {/* Quick booking options */}
            <div className="bg-white border border-black/10 p-6">
              <h3 className="font-sans font-semibold text-black text-base mb-4">Quick Options</h3>
              <div className="space-y-3">
                {[
                  { label: "Schedule a Free Tour", desc: "30-min walkthrough of all spaces", icon: Calendar },
                  { label: "Private Office", desc: "Book by the hour — from $10/hr (member)", icon: Clock },
                  { label: "Conference Room", desc: "Reserve for meetings — from $20/hr (member)", icon: MapPin },
                ].map((opt, i) => {
                  const Icon = opt.icon;
                  return (
                    <Link
                      key={i}
                      href={BOOKING_PATH}
                      className="flex items-center gap-4 border border-black/10 p-4 hover:border-black/30 transition-all duration-200 group"
                    >
                      <div className="w-9 h-9 border border-black/15 flex items-center justify-center flex-shrink-0 group-hover:border-black/40 transition-colors">
                        <Icon size={16} className="text-black/50" />
                      </div>
                      <div>
                        <div className="font-sans font-semibold text-black text-sm">{opt.label}</div>
                        <div className="font-sans text-black/45 text-xs">{opt.desc}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Contact Info + Map */}
          <div className="flex flex-col gap-6">
            {/* Contact Info */}
            <div className="bg-white border border-black/10 p-6">
              <h3 className="font-sans font-semibold text-black text-base mb-4">Contact Us</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Phone size={15} className="text-black/40 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="section-label mb-0.5">Phone</p>
                    <a href="tel:6785194723" className="font-sans text-black text-sm hover:text-black/60 transition-colors">
                      (678) 519-4723
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Mail size={15} className="text-black/40 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="section-label mb-0.5">Email</p>
                    <a href="mailto:jonesborovirtualoffice@gmail.com" className="font-sans text-black text-sm hover:text-black/60 transition-colors break-all">
                      jonesborovirtualoffice@gmail.com
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin size={15} className="text-black/40 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="section-label mb-0.5">Address</p>
                    <p className="font-sans text-black text-sm">127 Jonesboro Rd<br />Jonesboro, GA 30236</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock size={15} className="text-black/40 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="section-label mb-0.5">Member Access</p>
                    <p className="font-sans text-black text-sm">24/7 — Always Open</p>
                    <p className="font-sans text-black/40 text-xs mt-0.5">Receptionist: Mon–Fri, business hours</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Map */}
            <div id="contact" className="border border-black/10 overflow-hidden h-48">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3323.5!2d-84.3539!3d33.5323!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x88f4f5e3b3b3b3b3%3A0x1!2s127+Jonesboro+Rd%2C+Jonesboro%2C+GA+30236!5e0!3m2!1sen!2sus!4v1"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="JVO Location"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
