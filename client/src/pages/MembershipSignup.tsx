/*
 * JVO Membership Signup — Redirects to Deskworks
 * All new member registrations go to: https://jvo.satellitedeskworks.com/member-sign-up
 * In-office requirement notice shown prominently
 */

import { useEffect } from "react";
import { ArrowLeft, ArrowRight, MapPin, ExternalLink, FileText } from "lucide-react";
import { Link, useSearch } from "wouter";

const DESKWORKS_SIGNUP_URL = "https://jvo.satellitedeskworks.com/member-sign-up";

export default function MembershipSignup() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const plan = params.get("plan") || "Membership";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Auto-redirect to Deskworks after a brief moment
    const timer = setTimeout(() => {
      window.location.href = DESKWORKS_SIGNUP_URL;
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col">
      {/* Back nav */}
      <div className="container pt-8">
        <Link
          href="/#memberships"
          className="inline-flex items-center gap-2 font-sans text-[11px] font-medium tracking-[0.18em] uppercase text-white/40 hover:text-white transition-colors"
        >
          <ArrowLeft size={13} /> Back to Plans
        </Link>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="container max-w-xl text-center">

          {/* Label */}
          <p className="font-sans text-[10px] font-semibold tracking-[0.3em] uppercase text-white/30 mb-4">
            {plan} Plan
          </p>

          {/* Headline */}
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-white leading-[0.95] mb-4">
            Redirecting to
            <br />
            <em className="not-italic text-white/40">Registration...</em>
          </h1>

          <p className="font-sans text-sm text-white/45 leading-relaxed mb-10 max-w-sm mx-auto">
            You'll be taken to our secure member registration portal in just a moment.
          </p>

          {/* Direct link button */}
          <a
            href={DESKWORKS_SIGNUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase bg-white text-black px-8 py-3.5 hover:bg-white/90 transition-all duration-200 mb-10"
          >
            Register Now <ExternalLink size={13} />
          </a>

          {/* In-office requirement notice */}
          <div className="flex items-start gap-4 border border-white/15 bg-white/5 px-6 py-5 text-left mt-4">
            <MapPin size={16} className="text-white/50 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-sans text-xs font-semibold tracking-[0.15em] uppercase text-white/60 mb-1">
                In-Office Visit Required
              </p>
              <p className="font-sans text-sm text-white/40 leading-relaxed">
                After completing your online registration, all new members must visit our office in person to sign membership agreements and complete onboarding.{" "}
                <span className="text-white/60 font-medium">127 Jonesboro Rd, Suite 100, Jonesboro, GA 30236</span>
              </p>
            </div>
          </div>

          {/* Mailbox / Form 1583 prep */}
          <Link
            href="/mailbox-application"
            className="flex items-start gap-4 border border-white/15 bg-white/5 px-6 py-5 text-left mt-4 hover:border-white/40 transition-colors group"
          >
            <FileText size={16} className="text-white/50 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-sans text-xs font-semibold tracking-[0.15em] uppercase text-white/60 mb-1 group-hover:text-white transition-colors">
                Getting a Mailbox? Prep Your USPS Form 1583
              </p>
              <p className="font-sans text-sm text-white/40 leading-relaxed">
                Answer a short questionnaire and we'll pre-fill the form USPS requires to receive mail on your behalf — then bring it and your two IDs to your visit.
              </p>
            </div>
            <ArrowRight size={14} className="text-white/40 group-hover:text-white transition-colors flex-shrink-0 mt-0.5 ml-auto" />
          </Link>

          {/* Contact fallback */}
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="tel:6785194723"
              className="inline-flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-white/20 text-white/60 px-6 py-3 hover:border-white hover:text-white transition-all duration-200"
            >
              Call (678) 519-4723
            </a>
            <a
              href="mailto:jonesborovirtualoffice@gmail.com"
              className="inline-flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-white/20 text-white/60 px-6 py-3 hover:border-white hover:text-white transition-all duration-200"
            >
              Email Us <ArrowRight size={12} />
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
