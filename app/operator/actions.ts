"use server";

import "@/lib/validation/zod-messages";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import {
  updateOperatorCancellationPolicy,
  updateOperatorPayoutDetails,
} from "@/lib/services/operator/payout-settings";
import {
  createDraftListing,
  operatorListingInputSchema,
  publishListing,
  updateDraftListing,
} from "@/lib/services/operators/operator-listing-service";

export type OperatorSettingsState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string; field?: string };

/**
 * Both actions below re-derive the operator themselves rather than trusting the page-load gate, for
 * the same reason every write in the admin console does: the layout's check finished before these
 * buttons existed on screen. A tab left open after the profile was detached still holds a fully
 * rendered form.
 *
 * The stronger reason here is that the identity *is* the authorisation. There is no profile id in
 * the submitted form — it is read from the signed-in session every time, so a tampered payload
 * cannot aim this at another operator's payout details. That is why neither action accepts one.
 */
async function requireOperator() {
  const access = await currentOperatorAccess();

  if (!access.ok) {
    return {
      failure: {
        status: "error" as const,
        message:
          access.reason === "SIGNED_OUT"
            ? "Your session has expired. Sign in again and retry — nothing was changed."
            : "This account can no longer edit that operator profile. Nothing was changed.",
      },
    };
  }

  return { access };
}

export async function updatePayoutDetailsAction(
  _previous: OperatorSettingsState,
  formData: FormData,
): Promise<OperatorSettingsState> {
  const { access, failure } = await requireOperator();

  if (failure) {
    return failure;
  }

  const text = (field: string) => {
    const value = formData.get(field);
    return typeof value === "string" ? value.trim() : "";
  };

  /* The confirmation is enforced server-side, not just rendered. A form that reached this action
     without it is not a form this page produced. */
  if (formData.get("confirm") !== "on") {
    return {
      status: "error",
      message: "Confirm the change before saving — this decides where your money is sent.",
    };
  }

  const result = await updateOperatorPayoutDetails({
    operatorProfileId: access.profile.id,
    updatedByEmail: access.account.email,
    payoutMethod: text("payoutMethod") as never,
    bankDetails: text("bankDetails"),
    airwallexReference: text("airwallexReference"),
  });

  if (!result.ok) {
    return { status: "error", message: result.message, field: result.field };
  }

  revalidatePath("/operator");

  return {
    status: "done",
    message: "Payout details saved. Bluepass will use these for your next payout.",
  };
}

export async function updateCancellationPolicyAction(
  _previous: OperatorSettingsState,
  formData: FormData,
): Promise<OperatorSettingsState> {
  const { access, failure } = await requireOperator();

  if (failure) {
    return failure;
  }

  /* Rows arrive as parallel `days`/`percent` entries in DOM order, which is the order the operator
     sees them in. They are zipped back into tiers here and validated as a whole — the ordering
     rules are properties of the list, not of any single row. */
  const days = formData.getAll("minDaysBeforeDeparture");
  const percents = formData.getAll("refundPercent");

  if (days.length !== percents.length) {
    return { status: "error", message: "That form was malformed. Reload the page and try again." };
  }

  const tiers = days.map((value, index) => ({
    minDaysBeforeDeparture: toNumber(value),
    refundPercent: toNumber(percents[index]),
  }));

  const result = await updateOperatorCancellationPolicy({
    operatorProfileId: access.profile.id,
    updatedByEmail: access.account.email,
    tiers,
  });

  if (!result.ok) {
    return { status: "error", message: result.message, field: result.field };
  }

  revalidatePath("/operator");

  return {
    status: "done",
    message: "Cancellation policy saved. It applies to cancellations from now on.",
  };
}

function listingFieldsFromForm(formData: FormData) {
  const text = (field: string) => {
    const value = formData.get(field);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  return {
    title: text("title") ?? "",
    category: text("category") ?? "",
    region: text("region") ?? "",
    description: text("description") ?? "",
    heroImageUrl: text("heroImageUrl"),
    maxGuests: text("maxGuests"),
    priceFrom: text("priceFrom"),
    priceSignal: text("priceSignal"),
    currency: text("currency"),
  };
}

/**
 * Listings are only self-editable for an operator with no Rezdy link: a Rezdy-synced operator's
 * listing content is meant to come from the daily sync (see rezdy-agent-sync.ts), and letting them
 * hand-edit the same row here would just have their edit overwritten by the next sync run. This is
 * a UI-level restriction too (OperatorListings only renders the editor when unlinked), checked again
 * here since a server action must not trust that the page enforced it.
 */
function requireEditableOperator(access: Extract<Awaited<ReturnType<typeof currentOperatorAccess>>, { ok: true }>) {
  if (access.profile.rezdySupplierId) {
    return {
      status: "error" as const,
      message: "This operator's listing is managed by the Rezdy sync, not this form.",
    };
  }

  return null;
}

export async function createListingAction(
  _previous: OperatorSettingsState,
  formData: FormData,
): Promise<OperatorSettingsState> {
  const { access, failure } = await requireOperator();
  if (failure) return failure;

  const blocked = requireEditableOperator(access);
  if (blocked) return blocked;

  const parsed = operatorListingInputSchema.safeParse(listingFieldsFromForm(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "error",
      message: issue?.message ?? "Please check these details and try again.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }

  let created: Awaited<ReturnType<typeof createDraftListing>>;
  try {
    created = await createDraftListing({ ...parsed.data, accountId: access.account.id });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not create the listing." };
  }

  revalidatePath("/operator", "layout");
  /* Started from the Trips page, the next thing an operator needs is that trip's schedule and price:
     take them straight there rather than leaving them on a "created" card to find their own way. */
  if (formData.get("next") === "trip-setup") redirect(`/operator/trips/${created.id}`);
  return { status: "done", message: "Draft listing created. Publish it when you're ready for travellers to see it." };
}

export async function updateListingAction(
  listingId: string,
  _previous: OperatorSettingsState,
  formData: FormData,
): Promise<OperatorSettingsState> {
  const { access, failure } = await requireOperator();
  if (failure) return failure;

  const blocked = requireEditableOperator(access);
  if (blocked) return blocked;

  const parsed = operatorListingInputSchema.safeParse(listingFieldsFromForm(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "error",
      message: issue?.message ?? "Please check these details and try again.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }

  try {
    await updateDraftListing({ ...parsed.data, listingId, accountId: access.account.id });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not save the listing." };
  }

  revalidatePath("/operator");
  return { status: "done", message: "Draft saved." };
}

export async function publishListingAction(
  listingId: string,
  _previous: OperatorSettingsState,
  _formData: FormData,
): Promise<OperatorSettingsState> {
  const { access, failure } = await requireOperator();
  if (failure) return failure;

  const blocked = requireEditableOperator(access);
  if (blocked) return blocked;

  try {
    await publishListing({ listingId, accountId: access.account.id });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not publish the listing." };
  }

  revalidatePath("/operator", "layout");
  return { status: "done", message: "Published — travellers can see this listing now." };
}

/**
 * An empty or non-numeric field becomes NaN rather than 0.
 *
 * `Number("")` is 0, which would turn a row the operator left blank into a real "0 days, 0% refund"
 * tier — a policy they never wrote. NaN fails the schema and is reported back instead.
 */
function toNumber(value: FormDataEntryValue) {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? Number.NaN : Number(text);
}
