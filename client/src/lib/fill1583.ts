/*
 * fill1583.ts — Client-side generator for USPS PS Form 1583 (June 2024 edition).
 *
 * The official blank form has NO fillable AcroForm fields, so we overlay text and
 * check marks at coordinates measured directly from the PDF (US Letter, 612x792pt).
 * All coordinates below are in pdfplumber "top" units (distance from the TOP of the
 * page); we convert to pdf-lib's bottom-left origin at draw time. Nothing is sent to
 * a server — the filled PDF is produced entirely in the browser.
 *
 * The applicant still signs in the physical presence of JVO staff (item 13a) and JVO
 * completes/witnesses items 2 and 14 and uploads the signed form to USPS. This tool
 * only pre-populates the customer-supplied fields.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_H = 792;
const BLANK_PDF_URL = "/forms/ps1583.pdf";

// JVO is the CMRA (agent). These are prefilled into Section 2 for the customer.
export const CMRA = {
  street: "127 Jonesboro Rd, Suite 100",
  city: "Jonesboro",
  state: "GA",
  zip: "30236",
} as const;

export type ServiceType = "business" | "residential";

export type PhotoIdType =
  | "drivers"
  | "uniformed"
  | "passport"
  | "naturalization"
  | "access"
  | "matricula"
  | "permanent_resident"
  | "university"
  | "nexus";

export type AddressIdType =
  | "drivers"
  | "lease"
  | "insurance"
  | "mortgage"
  | "vehicle_registration"
  | "voter";

export interface PersonName {
  last: string;
  first: string;
  middle?: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface Form1583Data {
  serviceType: ServiceType;

  // Applicant (item 4)
  applicant: PersonName;
  phone: string;
  email: string;
  homeAddress: Address;
  courtProtected: boolean;

  // Photo ID (item 8) + Address ID (item 9) for the applicant
  photoId: { type: PhotoIdType; number: string; issuingEntity: string; expiration: string };
  addressIdType: AddressIdType;
  // Address on the address-verification doc; defaults to homeAddress if omitted
  addressIdAddress?: Address;

  // Business (item 7) — required when serviceType === "business"
  business?: {
    name: string;
    type: string;
    address: Address;
    phone?: string;
    placeOfRegistration?: string;
  };

  // Authorized individual (items 5, 10, 11) — optional
  authorized?: {
    name: PersonName;
    phone?: string;
    email?: string;
    homeAddress: Address;
    photoId?: { type: PhotoIdType; number: string; issuingEntity: string; expiration: string };
    addressIdType?: AddressIdType;
    addressIdAddress?: Address;
  };

  // Mail transfer (item 6) — optional
  transfer?: { address: Address; phone?: string; email?: string };
}

// ---- Coordinate map ---------------------------------------------------------
// Each text field: label's top-Y and the cell's left/right x-bounds.
type Cell = { top: number; x: number; w: number };
const cell = (top: number, x: number, right: number): Cell => ({ top, x, w: right - x });

const F = {
  // Section 2 — CMRA (prefilled)
  cmraStreet: cell(111, 22, 234),
  cmraCity: cell(143, 22, 162),
  cmraState: cell(143, 162, 216),
  cmraZip: cell(143, 216, 306),

  // Section 4 — Applicant
  appLast: cell(214, 22, 113),
  appFirst: cell(214, 113, 211),
  appMiddle: cell(214, 213, 306),
  appPhone: cell(246, 22, 162),
  appEmail: cell(246, 162, 306),
  appStreet: cell(278, 22, 306),
  appCity: cell(310, 22, 162),
  appState: cell(310, 162, 207),
  appZip: cell(310, 207, 256),
  appCountry: cell(310, 256, 306),

  // Section 5 — Authorized individual
  authLast: cell(377, 22, 113),
  authFirst: cell(377, 113, 211),
  authMiddle: cell(377, 213, 306),
  authPhone: cell(409, 22, 162),
  authEmail: cell(409, 162, 306),
  authStreet: cell(441, 22, 306),
  authCity: cell(472, 22, 162),
  authState: cell(472, 162, 207),
  authZip: cell(472, 207, 256),
  authCountry: cell(472, 256, 306),

  // Section 6 — Transfer
  xferStreet: cell(516, 22, 306),
  xferCity: cell(547, 22, 162),
  xferState: cell(547, 162, 208),
  xferZip: cell(547, 208, 256),
  xferCountry: cell(547, 256, 306),
  xferPhone: cell(579, 22, 162),
  xferEmail: cell(579, 162, 306),

  // Section 7 — Business
  bizName: cell(623, 22, 198),
  bizType: cell(623, 198, 306),
  bizStreet: cell(657, 22, 306),
  bizCity: cell(688, 22, 162),
  bizState: cell(688, 162, 207),
  bizZip: cell(688, 207, 256),
  bizCountry: cell(688, 256, 306),
  bizPhone: cell(720, 22, 162),
  bizPlaceReg: cell(720, 162, 306),

  // Section 8 — Applicant photo ID
  pidName: cell(68, 306, 450),
  pidNumber: cell(68, 450, 612),
  pidIssuer: cell(99, 306, 450),
  pidExpiration: cell(99, 450, 612),

  // Section 9 — Applicant address ID (9a label sits below the "9." header row)
  aidName: cell(216, 306, 612),
  aidStreet: cell(246, 306, 612),
  aidCity: cell(278, 306, 450),
  aidState: cell(278, 450, 495),
  aidZip: cell(278, 495, 544),
  aidCountry: cell(278, 544, 612),

  // Section 10 — Authorized photo ID
  authPidName: cell(377, 306, 450),
  authPidNumber: cell(377, 450, 612),
  authPidIssuer: cell(409, 306, 450),
  authPidExpiration: cell(409, 450, 612),

  // Section 11 — Authorized address ID
  authAidName: cell(516, 306, 612),
  authAidStreet: cell(547, 306, 612),
  authAidCity: cell(579, 306, 450),
  authAidState: cell(579, 450, 495),
  authAidZip: cell(579, 495, 544),
  authAidCountry: cell(579, 544, 612),
} satisfies Record<string, Cell>;

// Checkbox positions (x0, top) — anchored to the true visible box glyph
// (ZapfDingbats). The form has a second, misaligned marker layer; those
// coordinates drift in the right-hand columns, so we do NOT use them.
const CB = {
  service: {
    business: { x: 22.8, top: 185.8 },
    residential: { x: 130.8, top: 185.8 },
  },
  courtProtected: {
    yes: { x: 195.8, top: 342.0 },
    no: { x: 239.0, top: 342.0 },
  },
  photoId8e: {
    drivers: { x: 317.2, top: 156.9 },
    uniformed: { x: 316.8, top: 166.8 },
    passport: { x: 405.1, top: 166.8 },
    naturalization: { x: 482.0, top: 166.1 },
    access: { x: 316.8, top: 176.8 },
    matricula: { x: 405.1, top: 176.8 },
    permanent_resident: { x: 482.0, top: 176.1 },
    university: { x: 316.8, top: 186.8 },
    nexus: { x: 405.1, top: 186.8 },
  } as Record<PhotoIdType, { x: number; top: number }>,
  addressId9g: {
    drivers: { x: 318.2, top: 323.2 },
    lease: { x: 318.2, top: 333.9 },
    insurance: { x: 438.2, top: 333.9 },
    mortgage: { x: 318.2, top: 343.9 },
    vehicle_registration: { x: 438.2, top: 343.9 },
    voter: { x: 543.6, top: 344.0 },
  } as Record<AddressIdType, { x: number; top: number }>,
  photoId10e: {
    drivers: { x: 319.3, top: 454.3 },
    uniformed: { x: 319.0, top: 464.2 },
    passport: { x: 407.2, top: 464.2 },
    naturalization: { x: 481.0, top: 463.5 },
    access: { x: 319.0, top: 474.2 },
    matricula: { x: 407.2, top: 474.2 },
    permanent_resident: { x: 481.0, top: 473.5 },
    university: { x: 319.0, top: 484.2 },
    nexus: { x: 407.2, top: 484.2 },
  } as Record<PhotoIdType, { x: number; top: number }>,
  addressId11g: {
    drivers: { x: 318.8, top: 624.3 },
    lease: { x: 318.9, top: 634.9 },
    insurance: { x: 438.9, top: 634.9 },
    mortgage: { x: 318.9, top: 644.9 },
    vehicle_registration: { x: 438.9, top: 644.9 },
    voter: { x: 544.2, top: 645.0 },
  } as Record<AddressIdType, { x: number; top: number }>,
} as const;

const VALUE_OFFSET = 16.5; // baseline distance below the label's top
const BLACK = rgb(0.03, 0.03, 0.12);

function drawValue(
  page: PDFPage,
  font: PDFFont,
  c: Cell,
  text: string | undefined | null,
  maxSize = 8.5,
) {
  if (!text) return;
  const value = String(text).trim();
  if (!value) return;
  const pad = 3.5;
  let size = maxSize;
  const avail = c.w - pad * 2;
  while (size > 5.5 && font.widthOfTextAtSize(value, size) > avail) size -= 0.5;
  page.drawText(value, {
    x: c.x + pad,
    y: PAGE_H - (c.top + VALUE_OFFSET),
    size,
    font,
    color: BLACK,
    maxWidth: avail,
  });
}

function drawCheck(page: PDFPage, font: PDFFont, box: { x: number; top: number }) {
  // box is the ~8pt ZapfDingbats square at (x, top); center an X inside it.
  page.drawText("X", {
    x: box.x + 0.8,
    y: PAGE_H - (box.top + 7),
    size: 8,
    font,
    color: BLACK,
  });
}

const fullName = (n: PersonName) =>
  [n.first, n.middle, n.last].filter(Boolean).join(" ");

/** Fill the PS Form 1583 and return the PDF bytes. */
export async function fill1583(data: Form1583Data): Promise<Uint8Array> {
  const blank = await fetch(BLANK_PDF_URL).then((r) => {
    if (!r.ok) throw new Error(`Could not load the blank PS Form 1583 (${r.status}).`);
    return r.arrayBuffer();
  });
  return fill1583FromBytes(blank, data);
}

/** Fill from already-loaded blank PDF bytes (used by fill1583 and by tests). */
export async function fill1583FromBytes(
  blank: ArrayBuffer | Uint8Array,
  data: Form1583Data,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(blank);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.getPages()[0];

  const t = (c: Cell, v?: string | null) => drawValue(page, font, c, v);
  const check = (box: { x: number; top: number }) => drawCheck(page, bold, box);

  // Section 2 — CMRA (JVO) place of business
  t(F.cmraStreet, CMRA.street);
  t(F.cmraCity, CMRA.city);
  t(F.cmraState, CMRA.state);
  t(F.cmraZip, CMRA.zip);

  // Section 3 — Type of service
  check(CB.service[data.serviceType]);

  // Section 4 — Applicant
  t(F.appLast, data.applicant.last);
  t(F.appFirst, data.applicant.first);
  t(F.appMiddle, data.applicant.middle);
  t(F.appPhone, data.phone);
  t(F.appEmail, data.email);
  t(F.appStreet, data.homeAddress.street);
  t(F.appCity, data.homeAddress.city);
  t(F.appState, data.homeAddress.state);
  t(F.appZip, data.homeAddress.zip);
  t(F.appCountry, data.homeAddress.country || "USA");
  check(data.courtProtected ? CB.courtProtected.yes : CB.courtProtected.no);

  // Section 8 — Applicant photo ID
  t(F.pidName, fullName(data.applicant));
  t(F.pidNumber, data.photoId.number);
  t(F.pidIssuer, data.photoId.issuingEntity);
  t(F.pidExpiration, data.photoId.expiration);
  check(CB.photoId8e[data.photoId.type]);

  // Section 9 — Applicant address ID
  const aidAddr = data.addressIdAddress || data.homeAddress;
  t(F.aidName, fullName(data.applicant));
  t(F.aidStreet, aidAddr.street);
  t(F.aidCity, aidAddr.city);
  t(F.aidState, aidAddr.state);
  t(F.aidZip, aidAddr.zip);
  t(F.aidCountry, aidAddr.country || "USA");
  check(CB.addressId9g[data.addressIdType]);

  // Section 7 — Business (business use only)
  if (data.serviceType === "business" && data.business) {
    const b = data.business;
    t(F.bizName, b.name);
    t(F.bizType, b.type);
    t(F.bizStreet, b.address.street);
    t(F.bizCity, b.address.city);
    t(F.bizState, b.address.state);
    t(F.bizZip, b.address.zip);
    t(F.bizCountry, b.address.country || "USA");
    t(F.bizPhone, b.phone);
    t(F.bizPlaceReg, b.placeOfRegistration);
  }

  // Sections 5, 10, 11 — Authorized individual
  if (data.authorized) {
    const a = data.authorized;
    t(F.authLast, a.name.last);
    t(F.authFirst, a.name.first);
    t(F.authMiddle, a.name.middle);
    t(F.authPhone, a.phone);
    t(F.authEmail, a.email);
    t(F.authStreet, a.homeAddress.street);
    t(F.authCity, a.homeAddress.city);
    t(F.authState, a.homeAddress.state);
    t(F.authZip, a.homeAddress.zip);
    t(F.authCountry, a.homeAddress.country || "USA");

    if (a.photoId) {
      t(F.authPidName, fullName(a.name));
      t(F.authPidNumber, a.photoId.number);
      t(F.authPidIssuer, a.photoId.issuingEntity);
      t(F.authPidExpiration, a.photoId.expiration);
      check(CB.photoId10e[a.photoId.type]);
    }
    if (a.addressIdType) {
      const auxAddr = a.addressIdAddress || a.homeAddress;
      t(F.authAidName, fullName(a.name));
      t(F.authAidStreet, auxAddr.street);
      t(F.authAidCity, auxAddr.city);
      t(F.authAidState, auxAddr.state);
      t(F.authAidZip, auxAddr.zip);
      t(F.authAidCountry, auxAddr.country || "USA");
      check(CB.addressId11g[a.addressIdType]);
    }
  }

  // Section 6 — Transfer
  if (data.transfer) {
    const x = data.transfer;
    t(F.xferStreet, x.address.street);
    t(F.xferCity, x.address.city);
    t(F.xferState, x.address.state);
    t(F.xferZip, x.address.zip);
    t(F.xferCountry, x.address.country || "USA");
    t(F.xferPhone, x.phone);
    t(F.xferEmail, x.email);
  }

  return pdf.save();
}

/** Convenience: fill, then trigger a browser download. */
export async function downloadFilled1583(data: Form1583Data, filename = "PS-Form-1583-JVO.pdf") {
  const bytes = await fill1583(data);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Human-readable labels reused by the UI.
export const PHOTO_ID_LABELS: Record<PhotoIdType, string> = {
  drivers: "U.S. State/Territory/Tribal Driver's or Non-driver's ID Card",
  uniformed: "Uniformed Service ID",
  passport: "Passport",
  naturalization: "Certificate of Naturalization",
  access: "U.S. Access Card",
  matricula: "Matrícula Consular",
  permanent_resident: "U.S. Permanent Resident Card",
  university: "U.S. University ID Card",
  nexus: "NEXUS Card",
};

export const ADDRESS_ID_LABELS: Record<AddressIdType, string> = {
  drivers: "U.S. State/Territory/Tribal Driver's or Non-driver's ID Card",
  lease: "Current Lease",
  insurance: "Home or Vehicle Insurance Policy",
  mortgage: "Mortgage or Deed of Trust",
  vehicle_registration: "Vehicle Registration Card",
  voter: "Voter Card",
};
