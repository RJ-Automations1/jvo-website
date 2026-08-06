/*
 * fileApplication.ts — hands the generated PS Form 1583 and the applicant's uploaded
 * ID / proof-of-address files to the JVO server, which files them into the office
 * Dropbox under the client's folder, adds a row to the client master sheet, and
 * emails the JVO team.
 *
 * The applicant already has the downloaded PDF in hand and the in-office signing visit
 * is what actually files the form with USPS, so a failure here is recoverable: the UI
 * offers a retry that re-sends without regenerating the form.
 */
import type { PreparedDoc } from "@/lib/imagePrep";

export type DocKind = "photo-id-front" | "photo-id-back" | "address-proof";

export interface ApplicantSummary {
  serviceType: string;
  firstName: string;
  lastName: string;
  businessName?: string;
  businessType?: string;
  phone?: string;
  email?: string;
  homeAddress?: string;
  photoIdLabel?: string;
  addressIdLabel?: string;
  courtProtected?: boolean;
}

/** Uint8Array -> base64, chunked so large files don't blow the argument limit. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export interface FilingResult {
  ok: true;
  folder: string;
  /** How many files (form + documents) landed in Dropbox. */
  uploaded: number;
  notified: boolean;
  logged: boolean;
}

export async function fileApplicationWithJvo(
  applicant: ApplicantSummary,
  pdfBytes: Uint8Array,
  documents: { kind: DocKind; doc: PreparedDoc }[],
  plan = ""
): Promise<FilingResult> {
  const res = await fetch("/api/mailbox-application", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicant,
      plan,
      pdfBase64: toBase64(pdfBytes),
      documents: documents.map(({ kind, doc }) => ({
        kind,
        filename: doc.name,
        mime: doc.mime,
        base64: toBase64(doc.bytes),
      })),
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(detail.error || `Filing failed (${res.status}).`);
  }
  return res.json();
}
