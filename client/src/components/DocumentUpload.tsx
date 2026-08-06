/*
 * DocumentUpload — file picker for the ID / proof-of-address images on the mailbox
 * application. Used three times: front of ID, back of ID, and address proof (multi).
 *
 * Files are downscaled in the browser before they ever leave the device (see
 * lib/imagePrep.ts) and held in React state only — never persisted locally, since
 * these are photographs of government IDs.
 */
import { useEffect, useRef, useState } from "react";
import { Upload, X, FileText, Loader2, AlertTriangle } from "lucide-react";
import { prepareDocument, formatSize, DocPrepError, type PreparedDoc } from "@/lib/imagePrep";

interface Props {
  label: string;
  hint?: string;
  docs: PreparedDoc[];
  onChange: (docs: PreparedDoc[]) => void;
  multiple?: boolean;
  /** Cap on total files for this control. */
  max?: number;
}

export default function DocumentUpload({ label, hint, docs, onChange, multiple = false, max = 6 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Release preview object URLs when this control goes away.
  const docsRef = useRef(docs);
  docsRef.current = docs;
  useEffect(() => () => docsRef.current.forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl)), []);

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    setErr(null);
    setBusy(true);
    try {
      const room = multiple ? max - docs.length : 1;
      if (room <= 0) {
        setErr(`You can attach up to ${max} files here.`);
        return;
      }
      const picked = Array.from(list).slice(0, room);
      const prepared: PreparedDoc[] = [];
      for (const f of picked) {
        try {
          prepared.push(await prepareDocument(f));
        } catch (e) {
          setErr(e instanceof DocPrepError ? e.message : `Couldn't read "${f.name}".`);
        }
      }
      if (!prepared.length) return;

      if (multiple) {
        onChange([...docs, ...prepared]);
      } else {
        docs.forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl));
        onChange([prepared[0]]);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ""; // allow re-picking the same file
    }
  }

  function remove(i: number) {
    const doc = docs[i];
    if (doc.previewUrl) URL.revokeObjectURL(doc.previewUrl);
    onChange(docs.filter((_, n) => n !== i));
    setErr(null);
  }

  const full = !multiple && docs.length > 0;

  return (
    <div>
      <p className="block font-sans text-[10px] font-semibold tracking-[0.2em] uppercase text-white/45 mb-2">
        {label} <span className="text-white/25">*</span>
      </p>
      {hint && <p className="font-sans text-xs text-white/35 leading-relaxed mb-3">{hint}</p>}

      {docs.length > 0 && (
        <ul className="space-y-2 mb-3">
          {docs.map((d, i) => (
            <li key={`${d.name}-${i}`} className="flex items-center gap-3 border border-white/12 bg-white/[0.03] p-2.5">
              {d.previewUrl && d.mime !== "application/pdf" ? (
                <img src={d.previewUrl} alt="" className="w-12 h-12 object-cover flex-shrink-0" />
              ) : (
                <span className="w-12 h-12 flex items-center justify-center bg-white/[0.05] flex-shrink-0">
                  <FileText size={16} className="text-white/40" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-sans text-sm text-white/80 truncate">{d.name}</span>
                <span className="block font-sans text-xs text-white/35">{formatSize(d.bytes.length)}</span>
                {d.warning && <span className="block font-sans text-xs text-amber-200/70">{d.warning}</span>}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${d.name}`}
                className="text-white/35 hover:text-white transition-colors flex-shrink-0 p-1"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 border border-dashed border-white/20 bg-white/[0.02] px-4 py-5 font-sans text-xs font-semibold tracking-[0.15em] uppercase text-white/50 hover:border-white/40 hover:text-white/80 disabled:opacity-50 transition-colors"
        >
          {busy ? (
            <><Loader2 size={14} className="animate-spin" /> Processing…</>
          ) : (
            <><Upload size={14} /> {docs.length ? "Add another" : "Choose file or take photo"}</>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />

      {err && (
        <p className="flex items-start gap-2 font-sans text-xs text-amber-200/80 mt-2 leading-relaxed">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {err}
        </p>
      )}
    </div>
  );
}
