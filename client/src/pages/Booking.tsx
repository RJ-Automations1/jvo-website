/*
 * JVO Booking Page — /booking
 * Compact calendar + reservation form on a dedicated page
 * Linked from "Reserve Now" / "Book a Space" CTAs
 * Design: Professional Black / Grey / White
 */

import { useState, useMemo, useEffect } from "react";
import {
  Check, ChevronLeft, ChevronRight, ArrowLeft,
  ArrowRight, Lock, Tag, User, CalendarDays
} from "lucide-react";
import { Link, useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/*
 * ── Google Calendar connection ──────────────────────────────────────────────
 * JVO_CALENDAR_EMBED: read-only view of the client's live JVO calendar
 * (jonesborovirtualoffice@gmail.com). Shows customers what's already booked.
 * NOTE: this only renders publicly if that calendar's sharing is set to
 * "Make available to public" in Google Calendar → Settings → Access permissions.
 *
 * APPOINTMENT_BOOKING_URL: paste the client's Google Appointment Schedule link
 * here (looks like https://calendar.app.google/XXXX). That page lets customers
 * self-book AND automatically refuses anything that would double-book the
 * calendar. Once set, an "Instant Book" button appears below. Until then,
 * customers see live availability + submit a request we confirm manually.
 */
const JVO_CALENDAR_EMBED =
  "https://calendar.google.com/calendar/embed?src=1830514f596a30e51ac9c83a2700e915b87ddd99115031e62d788dde64733d57%40group.calendar.google.com&ctz=America%2FNew_York&mode=WEEK";
const APPOINTMENT_BOOKING_URL = "";

type SpaceOption = {
  id: string;
  name: string;
  memberPrice: number;
  nonMemberPrice: number;
  minHours: number;
};

const spaceOptions: SpaceOption[] = [
  { id: "classroom",       name: "Classroom (seats 15)",     memberPrice: 30,  nonMemberPrice: 75,  minHours: 1 },
  { id: "conference",      name: "Conference Room (seats 6)", memberPrice: 20, nonMemberPrice: 50,  minHours: 1 },
  { id: "private-small",   name: "Private Office — Small",   memberPrice: 10,  nonMemberPrice: 25,  minHours: 1 },
  { id: "private-large",   name: "Private Office — Large",   memberPrice: 15,  nonMemberPrice: 35,  minHours: 1 },
  { id: "content-studio",  name: "Content Studio",           memberPrice: 25,  nonMemberPrice: 40,  minHours: 1 },
  { id: "corporate-event", name: "Corporate Event Space",    memberPrice: 75,  nonMemberPrice: 150, minHours: 2 },
];

const timeSlots = [
  "8:00 AM","9:00 AM","10:00 AM","11:00 AM",
  "12:00 PM","1:00 PM","2:00 PM","3:00 PM",
  "4:00 PM","5:00 PM","6:00 PM","7:00 PM",
];

const DAYS   = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function buildCalendar(year: number, month: number) {
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

export default function BookingPage() {
  const today = new Date();
  const [, setLocation] = useLocation();

  const [isMember,       setIsMember]       = useState(false);
  const [selectedSpace,  setSelectedSpace]  = useState<SpaceOption>(spaceOptions[0]);
  const [hours,          setHours]          = useState(1);
  const [calYear,        setCalYear]        = useState(today.getFullYear());
  const [calMonth,       setCalMonth]       = useState(today.getMonth());
  const [selectedDay,    setSelectedDay]    = useState<number | null>(null);
  const [startTime,      setStartTime]      = useState("9:00 AM");
  const [name,           setName]           = useState("");
  const [email,          setEmail]          = useState("");
  const [phone,          setPhone]          = useState("");
  const [notes,          setNotes]          = useState("");
  const [submitted,      setSubmitted]      = useState(false);
  const [submitting,     setSubmitting]     = useState(false);
  const [bookError,      setBookError]      = useState("");

  useEffect(() => { window.scrollTo({ top: 0 }); }, []);

  const cells = useMemo(() => buildCalendar(calYear, calMonth), [calYear, calMonth]);

  const isToday = (d: number) =>
    d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();

  const isPast = (d: number) => {
    const cell = new Date(calYear, calMonth, d);
    cell.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return cell < t;
  };

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
    setSelectedDay(null);
  };

  const nextMonth = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
    setSelectedDay(null);
  };

  const selectedDateStr = selectedDay
    ? `${MONTHS[calMonth]} ${selectedDay}, ${calYear}`
    : "";

  const pricePerHour  = isMember ? selectedSpace.memberPrice : selectedSpace.nonMemberPrice;
  const subtotal      = pricePerHour * hours;
  const memberSavings = !isMember
    ? (selectedSpace.nonMemberPrice - selectedSpace.memberPrice) * hours
    : 0;

  // YYYY-MM-DD for the selected day (local, no timezone drift)
  const isoDate = selectedDay
    ? `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDay || submitting) return;
    setBookError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email, phone, notes,
          space: selectedSpace.name,
          date: isoDate,
          startTime,
          hours,
        }),
      });
      // A static-only deploy has no /api/book, and the SPA rewrite answers the
      // POST with index.html and a 200 — so res.ok alone is NOT proof the
      // booking was recorded. Require a JSON body before trusting it.
      const isJson = (res.headers.get("content-type") || "").includes("application/json");
      const data = isJson
        ? await res.json().catch(() => ({}) as { error?: string })
        : ({} as { error?: string });
      if (!res.ok || !isJson) {
        // 409 = slot taken; other errors (incl. API not yet live) fall back to a call-us message.
        setBookError(
          data.error ||
            "Online booking is being set up. Please call (678) 519-4723 to reserve your space."
        );
        return;
      }
      setSubmitted(true);
    } catch {
      setBookError(
        "Couldn't reach the booking system. Please try again, or call (678) 519-4723 to reserve."
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Success Screen ── */
  if (submitted) {
    return (
      <div className="min-h-screen bg-white text-black">
        <Navbar />
        <main className="pt-28 pb-24">
          <div className="container max-w-xl">
            <div className="bg-white border border-black/10 p-12 text-center">
              <div className="w-14 h-14 bg-black flex items-center justify-center mx-auto mb-6">
                <Check size={24} className="text-white" />
              </div>
              <h2 className="font-display text-3xl font-semibold text-black mb-3">Booking Confirmed</h2>
              <p className="font-sans text-sm text-black/55 leading-relaxed mb-8">
                Thank you, <strong>{name}</strong>. Your reservation for the{" "}
                <strong>{selectedSpace.name}</strong> on <strong>{selectedDateStr}</strong> at{" "}
                <strong>{startTime}</strong> is booked and on our calendar. A confirmation is on its way to{" "}
                <strong>{email}</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => {
                    setSubmitted(false);
                    setName(""); setEmail(""); setPhone(""); setNotes("");
                    setSelectedDay(null);
                  }}
                  className="font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-black px-8 py-3 hover:bg-black hover:text-white transition-all duration-200"
                >
                  Book Another
                </button>
                <Link
                  href="/"
                  className="font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-black/20 px-8 py-3 text-black/50 hover:border-black hover:text-black transition-all duration-200 text-center"
                >
                  Back to Home
                </Link>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  /* ── Main Booking Page ── */
  return (
    <div className="min-h-screen bg-[#F5F5F3] text-black">
      <Navbar />

      <main className="pt-28 pb-24">
        <div className="container max-w-5xl">

          {/* Back link */}
          <div className="mb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase text-black/40 hover:text-black transition-colors"
            >
              <ArrowLeft size={13} /> Back to Home
            </Link>
          </div>

          {/* Page Header */}
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-6 h-px bg-black/30" />
              <span className="font-sans text-[10px] font-semibold tracking-[0.25em] uppercase text-black/40">Reserve a Space</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <h1 className="font-display text-4xl md:text-5xl font-semibold text-black leading-[0.95]">
                Book Your Space
              </h1>
              {/* Member Toggle */}
              <div className="flex flex-col gap-1.5">
                <p className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-black/40">Your Status</p>
                <div className="flex items-center border border-black/20 overflow-hidden bg-white">
                  <button
                    type="button"
                    onClick={() => setIsMember(false)}
                    className={`px-4 py-2 font-sans text-[11px] font-semibold tracking-[0.15em] uppercase transition-all duration-200 ${
                      !isMember ? "bg-black text-white" : "text-black/50 hover:text-black"
                    }`}
                  >
                    Non-Member
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMember(true)}
                    className={`flex items-center gap-1.5 px-4 py-2 font-sans text-[11px] font-semibold tracking-[0.15em] uppercase transition-all duration-200 ${
                      isMember ? "bg-black text-white" : "text-black/50 hover:text-black"
                    }`}
                  >
                    <User size={11} /> Member
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Live availability from the JVO Google Calendar ── */}
          <div className="bg-white border border-black/10 p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <CalendarDays size={16} className="text-black/40" />
              <h3 className="font-display text-base font-semibold text-black">Live Availability</h3>
              <span className="ml-auto font-sans text-[10px] font-semibold tracking-[0.15em] uppercase text-black/35">
                Synced with our Google Calendar
              </span>
            </div>

            {APPOINTMENT_BOOKING_URL && (
              <a
                href={APPOINTMENT_BOOKING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-4 w-full flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase bg-black text-white py-3.5 hover:bg-black/80 transition-all duration-200"
              >
                Book Instantly — No Double-Booking <ArrowRight size={13} />
              </a>
            )}

            <div className="w-full overflow-hidden border border-black/10">
              <iframe
                title="JVO Live Calendar"
                src={JVO_CALENDAR_EMBED}
                className="w-full"
                style={{ height: 500, border: 0 }}
                loading="lazy"
              />
            </div>
            <p className="font-sans text-[11px] text-black/40 mt-3 leading-relaxed">
              The calendar above reflects current bookings in real time.
              {APPOINTMENT_BOOKING_URL
                ? " Use “Book Instantly” to reserve an open slot."
                : " Pick an open slot below — your reservation is checked against the calendar and booked instantly, so nothing gets double-booked."}
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="grid lg:grid-cols-3 gap-6">

              {/* ── Left: Form Panels ── */}
              <div className="lg:col-span-2 flex flex-col gap-5">

                {/* Space Selection */}
                <div className="bg-white border border-black/10 p-6">
                  <h3 className="font-display text-base font-semibold text-black mb-4">Select a Space</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {spaceOptions.map((space) => {
                      const price = isMember ? space.memberPrice : space.nonMemberPrice;
                      const isSelected = selectedSpace.id === space.id;
                      return (
                        <button
                          key={space.id}
                          type="button"
                          onClick={() => { setSelectedSpace(space); setHours(space.minHours); }}
                          className={`text-left p-3 border transition-all duration-200 ${
                            isSelected ? "border-black bg-black text-white" : "border-black/12 hover:border-black/40 bg-white"
                          }`}
                        >
                          <div className={`font-display text-sm font-semibold leading-tight mb-1.5 ${isSelected ? "text-white" : "text-black"}`}>
                            {space.name}
                          </div>
                          <div className="flex items-baseline gap-0.5">
                            <span className={`font-mono text-base font-medium ${isSelected ? "text-white" : "text-black"}`}>
                              ${price}
                            </span>
                            <span className={`font-sans text-[11px] ${isSelected ? "text-white/50" : "text-black/40"}`}>/hr</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Compact Calendar + Time side by side */}
                <div className="bg-white border border-black/10 p-6">
                  <h3 className="font-display text-base font-semibold text-black mb-4">Date &amp; Time</h3>
                  <div className="grid sm:grid-cols-2 gap-6">

                    {/* Compact Calendar */}
                    <div>
                      {/* Month Nav */}
                      <div className="flex items-center justify-between mb-3">
                        <button type="button" onClick={prevMonth}
                          className="w-7 h-7 flex items-center justify-center border border-black/15 hover:bg-black hover:text-white transition-all duration-150">
                          <ChevronLeft size={13} />
                        </button>
                        <span className="font-sans text-xs font-semibold tracking-[0.12em] uppercase text-black">
                          {MONTHS[calMonth].slice(0,3)} {calYear}
                        </span>
                        <button type="button" onClick={nextMonth}
                          className="w-7 h-7 flex items-center justify-center border border-black/15 hover:bg-black hover:text-white transition-all duration-150">
                          <ChevronRight size={13} />
                        </button>
                      </div>

                      {/* Day headers */}
                      <div className="grid grid-cols-7 mb-1">
                        {DAYS.map((d) => (
                          <div key={d} className="text-center font-sans text-[9px] font-semibold tracking-[0.1em] uppercase text-black/30 py-1">
                            {d}
                          </div>
                        ))}
                      </div>

                      {/* Day grid */}
                      <div className="grid grid-cols-7 gap-0.5">
                        {cells.map((day, idx) => {
                          if (!day) return <div key={idx} />;
                          const past     = isPast(day);
                          const todayCell = isToday(day);
                          const selected = selectedDay === day;
                          return (
                            <button
                              key={idx}
                              type="button"
                              disabled={past}
                              onClick={() => setSelectedDay(day)}
                              className={`
                                relative aspect-square flex items-center justify-center
                                font-sans text-xs font-medium transition-all duration-100
                                ${past ? "text-black/20 cursor-not-allowed" : "cursor-pointer"}
                                ${selected
                                  ? "bg-black text-white"
                                  : past ? ""
                                  : todayCell
                                  ? "border border-black text-black hover:bg-black hover:text-white"
                                  : "text-black hover:bg-black/8"
                                }
                              `}
                            >
                              {day}
                              {todayCell && !selected && (
                                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-0.5 h-0.5 rounded-full bg-black" />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {selectedDay ? (
                        <p className="font-sans text-[11px] text-black/50 mt-2 text-center">
                          {selectedDateStr}
                        </p>
                      ) : (
                        <p className="font-sans text-[11px] text-black/30 mt-2 text-center italic">
                          Click a date to select
                        </p>
                      )}
                    </div>

                    {/* Time + Duration */}
                    <div className="flex flex-col gap-4">
                      <div>
                        <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-2">
                          Start Time
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {timeSlots.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setStartTime(t)}
                              className={`py-2 font-sans text-[11px] font-medium border transition-all duration-100 ${
                                startTime === t
                                  ? "bg-black text-white border-black"
                                  : "border-black/12 text-black/60 hover:border-black/40 hover:text-black"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-2">
                          Duration
                        </label>
                        <div className="flex items-center border border-black/15 bg-white">
                          <button type="button"
                            onClick={() => setHours(Math.max(selectedSpace.minHours, hours - 1))}
                            className="w-10 h-10 flex items-center justify-center text-black/40 hover:text-black hover:bg-black/5 transition-colors text-lg">
                            −
                          </button>
                          <div className="flex-1 text-center">
                            <span className="font-mono text-xl font-medium text-black">{hours}</span>
                            <span className="font-sans text-xs text-black/40 ml-1">hr{hours > 1 ? "s" : ""}</span>
                          </div>
                          <button type="button"
                            onClick={() => setHours(Math.min(12, hours + 1))}
                            className="w-10 h-10 flex items-center justify-center text-black/40 hover:text-black hover:bg-black/5 transition-colors text-lg">
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="bg-white border border-black/10 p-6">
                  <h3 className="font-display text-base font-semibold text-black mb-4">Your Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { label: "Full Name *", type: "text",  value: name,  setter: setName,  placeholder: "Your full name",    required: true },
                      { label: "Email *",     type: "email", value: email, setter: setEmail, placeholder: "your@email.com",    required: true },
                      { label: "Phone",       type: "tel",   value: phone, setter: setPhone, placeholder: "(000) 000-0000",    required: false },
                      { label: "Notes",       type: "text",  value: notes, setter: setNotes, placeholder: "Any special requests?", required: false },
                    ].map(({ label, type, value, setter, placeholder, required }) => (
                      <div key={label}>
                        <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-1.5">
                          {label}
                        </label>
                        <input
                          type={type}
                          required={required}
                          value={value}
                          onChange={(e) => setter(e.target.value)}
                          placeholder={placeholder}
                          className="w-full border border-black/15 px-3 py-2.5 font-sans text-sm text-black bg-white focus:outline-none focus:border-black transition-colors placeholder:text-black/25"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Right: Summary + Submit ── */}
              <div className="lg:col-span-1">
                <div className="sticky top-28 flex flex-col gap-3">

                  {/* Summary Card */}
                  <div className="bg-black text-white p-6">
                    <h3 className="font-display text-base font-semibold mb-5 pb-4 border-b border-white/10">
                      Booking Summary
                    </h3>
                    <div className="space-y-3">
                      {[
                        { label: "Space",    value: selectedSpace.name },
                        { label: "Date",     value: selectedDay ? selectedDateStr : null },
                        { label: "Time",     value: startTime },
                        { label: "Duration", value: `${hours} hr${hours > 1 ? "s" : ""}` },
                        { label: "Rate",     value: `$${pricePerHour}/hr${isMember ? " (member)" : ""}` },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between gap-3">
                          <span className="font-sans text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</span>
                          <span className="font-sans text-xs text-right text-white/80">
                            {value ?? <span className="text-white/25 italic">Not selected</span>}
                          </span>
                        </div>
                      ))}
                      <div className="border-t border-white/10 pt-3 flex justify-between items-baseline">
                        <span className="font-sans text-[10px] uppercase tracking-[0.12em] text-white/40">Total</span>
                        <span className="font-mono text-2xl font-semibold text-white">${subtotal}</span>
                      </div>
                      {!isMember && memberSavings > 0 && (
                        <div className="bg-white/8 p-3 flex items-start gap-2">
                          <Lock size={10} className="text-white/40 mt-0.5 flex-shrink-0" />
                          <p className="font-sans text-[11px] text-white/50 leading-relaxed">
                            Members pay <strong className="text-white">${subtotal - memberSavings}</strong> — save{" "}
                            <strong className="text-white">${memberSavings}</strong> as a member.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Submit */}
                  {bookError && (
                    <p className="font-sans text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2.5 leading-relaxed">
                      {bookError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={!selectedDay || submitting}
                    className={`w-full flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase py-3.5 transition-all duration-200 active:scale-[0.98] ${
                      selectedDay && !submitting
                        ? "bg-black text-white hover:bg-black/80"
                        : "bg-black/15 text-black/30 cursor-not-allowed"
                    }`}
                  >
                    {submitting
                      ? "Booking…"
                      : selectedDay
                      ? <><span>Confirm Reservation</span><ArrowRight size={13} /></>
                      : "Select a Date First"}
                  </button>

                  {!isMember && (
                    <a
                      href="https://jvo.satellitedeskworks.com/member-sign-up"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-black/20 py-3.5 text-black/50 hover:border-black hover:text-black transition-all duration-200"
                    >
                      <Tag size={12} /> Become a Member
                    </a>
                  )}
                </div>
              </div>

            </div>
          </form>
        </div>
      </main>

      <Footer />
    </div>
  );
}
