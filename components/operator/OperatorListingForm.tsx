"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import Field from "@/components/auth/Field";
import ImagePicker from "@/components/admin/blog/ImagePicker";
import Button from "@/components/ui/Button";
import {
  createListingAction,
  updateListingAction,
  type OperatorSettingsState,
} from "@/app/operator/actions";
import type { OperatorListingRow } from "@/lib/services/operator/dashboard";

const IDLE: OperatorSettingsState = { status: "idle" };

type FormValues = {
  title: string;
  category: string;
  region: string;
  description: string;
  heroImageUrl: string;
  maxGuests: string;
  priceFrom: string;
  priceSignal: string;
  currency: string;
};

const EMPTY: FormValues = {
  title: "",
  category: "",
  region: "",
  description: "",
  heroImageUrl: "",
  maxGuests: "",
  priceFrom: "",
  priceSignal: "",
  currency: "AUD",
};

/**
 * Create or edit one DRAFT listing. Only ever shown for an operator with no Rezdy link (see
 * requireEditableOperator in app/operator/actions.ts) — a LIVE listing isn't editable here at all,
 * since operator-listing-service.ts's updateDraftListing refuses anything but a draft; publishing is
 * a one-way door in this pass, matching how the service itself is written.
 */
export default function OperatorListingForm({
  listing,
  onDone,
  nextStepIsSetup,
}: {
  /** Present for edit mode, absent for creating a new draft. */
  listing?: OperatorListingRow;
  onDone: () => void;
  /** Creating from the Trips page: continue to that trip's schedule and price once it is saved. */
  nextStepIsSetup?: boolean;
}) {
  const action = listing ? updateListingAction.bind(null, listing.id) : createListingAction;
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [values, setValues] = useState<FormValues>(
    listing
      ? {
          title: listing.title,
          category: listing.category,
          region: listing.region,
          description: listing.description,
          heroImageUrl: listing.heroImageUrl ?? "",
          maxGuests: listing.maxGuests ? String(listing.maxGuests) : "",
          priceFrom: listing.priceFrom ? String(listing.priceFrom) : "",
          priceSignal: listing.priceSignal ?? "",
          currency: listing.currency,
        }
      : EMPTY,
  );

  const set = (field: keyof FormValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  if (state.status === "done") {
    return (
      <div className="adm-card adm-done" style={{ padding: 20 }}>
        <p className="ds-body-sm">{state.message}</p>
        <Button variant="secondary" magnetic={false} onClick={onDone}>
          Close
        </Button>
      </div>
    );
  }

  const error = state.status === "error" ? state : undefined;
  const invalid = (field: string) => (error?.field === field ? "adm-form__row--invalid" : "");

  return (
    <form action={formAction} className="adm-form__section" style={{ marginTop: 16 }}>
      {error ? <Notice tone="error">{error.message}</Notice> : null}
      {nextStepIsSetup ? <input type="hidden" name="next" value="trip-setup" /> : null}

      <div className="adm-form__grid">
        <div className={`adm-form__row adm-form__row--wide ${invalid("title")}`}>
          <Field
            label="Title"
            name="title"
            value={values.title}
            onChange={set("title")}
            placeholder="Whitsundays Sailing Day"
            autoComplete="off"
            required
            disabled={pending}
          />
        </div>
        <div className={`adm-form__row ${invalid("category")}`}>
          <Field
            label="Category"
            name="category"
            value={values.category}
            onChange={set("category")}
            placeholder="Sailing"
            autoComplete="off"
            required
            disabled={pending}
          />
        </div>
        <div className={`adm-form__row ${invalid("region")}`}>
          <Field
            label="Region"
            name="region"
            value={values.region}
            onChange={set("region")}
            placeholder="Whitsundays"
            autoComplete="off"
            required
            disabled={pending}
          />
        </div>
        <div className={`adm-form__row ${invalid("priceFrom")}`}>
          <Field
            label="Price per guest (AUD)"
            name="priceFrom"
            value={values.priceFrom}
            onChange={set("priceFrom")}
            inputMode="numeric"
            placeholder="189"
            hint="Required to appear on Discover"
            autoComplete="off"
            disabled={pending}
          />
        </div>
        <div className="adm-form__row">
          <Field
            label="Custom price text"
            name="priceSignal"
            value={values.priceSignal}
            onChange={set("priceSignal")}
            placeholder="From AUD 189"
            hint={`Optional — defaults to "From AUD ${values.priceFrom || "…"}"`}
            autoComplete="off"
            disabled={pending}
          />
        </div>
        <div className="adm-form__row">
          <Field
            label="Max guests"
            name="maxGuests"
            value={values.maxGuests}
            onChange={set("maxGuests")}
            inputMode="numeric"
            hint="Optional"
            autoComplete="off"
            disabled={pending}
          />
        </div>
        <div className="adm-form__row adm-form__row--wide rl-photo">
          <ImagePicker
            label="Cover photo"
            hint="Optional"
            value={values.heroImageUrl}
            onChange={set("heroImageUrl")}
            endpoint="/api/operator/listing-image"
            accept="image/jpeg,image/png,image/webp,image/avif"
            spec="Any size: shrunk to HD, under 500 KB · JPG, PNG, WebP or AVIF"
            aspect="16 / 9"
            allowUrl={false}
            compress
          />
          <input type="hidden" name="heroImageUrl" value={values.heroImageUrl} />
        </div>
        <div className="adm-form__row adm-form__row--wide">
          <label className="afield">
            <span className="afield__top">
              <span className="ds-micro afield__label">Description</span>
            </span>
            <span className="afield__well">
              <textarea
                name="description"
                value={values.description}
                onChange={(e) => set("description")(e.target.value)}
                rows={5}
                disabled={pending}
                className="afield__input adm-textarea"
                placeholder="What travellers should know before they book."
                required
              />
            </span>
          </label>
        </div>
      </div>

      <div className="adm-form__submit">
        <Button type="submit" variant="primary" magnetic={false} disabled={pending}>
          {pending ? "Saving…" : listing ? "Save draft" : "Create draft"}
        </Button>
        <Button type="button" variant="secondary" magnetic={false} onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
