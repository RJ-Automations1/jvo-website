/*
 * JVO Home Page
 * Design Philosophy: Refined Corporate Minimalism — Black, Grey, White
 * Assembles all sections in order
 */

import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ServicesSection from "@/components/ServicesSection";
import VirtualMailSection from "@/components/VirtualMailSection";
import SpacesSection from "@/components/SpacesSection";
import MembershipsSection from "@/components/MembershipsSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import BookingSection from "@/components/BookingSection";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-black">
      <Navbar />
      <HeroSection />
      <ServicesSection />
      <VirtualMailSection />
      <SpacesSection />
      <MembershipsSection />
      <TestimonialsSection />
      <BookingSection />
      <Footer />
    </div>
  );
}
