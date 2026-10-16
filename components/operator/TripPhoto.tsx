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
        spec="Any size: shrunk to HD, under 500 KB · JPG, PNG, WebP or AVIF"
        aspect="16 / 9"
        allowUrl={false}
        compress
      />
      <ActionNotice state={state} />
    </div>
  );
}
