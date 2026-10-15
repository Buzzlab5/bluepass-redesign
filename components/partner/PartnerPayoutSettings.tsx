"use client";

import { useActionState, useState } from "react";
import { updatePayoutDetailsAction, type PartnerSettingsState } from "@/app/partner-portal/actions";
import Notice from "@/components/auth/Notice";
import BankDetailsFields from "@/components/payout/BankDetailsFields";
import Button from "@/components/ui/Button";

const IDLE: PartnerSettingsState = { status: "idle" };

/**
 * Where this partner's money goes, edited by the partner themselves - the /partner equivalent of
 * OperatorPayoutSettings.tsx, trimmed to the one rail partners have (manual bank transfer; no
 * Stripe Connect/Airwallex, which are operator-specific infra tied to Kai's own account-creation
 * flow). Same confirmation-gates-the-save pattern for the same reason: the mistake worth catching
 * is a wrong account number, and a confirmation that doesn't say so out loud cannot catch it.
 */
export default function PartnerPayoutSettings({ hasDetailsOnFile }: { hasDetailsOnFile: boolean }) {
  const [state, formAction, pending] = useActionState(updatePayoutDetailsAction, IDLE);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <section className="adm-block">
      <header className="adm-block__head">
        <h2 className="ds-headline adm-block__title">How you get paid</h2>
        <p className="ds-caption adm-block__note">
          Bluepass sends your payout to these bank details by hand once you request one, so it asks
          you to confirm before saving.
        </p>
      </header>

      <form action={formAction} className="adm-form">
        {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
        {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}

        <section className="adm-form__section">
          <BankDetailsFields hasDetailsOnFile={hasDetailsOnFile} disabled={pending} />

          <label className="adm-confirm ds-body-sm">
            <input
              type="checkbox"
              name="confirm"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={pending}
            />
            <span>Pay me by bank transfer using these details. I have checked them.</span>
          </label>
        </section>

        <div className="adm-form__submit">
          <Button type="submit" variant="primary" large magnetic={false} disabled={pending || !confirmed}>
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
