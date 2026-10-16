"use client";

import { useState, useTransition } from "react";
import ImagePicker from "@/components/admin/blog/ImagePicker";
import ActionNotice from "@/components/rails/ActionNotice";
import { saveTripPhotoAction, type RailsActionState } from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

/** A trip's cover photo, saved the moment it is uploaded or removed, like everything else on the trip page. */
export default function TripPhoto({ listingId, initialUrl }: { listingId: string; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [state, setState] = useState<RailsActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const change = (next: string) => {
    setUrl(next);
    setState(IDLE);
    startTransition(async () => setState(await saveTripPhotoAction(listingId, next || null)));
  };

  return (
    <div className="rl-stack rl-photo" aria-busy={pending}>
      <ImagePicker
        label="Cover photo"
        hint={pending ? "Saving…" : undefined}
        value={url}
        onChange={change}
        endpoint="/api/operator/listing-image"
        accept="image/jpeg,image/png,image/webp,image/avif"
        spec="Landscape works best · JPG, PNG, WebP or AVIF · up to 8 MB"
        aspect="16 / 9"
        allowUrl={false}
        maxDimension={2000}
      />
      <ActionNotice state={state} />
    </div>
  );
}
