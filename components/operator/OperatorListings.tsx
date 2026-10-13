"use client";

import { useActionState, useState } from "react";
import StatusPill, { type PillTone } from "@/components/admin/StatusPill";
import { formatDateTime } from "@/lib/services/admin/payouts";
import Button from "@/components/ui/Button";
import Notice from "@/components/auth/Notice";
import OperatorListingForm from "@/components/operator/OperatorListingForm";
import { publishListingAction, type OperatorSettingsState } from "@/app/operator/actions";
import type { OperatorListingRow } from "@/lib/services/operator/dashboard";

const LISTING_TONES: Record<string, PillTone> = {
  LIVE: "good",
  DRAFT: "warn",
  ARCHIVED: "muted",
};

const IDLE: OperatorSettingsState = { status: "idle" };

/**
 * The operator's listings. `editable` (true only for an operator with no Rezdy link — see
 * app/operator/page.tsx) unlocks creating/editing DRAFT listings and publishing them; a
 * Rezdy-synced operator, or a LIVE listing on any operator, still renders read-only, same as
 * before this pass — the "editing is coming" copy only shows when it genuinely isn't available yet.
 */
export default function OperatorListings({
  listings,
  editable,
}: {
  listings: OperatorListingRow[];
  editable: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section className="adm-block">
      <header className="adm-block__head">
        <h2 className="ds-headline adm-block__title">Your listing{listings.length === 1 ? "" : "s"}</h2>
        <p className="ds-caption adm-block__note">
          {editable
            ? "What Bluepass is showing travellers on your behalf. Create a draft, edit it, then publish when it's ready — a published listing can't be edited directly here."
            : "What Bluepass is showing travellers on your behalf. Your listing is managed by the Rezdy sync, not this page — changes go through your Bluepass contact."}
        </p>
      </header>

      {editable && !creating ? (
        <Button variant="secondary" magnetic={false} onClick={() => setCreating(true)}>
          + New listing
        </Button>
      ) : null}

      {creating ? <OperatorListingForm onDone={() => setCreating(false)} /> : null}

      {listings.length === 0 && !creating ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">No listing yet.</p>
          <p className="ds-body-sm adm-empty__body">
            {editable
              ? "Create a draft above to get your first listing started."
              : "Nothing of yours is published on Bluepass at the moment. If you were expecting a listing here, your Bluepass contact can tell you where it is up to."}
          </p>
        </div>
      ) : (
        <div className="adm-list">
          {listings.map((listing) =>
            editingId === listing.id ? (
              <OperatorListingForm key={listing.id} listing={listing} onDone={() => setEditingId(null)} />
            ) : (
              <ListingCard
                key={listing.id}
                listing={listing}
                editable={editable}
                onEdit={() => setEditingId(listing.id)}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function ListingCard({
  listing,
  editable,
  onEdit,
}: {
  listing: OperatorListingRow;
  editable: boolean;
  onEdit: () => void;
}) {
  const [publishState, publishFormAction, publishPending] = useActionState(
    publishListingAction.bind(null, listing.id),
    IDLE,
  );
  const canEdit = editable && listing.status === "DRAFT";
  const canPublish = editable && listing.status === "DRAFT" && publishState.status !== "done";

  return (
    <article className="adm-card adm-review">
      <header className="adm-review__head">
        <div className="adm-review__ident">
          <h3 className="ds-body-lg adm-review__title">{listing.title}</h3>
          <span className="ds-micro adm-ledger__kind">
            {listing.category} · {listing.region}
          </span>
        </div>
        <StatusPill tone={LISTING_TONES[listing.status] ?? "muted"}>{listing.status}</StatusPill>
      </header>

      <dl className="adm-facts">
        <div className="adm-facts__row">
          <dt className="ds-micro adm-facts__label">Price shown</dt>
          {/* `priceSignal` is free text an operator or an import wrote, so it is shown
              exactly as stored — inventing "From $0" for a listing that never had a price
              would put a number on the page that nobody chose. */}
          <dd className="ds-body-sm adm-facts__value">{listing.priceSignal ?? "No price shown"}</dd>
        </div>
        <div className="adm-facts__row">
          <dt className="ds-micro adm-facts__label">Published</dt>
          <dd className="ds-body-sm adm-facts__value">
            {listing.publishedAt ? formatDateTime(listing.publishedAt) : "Not published"}
          </dd>
        </div>
      </dl>

      {canEdit ? (
        <div className="adm-form__submit" style={{ marginTop: 12 }}>
          <Button variant="secondary" magnetic={false} onClick={onEdit}>
            Edit draft
          </Button>
          {canPublish ? (
            <form action={publishFormAction}>
              <Button type="submit" variant="primary" magnetic={false} disabled={publishPending}>
                {publishPending ? "Publishing…" : "Publish"}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {publishState.status === "error" ? <Notice tone="error">{publishState.message}</Notice> : null}
      {publishState.status === "done" ? <Notice tone="success">{publishState.message}</Notice> : null}
    </article>
  );
}
