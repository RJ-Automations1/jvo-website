/*
 * JVO Video Section — Autoplay MP4 commercial between Hero and Services
 * Design: Full-width, edge-to-edge, black background, subtle label above
 */

import { useRef, useEffect, useState } from "react";

export default function VideoSection() {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          videoRef.current?.play().catch(() => {});
        }
      },
      { threshold: 0.05 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className="w-full bg-black"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 0.8s cubic-bezier(0.23,1,0.32,1)",
      }}
    >
      {/* Label bar */}
      <div className="flex items-center justify-center gap-4 py-4 border-b border-white/10">
        <div className="w-8 h-px bg-white/30" />
        <span className="font-sans text-[10px] font-semibold tracking-[0.25em] uppercase text-white/50">
          Welcome to Jonesboro Virtual Office
        </span>
        <div className="w-8 h-px bg-white/30" />
      </div>

      {/* Full-width video */}
      <video
        ref={videoRef}
        className="w-full block"
        src="/manus-storage/CommericalWithBrOll_2b1336d8.mp4"
        autoPlay
        muted
        loop
        playsInline
        controls
      />
    </section>
  );
}
