/*
 * JVO Space Reservation — Full Calendar Booking
 * Large visual calendar to pick a date, then select time slot and duration
 * Member / Non-Member pricing toggle
 * Professional Black / Grey / White design
 */

import { useState, useMemo } from "react";
import {
  Check, ChevronLeft, ChevronRight, ChevronDown,
  Lock, Tag, ArrowRight, User, Calendar
} from "lucide-react";
import { START_TIMES, DEFAULT_START_TIME, MAX_HOURS, isOpenDay } from "@shared/booking";

type SpaceOption = {
  id: string;
  name: string;
  memberPrice: number;
  nonMemberPrice: number;
  unit: string;
  minHours: number;
};

const spaceOptions: SpaceOption[] = [
  { id: "classroom",      name: "Classroom (seats 15)",    memberPrice: 30,  nonMemberPrice: 75,  unit: "/hr", minHours: 1 },
  { id: "conference",     name: "Conference Room (seats 6)", memberPrice: 20, nonMemberPrice: 50, unit: "/hr", minHours: 1 },
  { id: "private-small",  name: "Private Office — Small",  memberPrice: 10,  nonMemberPrice: 25,  unit: "/hr", minHours: 1 },
  { id: "private-large",  name: "Private Office — Large",  memberPrice: 15,  nonMemberPrice: 35,  unit: "/hr", minHours: 1 },
  { id: "content-studio", name: "Content Studio",          memberPrice: 25,  nonMemberPrice: 40,  unit: "/hr", minHours: 1 },
  { id: "corporate-event",name: "Corporate Event Space",   memberPrice: 75,  nonMemberPrice: 150, unit: "/hr", minHours: 2 },
];

// Office hours live in @shared/booking so this and the /booking page can't drift.
const timeSlots = START_TIMES;

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function buildCalendar(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

export default function SpaceReservation() {
  const today = new Date();
  const [isMember, setIsMember]           = useState(false);
  const [selectedSpace, setSelectedSpace] = useState<SpaceOption>(spaceOptions[0]);
  const [hours, setHours]                 = useState(1);
  const [calYear, setCalYear]             = useState(today.getFullYear());
  const [calMonth, setCalMonth]           = useState(today.getMonth());
  const [selectedDay, setSelectedDay]     = useState<number | null>(null);
  const [startTime, setStartTime]         = useState(DEFAULT_START_TIME);
  const [name, setName]                   = useState("");
  const [email, setEmail]                 = useState("");
  const [phone, setPhone]                 = useState("");
  const [notes, setNotes]                 = useState("");
  const [submitted, setSubmitted]         = useState(false);

  const cells = useMemo(() => buildCalendar(calYear, calMonth), [calYear, calMonth]);

  const isToday = (d: number) =>
    d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();

  const isPast = (d: number) => {
    const cell = new Date(calYear, calMonth, d);
    cell.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return cell < t || !isOpenDay(cell.getDay());
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

  const pricePerHour = isMember ? selectedSpace.memberPrice : selectedSpace.nonMemberPrice;
  const subtotal     = pricePerHour * hours;
  const memberSavings = !isMember
    ? (selectedSpace.nonMemberPrice - selectedSpace.memberPrice) * hours
    : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDay) return;
    setSubmitted(true);
  };

  /* ── Success Screen ── */
  if (submitted) {
    return (
      <section id="reserve" className="py-24 md:py-32 bg-[#F5F5F3]">
        <div className="container max-w-2xl">
          <div className="bg-white border border-black/10 p-12 text-center">
            <div className="w-14 h-14 bg-black flex items-center justify-center mx-auto mb-6">
              <Check size={24} className="text-white" />
            </div>
            <h2 className="font-display text-3xl font-semibold text-black mb-3">Request Received</h2>
            <p className="font-sans text-sm text-black/55 leading-relaxed mb-8">
              Thank you, <strong>{name}</strong>. We've received your reservation request for the{" "}
              <strong>{selectedSpace.name}</strong> on <strong>{selectedDateStr}</strong> at{" "}
              <strong>{startTime}</strong>. We'll confirm your booking within 24 hours.
            </p>
            <button
              onClick={() => {
                setSubmitted(false);
                setName(""); setEmail(""); setPhone(""); setNotes("");
                setSelectedDay(null);
              }}
              className="font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-black px-8 py-3 hover:bg-black hover:text-white transition-all duration-200"
            >
              Make Another Reservation
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* ── Main Form ── */
  return (
    <section id="reserve" className="py-24 md:py-32 bg-[#F5F5F3]">
      <div className="container">

        {/* Section Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-px bg-black/30" />
            <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40">Reserve a Space</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <h2 className="font-display text-5xl md:text-6xl font-semibold text-black leading-[0.95]">
                Book Your<br />
                <em className="not-italic text-black/35">Space.</em>
              </h2>
              <p className="font-sans text-sm text-black/50 max-w-sm leading-relaxed mt-4">
                Reserve any JVO space by the hour. Members unlock significantly lower rates.
              </p>
            </div>

            {/* Member Toggle */}
            <div className="flex flex-col gap-2">
              <p className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-black/40">Your Status</p>
              <div className="flex items-center border border-black/15 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsMember(false)}
                  className={`flex items-center gap-2 px-5 py-2.5 font-sans text-[11px] font-semibold tracking-[0.15em] uppercase transition-all duration-200 ${
                    !isMember ? "bg-black text-white" : "bg-white text-black/50 hover:text-black"
                  }`}
                >
                  Non-Member
                </button>
                <button
                  type="button"
                  onClick={() => setIsMember(true)}
                  className={`flex items-center gap-2 px-5 py-2.5 font-sans text-[11px] font-semibold tracking-[0.15em] uppercase transition-all duration-200 ${
                    isMember ? "bg-black text-white" : "bg-white text-black/50 hover:text-black"
                  }`}
                >
                  <User size={12} /> Member
                </button>
              </div>
              {!isMember && (
                <p className="font-sans text-xs text-black/40">
                  <button
                    type="button"
                    onClick={() => document.querySelector("#memberships")?.scrollIntoView({ behavior: "smooth" })}
                    className="underline hover:text-black transition-colors"
                  >
                    Become a member
                  </button>{" "}
                  to unlock lower rates
                </p>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid lg:grid-cols-3 gap-8">

            {/* ── Left Column: Space + Calendar + Time ── */}
            <div className="lg:col-span-2 flex flex-col gap-6">

              {/* Space Selection */}
              <div className="bg-white border border-black/10 p-8">
                <h3 className="font-display text-xl font-semibold text-black mb-6">Select a Space</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {spaceOptions.map((space) => {
                    const price = isMember ? space.memberPrice : space.nonMemberPrice;
                    const isSelected = selectedSpace.id === space.id;
                    return (
                      <button
                        key={space.id}
                        type="button"
                        onClick={() => { setSelectedSpace(space); setHours(space.minHours); }}
                        className={`text-left p-4 border transition-all duration-200 ${
                          isSelected ? "border-black bg-black text-white" : "border-black/15 hover:border-black/40"
                        }`}
                      >
                        <div className={`font-sans text-[10px] font-semibold tracking-[0.18em] uppercase mb-1 ${isSelected ? "text-white/50" : "text-black/40"}`}>
                          Hourly
                        </div>
                        <div className={`font-display text-base font-semibold leading-tight mb-2 ${isSelected ? "text-white" : "text-black"}`}>
                          {space.name}
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className={`font-mono text-xl font-medium ${isSelected ? "text-white" : "text-black"}`}>
                            ${price}
                          </span>
                          <span className={`font-sans text-xs ${isSelected ? "text-white/50" : "text-black/40"}`}>/hr</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Full Calendar */}
              <div className="bg-white border border-black/10 p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Calendar size={16} className="text-black/40" />
                  <h3 className="font-display text-xl font-semibold text-black">Select a Date</h3>
                  {selectedDay && (
                    <span className="ml-auto font-sans text-xs font-semibold tracking-[0.12em] uppercase text-black/50 bg-black/5 px-3 py-1">
                      {selectedDateStr}
                    </span>
                  )}
                </div>

                {/* Month Navigation */}
                <div className="flex items-center justify-between mb-6">
                  <button
                    type="button"
                    onClick={prevMonth}
                    className="w-10 h-10 flex items-center justify-center border border-black/15 hover:border-black hover:bg-black hover:text-white transition-all duration-200"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="font-display text-lg font-semibold text-black tracking-wide">
                    {MONTHS[calMonth]} {calYear}
                  </span>
                  <button
                    type="button"
                    onClick={nextMonth}
                    className="w-10 h-10 flex items-center justify-center border border-black/15 hover:border-black hover:bg-black hover:text-white transition-all duration-200"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>

                {/* Day Headers */}
                <div className="grid grid-cols-7 mb-2">
                  {DAYS.map((d) => (
                    <div key={d} className="text-center font-sans text-[10px] font-semibold tracking-[0.15em] uppercase text-black/35 py-2">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((day, idx) => {
                    if (!day) return <div key={idx} />;
                    const past = isPast(day);
                    const todayCell = isToday(day);
                    const selected = selectedDay === day;
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={past}
                        onClick={() => setSelectedDay(day)}
                        className={`
                          relative aspect-square flex flex-col items-center justify-center
                          font-sans text-sm font-medium transition-all duration-150
                          ${past ? "text-black/20 cursor-not-allowed" : "cursor-pointer"}
                          ${selected
                            ? "bg-black text-white"
                            : past
                            ? ""
                            : todayCell
                            ? "border-2 border-black text-black hover:bg-black hover:text-white"
                            : "text-black hover:bg-black/8"
                          }
                        `}
                      >
                        {day}
                        {todayCell && !selected && (
                          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-black" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {!selectedDay && (
                  <p className="font-sans text-xs text-black/35 mt-4 text-center">
                    Click a date above to select it
                  </p>
                )}
              </div>

              {/* Time & Duration */}
              <div className="bg-white border border-black/10 p-8">
                <h3 className="font-display text-xl font-semibold text-black mb-6">Time &amp; Duration</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Time Slots Grid */}
                  <div>
                    <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-3">
                      Start Time
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {timeSlots.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setStartTime(t)}
                          className={`py-2.5 px-2 font-sans text-xs font-medium border transition-all duration-150 ${
                            startTime === t
                              ? "bg-black text-white border-black"
                              : "border-black/15 text-black/70 hover:border-black/50 hover:text-black"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Duration */}
                  <div>
                    <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-3">
                      Duration
                    </label>
                    <div className="flex items-center border border-black/15 mb-4">
                      <button
                        type="button"
                        onClick={() => setHours(Math.max(selectedSpace.minHours, hours - 1))}
                        className="w-14 h-14 flex items-center justify-center text-black/50 hover:text-black hover:bg-black/5 transition-colors text-xl"
                      >
                        −
                      </button>
                      <div className="flex-1 text-center">
                        <span className="font-mono text-3xl font-medium text-black">{hours}</span>
                        <span className="font-sans text-xs text-black/40 ml-1">hr{hours > 1 ? "s" : ""}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setHours(Math.min(MAX_HOURS, hours + 1))}
                        className="w-14 h-14 flex items-center justify-center text-black/50 hover:text-black hover:bg-black/5 transition-colors text-xl"
                      >
                        +
                      </button>
                    </div>

                    {/* Live Price Preview */}
                    <div className="bg-[#F5F5F3] p-4 border border-black/8">
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="font-sans text-xs text-black/50">
                          ${pricePerHour}/hr × {hours} hr{hours > 1 ? "s" : ""}
                        </span>
                        <span className="font-mono text-xl font-semibold text-black">${subtotal}</span>
                      </div>
                      {isMember ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Tag size={10} className="text-black/40" />
                          <span className="font-sans text-[10px] font-semibold tracking-[0.15em] uppercase text-black/40">
                            Member Rate Applied
                          </span>
                        </div>
                      ) : memberSavings > 0 ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Lock size={10} className="text-black/40" />
                          <span className="font-sans text-[10px] text-black/40">
                            Members save <strong className="text-black">${memberSavings}</strong> on this booking
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="bg-white border border-black/10 p-8">
                <h3 className="font-display text-xl font-semibold text-black mb-6">Your Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-2">Full Name *</label>
                    <input
                      type="text" required value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      className="w-full border border-black/15 px-4 py-3 font-sans text-sm text-black bg-white focus:outline-none focus:border-black transition-colors placeholder:text-black/25"
                    />
                  </div>
                  <div>
                    <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-2">Email *</label>
                    <input
                      type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full border border-black/15 px-4 py-3 font-sans text-sm text-black bg-white focus:outline-none focus:border-black transition-colors placeholder:text-black/25"
                    />
                  </div>
                  <div>
                    <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-2">Phone</label>
                    <input
                      type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                      placeholder="(000) 000-0000"
                      className="w-full border border-black/15 px-4 py-3 font-sans text-sm text-black bg-white focus:outline-none focus:border-black transition-colors placeholder:text-black/25"
                    />
                  </div>
                  <div>
                    <label className="block font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-black/40 mb-2">Notes</label>
                    <input
                      type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="Any special requests?"
                      className="w-full border border-black/15 px-4 py-3 font-sans text-sm text-black bg-white focus:outline-none focus:border-black transition-colors placeholder:text-black/25"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right Column: Summary + Submit ── */}
            <div className="lg:col-span-1">
              <div className="sticky top-28 flex flex-col gap-4">

                {/* Booking Summary */}
                <div className="bg-black text-white p-8">
                  <h3 className="font-display text-lg font-semibold mb-6 pb-4 border-b border-white/10">
                    Booking Summary
                  </h3>
                  <div className="space-y-4 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-white/50 font-sans text-xs uppercase tracking-[0.12em]">Space</span>
                      <span className="font-sans text-xs text-right text-white/90">{selectedSpace.name}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-white/50 font-sans text-xs uppercase tracking-[0.12em]">Date</span>
                      <span className="font-sans text-xs text-right text-white/90">
                        {selectedDay ? selectedDateStr : <span className="text-white/30 italic">Not selected</span>}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-white/50 font-sans text-xs uppercase tracking-[0.12em]">Time</span>
                      <span className="font-sans text-xs text-right text-white/90">{startTime}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-white/50 font-sans text-xs uppercase tracking-[0.12em]">Duration</span>
                      <span className="font-sans text-xs text-right text-white/90">{hours} hr{hours > 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-white/50 font-sans text-xs uppercase tracking-[0.12em]">Rate</span>
                      <span className="font-sans text-xs text-right text-white/90">
                        ${pricePerHour}/hr {isMember && <span className="text-white/40">(member)</span>}
                      </span>
                    </div>
                    <div className="border-t border-white/10 pt-4 flex justify-between items-baseline">
                      <span className="text-white/50 font-sans text-xs uppercase tracking-[0.12em]">Total</span>
                      <span className="font-mono text-2xl font-semibold text-white">${subtotal}</span>
                    </div>
                    {!isMember && memberSavings > 0 && (
                      <div className="bg-white/8 p-3 flex items-start gap-2">
                        <Lock size={11} className="text-white/40 mt-0.5 flex-shrink-0" />
                        <p className="font-sans text-[11px] text-white/50 leading-relaxed">
                          Members pay <strong className="text-white">${subtotal - memberSavings}</strong> — save{" "}
                          <strong className="text-white">${memberSavings}</strong> by becoming a member.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={!selectedDay}
                  className={`w-full flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase py-4 transition-all duration-200 ${
                    selectedDay
                      ? "bg-black text-white hover:bg-black/80 active:scale-[0.98]"
                      : "bg-black/20 text-black/30 cursor-not-allowed"
                  }`}
                >
                  {selectedDay ? (
                    <>Request Reservation <ArrowRight size={13} /></>
                  ) : (
                    <>Select a Date First</>
                  )}
                </button>

                {!isMember && (
                  <button
                    type="button"
                    onClick={() => document.querySelector("#memberships")?.scrollIntoView({ behavior: "smooth" })}
                    className="w-full flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase border border-black/20 py-4 text-black/50 hover:border-black hover:text-black transition-all duration-200"
                  >
                    <Tag size={12} /> Become a Member
                  </button>
                )}
              </div>
            </div>

          </div>
        </form>
      </div>
    </section>
  );
}
