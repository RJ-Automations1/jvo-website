/*
 * JVO Hero Section — Real JVO logo wall photo as background
 * Professional Black / Grey / White palette
 * Image: /manus-storage/jvo-28_b7beac9c.jpg (JVO logo on white brick wall)
 * Layout: Left = headline/CTAs, Right = autoplay video
 */

import { useEffect, useRef, useState } from "react";
import { ArrowRight, MapPin, Phone, Clock, Volume2, VolumeX } from "lucide-react";

export default function HeroSection() {
  const [visible, setVisible] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setMuted(videoRef.current.muted);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
      videoRef.current?.play().catch(() => {});
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleScroll = (href: string) => {
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden">
      {/* Real JVO logo wall photo */}
      <div className="absolute inset-0">
        <img
          src="/manus-storage/jvo-28_b7beac9c.jpg"
          alt="Jonesboro Virtual Office"
          className="w-full h-full object-cover object-center"
        />
        {/* Dark overlay for text legibility */}
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/10" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />
      </div>

      <div className="container relative z-10 pt-28 pb-10">
        {/* Two-column layout: left = content, right = video */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:gap-12 xl:gap-16">

          {/* Left column — headline, CTAs, quick info */}
          <div className="flex-1 max-w-xl">
            {/* Location label */}
            <div
              className={`flex items-center gap-3 mb-8 transition-all duration-700 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <div className="w-8 h-px bg-white/40" />
              <span className="font-sans text-[10px] font-medium tracking-[0.3em] uppercase text-white/60">
                Downtown Jonesboro, Georgia
              </span>
            </div>

            {/* Main Headline */}
            <h1
              className={`font-display font-semibold text-white leading-[0.92] mb-6 transition-all duration-700 delay-100 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              }`}
              style={{ fontSize: "clamp(2.8rem, 6vw, 6rem)" }}
            >
              Your Business,
              <br />
              <em className="not-italic text-white/75">Elevated.</em>
            </h1>

            {/* Subheadline */}
            <p
              className={`font-sans text-white/65 text-lg leading-relaxed mb-10 max-w-lg transition-all duration-700 delay-200 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              }`}
            >
              Premium virtual office memberships, private suites, professional mail
              services, and on-demand conference rooms — all in one address.
            </p>

            {/* CTA Buttons */}
            <div
              className={`flex flex-wrap gap-4 mb-10 transition-all duration-700 delay-300 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              }`}
            >
              <a
                href="https://youriguide.com/100_127_jonesboro_rd_jonesboro_ga"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex items-center gap-2.5"
              >
                Virtual Tour
                <ArrowRight className="w-4 h-4" />
              </a>
              <button
                onClick={() => handleScroll("#memberships")}
                className="btn-outline-white"
              >
                View Memberships
              </button>
            </div>

            {/* Quick Info */}
            <div
              className={`flex flex-wrap gap-6 transition-all duration-700 delay-400 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              }`}
            >
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-white/40" />
                <span className="font-sans text-white/55 text-sm">24/7 Member Access</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-white/40" />
                <a href="tel:6785194723" className="font-sans text-white/55 text-sm hover:text-white transition-colors">
                  (678) 519-4723
                </a>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-white/40" />
                <span className="font-sans text-white/55 text-sm">127 Jonesboro Rd, GA 30236</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Video — center-right, alongside JVO logo background */}
      <div
        className={`hidden lg:block absolute top-1/2 right-8 z-20 transition-all duration-1000 delay-600 ${
          visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
        }`}
        style={{ width: "44%", maxWidth: "640px", transform: "translateY(-50%)" }}
      >
        <div className="relative border border-white/25 shadow-2xl overflow-hidden" style={{ aspectRatio: "16/9" }}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            src="/manus-storage/CommericalWithBrOll_2b1336d8.mp4"
            autoPlay
            muted
            loop
            playsInline
          />
          {/* Subtle vignette */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "linear-gradient(135deg, rgba(0,0,0,0.15) 0%, transparent 60%, rgba(0,0,0,0.1) 100%)"
          }} />
          {/* Bottom bar: label + mute toggle */}
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2.5 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between">
            <span className="font-sans text-[9px] font-semibold tracking-[0.25em] uppercase text-white/70">
              Jonesboro Virtual Office
            </span>
            <button
              onClick={toggleMute}
              className="flex items-center gap-1.5 text-white/80 hover:text-white transition-colors bg-black/30 hover:bg-black/50 rounded px-2 py-1"
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              <span className="font-sans text-[9px] font-semibold tracking-widest uppercase">
                {muted ? "Unmute" : "Mute"}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div
        className={`relative z-10 container pb-14 transition-all duration-700 delay-500 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
        }`}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/10 border border-white/10 max-w-2xl">
          {[
            { value: "24/7", label: "Building Access" },
            { value: "$39", label: "Starting/Month" },
            { value: "3+", label: "Space Types" },
            { value: "100%", label: "Professional" },
          ].map((stat, i) => (
            <div key={i} className="bg-black/40 backdrop-blur-sm px-6 py-5">
              <div className="font-mono-price text-white text-2xl font-medium leading-none mb-1">
                {stat.value}
              </div>
              <div className="font-sans text-white/45 text-[10px] uppercase tracking-[0.2em]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
