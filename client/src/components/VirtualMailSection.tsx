/*
 * JVO Virtual Mail Section — Professional Black / Grey / White
 * Split layout with real JVO entrance photo
 */

import { useRef, useEffect, useState } from "react";
import { Check } from "lucide-react";

const mailFeatures = [
  "Instant app notification when mail arrives",
  "Photo of every piece of mail uploaded to your account",
  "Forward mail to any address worldwide",
  "Request open & scan for digital access",
  "Shred, recycle, or hold for pickup",
  "Maintain a credible business address while working remotely",
];

export default function VirtualMailSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="virtual-mail" className="py-24 md:py-32 bg-white">
      <div className="container" ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: Text Content */}
          <div
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateX(0)" : "translateX(-24px)",
              transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1), transform 0.7s cubic-bezier(0.23,1,0.32,1)",
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-px bg-black/30" />
              <span className="section-label">Virtual Mail Services</span>
            </div>
            <h2 className="font-display text-5xl md:text-6xl font-semibold text-black leading-[0.95] mb-6">
              Manage Your Mail
              <br />
              <em className="not-italic text-black/35">From Anywhere.</em>
            </h2>
            <p className="font-sans text-black/55 text-base leading-relaxed mb-8">
              A virtual mailbox lets you operate remotely while maintaining a professional,
              credible business address. Stay on top of your mail without ever being physically
              present — our app keeps you in control 24/7.
            </p>

            {/* Features List */}
            <ul className="space-y-3 mb-10">
              {mailFeatures.map((feature, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3"
                  style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateX(0)" : "translateX(-16px)",
                    transition: `opacity 0.5s cubic-bezier(0.23,1,0.32,1) ${200 + i * 60}ms, transform 0.5s cubic-bezier(0.23,1,0.32,1) ${200 + i * 60}ms`,
                  }}
                >
                  <Check size={15} className="text-black/50 mt-0.5 flex-shrink-0" />
                  <span className="font-sans text-black/65 text-sm leading-relaxed">{feature}</span>
                </li>
              ))}
            </ul>

            {/* Pricing callout */}
            <div className="border border-black/15 p-5 inline-block">
              <p className="section-label mb-1">Corporate Mailing Address</p>
              <div className="flex items-baseline gap-1">
                <span className="font-mono-price text-black text-3xl font-medium">$39</span>
                <span className="font-sans text-black/40 text-sm">/month</span>
              </div>
              <p className="font-sans text-black/40 text-xs mt-1">No long-term contract required</p>
            </div>
          </div>

          {/* Right: Real JVO entrance photo */}
          <div
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateX(0)" : "translateX(24px)",
              transition: "opacity 0.7s cubic-bezier(0.23,1,0.32,1) 0.2s, transform 0.7s cubic-bezier(0.23,1,0.32,1) 0.2s",
            }}
          >
            <div className="relative overflow-hidden">
              <img
                src="/manus-storage/DSC02095_55966791.jpg"
                alt="JVO office entrance"
                className="w-full h-auto object-cover"
                style={{ maxHeight: "520px", objectFit: "cover" }}
              />
              {/* Subtle bottom gradient */}
              <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white/20 to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
