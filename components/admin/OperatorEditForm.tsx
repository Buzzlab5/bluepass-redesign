"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import Field from "@/components/auth/Field";
import BankDetailsFields from "@/components/payout/BankDetailsFields";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import StatusPill, { type PillTone } from "@/components/admin/StatusPill";
import OperatorLoginInvite from "@/components/admin/OperatorLoginInvite";
import {
  updateOperatorBasicInfoAction,
  updateOperatorPayoutAction,
  type OperatorEditState,
} from "@/app/admin/operators/[id]/actions";
import type { OperatorEditView } from "@/lib/services/admin/operator-edit";

const IDLE: OperatorEditState = { status: "idle" };

type PayoutMethod = "MANUAL_BANK_TRANSFER" | "STRIPE_CONNECT" | "AIRWALLEX";

const PAYOUT_OPTIONS: { value: PayoutMethod; label: string; hint: string }[] = [
  {
    value: "MANUAL_BANK_TRANSFER",
    label: "Manual bank transfer",
    hint: "Commission is paid out by hand against these details.",
  },
  {
    value: "STRIPE_CONNECT",
    label: "Stripe Connect",
    hint: "Records a Connect account Kai has already created via the admin bridge.",
  },
  {
    value: "AIRWALLEX",
    label: "Airwallex",
    hint: "The Indonesia rail — record whatever reference is available.",
  },
];

const STATUS_TONES: Record<string, PillTone> = {
  LIVE: "good",
  APPROVED: "good",
  PENDING_REVIEW: "warn",
  DECLINED: "bad",
};

/**
 * Edits a real, already-existing operator profile — the counterpart to OperatorOnboardingForm,
 * which only ever creates one. Split into two independent forms/actions (business details, payout)
 * rather than one big submit: they touch different fields, fail independently, and a payout change
 * is deliberately gated behind its own confirmation checkbox the same way the operator's own
 * self-service payout form is (app/operator).
 */
export default function OperatorEditForm({ operator }: { operator: OperatorEditView }) {
  return (
    <div className="adm-form" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section className="adm-form__section">
        <h2 className="ds-body-lg adm-form__legend">Status</h2>
        <dl className="adm-facts">
          <div className="adm-facts__row">
            <dt className="ds-micro adm-facts__label">Status</dt>
            <dd className="ds-body-sm adm-facts__value">
              <StatusPill tone={STATUS_TONES[operator.status] ?? "muted"}>{operator.status}</StatusPill>
            </dd>
          </div>
          <div className="adm-facts__row">
            <dt className="ds-micro adm-facts__label">Account email</dt>
            <dd className="ds-body-sm adm-facts__value">{operator.accountEmail}</dd>
          </div>
          <div className="adm-facts__row">
            <dt className="ds-micro adm-facts__label">Payout details on file</dt>
            <dd className="ds-body-sm adm-facts__value">{operator.hasPayoutDetails ? "Yes" : "No"}</dd>
          </div>
        </dl>

        {/* Onboarding only ever showed this once, right when the profile was created - an admin
            working through a batch of operators (or one whose invite email bounced or was typed
            wrong) had no way back to it afterwards. Same component the onboarding form uses;
            it's already safe to press more than once. */}
        <OperatorLoginInvite operatorProfileId={operator.id} email={operator.accountEmail} />
      </section>

      <BasicInfoSection operator={operator} />
      <PayoutSection operator={operator} />

      <Link href="/admin/operators" className="ds-body-sm">
        ← Back to all operators
      </Link>
    </div>
  );
}

function BasicInfoSection({ operator }: { operator: OperatorEditView }) {
  const action = updateOperatorBasicInfoAction.bind(null, operator.id);
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [values, setValues] = useState({
    companyName: operator.companyName ?? "",
    whatsappE164: operator.whatsappE164 ?? "",
    websiteUrl: operator.websiteUrl ?? "",
    country: operator.country ?? "",
    rezdySupplierId: operator.rezdySupplierId ?? "",
  });

  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const error = state.status === "error" ? state : undefined;
  const invalid = (field: string) => (error?.field === field ? "adm-form__row--invalid" : "");

  return (
    <form action={formAction} className="adm-form__section">
      <h2 className="ds-body-lg adm-form__legend">The business</h2>
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
      {error ? <Notice tone="error">{error.message}</Notice> : null}

      <div className="adm-form__grid">
        <div className={`adm-form__row adm-form__row--wide ${invalid("companyName")}`}>
          <Field
            label="Company name"
            name="companyName"
            value={values.companyName}
            onChange={set("companyName")}
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
        <div className={`adm-form__row adm-form__row--wide ${invalid("rezdySupplierId")}`}>
          <Field
            label="Rezdy supplier ID"
            name="rezdySupplierId"
            value={values.rezdySupplierId}
            onChange={set("rezdySupplierId")}
            placeholder="e.g. 123456"
            hint="Clearing this detaches the operator from Rezdy sync matching"
            autoComplete="off"
            disabled={pending}
          />
        </div>
      </div>

      <div className="adm-form__submit">
        <Button type="submit" variant="secondary" magnetic={false} disabled={pending}>
          {pending ? "Saving…" : "Save business details"}
        </Button>
      </div>
    </form>
  );
}

function PayoutSection({ operator }: { operator: OperatorEditView }) {
  const action = updateOperatorPayoutAction.bind(null, operator.id);
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>(operator.payoutMethod);
  const [values, setValues] = useState({
    bankDetails: "",
    airwallexReference: "",
    stripeConnectAccountId: operator.stripeConnectAccountId ?? "",
  });
  const [confirm, setConfirm] = useState(false);

  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const error = state.status === "error" ? state : undefined;
  const invalid = (field: string) => (error?.field === field ? "adm-form__row--invalid" : "");

  return (
    <form action={formAction} className="adm-form__section">
      <h2 className="ds-body-lg adm-form__legend">How they get paid</h2>
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
      {error ? <Notice tone="error">{error.message}</Notice> : null}

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
          <BankDetailsFields country={operator.country} hasDetailsOnFile={operator.hasPayoutDetails} optionalWhenEmpty disabled={pending} />
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
              hint={operator.hasPayoutDetails ? "Leave blank to keep what's on file" : "Optional"}
              autoComplete="off"
              disabled={pending}
            />
          </div>
        ) : null}
      </div>

      <label className="adm-dupe__confirm ds-body-sm" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          name="confirm"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
          disabled={pending}
        />
        <span>I've checked this — saving changes where this operator's payout is sent.</span>
      </label>

      <div className="adm-form__submit">
        <Button type="submit" variant="secondary" magnetic={false} disabled={pending || !confirm}>
          {pending ? "Saving…" : "Save payout details"}
        </Button>
      </div>
    </form>
  );
}
