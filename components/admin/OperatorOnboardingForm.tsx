"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import Field from "@/components/auth/Field";
import BankDetailsFields from "@/components/payout/BankDetailsFields";
import Notice from "@/components/auth/Notice";
import OperatorLoginInvite from "@/components/admin/OperatorLoginInvite";
import Button from "@/components/ui/Button";
import {
  onboardOperatorAction,
  type OnboardOperatorState,
} from "@/app/admin/operators/new/actions";

const IDLE: OnboardOperatorState = { status: "idle" };

type PayoutMethod = "MANUAL_BANK_TRANSFER" | "STRIPE_CONNECT" | "AIRWALLEX";

const PAYOUT_OPTIONS: { value: PayoutMethod; label: string; hint: string }[] = [
  {
    value: "MANUAL_BANK_TRANSFER",
    label: "Manual bank transfer",
    hint: "Commission is paid out by hand against these details. This is how every operator starts today.",
  },
  {
    value: "STRIPE_CONNECT",
    label: "Stripe Connect",
    hint: "Records a Connect account you already have. This form does not start Connect onboarding — Kai's admin bridge does that.",
  },
  {
    value: "AIRWALLEX",
    label: "Airwallex",
    hint: "The Indonesia rail. No live Airwallex account exists yet, so record whatever reference you have and move on.",
  },
];

const EMPTY = {
  companyName: "",
  payoutContactEmail: "",
  whatsappE164: "",
  websiteUrl: "",
  country: "",
  bankDetails: "",
  stripeConnectAccountId: "",
  airwallexReference: "",
  rezdySupplierId: "",
};

/**
 * Manual operator onboarding.
 *
 * The real process is a person closing a deal on a call, so this form is the
 * point where that conversation becomes a record that can be paid. It creates a
 * LIVE profile straight away — the admin filling it in is the vetting step.
 *
 * Every input is controlled. React 19 resets a form once its action resolves,
 * which for uncontrolled inputs means a rejected submission silently empties
 * the whole form — the admin loses the bank details they just transcribed off a
 * phone call, and the duplicate-confirm path can never submit because the
 * required fields behind it are now blank. Holding the values in state is what
 * makes "you already have this operator, confirm to continue" a usable answer
 * rather than a dead end.
 */
export default function OperatorOnboardingForm({
  leadId,
  initialValues,
}: {
  /** Set when this form was opened from an outreach lead — see app/admin/leads/[id]/page.tsx. */
  leadId?: string;
  initialValues?: Partial<typeof EMPTY>;
} = {}) {
  const [state, formAction, pending] = useActionState(onboardOperatorAction, IDLE);
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>("MANUAL_BANK_TRANSFER");
  const [values, setValues] = useState({ ...EMPTY, ...initialValues });
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const set = (field: keyof typeof EMPTY) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  if (state.status === "success") {
    return (
      <div className="adm-card adm-done">
        <span className="adm-done__glyph" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>
        <h2 className="ds-headline adm-done__title">{state.companyName} is live.</h2>
        <p className="ds-body adm-done__body">
          The operator profile was created with the payout details you entered, and the account is
          attached to <strong>{state.payoutContactEmail}</strong>. Their products will merge into this
          profile automatically once the Rezdy sync sees them.
        </p>
        <dl className="adm-facts adm-done__facts">
          <div className="adm-facts__row">
            <dt className="ds-micro adm-facts__label">Profile ID</dt>
            <dd className="ds-body-sm adm-facts__value">{state.operatorProfileId}</dd>
          </div>
        </dl>

        {/* The account exists but its password is the unusable placeholder `createManualOperator`
            wrote, so nobody can sign into it yet. This is the step that hands the operator their
            own way in — deliberately a separate, deliberate press rather than something the create
            does silently, because it emails a live password-setting link to a real business. */}
        <OperatorLoginInvite
          operatorProfileId={state.operatorProfileId}
          email={state.payoutContactEmail}
        />
        <div className="adm-done__actions">
          {/* A full-page reload rather than a router link: it is what drops the
              action state and the field state together, so the next operator is
              never started on top of the last one's bank details. */}
          <a href="/admin/operators/new" className="ds-body-sm adm-done__again">
            Onboard another operator →
          </a>
          <Link href="/admin" className="ds-body-sm">
            Back to admin
          </Link>
        </div>
      </div>
    );
  }

  const error = state.status === "error" ? state : undefined;
  const invalid = (field: string) => (error?.field === field ? "adm-form__row--invalid" : "");

  return (
    <form action={formAction} className="adm-form">
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      {error ? <Notice tone="error">{error.message}</Notice> : null}

      {error?.duplicate ? (
        <div className="adm-dupe">
          <p className="ds-body-sm adm-dupe__body">
            The existing profile is <strong>{error.duplicate.companyName}</strong> (
            {error.duplicate.accountEmail}, status {error.duplicate.status}). If that is the same
            business, stop here and use it — two profiles means two payout destinations for one
            operator, and the wrong one can be paid.
          </p>
          <label className="adm-dupe__confirm ds-body-sm">
            <input
              type="checkbox"
              name="confirmDuplicate"
              checked={confirmDuplicate}
              onChange={(e) => setConfirmDuplicate(e.target.checked)}
            />
            <span>
              I have checked. This is a different business that happens to share the name — create it
              anyway.
            </span>
          </label>
        </div>
      ) : null}

      <section className="adm-form__section">
        <h2 className="ds-body-lg adm-form__legend">The business</h2>
        <div className="adm-form__grid">
          <div className={`adm-form__row adm-form__row--wide ${invalid("companyName")}`}>
            <Field
              label="Company name"
              name="companyName"
              value={values.companyName}
              onChange={set("companyName")}
              placeholder="Whitsunday Sailing Co"
              autoComplete="off"
              required
              disabled={pending}
            />
          </div>
          <div className={`adm-form__row adm-form__row--wide ${invalid("payoutContactEmail")}`}>
            <Field
              label="Payout contact email"
              name="payoutContactEmail"
              value={values.payoutContactEmail}
              onChange={set("payoutContactEmail")}
              type="email"
              inputMode="email"
              placeholder="accounts@operator.com"
              hint="Becomes their account"
              autoComplete="off"
              required
              disabled={pending}
            />
          </div>
          <div className="adm-form__row">
            <Field
              label="WhatsApp"
              name="whatsappE164"
              value={values.whatsappE164}
              onChange={set("whatsappE164")}
              type="tel"
              inputMode="tel"
              placeholder="+61400000000"
              hint="Optional"
              autoComplete="off"
              disabled={pending}
            />
          </div>
          <div className="adm-form__row">
            <Field
              label="Website"
              name="websiteUrl"
              value={values.websiteUrl}
              onChange={set("websiteUrl")}
              inputMode="url"
              placeholder="operator.com"
              hint="Optional"
              autoComplete="off"
              disabled={pending}
            />
          </div>
          <div className={`adm-form__row ${invalid("country")}`}>
            <Field
              label="Country"
              name="country"
              value={values.country}
              onChange={set("country")}
              placeholder="AU"
              hint="Two-letter code"
              autoComplete="off"
              disabled={pending}
            />
          </div>
        </div>
      </section>

      <section className="adm-form__section">
        <h2 className="ds-body-lg adm-form__legend">How they get paid</h2>

        <div className="adm-choice" role="radiogroup" aria-label="Payout method">
          {PAYOUT_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`adm-choice__option ${payoutMethod === option.value ? "is-active" : ""}`}
            >
              <input
                type="radio"
                name="payoutMethod"
                value={option.value}
                checked={payoutMethod === option.value}
                onChange={() => setPayoutMethod(option.value)}
                disabled={pending}
              />
              <span className="ds-body-sm adm-choice__label">{option.label}</span>
              <span className="ds-micro adm-choice__hint">{option.hint}</span>
            </label>
          ))}
        </div>

        <div className="adm-form__grid adm-form__grid--conditional">
          {payoutMethod === "MANUAL_BANK_TRANSFER" ? (
            <BankDetailsFields country={values.country} optionalWhenEmpty disabled={pending} />
          ) : null}

          {payoutMethod === "STRIPE_CONNECT" ? (
            <div className={`adm-form__row adm-form__row--wide ${invalid("stripeConnectAccountId")}`}>
              <Field
                label="Stripe Connect account ID"
                name="stripeConnectAccountId"
                value={values.stripeConnectAccountId}
                onChange={set("stripeConnectAccountId")}
                placeholder="acct_1234567890"
                hint="Recorded, not created"
                autoComplete="off"
                disabled={pending}
              />
              <span className="ds-micro adm-form__help">
                Paste an account that already exists. Connect onboarding is started by Kai through the
                admin bridge — nothing on this page talks to Stripe.
              </span>
            </div>
          ) : null}

          {payoutMethod === "AIRWALLEX" ? (
            <div className="adm-form__row adm-form__row--wide">
              <Field
                label="Airwallex reference"
                name="airwallexReference"
                value={values.airwallexReference}
                onChange={set("airwallexReference")}
                placeholder="Beneficiary ID, account reference, or whatever BD supplied"
                hint="Optional"
                autoComplete="off"
                disabled={pending}
              />
              <span className="ds-micro adm-form__help">
                Forward-looking: there is no live Airwallex account yet, so anything you have is worth
                recording and nothing here is validated.
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="adm-form__section">
        <h2 className="ds-body-lg adm-form__legend">Rezdy</h2>
        <div className="adm-form__grid">
          <div className="adm-form__row adm-form__row--wide">
            <Field
              label="Rezdy supplier ID"
              name="rezdySupplierId"
              value={values.rezdySupplierId}
              onChange={set("rezdySupplierId")}
              placeholder="e.g. 123456"
              hint="Fill this in if you know it"
              autoComplete="off"
              disabled={pending}
            />
            <span className="ds-micro adm-form__help">
              Worth chasing on the call. This is the exact key the Rezdy sync matches on — with it,
              this operator&rsquo;s products attach to the profile you are creating now. Without it, the
              sync falls back to matching on company name, and if that misses you end up with a second
              placeholder account holding the listings while the payout details sit here.
            </span>
          </div>
        </div>
      </section>

      <div className="adm-form__submit">
        <Button type="submit" variant="primary" large magnetic={false} disabled={pending}>
          {pending ? "Creating…" : "Create operator"}
        </Button>
        <span className="ds-micro adm-form__submit-note">
          Creates a live operator profile immediately — your review is the vetting step, so this does
          not go into the approvals queue.
        </span>
      </div>
    </form>
  );
}
