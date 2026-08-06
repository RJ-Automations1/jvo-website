/*
 * imagePrep.ts — normalizes a user-picked ID/proof file into upload-ready bytes.
 *
 * Phone cameras produce 3-8 MB images; three of those base64-encoded would blow any
 * reasonable request limit. We downscale to a size that still reads cleanly (an ID
 * number has to be legible to staff) and re-encode as JPEG.
 *
 * PDFs pass through untouched — proof of address is very often a bank statement PDF.
 */

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.82;
const MAX_BYTES = 8 * 1024 * 1024;

export interface PreparedDoc {
  bytes: Uint8Array;
  mime: string;
  name: string;
  /** Object URL for the preview thumbnail; caller revokes it when done. */
  previewUrl: string;
  /** Set when we couldn't re-encode and passed the original through. */
  warning?: string;
}

export class DocPrepError extends Error {}

const readBytes = async (file: File | Blob): Promise<Uint8Array> =>
  new Uint8Array(await file.arrayBuffer());

/** Re-encode through a canvas, scaled so the longest edge is <= MAX_EDGE. */
async function reencode(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) throw new Error("canvas encode failed");
  return blob;
}

const swapExt = (name: string, ext: string) => name.replace(/\.[^.]+$/, "") + ext;

/**
 * Prepare one picked file. Throws DocPrepError with a user-facing message when the
 * file can't be used at all.
 */
export async function prepareDocument(file: File): Promise<PreparedDoc> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (isPdf) {
    if (file.size > MAX_BYTES) {
      throw new DocPrepError(`That PDF is ${(file.size / 1e6).toFixed(1)} MB — the limit is 8 MB.`);
    }
    return {
      bytes: await readBytes(file),
      mime: "application/pdf",
      name: file.name,
      previewUrl: "",
    };
  }

  try {
    const blob = await reencode(file);
    return {
      bytes: await readBytes(blob),
      mime: "image/jpeg",
      name: swapExt(file.name, ".jpg"),
      previewUrl: URL.createObjectURL(blob),
    };
  } catch {
    // Chrome/Firefox on Windows can't decode HEIC, so createImageBitmap throws.
    // iOS Safari usually converts to JPEG on upload, making this path uncommon —
    // but it must not dead-end the applicant. Send the original as-is if it fits.
    if (file.size > MAX_BYTES) {
      throw new DocPrepError(
        `We couldn't read that image, and at ${(file.size / 1e6).toFixed(1)} MB it's too large to ` +
          `send as-is. Try saving it as a JPEG or PNG, or take the photo again.`
      );
    }
    return {
      bytes: await readBytes(file),
      mime: file.type || "application/octet-stream",
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      warning: "We couldn't preview this file, but it was attached.",
    };
  }
}

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
