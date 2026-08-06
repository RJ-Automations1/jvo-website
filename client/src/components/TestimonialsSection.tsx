/*
 * JVO Testimonials Section — Professional Black / Grey / White
 * Trust stats + quote cards, clean editorial style
 */

import { useRef, useEffect, useState } from "react";
import { Star, Quote } from "lucide-react";
import { businessAgeParts } from "@/lib/businessAge";

const testimonials = [
  {
    name: "Marcus T.",
    role: "Real Estate Agent",
    text: "JVO gave my business the professional edge I needed. Having a real Jonesboro address on my cards and website made a huge difference with clients. The mail app is incredibly convenient.",
    rating: 5,
  },
  {
    name: "Priya S.",
    role: "Marketing Consultant",
    text: "I work remotely but needed a professional presence. The Solo membership is perfect — I get a business address, mail handling, and can book a private office whenever I have client meetings.",
    rating: 5,
  },
  {
    name: "David K.",
    role: "Startup Founder",
    text: "The conference room is top-notch. We use it for investor meetings and team sessions. The staff is professional and the space always looks great. Worth every penny.",
    rating: 5,
  },
];

export default function TestimonialsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Counted live from opening day rather than hardcoded, so it never goes stale.
  const [age, setAge] = useState(businessAgeParts);
  useEffect(() => {
    // Hourly re-check: a tab left open overnight rolls over on its own, and an
    // hourly tick can't drift past a midnight the way a 24h timer would.
    const id = setInterval(() => setAge(businessAgeParts()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const trustStats: { value: string; label: string; sub?: string | null }[] = [
    { value: "200+", label: "Active Members" },
    { value: "4.9★", label: "Google Rating" },
    { value: age.years, sub: age.days, label: "In Business" },
    { value: "24/7", label: "Access" },
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.05 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="py-24 md:py-32 bg-white">
      <div className="container" ref={ref}>
        {/* Trust Stats Bar */}
        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-black/10 mb-20"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1), transform 0.7s cubic-bezier(0.23,1,0.32,1)",
          }}
        >
          {trustStats.map((stat, i) => (
            <div key={i} className="bg-white px-6 py-6 text-center hover:bg-[#F7F7F7] transition-colors duration-200">
              <div className="font-mono-price text-black text-3xl font-medium mb-1">
                {stat.value}
                {stat.sub && (
                  // Smaller and on its own line below md, so the tile never
                  // overflows in the 2-column mobile grid.
                  <span className="block md:inline md:ml-2 text-base font-normal text-black/45">
                    {stat.sub}
                  </span>
                )}
              </div>
              <div className="font-sans text-black/40 text-[10px] uppercase tracking-[0.2em]">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Section Header */}
        <div
          className="mb-12"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1) 0.1s, transform 0.7s cubic-bezier(0.23,1,0.32,1) 0.1s",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-px bg-black/30" />
            <span className="section-label">Member Stories</span>
          </div>
          <h2 className="font-display text-5xl md:text-6xl font-semibold text-black leading-[0.95]">
            Trusted by Local
            <br />
            <em className="not-italic text-black/35">Business Professionals.</em>
          </h2>
        </div>

        {/* Testimonial Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-black/10">
          {testimonials.map((t, i) => (
            <div
              key={i}
              className="bg-white p-8 flex flex-col hover:bg-[#F7F7F7] transition-colors duration-300"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(24px)",
                transition: `opacity 0.7s cubic-bezier(0.23,1,0.32,1) ${0.2 + i * 0.1}s, transform 0.7s cubic-bezier(0.23,1,0.32,1) ${0.2 + i * 0.1}s`,
              }}
            >
              {/* Quote icon */}
              <Quote size={24} className="text-black/15 mb-5" />

              {/* Stars */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} size={13} className="text-black/50 fill-black/50" />
                ))}
              </div>

              {/* Text */}
              <p className="font-sans text-black/60 text-sm leading-relaxed flex-1 mb-6">
                "{t.text}"
              </p>

              {/* Author */}
              <div className="flex items-center gap-3 pt-4 border-t border-black/10">
                <div className="w-8 h-8 bg-black flex items-center justify-center flex-shrink-0">
                  <span className="font-sans font-semibold text-white text-xs">
                    {t.name[0]}
                  </span>
                </div>
                <div>
                  <div className="font-sans font-semibold text-black text-sm">{t.name}</div>
                  <div className="font-sans text-black/40 text-xs">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
