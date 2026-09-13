/*
 * JVO Mailbox Application — /mailbox-application
 * Onboarding questionnaire that fills the applicant's USPS PS Form 1583 in the browser
 * and then hands them on to registration. On "Continue Registration" the form and the
 * uploaded ID / proof-of-address images go to JVO (see lib/fileApplication.ts): Dropbox
 * folder, a row on the client master sheet, and a team email. Uploads are required —
 * see validate() — but never replace inspecting the original documents in person.
 *
 * The applicant never downloads or prints anything — business or residential. JVO holds
 * the filled form and has it ready to sign at the visit. The PDF bytes exist only long
 * enough to be sent to JVO (and kept in memory for a retry).
 *
 * USPS requires TWO documents: (1) a government photo ID and (2) proof of the home
 * address on the form. A driver's/state ID may satisfy only ONE of the two.
 * Signing is witnessed in person by JVO staff; JVO uploads the signed form to USPS.
 */

import { useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, ShieldCheck, IdCard,
  FileText, AlertTriangle, MapPin, Building2, User, ExternalLink, Info,
} from "lucide-react";
import { Link, useSearch } from "wouter";

const DESKWORKS_SIGNUP_URL = "https://jvo.satellitedeskworks.com/member-sign-up";
/** The site's accent gold (same value as the JVO Events tab in the navbar). */
const GOLD = "#c9a96a";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  fill1583, PHOTO_ID_LABELS, ADDRESS_ID_LABELS, CMRA,
  type Form1583Data, type PhotoIdType, type AddressIdType, type ServiceType,
} from "@/lib/fill1583";
import { fileApplicationWithJvo, type DocKind } from "@/lib/fileApplication";
import DocumentUpload from "@/components/DocumentUpload";
import type { PreparedDoc } from "@/lib/imagePrep";

// ---- Local form state -------------------------------------------------------
type Addr = { street: string; city: string; state: string; zip: string };
const emptyAddr = (): Addr => ({ street: "", city: "", state: "", zip: "" });

interface State {
  serviceType: ServiceType | "";
  // applicant
  firstName: string; middleInitial: string; lastName: string;
  phone: string; email: string;
  home: Addr;
  courtProtected: boolean;
  // business
  bizName: string; bizType: string; biz: Addr; bizPlaceReg: string;
  // photo id
  photoIdType: PhotoIdType | ""; photoIdNumber: string; photoIdIssuer: string; photoIdExp: string;
  // scans of the documents themselves — held in memory only, never persisted
  photoIdFront: PreparedDoc[]; photoIdBack: PreparedDoc[];
  // address id
  addressIdType: AddressIdType | ""; addressIdSameAsHome: boolean; addressIdAddr: Addr;
  addressDocs: PreparedDoc[];
  // authorized individual (optional)
  hasAuthorized: boolean;
  authFirst: string; authMiddle: string; authLast: string; authPhone: string; authEmail: string;
  authHome: Addr;
}

const initialState: State = {
  serviceType: "",
  firstName: "", middleInitial: "", lastName: "", phone: "", email: "",
  home: emptyAddr(), courtProtected: false,
  bizName: "", bizType: "", biz: emptyAddr(), bizPlaceReg: "",
  photoIdType: "", photoIdNumber: "", photoIdIssuer: "", photoIdExp: "",
  photoIdFront: [], photoIdBack: [],
  addressIdType: "", addressIdSameAsHome: true, addressIdAddr: emptyAddr(),
  addressDocs: [],
  hasAuthorized: false,
  authFirst: "", authMiddle: "", authLast: "", authPhone: "", authEmail: "",
  authHome: emptyAddr(),
};

/**
 * What the two service types actually mean for the applicant — USPS treats them
 * differently, and picking the wrong one is the most common reason a 1583 has to be
 * redone. Surfaced behind the gold info icon on the service step.
 */
const COMMERCIAL_DETAIL = [
  "Choose Commercial when the mailbox belongs to a business — an LLC, corporation, nonprofit, DBA, or a sole proprietorship trading under its own name.",
  "Mail and packages addressed to the business name are accepted, and JVO becomes the address you can use on your website, invoices, Google listing, and state filings. Form 1583 will also ask for your business address and where the business is registered.",
  "The business name on your application has to match your registration, and you sign as the person authorized to receive its mail.",
];

const RESIDENTIAL_DETAIL = [
  "Choose Residential / Personal when the mailbox is for you as an individual — personal mail and packages, with no business name on the box.",
  "A private street address instead of your home one: useful for deliveries, while you travel, or simply to keep your home address off public records.",
  "USPS only lets us hand over mail for the people named on the form, so every adult who will receive mail at this box files their own Form 1583. Children living at your address are covered by yours.",
];

const PHOTO_ID_OPTIONS = Object.keys(PHOTO_ID_LABELS) as PhotoIdType[];
const ADDRESS_ID_OPTIONS = Object.keys(ADDRESS_ID_LABELS) as AddressIdType[];

// ---- Small styled primitives (match the site's dark aesthetic) --------------
const inputCls =
  "w-full bg-white/[0.04] border border-white/15 px-4 py-3 text-white text-sm placeholder:text-white/25 focus:border-white/45 focus:bg-white/[0.06] outline-none transition-colors";
const labelCls =
  "block font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-white/45 mb-2";

function Field({
  label, value, onChange, placeholder, required, type = "text", maxLength, className = "",
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; type?: string; maxLength?: number; className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelCls}>
        {label} {required && <span className="text-white/25">*</span>}
      </label>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
    </div>
  );
}

function AddressFields({ addr, set }: { addr: Addr; set: (a: Addr) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
      <Field className="sm:col-span-6" label="Street Address (incl. apt/suite)" required
        value={addr.street} onChange={(v) => set({ ...addr, street: v })} placeholder="123 Main St, Apt 4" />
      <Field className="sm:col-span-3" label="City" required
        value={addr.city} onChange={(v) => set({ ...addr, city: v })} placeholder="Atlanta" />
      <Field className="sm:col-span-1" label="State" required maxLength={2}
        value={addr.state} onChange={(v) => set({ ...addr, state: v.toUpperCase() })} placeholder="GA" />
      <Field className="sm:col-span-2" label="ZIP + 4" required
        value={addr.zip} onChange={(v) => set({ ...addr, zip: v })} placeholder="30331" />
    </div>
  );
}

const addrFilled = (a: Addr) => !!(a.street && a.city && a.state && a.zip);

// ---- Steps ------------------------------------------------------------------
type StepId = "intro" | "service" | "applicant" | "business" | "photoId" | "addressId" | "authorized" | "review";

export default function MailboxApplication() {
  const searchParams = new URLSearchParams(useSearch());
  const plan = searchParams.get("plan") || "";

  const [s, setS] = useState<State>(initialState);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [filing, setFiling] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  // Kept so a retry can re-send — and so a business applicant can save a copy —
  // without rebuilding the form.
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);

  const upd = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  // Which steps are active depends on service type / options.
  const steps: StepId[] = [
    "intro", "service", "applicant",
    ...(s.serviceType === "business" ? (["business"] as StepId[]) : []),
    "photoId", "addressId", "authorized", "review",
  ];
  const step = steps[stepIdx];
  const progress = Math.round((stepIdx / (steps.length - 1)) * 100);

  // The core USPS rule: a driver's/state ID can't be BOTH the photo and address ID.
  const licenseUsedTwice = s.photoIdType === "drivers" && s.addressIdType === "drivers";

  function validate(): string | null {
    switch (step) {
      case "service":
        if (!s.serviceType) return "Please choose the type of service.";
        return null;
      case "applicant":
        if (!s.firstName || !s.lastName) return "First and last name are required.";
        if (!s.phone) return "A telephone number is required.";
        if (!s.email || !s.email.includes("@")) return "A valid email address is required.";
        if (!addrFilled(s.home)) return "Your full home address is required.";
        return null;
      case "business":
        if (!s.bizName) return "Business/organization name is required.";
        if (!s.bizType) return "Type of business is required.";
        if (!addrFilled(s.biz)) return "The business street address is required.";
        return null;
      case "photoId":
        if (!s.photoIdType) return "Select the type of photo ID.";
        if (!s.photoIdNumber) return "Enter the ID number.";
        if (!s.photoIdIssuer) return "Enter the issuing entity (e.g. Georgia DDS).";
        if (!s.photoIdExp) return "Enter the ID expiration date.";
        if (!s.photoIdFront.length) return "Upload a photo of the front of your ID.";
        if (!s.photoIdBack.length) return "Upload a photo of the back of your ID.";
        return null;
      case "addressId":
        if (!s.addressIdType) return "Select the document that proves your address.";
        if (licenseUsedTwice)
          return "A driver's/state ID can only count once. Choose a different document (lease, insurance, voter card, etc.) to prove your address.";
        if (!s.addressIdSameAsHome && !addrFilled(s.addressIdAddr))
          return "Enter the address exactly as it appears on your proof-of-address document.";
        if (!s.addressDocs.length) return "Upload a photo or PDF of your proof of address.";
        return null;
      case "authorized":
        if (s.hasAuthorized) {
          if (!s.authFirst || !s.authLast) return "Enter the authorized individual's name.";
          if (!addrFilled(s.authHome)) return "Enter the authorized individual's home address.";
        }
        return null;
      default:
        return null;
    }
  }

  function next() {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function back() {
    setError(null);
    setStepIdx((i) => Math.max(i - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toFormData(): Form1583Data {
    return {
      serviceType: s.serviceType as ServiceType,
      applicant: { first: s.firstName, middle: s.middleInitial, last: s.lastName },
      phone: s.phone,
      email: s.email,
      homeAddress: { ...s.home, country: "USA" },
      courtProtected: s.courtProtected,
      photoId: {
        type: s.photoIdType as PhotoIdType,
        number: s.photoIdNumber,
        issuingEntity: s.photoIdIssuer,
        expiration: s.photoIdExp,
      },
      addressIdType: s.addressIdType as AddressIdType,
      addressIdAddress: s.addressIdSameAsHome ? undefined : { ...s.addressIdAddr, country: "USA" },
      business:
        s.serviceType === "business"
          ? {
              name: s.bizName, type: s.bizType,
              address: { ...s.biz, country: "USA" },
              placeOfRegistration: s.bizPlaceReg,
            }
          : undefined,
      authorized: s.hasAuthorized
        ? {
            name: { first: s.authFirst, middle: s.authMiddle, last: s.authLast },
            phone: s.authPhone, email: s.authEmail,
            homeAddress: { ...s.authHome, country: "USA" },
          }
        : undefined,
    };
  }

  /** Everything the applicant uploaded, tagged for the Dropbox filename. */
  const documents: { kind: DocKind; doc: PreparedDoc }[] = [
    ...s.photoIdFront.map((doc) => ({ kind: "photo-id-front" as DocKind, doc })),
    ...s.photoIdBack.map((doc) => ({ kind: "photo-id-back" as DocKind, doc })),
    ...s.addressDocs.map((doc) => ({ kind: "address-proof" as DocKind, doc })),
  ];
  const docsComplete = s.photoIdFront.length > 0 && s.photoIdBack.length > 0 && s.addressDocs.length > 0;

  /** Send the form + uploads to JVO. Split out so retry doesn't regenerate the PDF. */
  async function sendToJvo(bytes: Uint8Array) {
    setFiling("sending");
    try {
      await fileApplicationWithJvo(
        {
          serviceType: s.serviceType || "residential",
          firstName: s.firstName,
          lastName: s.lastName,
          businessName: s.serviceType === "business" ? s.bizName : undefined,
          businessType: s.serviceType === "business" ? s.bizType : undefined,
          phone: s.phone,
          email: s.email,
          homeAddress: `${s.home.street}, ${s.home.city}, ${s.home.state} ${s.home.zip}`,
          photoIdLabel: s.photoIdType ? PHOTO_ID_LABELS[s.photoIdType] : undefined,
          addressIdLabel: s.addressIdType ? ADDRESS_ID_LABELS[s.addressIdType] : undefined,
          courtProtected: s.courtProtected,
        },
        bytes,
        documents,
        plan
      );
      setFiling("sent");
    } catch (e) {
      // Not surfaced as a form error — they still have the PDF and the visit works.
      console.error("Could not file the application with JVO:", e);
      setFiling("failed");
    }
  }

  /**
   * Build the 1583 and file it with JVO, then hand them on to registration.
   *
   * Nothing is downloaded, by anyone. The applicant's next step is finishing
   * registration, not managing a PDF: JVO has the form in Dropbox and prints it for
   * the in-office visit.
   */
  async function handleContinue() {
    setSubmitting(true);
    setError(null);
    let bytes: Uint8Array;
    try {
      bytes = await fill1583(toFormData());
      setPdfBytes(bytes);
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare your form. Please try again.");
      return;
    } finally {
      setSubmitting(false);
    }

    await sendToJvo(bytes);
  }

  /**
   * Jump back to a step from the review summary.
   *
   * Returns undefined once the application has been filed: at that point the
   * Continue button is gone, so an edit would change the form on screen without
   * ever reaching JVO — a corrected name that silently doesn't get corrected.
   * After filing, corrections go through the office (see the note on screen).
   */
  function editStep(id: StepId): (() => void) | undefined {
    if (submitted) return undefined;
    return () => {
      setError(null);
      setStepIdx(steps.indexOf(id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col">
      <Navbar />

      <main className="flex-1 container max-w-2xl py-14 md:py-20">
        {/* Header */}
        <div className="mb-10">
          <Link
            href="/#memberships"
            className="inline-flex items-center gap-2 font-sans text-[11px] font-medium tracking-[0.18em] uppercase text-white/40 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft size={13} /> Back
          </Link>
          <p className="font-sans text-[10px] font-semibold tracking-[0.3em] uppercase text-white/30 mb-3">
            {plan ? `${plan} Plan · Step 1 of 2` : "New Member Onboarding"}
          </p>
          <h1 className="font-display text-3xl md:text-4xl font-semibold text-white leading-[1.02]">
            Mailbox Application
          </h1>
          <p className="font-sans text-sm text-white/45 mt-3 leading-relaxed">
            Every JVO membership includes a mailbox, so we start by preparing your USPS Form 1583 — the
            form that authorizes JVO to receive mail on your behalf. Then you'll continue to registration.
            You'll also upload photos of your ID and proof of address. Everything stays on your device
            until you continue — then it goes to JVO so we can prep your mailbox and have your form
            ready to sign before your visit. You still bring the original documents with you.
          </p>
        </div>

        {/* Progress */}
        {step !== "intro" && (
          <div className="mb-10">
            <div className="h-[3px] bg-white/10 w-full">
              <div className="h-full bg-white transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="font-sans text-[10px] tracking-[0.18em] uppercase text-white/30 mt-2">
              Step {stepIdx} of {steps.length - 1}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/10 px-4 py-3 mb-6">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="font-sans text-sm text-amber-200/90 leading-relaxed">{error}</p>
          </div>
        )}

        {/* ---- STEP: INTRO ---- */}
        {step === "intro" && (
          <div className="space-y-8">
            <div className="border border-white/12 bg-white/[0.03] p-6 md:p-7">
              <div className="flex items-center gap-3 mb-4">
                <IdCard size={18} className="text-white/60" />
                <h2 className="font-display text-lg font-semibold text-white">Before you start — you'll need two IDs</h2>
              </div>
              <p className="font-sans text-sm text-white/50 leading-relaxed mb-5">
                USPS requires <span className="text-white/80">two documents</span> to open your mailbox.
                You'll show these in person when you sign — you don't upload them here.
              </p>
              <div className="space-y-4">
                <IdCallout
                  n={1} title="A government photo ID"
                  body="U.S. driver's/state ID, passport, military ID, permanent resident card, university ID, and similar. Must be U.S.-issued (a passport is fine)."
                />
                <IdCallout
                  n={2} title="Proof of your home address"
                  body="A current lease, home/vehicle insurance policy, mortgage or deed, vehicle registration, or voter card — showing the SAME home address you enter on this form."
                />
              </div>
              <div className="flex items-start gap-3 mt-5 pt-5 border-t border-white/10">
                <AlertTriangle size={15} className="text-amber-400/80 flex-shrink-0 mt-0.5" />
                <p className="font-sans text-xs text-white/45 leading-relaxed">
                  Your driver's license can cover <span className="text-white/70">only one</span> of the two.
                  If it's your photo ID, you'll still need a second document (lease, insurance, etc.) to prove your address.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 border border-white/12 bg-white/[0.03] px-5 py-4">
              <ShieldCheck size={16} className="text-white/50 flex-shrink-0 mt-0.5" />
              <p className="font-sans text-xs text-white/45 leading-relaxed">
                <span className="text-white/70 font-medium">Your privacy:</span> this questionnaire runs
                entirely in your browser. Your answers fill the PDF on your own device, and nothing leaves
                it until you continue to registration at the end — at which point your form and documents
                go to JVO alone.
              </p>
            </div>

            <button onClick={next} className={btnPrimary}>
              Start Application <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* ---- STEP: SERVICE TYPE ---- */}
        {step === "service" && (
          <StepShell title="How will you use this mailbox?" icon={<FileText size={18} />}>
            <div className="grid grid-cols-1 gap-4">
              <ChoiceCard
                selected={s.serviceType === "business"}
                onClick={() => upd({ serviceType: "business" })}
                icon={<Building2 size={18} />}
                title="Business / Organization (Commercial)"
                body="For an LLC, corporation, nonprofit, or any registered business receiving mail."
                detailTitle="What Commercial means"
                detail={COMMERCIAL_DETAIL}
              />
              <ChoiceCard
                selected={s.serviceType === "residential"}
                onClick={() => upd({ serviceType: "residential" })}
                icon={<User size={18} />}
                title="Residential / Personal"
                body="For personal mail. Note: each adult using the mailbox files a separate form."
                detailTitle="What Residential means"
                detail={RESIDENTIAL_DETAIL}
              />
            </div>
            <p className="font-sans text-xs text-white/35 leading-relaxed mt-4">
              Not sure which fits? Tap the{" "}
              <Info size={12} className="inline -mt-0.5" style={{ color: GOLD }} /> beside either option
              for a fuller explanation. You can change this later with <span className="text-white/55">Edit</span> on the review screen.
            </p>
          </StepShell>
        )}

        {/* ---- STEP: APPLICANT ---- */}
        {step === "applicant" && (
          <StepShell title="Your information" icon={<User size={18} />}>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <Field className="sm:col-span-3" label="First Name" required value={s.firstName} onChange={(v) => upd({ firstName: v })} />
              <Field className="sm:col-span-1" label="M.I." maxLength={1} value={s.middleInitial} onChange={(v) => upd({ middleInitial: v })} />
              <Field className="sm:col-span-2" label="Last Name" required value={s.lastName} onChange={(v) => upd({ lastName: v })} />
              <Field className="sm:col-span-3" label="Telephone" required type="tel" value={s.phone} onChange={(v) => upd({ phone: v })} placeholder="(678) 555-0100" />
              <Field className="sm:col-span-3" label="Email" required type="email" value={s.email} onChange={(v) => upd({ email: v })} placeholder="you@email.com" />
            </div>
            <div className="mt-6">
              <p className={labelCls}>Home Address (must match your proof-of-address document)</p>
              <AddressFields addr={s.home} set={(a) => upd({ home: a })} />
            </div>
            <CheckboxRow
              checked={s.courtProtected}
              onChange={(v) => upd({ courtProtected: v })}
              label="I am a court-ordered protected individual"
              hint="If checked, you must attach a copy of the court order at your visit."
            />
          </StepShell>
        )}

        {/* ---- STEP: BUSINESS ---- */}
        {step === "business" && (
          <StepShell title="Business / organization details" icon={<Building2 size={18} />}>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <Field className="sm:col-span-4" label="Business / Organization Name" required value={s.bizName} onChange={(v) => upd({ bizName: v })} />
              <Field className="sm:col-span-2" label="Type of Business" required value={s.bizType} onChange={(v) => upd({ bizType: v })} placeholder="e.g. Consulting" />
            </div>
            <div className="mt-6">
              <p className={labelCls}>Business Street Address</p>
              <AddressFields addr={s.biz} set={(a) => upd({ biz: a })} />
            </div>
            <Field className="mt-6" label="Place of Registration (county & state)" value={s.bizPlaceReg} onChange={(v) => upd({ bizPlaceReg: v })} placeholder="Clayton County, GA" />
          </StepShell>
        )}

        {/* ---- STEP: PHOTO ID ---- */}
        {step === "photoId" && (
          <StepShell title="Your government photo ID" icon={<IdCard size={18} />}>
            <p className={labelCls}>Photo ID Type</p>
            <div className="grid grid-cols-1 gap-2 mb-6">
              {PHOTO_ID_OPTIONS.map((k) => (
                <RadioRow key={k} selected={s.photoIdType === k} onClick={() => upd({ photoIdType: k })} label={PHOTO_ID_LABELS[k]} />
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <Field className="sm:col-span-3" label="ID Number" required value={s.photoIdNumber} onChange={(v) => upd({ photoIdNumber: v })} />
              <Field className="sm:col-span-3" label="Issuing Entity" required value={s.photoIdIssuer} onChange={(v) => upd({ photoIdIssuer: v })} placeholder="e.g. Georgia DDS, U.S. Dept of State" />
              <Field className="sm:col-span-3" label="Expiration Date" required value={s.photoIdExp} onChange={(v) => upd({ photoIdExp: v })} placeholder="MM/DD/YYYY" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-8 pt-8 border-t border-white/10">
              <DocumentUpload
                label="Front of ID"
                hint="A clear, flat photo — all four corners visible and nothing cut off."
                docs={s.photoIdFront}
                onChange={(d) => upd({ photoIdFront: d })}
              />
              <DocumentUpload
                label="Back of ID"
                hint="Required even if it looks blank — your address is often printed here."
                docs={s.photoIdBack}
                onChange={(d) => upd({ photoIdBack: d })}
              />
            </div>
          </StepShell>
        )}

        {/* ---- STEP: ADDRESS ID ---- */}
        {step === "addressId" && (
          <StepShell title="Proof of your home address" icon={<MapPin size={18} />}>
            <p className="font-sans text-sm text-white/45 leading-relaxed mb-5">
              Choose the document you'll bring that proves the home address you entered. It must show that
              exact address.
            </p>
            <div className="grid grid-cols-1 gap-2 mb-2">
              {ADDRESS_ID_OPTIONS.map((k) => {
                const disabled = k === "drivers" && s.photoIdType === "drivers";
                return (
                  <RadioRow
                    key={k}
                    selected={s.addressIdType === k}
                    disabled={disabled}
                    onClick={() => !disabled && upd({ addressIdType: k })}
                    label={ADDRESS_ID_LABELS[k]}
                    note={disabled ? "Already used as your photo ID" : undefined}
                  />
                );
              })}
            </div>
            {s.photoIdType === "drivers" && (
              <p className="font-sans text-xs text-amber-200/70 leading-relaxed mb-6 mt-1">
                You're using your driver's/state ID as your photo ID, so it can't also prove your address —
                pick another document above.
              </p>
            )}
            <CheckboxRow
              checked={!s.addressIdSameAsHome}
              onChange={(v) => upd({ addressIdSameAsHome: !v })}
              label="The address on this document is different from my home address above"
            />
            {!s.addressIdSameAsHome && (
              <div className="mt-4">
                <p className={labelCls}>Address exactly as shown on the document</p>
                <AddressFields addr={s.addressIdAddr} set={(a) => upd({ addressIdAddr: a })} />
              </div>
            )}
            <div className="mt-8 pt-8 border-t border-white/10">
              <DocumentUpload
                label="Upload your proof of address"
                hint="Photo or PDF. Add more than one file if the document runs several pages — the address must be readable."
                docs={s.addressDocs}
                onChange={(d) => upd({ addressDocs: d })}
                multiple
              />
            </div>
          </StepShell>
        )}

        {/* ---- STEP: AUTHORIZED ---- */}
        {step === "authorized" && (
          <StepShell title="Authorized individual (optional)" icon={<User size={18} />}>
            <p className="font-sans text-sm text-white/45 leading-relaxed mb-5">
              Add someone else who is allowed to pick up mail for this mailbox. You can skip this.
            </p>
            <CheckboxRow
              checked={s.hasAuthorized}
              onChange={(v) => upd({ hasAuthorized: v })}
              label="Add an authorized individual"
            />
            {s.hasAuthorized && (
              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                  <Field className="sm:col-span-3" label="First Name" required value={s.authFirst} onChange={(v) => upd({ authFirst: v })} />
                  <Field className="sm:col-span-1" label="M.I." maxLength={1} value={s.authMiddle} onChange={(v) => upd({ authMiddle: v })} />
                  <Field className="sm:col-span-2" label="Last Name" required value={s.authLast} onChange={(v) => upd({ authLast: v })} />
                  <Field className="sm:col-span-3" label="Telephone" type="tel" value={s.authPhone} onChange={(v) => upd({ authPhone: v })} />
                  <Field className="sm:col-span-3" label="Email" type="email" value={s.authEmail} onChange={(v) => upd({ authEmail: v })} />
                </div>
                <div>
                  <p className={labelCls}>Home Address</p>
                  <AddressFields addr={s.authHome} set={(a) => upd({ authHome: a })} />
                </div>
                <p className="font-sans text-xs text-white/40 leading-relaxed">
                  The authorized individual must also bring two forms of ID (photo + address) to present at the office.
                </p>
              </div>
            )}
          </StepShell>
        )}

        {/* ---- STEP: REVIEW ---- */}
        {step === "review" && (
          <div className="space-y-8">
            <div>
              <h2 className="font-display text-xl font-semibold text-white mb-1">Review &amp; continue</h2>
              <p className="font-sans text-sm text-white/45 leading-relaxed">
                Check the summary, then continue to registration. Your PS Form 1583 and uploaded
                documents go to JVO as you continue — we print the form and have it ready for you to
                sign at your in-office visit. Bring your two original IDs.
              </p>
            </div>

            <div className="border border-white/12 divide-y divide-white/10">
              <SummaryRow label="Service" value={s.serviceType === "business" ? "Business / Organization" : "Residential / Personal"} onEdit={editStep("service")} />
              <SummaryRow label="Applicant" value={[s.firstName, s.middleInitial, s.lastName].filter(Boolean).join(" ")} onEdit={editStep("applicant")} />
              <SummaryRow label="Contact" value={`${s.phone} · ${s.email}`} onEdit={editStep("applicant")} />
              <SummaryRow label="Home address" value={`${s.home.street}, ${s.home.city}, ${s.home.state} ${s.home.zip}`} onEdit={editStep("applicant")} />
              {s.serviceType === "business" && (
                <SummaryRow label="Business" value={`${s.bizName} (${s.bizType})`} onEdit={editStep("business")} />
              )}
              <SummaryRow label="Photo ID" value={s.photoIdType ? PHOTO_ID_LABELS[s.photoIdType] : "—"} onEdit={editStep("photoId")} />
              <SummaryRow label="Address proof" value={s.addressIdType ? ADDRESS_ID_LABELS[s.addressIdType] : "—"} onEdit={editStep("addressId")} />
              <SummaryRow
                label="Uploads"
                value={[
                  s.photoIdFront.length ? "ID front" : null,
                  s.photoIdBack.length ? "ID back" : null,
                  s.addressDocs.length ? `${s.addressDocs.length} address ${s.addressDocs.length === 1 ? "file" : "files"}` : null,
                ].filter(Boolean).join(" · ") || "None yet"}
                onEdit={editStep("photoId")}
              />
              {s.hasAuthorized && (
                <SummaryRow label="Authorized" value={[s.authFirst, s.authLast].filter(Boolean).join(" ")} onEdit={editStep("authorized")} />
              )}
              <SummaryRow
                label="Delivery address (JVO)"
                value={`${CMRA.streetDisplay}, ${CMRA.city}, ${CMRA.state} ${CMRA.zip} — suite # assigned at setup`}
              />
            </div>

            {!submitted ? (
              <div>
                <button onClick={handleContinue} disabled={submitting || !docsComplete} className={btnPrimary}>
                  {submitting ? "Submitting…" : (<>Continue Registration <ArrowRight size={14} /></>)}
                </button>
                {!docsComplete && (
                  <p className="font-sans text-xs text-amber-200/70 mt-3 leading-relaxed">
                    Add photos of both sides of your ID and your proof of address before continuing.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-start gap-3 border border-emerald-500/30 bg-emerald-500/10 px-5 py-4">
                  <Check size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-sans text-sm text-emerald-200/90 font-medium">
                      Your mailbox application is complete.
                    </p>
                    <p className="font-sans text-xs text-emerald-200/60 mt-1 leading-relaxed">
                      Your Form 1583 is filled in and waiting at the office — don't sign anything yet,
                      you'll sign it in front of JVO staff at your visit.
                    </p>
                    {filing === "sending" && (
                      <p className="font-sans text-xs text-emerald-200/60 mt-2">
                        Sending your form and documents to JVO…
                      </p>
                    )}
                    {filing === "sent" && (
                      <p className="font-sans text-xs text-emerald-200/60 mt-2">
                        JVO has your application and your uploaded documents on file, and will have
                        everything ready for your visit. Next step is below.
                      </p>
                    )}
                    {filing === "failed" && (
                      <div className="mt-2">
                        <p className="font-sans text-xs text-amber-200/70 leading-relaxed">
                          Your form and documents didn't reach JVO. Please retry — if it still won't go
                          through, continue to registration anyway and bring your IDs to your visit; we'll
                          fill the form with you at the office.
                        </p>
                        <button
                          onClick={() => pdfBytes && sendToJvo(pdfBytes)}
                          className="font-sans text-[11px] font-semibold tracking-[0.18em] uppercase text-amber-200/90 hover:text-white transition-colors mt-2"
                        >
                          Retry sending
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-white/12 bg-white/[0.03] p-6">
                  <h3 className="font-display text-base font-semibold text-white mb-4">Bring to your in-office visit</h3>
                  <ul className="space-y-3">
                    <BringItem>Photo ID — {s.photoIdType ? PHOTO_ID_LABELS[s.photoIdType] : "government photo ID"}</BringItem>
                    <BringItem>Address proof — {s.addressIdType ? ADDRESS_ID_LABELS[s.addressIdType] : "proof of address"}</BringItem>
                    {s.courtProtected && <BringItem>A copy of your court protection order</BringItem>}
                    <BringItem>
                      Nothing to print — we have your Form 1583 ready at the office for you to sign
                    </BringItem>
                  </ul>
                  <div className="flex items-start gap-3 mt-5 pt-5 border-t border-white/10">
                    <MapPin size={15} className="text-white/50 flex-shrink-0 mt-0.5" />
                    <p className="font-sans text-sm text-white/45 leading-relaxed">
                      <span className="text-white/70 font-medium">{CMRA.streetDisplay}, {CMRA.city}, {CMRA.state} {CMRA.zip}</span>
                      <br />Staff will fill in your suite number and witness your signature, then file the
                      form with USPS.
                    </p>
                  </div>
                </div>

                {/* Step 2 — the next step, and the only thing left for them to do */}
                <div className="border p-6" style={{ borderColor: `${GOLD}45`, background: `${GOLD}0D` }}>
                  <p
                    className="font-sans text-[10px] font-semibold tracking-[0.3em] uppercase mb-2"
                    style={{ color: GOLD }}
                  >
                    {plan ? `${plan} Plan · Step 2 of 2` : "Step 2 of 2"}
                  </p>
                  <h3 className="font-display text-base font-semibold text-white mb-2">
                    Next step — complete your registration
                  </h3>
                  <p className="font-sans text-sm text-white/50 leading-relaxed mb-5">
                    One step left: finish setting up your {plan ? `${plan} ` : ""}membership in our secure
                    registration portal, where you'll choose your start date and set up billing. Then come
                    in with your two IDs and we'll sign your Form 1583 together.
                  </p>
                  <a
                    href={DESKWORKS_SIGNUP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={btnPrimary}
                  >
                    Continue Registration <ExternalLink size={13} />
                  </a>
                </div>

                {/*
                  The summary above loses its Edit links once this is filed, so say
                  plainly how a mistake gets fixed — a wrong name on a USPS form is
                  worth a phone call.
                */}
                <p className="font-sans text-xs text-white/35 leading-relaxed">
                  Spotted something wrong above? Call{" "}
                  <a href="tel:+16785194723" className="text-white/60 hover:text-white transition-colors">678-519-4723</a>{" "}
                  or email{" "}
                  <a href="mailto:jonesborovirtualoffice@gmail.com" className="text-white/60 hover:text-white transition-colors">
                    jonesborovirtualoffice@gmail.com
                  </a>{" "}
                  and we'll correct your form before your visit — nothing is filed with USPS until you sign it in person.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Nav buttons */}
        {step !== "intro" && step !== "review" && (
          <div className="flex items-center justify-between mt-10">
            <button onClick={back} className={btnGhost}><ArrowLeft size={13} /> Back</button>
            <button onClick={next} className={btnPrimary}>Continue <ArrowRight size={14} /></button>
          </div>
        )}
        {step === "review" && !submitted && (
          <div className="mt-8">
            <button onClick={back} className={btnGhost}><ArrowLeft size={13} /> Back</button>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

// ---- Presentational helpers -------------------------------------------------
const btnPrimary =
  "inline-flex items-center justify-center gap-2 font-sans text-xs font-semibold tracking-[0.18em] uppercase bg-white text-black px-7 py-3.5 hover:bg-white/90 disabled:opacity-50 transition-all";
const btnGhost =
  "inline-flex items-center gap-2 font-sans text-[11px] font-semibold tracking-[0.18em] uppercase text-white/50 hover:text-white transition-colors";

function StepShell({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <span className="text-white/60">{icon}</span>
        <h2 className="font-display text-xl font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function IdCallout({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="flex-shrink-0 w-7 h-7 border border-white/20 flex items-center justify-center font-display text-sm text-white/70">{n}</span>
      <div>
        <p className="font-sans text-sm font-medium text-white/85">{title}</p>
        <p className="font-sans text-xs text-white/45 leading-relaxed mt-1">{body}</p>
      </div>
    </div>
  );
}

/**
 * A service-type option. The gold info button is a SIBLING of the select button,
 * never nested inside it — a button within a button is invalid markup, and tapping
 * "what does this mean?" must not silently pick the option you were asking about.
 */
function ChoiceCard({ selected, onClick, icon, title, body, detail, detailTitle }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; body: string;
  detail?: string[]; detailTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`relative border transition-all ${
        selected ? "border-white bg-white/[0.07]" : "border-white/15 bg-white/[0.02] hover:border-white/35"
      }`}
    >
      <button
        onClick={onClick}
        className={`w-full text-left flex items-start gap-4 px-5 py-4 ${detail ? "pr-20" : "pr-12"}`}
      >
        <span className={selected ? "text-white" : "text-white/50"}>{icon}</span>
        <div>
          <p className="font-sans text-sm font-semibold text-white">{title}</p>
          <p className="font-sans text-xs text-white/45 leading-relaxed mt-1">{body}</p>
        </div>
      </button>

      {selected && (
        <Check size={16} className={`text-white absolute top-5 ${detail ? "right-14" : "right-5"}`} />
      )}

      {detail && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={detailTitle || `More about ${title}`}
          title={detailTitle || `More about ${title}`}
          className="absolute top-4 right-4 p-1 hover:opacity-70 transition-opacity"
          style={{ color: GOLD }}
        >
          <Info size={17} />
        </button>
      )}

      {detail && open && (
        <div
          className="px-5 py-4 border-t"
          style={{ borderColor: `${GOLD}40`, background: `${GOLD}0F` }}
        >
          <p
            className="font-sans text-[10px] font-semibold tracking-[0.2em] uppercase mb-2"
            style={{ color: GOLD }}
          >
            {detailTitle || "What this means"}
          </p>
          {detail.map((para, i) => (
            <p key={i} className="font-sans text-xs text-white/60 leading-relaxed mb-2 last:mb-0">
              {para}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RadioRow({ selected, onClick, label, note, disabled }: {
  selected: boolean; onClick: () => void; label: string; note?: string; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left flex items-center gap-3 border px-4 py-3 transition-all ${
        disabled ? "border-white/8 opacity-40 cursor-not-allowed"
          : selected ? "border-white bg-white/[0.06]" : "border-white/15 hover:border-white/35"
      }`}
    >
      <span className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center ${selected ? "border-white" : "border-white/30"}`}>
        {selected && <span className="w-2 h-2 rounded-full bg-white" />}
      </span>
      <span className="font-sans text-sm text-white/80">{label}</span>
      {note && <span className="font-sans text-[10px] tracking-wide uppercase text-white/30 ml-auto">{note}</span>}
    </button>
  );
}

function CheckboxRow({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <label className="flex items-start gap-3 mt-6 cursor-pointer">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-5 h-5 border flex-shrink-0 flex items-center justify-center mt-0.5 transition-colors ${checked ? "bg-white border-white" : "border-white/30 hover:border-white/50"}`}
      >
        {checked && <Check size={13} className="text-black" />}
      </button>
      <span>
        <span className="font-sans text-sm text-white/75">{label}</span>
        {hint && <span className="block font-sans text-xs text-white/35 mt-0.5 leading-relaxed">{hint}</span>}
      </span>
    </label>
  );
}

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <span className="font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-white/35 w-40 flex-shrink-0">{label}</span>
      <span className="font-sans text-sm text-white/75 flex-1 truncate">{value || "—"}</span>
      {onEdit && (
        <button onClick={onEdit} className="font-sans text-[10px] font-semibold tracking-[0.15em] uppercase text-white/40 hover:text-white transition-colors flex-shrink-0">Edit</button>
      )}
    </div>
  );
}

function BringItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <Check size={15} className="text-white/50 flex-shrink-0 mt-0.5" />
      <span className="font-sans text-sm text-white/60 leading-relaxed">{children}</span>
    </li>
  );
}
