"use client";

import { useActionState, useState } from "react";
import Field from "@/components/auth/Field";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { addAffiliateTripAction, type AffiliateTripState } from "@/app/admin/affiliate-trips/actions";

const IDLE: AffiliateTripState = { status: "idle" };

const PLATFORMS = [
  {
    value: "FAREHARBOR",
    label: "FareHarbor affiliate",
    hint: "In the FareHarbor Marketplace, open the trip and press Copy referral link. Paste it as it is.",
  },
  {
    value: "REZDY",
    label: "Rezdy agent",
    hint: "Use the booking link from your Rezdy agent account for this product.",
  },
] as const;

/**
 * Adds one trip BluePass resells. Uncontrolled fields posted to a server action, like the rest of
 * the console. The form resets after a successful add so the next trip starts clean.
 */
export default function AffiliateTripForm() {
  const [state, formAction, pending] = useActionState(addAffiliateTripAction, IDLE);
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]["value"]>("FAREHARBOR");
  const error = state.status === "error" ? state : undefined;
  const invalid = (field: string) => (error?.field === field ? "adm-form__row--invalid" : "");
  const chosen = PLATFORMS.find((option) => option.value === platform) ?? PLATFORMS[0];

  return (
    <form action={formAction} className="adm-form__section">
      <h2 className="ds-body-lg adm-form__legend">Add a trip</h2>
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
      {error ? <Notice tone="error">{error.message}</Notice> : null}

      <div className="adm-form__grid">
        <label className={`afield adm-form__row ${invalid("bookingPlatform")}`}>
          <span className="afield__top">
            <span className="ds-micro afield__label">Sold through</span>
          </span>
          <span className="afield__well">
            <select
              name="bookingPlatform"
              className="afield__input"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as typeof platform)}
              disabled={pending}
            >
              {PLATFORMS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <div className={`adm-form__row ${invalid("operatorName")}`}>
          <Field label="Operator" name="operatorName" placeholder="Reef Magic Cruises" required disabled={pending} />
        </div>
        <div className={`adm-form__row adm-form__row--wide ${invalid("bookingUrl")}`}>
          <Field
            label="Booking link"
            name="bookingUrl"
            type="url"
            inputMode="url"
            placeholder={platform === "FAREHARBOR" ? "https://fareharbor.com/embeds/book/…" : "https://….rezdy.com/…"}
            hint={chosen.hint}
            required
            disabled={pending}
          />
        </div>
        <div className={`adm-form__row adm-form__row--wide ${invalid("title")}`}>
          <Field label="Trip name" name="title" placeholder="Outer Great Barrier Reef day trip" required disabled={pending} />
        </div>
        <div className={`adm-form__row ${invalid("category")}`}>
          <Field label="Category" name="category" placeholder="Dive, Sail & Yacht, Wildlife" hint="Dive, Sail & Yacht, Wildlife or Expedition" required disabled={pending} />
        </div>
        <div className={`adm-form__row ${invalid("region")}`}>
          <Field label="Region" name="region" placeholder="Great Barrier Reef" required disabled={pending} />
        </div>
        <div className={`adm-form__row ${invalid("priceFrom")}`}>
          <Field label="Price from" name="priceFrom" inputMode="numeric" placeholder="189" hint="Lowest adult price, per guest" required disabled={pending} />
        </div>
        <div className={`adm-form__row ${invalid("currency")}`}>
          <Field label="Currency" name="currency" defaultValue="AUD" hint="Three letters" disabled={pending} />
        </div>
        <div className={`adm-form__row adm-form__row--wide ${invalid("heroImageUrl")}`}>
          <Field label="Photo link" name="heroImageUrl" type="url" inputMode="url" hint="Optional. Use the operator's own photo." disabled={pending} />
        </div>
        <label className={`afield adm-form__row adm-form__row--wide ${invalid("description")}`}>
          <span className="afield__top">
            <span className="ds-micro afield__label">About the trip</span>
          </span>
          <span className="afield__well">
            <textarea
              name="description"
              rows={5}
              required
              disabled={pending}
              className="afield__input adm-textarea"
              placeholder="What travellers do, how long it takes, what is included. Use the operator's own facts only."
            />
          </span>
        </label>
      </div>

      <div>
        <Button type="submit" variant="primary" magnetic={false} disabled={pending}>
          {pending ? "Adding…" : "Add and publish"}
        </Button>
      </div>
    </form>
  );
}
