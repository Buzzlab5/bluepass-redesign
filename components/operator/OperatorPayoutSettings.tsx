"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import Field from "@/components/auth/Field";
import BankDetailsFields from "@/components/payout/BankDetailsFields";
import { updatePayoutDetailsAction, type OperatorSettingsState } from "@/app/operator/actions";
import type { OperatorProfileView } from "@/lib/services/operator/guard";

const IDLE: OperatorSettingsState = { status: "idle" };

type SelectableMethod = "MANUAL_BANK_TRANSFER" | "AIRWALLEX";

const OPTIONS: { value: SelectableMethod; label: string; hint: string }[] = [
  {
    value: "MANUAL_BANK_TRANSFER",
    label: "Manual bank transfer",
    hint: "Bluepass sends your payout to these bank details by hand. This is how most operators are paid today.",
  },
  {
    value: "AIRWALLEX",
    label: "Airwallex",
    hint: "The Indonesia rail. No live Airwallex account exists yet, so record whatever reference you have.",
  },
];

/**
 * Where this operator's money goes, edited by the operator.
 *
 * Structured exactly like `OperatorOnboardingForm`: `.adm-form` holds notices and the submit, and a
 * single `.adm-form__section` is the card. That section already carries a surface, a border and a
 * shadow, so wrapping it in an `.adm-card` — as this component first did — stacked three identical
 * surfaces inside each other and turned every radio option into a box within a box within a box.
 *
 * A confirmation step gates the save, and the label names the method being switched to rather than
 * asking "are you sure" — the mistake worth catching is picking the wrong rail, and a confirmation
 * that doesn't name the destination cannot catch it.
 */
export default function OperatorPayoutSettings({
  profile,
  hasDetailsOnFile,
}: {
  profile: OperatorProfileView;
  hasDetailsOnFile: boolean;
}) {
  const [state, formAction, pending] = useActionState(updatePayoutDetailsAction, IDLE);
  const onStripe = profile.payoutMethod === "STRIPE_CONNECT";
  const [method, setMethod] = useState<SelectableMethod>(
    profile.payoutMethod === "AIRWALLEX" ? "AIRWALLEX" : "MANUAL_BANK_TRANSFER",
  );
  const [confirmed, setConfirmed] = useState(false);

  const chosen = OPTIONS.find((option) => option.value === method);

  return (
    <section className="adm-block">
      <header className="adm-block__head">
        <h2 className="ds-headline adm-block__title">How you get paid</h2>
        <p className="ds-caption adm-block__note">
          Change your payout method and the details behind it. This decides where Bluepass sends your
          money, so it asks you to confirm before saving.
        </p>
      </header>

      <form action={formAction} className="adm-form">
        {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
        {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}

        {onStripe ? (
          /* Selecting Stripe Connect is not offered: the account id behind it is created by Kai
             through the admin bridge and is deliberately not typeable here, so an operator who
             picked it without one would be choosing a rail with no destination. Someone already on
             it can still be shown what saving this form would do to them. */
          <Notice tone="info">
            You are currently paid through Stripe Connect, which your Bluepass contact set up. Saving
            this form moves you off Stripe Connect and onto the method you pick below — if you only
            meant to update your bank details, talk to your contact first.
          </Notice>
        ) : null}

        <section className="adm-form__section">
          <div className="adm-choice" role="radiogroup" aria-label="Payout method">
            {OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`adm-choice__option ${method === option.value ? "is-active" : ""}`}
              >
                <input
                  type="radio"
                  name="payoutMethod"
                  value={option.value}
                  checked={method === option.value}
                  onChange={() => {
                    setMethod(option.value);
                    /* Changing the rail after confirming would otherwise save a method the operator
                       never confirmed. */
                    setConfirmed(false);
                  }}
                  disabled={pending}
                />
                <span className="ds-body-sm adm-choice__label">{option.label}</span>
                <span className="ds-micro adm-choice__hint">{option.hint}</span>
              </label>
            ))}
          </div>

          <div className="adm-form__grid adm-form__grid--conditional">
            {method === "MANUAL_BANK_TRANSFER" ? (
              <BankDetailsFields country={profile.country} hasDetailsOnFile={hasDetailsOnFile} disabled={pending} />
            ) : (
              <div className="adm-form__row adm-form__row--wide">
                <Field
                  label="Airwallex reference"
                  name="airwallexReference"
                  placeholder="Beneficiary ID or account reference"
                  hint={hasDetailsOnFile ? "Optional" : undefined}
                  autoComplete="off"
                  disabled={pending}
                />
                <span className="ds-micro adm-form__help">
                  {hasDetailsOnFile
                    ? "Leave empty to keep the reference Bluepass already holds for you."
                    : "Nothing is on file yet, so this is required."}
                </span>
              </div>
            )}
          </div>

          <label className="adm-confirm ds-body-sm">
            <input
              type="checkbox"
              name="confirm"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={pending}
            />
            <span>
              Pay me by <strong>{chosen?.label.toLowerCase()}</strong> using these details. I have
              checked them.
            </span>
          </label>
        </section>

        <div className="adm-form__submit">
          <Button
            type="submit"
            variant="primary"
            large
            magnetic={false}
            disabled={pending || !confirmed}
          >
            {pending ? "Saving…" : "Save payout details"}
          </Button>
          <span className="ds-micro adm-form__submit-note">
            {confirmed
              ? "Bluepass will use these details for your next payout."
              : "Tick the box above to save. Money sent to the wrong account is not something Bluepass can pull back for you."}
          </span>
        </div>
      </form>
    </section>
  );
}
