/*
 * JVO Booking Page — /booking
 * Compact calendar + reservation form on a dedicated page
 * Linked from "Reserve Now" / "Book a Space" CTAs
 * Design: Professional Black / Grey / White
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Check, ChevronLeft, ChevronRight, ArrowLeft,
  ArrowRight, Lock, Tag, User
} from "lucide-react";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  type Space,
  SPACES,
  DAYS_LABEL,
  HOURS_LABEL,
  DURATION_STEP_HOURS,
  OPEN_MINUTES,
  findSpace,
  formatMinutes,
  hoursToMinutes,
  isOpenDay,
  isTour,
  maxHoursAt,
  parseTimeToMinutes,
  startTimesFor,
  DEFAULT_START_TIME,
} from "@shared/booking";

type BusyBlock = { start: number; end: number };

/** "$75", but "$37.50" when a half hour lands on a half dollar. */
const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** 0.5 -> "30 min", 1 -> "1 hr", 1.5 -> "1.5 hrs". */
const durationLabel = (h: number) =>
  h < 1 ? `${hoursToMinutes(h)} min` : `${h} hr${h > 1 ? "s" : ""}`;

/** Deep-links like /booking?space=tour land straight on that tile. */
function spaceFromUrl(): Space {
  const requested = new URLSearchParams(window.location.search).get("space");
  return (requested && findSpace(requested)) || SPACES[0];
}

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

  const initialSpace = spaceFromUrl();
  const [isMember,       setIsMember]       = useState(false);
  const [selectedSpace,  setSelectedSpace]  = useState<Space>(initialSpace);
  const [hours,          setHours]          = useState(initialSpace.fixedHours ?? initialSpace.minHours);
  const [calYear,        setCalYear]        = useState(today.getFullYear());
  const [calMonth,       setCalMonth]       = useState(today.getMonth());
  const [selectedDay,    setSelectedDay]    = useState<number | null>(null);
  const [startTime,      setStartTime]      = useState(DEFAULT_START_TIME);
  const [busyBlocks,     setBusyBlocks]     = useState<BusyBlock[]>([]);
  const [loadingSlots,   setLoadingSlots]   = useState(false);
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

  // Closed weekends — those dates aren't selectable at all.
  const isClosed = (d: number) => !isOpenDay(new Date(calYear, calMonth, d).getDay());

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

  const tour          = isTour(selectedSpace);
  const pricePerHour  = isMember ? selectedSpace.memberPrice : selectedSpace.nonMemberPrice;
  const subtotal      = pricePerHour * hours;
  const memberSavings = !isMember
    ? (selectedSpace.nonMemberPrice - selectedSpace.memberPrice) * hours
    : 0;

  // YYYY-MM-DD for the selected day (local, no timezone drift)
  const isoDate = selectedDay
    ? `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
    : "";

  /*
   * What's already taken for the chosen day *in this space*, as
   * minutes-past-midnight in office time (the server does the timezone math).
   * Booking the Classroom doesn't touch the Conference Room, so this has to
   * re-run when the space changes, not only when the date does.
   */
  const spaceId = selectedSpace.id;
  const refreshAvailability = useCallback(async () => {
    if (!isoDate) { setBusyBlocks([]); return; }
    setLoadingSlots(true);
    try {
      const r = await fetch(`/api/availability?date=${isoDate}&space=${encodeURIComponent(spaceId)}`);
      const d = r.ok ? await r.json() : null;
      setBusyBlocks(Array.isArray(d?.busyMinutes) ? d.busyMinutes : []);
    } catch {
      // The API being unreachable shouldn't lock the form — the server
      // re-checks for conflicts on submit either way.
      setBusyBlocks([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [isoDate, spaceId]);

  useEffect(() => { void refreshAvailability(); }, [refreshAvailability]);

  // Start times this space can still take for a booking this long.
  const availableStartTimes = useMemo(
    () => startTimesFor(selectedSpace, hours),
    [selectedSpace, hours],
  );

  const isSlotTaken = (slot: string) => {
    const start = parseTimeToMinutes(slot);
    const end = start + hoursToMinutes(hours);
    return busyBlocks.some((b) => b.start < end && b.end > start);
  };

  /*
   * The cap on the duration stepper. Measured from opening rather than from the
   * chosen start on purpose: stretching a booking slides the start time earlier
   * (see the effect below) instead of dead-ending the + button.
   */
  const spaceMaxHours = useMemo(
    () => maxHoursAt(selectedSpace, OPEN_MINUTES),
    [selectedSpace],
  );

  // A longer booking can strand the current start time past closing — when it
  // does, slide the start back to the latest one that still fits.
  useEffect(() => {
    if (!availableStartTimes.includes(startTime) && availableStartTimes.length) {
      setStartTime(availableStartTimes[availableStartTimes.length - 1]);
    }
  }, [availableStartTimes, startTime]);

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
          space: selectedSpace.id,
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
        // 409 = slot taken (show the server's message); 5xx/misconfig = the
        // server's internal wording isn't for customers — show call-us instead.
        setBookError(
          res.status < 500 && data.error
            ? data.error
            : "Online booking is being set up. Please call (678) 519-4723 to reserve your space."
        );
        // Someone beat us to it — repaint the grid so the taken slot greys out.
        if (res.status === 409) void refreshAvailability();
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
              <h2 className="font-display text-3xl font-semibold text-black mb-3">
                {tour ? "Tour Booked" : "Booking Confirmed"}
              </h2>
              <p className="font-sans text-sm text-black/55 leading-relaxed mb-8">
                Thank you, <strong>{name}</strong>. Your{" "}
                {tour ? <>30-minute tour</> : <>reservation for the <strong>{selectedSpace.name}</strong></>}{" "}
                on <strong>{selectedDateStr}</strong> at <strong>{startTime}</strong> is booked and on
                our calendar. A confirmation is on its way to <strong>{email}</strong> — if it
                doesn&apos;t arrive, check your spam folder or call us at (678) 519-4723.
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

          {/*
            * The Google Calendar embed used to sit here. It's gone on purpose —
            * the calendar is staff-facing and showed every space at once, which
            * is the opposite of the per-space picker below. Availability still
            * comes from that same calendar, just through /api/availability.
            */}
          <p className="font-sans text-xs text-black/45 leading-relaxed mb-6">
            We're open {DAYS_LABEL}, {HOURS_LABEL}. Pick a space and a day — times already taken for
            that space are greyed out, and your reservation is re-checked the moment you confirm, so
            nothing gets double-booked.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="grid lg:grid-cols-3 gap-6">

              {/* ── Left: Form Panels ── */}
              <div className="lg:col-span-2 flex flex-col gap-5">

                {/* Space Selection */}
                <div className="bg-white border border-black/10 p-6">
                  <h3 className="font-display text-base font-semibold text-black mb-4">Select a Space</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {SPACES.map((space) => {
                      const price = isMember ? space.memberPrice : space.nonMemberPrice;
                      const isSelected = selectedSpace.id === space.id;
                      const isTourTile = isTour(space);
                      return (
                        <button
                          key={space.id}
                          type="button"
                          onClick={() => {
                            setSelectedSpace(space);
                            setHours(space.fixedHours ?? space.minHours);
                          }}
                          className={`text-left p-3 border transition-all duration-200 ${
                            isSelected ? "border-black bg-black text-white" : "border-black/12 hover:border-black/40 bg-white"
                          }`}
                        >
                          <div className={`font-display text-sm font-semibold leading-tight mb-1.5 ${isSelected ? "text-white" : "text-black"}`}>
                            {space.name}
                          </div>
                          <div className="flex items-baseline gap-0.5">
                            <span className={`font-mono text-base font-medium ${isSelected ? "text-white" : "text-black"}`}>
                              {isTourTile ? "Free" : money(price)}
                            </span>
                            <span className={`font-sans text-[11px] ${isSelected ? "text-white/50" : "text-black/40"}`}>
                              {isTourTile ? ` · ${durationLabel(space.fixedHours ?? 0.5)}` : "/hr"}
                            </span>
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
                          const closed   = isClosed(day);
                          const blocked  = past || closed;
                          const todayCell = isToday(day);
                          const selected = selectedDay === day;
                          return (
                            <button
                              key={idx}
                              type="button"
                              disabled={blocked}
                              title={closed && !past ? `Closed — we're open ${DAYS_LABEL}` : undefined}
                              onClick={() => setSelectedDay(day)}
                              className={`
                                relative aspect-square flex items-center justify-center
                                font-sans text-xs font-medium transition-all duration-100
                                ${blocked ? "text-black/20 cursor-not-allowed" : "cursor-pointer"}
                                ${selected
                                  ? "bg-black text-white"
                                  : blocked ? ""
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
                          Click a weekday to select
                        </p>
                      )}
                      <p className="font-sans text-[10px] text-black/35 mt-1 text-center">
                        {DAYS_LABEL} · {HOURS_LABEL}
                      </p>
                    </div>

                    {/* Time + Duration */}
                    <div className="flex flex-col gap-4">
                      <div>
                        <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-2">
                          Start Time
                          {loadingSlots && (
                            <span className="ml-2 normal-case tracking-normal font-normal text-black/30">
                              checking calendar…
                            </span>
                          )}
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {availableStartTimes.map((t) => {
                            const taken = isSlotTaken(t);
                            return (
                              <button
                                key={t}
                                type="button"
                                disabled={taken}
                                title={taken ? "Already booked" : undefined}
                                onClick={() => setStartTime(t)}
                                className={`py-2 font-sans text-[11px] font-medium border transition-all duration-100 ${
                                  taken
                                    ? "border-black/8 text-black/20 line-through cursor-not-allowed bg-black/[0.02]"
                                    : startTime === t
                                    ? "bg-black text-white border-black"
                                    : "border-black/12 text-black/60 hover:border-black/40 hover:text-black"
                                }`}
                              >
                                {t}
                              </button>
                            );
                          })}
                        </div>
                        {selectedDay && !loadingSlots && availableStartTimes.every(isSlotTaken) && (
                          <p className="font-sans text-[11px] text-black/45 mt-2 leading-relaxed">
                            The {selectedSpace.name} is booked solid for {durationLabel(hours)} that day.
                            {tour ? " Try another date." : " Try a shorter booking or another date."}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-2">
                          Duration
                        </label>
                        {tour ? (
                          // A tour is a fixed 30-minute walkthrough — nothing to choose.
                          <div className="flex items-center justify-center border border-black/15 bg-black/[0.02] h-10">
                            <span className="font-mono text-xl font-medium text-black">
                              {hoursToMinutes(hours)}
                            </span>
                            <span className="font-sans text-xs text-black/40 ml-1">min walkthrough</span>
                          </div>
                        ) : (
                          <div className="flex items-center border border-black/15 bg-white">
                            <button type="button"
                              onClick={() => setHours(Math.max(selectedSpace.minHours, hours - DURATION_STEP_HOURS))}
                              className="w-10 h-10 flex items-center justify-center text-black/40 hover:text-black hover:bg-black/5 transition-colors text-lg">
                              −
                            </button>
                            <div className="flex-1 text-center">
                              <span className="font-mono text-xl font-medium text-black">
                                {hours < 1 ? hoursToMinutes(hours) : hours}
                              </span>
                              <span className="font-sans text-xs text-black/40 ml-1">
                                {hours < 1 ? "min" : `hr${hours > 1 ? "s" : ""}`}
                              </span>
                            </div>
                            <button type="button"
                              onClick={() => setHours(Math.min(spaceMaxHours, hours + DURATION_STEP_HOURS))}
                              className="w-10 h-10 flex items-center justify-center text-black/40 hover:text-black hover:bg-black/5 transition-colors text-lg">
                              +
                            </button>
                          </div>
                        )}
                        <p className="font-sans text-[10px] text-black/35 mt-1.5">
                          {tour
                            ? `Tours run 30 minutes — the last one starts at ${formatMinutes(selectedSpace.lastStartMinutes)}.`
                            : `30-minute blocks, up to ${spaceMaxHours} hours. Last start ${formatMinutes(selectedSpace.lastStartMinutes)} — every rental ends by ${formatMinutes(selectedSpace.latestEndMinutes)}.`}
                        </p>
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
                        { label: tour ? "Visit" : "Space", value: selectedSpace.name },
                        { label: "Date",     value: selectedDay ? selectedDateStr : null },
                        { label: "Time",     value: startTime },
                        { label: "Duration", value: durationLabel(hours) },
                        { label: "Rate",     value: tour ? "Free" : `${money(pricePerHour)}/hr${isMember ? " (member)" : ""}` },
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
                        <span className="font-mono text-2xl font-semibold text-white">{tour ? "Free" : money(subtotal)}</span>
                      </div>
                      {!isMember && memberSavings > 0 && (
                        <div className="bg-white/8 p-3 flex items-start gap-2">
                          <Lock size={10} className="text-white/40 mt-0.5 flex-shrink-0" />
                          <p className="font-sans text-[11px] text-white/50 leading-relaxed">
                            Members pay <strong className="text-white">{money(subtotal - memberSavings)}</strong> — save{" "}
                            <strong className="text-white">{money(memberSavings)}</strong> as a member.
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
                      ? <><span>{tour ? "Book a Tour" : "Confirm Reservation"}</span><ArrowRight size={13} /></>
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
