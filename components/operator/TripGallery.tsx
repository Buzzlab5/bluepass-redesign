"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import { saveTripGalleryAction, type RailsActionState } from "@/app/operator/rails-actions";
import { uploadPhoto } from "@/lib/client/photo-upload";

const IDLE: RailsActionState = { status: "idle" };
const MAX_PHOTOS = 12;
const ENDPOINT = "/api/operator/listing-image";

/**
 * The extra photos on a trip's page, as a grid the operator can add to, reorder and trim.
 *
 * Every change is saved at once with the whole list, so the gallery on the site is never a half-made
 * edit. Several files can be chosen or dropped together; they upload one after another, and a file
 * that fails is reported by name without stopping the rest.
 */
export default function TripGallery({ listingId, initialUrls }: { listingId: string; initialUrls: string[] }) {
  const [urls, setUrls] = useState(initialUrls);
  const [state, setState] = useState<RailsActionState>(IDLE);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, startSaving] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const save = (next: string[]) => {
    setUrls(next);
    startSaving(async () => setState(await saveTripGalleryAction(listingId, next)));
  };

  const add = async (files: File[]) => {
    const room = MAX_PHOTOS - urls.length;
    if (room <= 0) return setState({ status: "error", message: `A trip can have up to ${MAX_PHOTOS} gallery photos. Remove one to add another.` });

    const uploaded: string[] = [];
    const failures: string[] = [];
    for (const [index, file] of files.slice(0, room).entries()) {
      setUploading(`Uploading ${index + 1} of ${Math.min(files.length, room)}…`);
      try {
        uploaded.push(await uploadPhoto(file, ENDPOINT, true));
      } catch (cause) {
        failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "could not be uploaded."}`);
      }
    }
    setUploading(null);

    if (uploaded.length) save([...urls, ...uploaded]);
    const skipped = files.length > room ? ` ${files.length - room} more ${files.length - room === 1 ? "was" : "were"} left out: the limit is ${MAX_PHOTOS}.` : "";
    if (failures.length) setState({ status: "error", message: failures.join(" ") + skipped });
    else if (skipped) setState({ status: "error", message: skipped.trim() });
  };

  const move = (from: number, to: number) => {
    const next = [...urls];
    next.splice(to, 0, ...next.splice(from, 1));
    save(next);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (files.length) void add(files);
  };

  return (
    <div className="rl-stack" aria-busy={saving || uploading !== null}>
      <div className="rl-gallery">
        {urls.map((url, index) => (
          <figure key={url} className="rl-gallery__item">
            {/* A plain <img>: it is a small preview of our own file, and next/image would route it through the optimiser for no gain. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Gallery photo ${index + 1} of ${urls.length}`} loading="lazy" />
            <figcaption className="rl-gallery__bar">
              <button type="button" className="ds-micro" disabled={index === 0 || saving} onClick={() => move(index, index - 1)} aria-label={`Move photo ${index + 1} earlier`}>←</button>
              <button type="button" className="ds-micro" disabled={index === urls.length - 1 || saving} onClick={() => move(index, index + 1)} aria-label={`Move photo ${index + 1} later`}>→</button>
              <button type="button" className="ds-micro" disabled={saving} onClick={() => save(urls.filter((u) => u !== url))} aria-label={`Remove photo ${index + 1}`}>Remove</button>
            </figcaption>
          </figure>
        ))}

        {urls.length < MAX_PHOTOS ? (
          <button
            type="button"
            className={`rl-gallery__add${dragging ? " is-dragging" : ""}`}
            disabled={uploading !== null}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="ds-body-sm">{uploading ?? "+ Add photos"}</span>
            <span className="ds-micro rl-muted">{urls.length} of {MAX_PHOTOS} · shrunk to HD, under 500 KB</span>
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) void add(files);
        }}
      />
      <ActionNotice state={state} />
    </div>
  );
}
