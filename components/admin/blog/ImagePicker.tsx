"use client";

import { useRef, useState, type DragEvent } from "react";
import { uploadPhoto } from "@/lib/client/photo-upload";

/**
 * Featured / share image.
 *
 * Two routes in, on purpose: drop or choose a file (uploaded straight to Supabase via
 * /api/admin/blog/upload), or paste a URL. The paste route is not a fallback for the upload
 * failing — it is how an image already hosted somewhere (the operator's own site, a shoot in the
 * existing /public folder) gets used without duplicating the file.
 */
export default function ImagePicker({
  value,
  onChange,
  label,
  hint,
  aspect = "16 / 9",
  endpoint = "/api/admin/blog/upload",
  spec = "1200 × 630 or larger · JPG, PNG, WebP, AVIF · up to 8MB",
  accept = "image/jpeg,image/png,image/webp,image/avif,image/gif",
  allowUrl = true,
  compress = false,
}: {
  value: string;
  onChange: (url: string) => void;
  label: string;
  hint?: string;
  aspect?: string;
  /** Where the chosen file is posted. The blog editor's admin-only route unless told otherwise. */
  endpoint?: string;
  /** The line under the prompt saying what will be accepted. */
  spec?: string;
  accept?: string;
  /** Whether a pasted address is offered as well as a file. */
  allowUrl?: boolean;
  /** Shrinks the photo in the browser to HD and under 500 KB before it goes up. */
  compress?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      onChange(await uploadPhoto(file, endpoint, compress));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  return (
    <div className="bpe-image">
      <div className="afield__top">
        <span className="ds-micro afield__label">{label}</span>
        {hint ? <span className="ds-micro afield__hint">{hint}</span> : null}
      </div>

      {value ? (
        <div className="bpe-image__preview" style={{ aspectRatio: aspect }}>
          {/* Deliberately a plain <img>: the source is an arbitrary external URL an editor pasted,
              which next/image would refuse to optimise without that host in next.config. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" />
          <div className="bpe-image__overlay">
            <button type="button" className="ds-micro bpe-image__action" onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            <button type="button" className="ds-micro bpe-image__action" onClick={() => onChange("")}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`bpe-image__drop${dragging ? " is-dragging" : ""}`}
          style={{ aspectRatio: aspect }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <circle cx="8.6" cy="9.6" r="1.6" />
            <path d="M3.5 17l4.6-4.4a2 2 0 0 1 2.7 0L20.5 20" />
          </svg>
          <span className="ds-body-sm bpe-image__prompt">
            {uploading ? "Uploading…" : "Drop an image, or click to choose one"}
          </span>
          <span className="ds-micro bpe-image__spec">{spec}</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />

      {allowUrl ? (
        <span className="afield__well bpe-image__url">
        <input
          className="afield__input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="…or paste an image URL"
          inputMode="url"
        />
        </span>
      ) : null}

      {error ? (
        <span className="ds-micro bpe-image__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
