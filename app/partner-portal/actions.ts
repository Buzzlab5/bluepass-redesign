"use server";

import { revalidatePath } from "next/cache";
import { createPartnerReferralLink } from "@/lib/services/partner/dashboard";
import { currentPartnerAccess } from "@/lib/services/partner/guard";
import { createPartnerPayoutRequest } from "@/lib/services/partner/payout-requests";
import { updatePartnerPayoutDetails } from "@/lib/services/partner/payout-settings";
import { updatePartnerProfileDetails } from "@/lib/services/partner/profile-settings";
import { markFeatured, respondToPick } from "@/lib/services/onboarding/creator-campaigns";

export type PartnerSettingsState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string; field?: string };

export type CreateReferralLinkState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

export type PayoutRequestState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

/**
 * Re-derives the partner from the session rather than trusting the page-load gate, for the same
 * reason every write in the operator console does (see app/operator/actions.ts) — and there is no
 * profile id in the submitted form, so a tampered payload cannot aim this at another partner's
 * profile.
 */
async function requirePartner() {
  const access = await currentPartnerAccess();

  if (!access.ok) {
    return {
      failure: {
        status: "error" as const,
        message:
          access.reason === "SIGNED_OUT"
            ? "Your session has expired. Sign in again and retry — nothing was changed."
            : "This account can no longer edit that partner profile. Nothing was changed.",
      },
    };
  }

  return { access };
}

export async function updatePartnerProfileAction(
  _previous: PartnerSettingsState,
  formData: FormData,
): Promise<PartnerSettingsState> {
  const { access, failure } = await requirePartner();

  if (failure) {
    return failure;
  }

  const text = (field: string) => {
    const value = formData.get(field);
    return typeof value === "string" ? value : "";
  };

  const result = await updatePartnerProfileDetails({
    partnerProfileId: access.profile.id,
    handle: text("handle"),
    audienceUrl: text("audienceUrl"),
    instagramUrl: text("instagramUrl"),
    youtubeUrl: text("youtubeUrl"),
    tiktokUrl: text("tiktokUrl"),
  });

  if (!result.ok) {
    return { status: "error", message: result.message, field: result.field };
  }

  revalidatePath("/partner-portal");

  return { status: "done", message: "Profile saved." };
}

export async function createReferralLinkAction(
  _previous: CreateReferralLinkState,
  formData: FormData,
): Promise<CreateReferralLinkState> {
  const { access, failure } = await requirePartner();

  if (failure) {
    return failure;
  }

  if (access.profile.status !== "APPROVED" || !access.profile.referralPartnerId) {
    return { status: "error", message: "Your application needs to be approved before you can create links." };
  }

  const rawLabel = formData.get("label");
  const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
  const result = await createPartnerReferralLink(access.profile.referralPartnerId, {
    label: label || null,
  });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  revalidatePath("/partner-portal");
  revalidatePath("/partners");

  return { status: "done", message: "New link created." };
}

export async function updatePayoutDetailsAction(
  _previous: PartnerSettingsState,
  formData: FormData,
): Promise<PartnerSettingsState> {
  const { access, failure } = await requirePartner();

  if (failure) {
    return failure;
  }

  /* Enforced server-side, not just rendered - a form that reached this action without it is not
     one this page produced (see the same check in app/operator/actions.ts). */
  if (formData.get("confirm") !== "on") {
    return {
      status: "error",
      message: "Confirm the change before saving — this decides where your money is sent.",
    };
  }

  const rawBankDetails = formData.get("bankDetails");

  const result = await updatePartnerPayoutDetails({
    partnerProfileId: access.profile.id,
    updatedByEmail: access.account.email,
    bankDetails: typeof rawBankDetails === "string" ? rawBankDetails.trim() : "",
  });

  if (!result.ok) {
    return { status: "error", message: result.message, field: result.field };
  }

  revalidatePath("/partner-portal");

  return { status: "done", message: "Payout details saved. Bluepass will use these for your next payout." };
}

export async function requestPayoutAction(
  _previous: PayoutRequestState,
  formData: FormData,
): Promise<PayoutRequestState> {
  const { access, failure } = await requirePartner();

  if (failure) {
    return failure;
  }

  if (access.profile.status !== "APPROVED" || !access.profile.referralPartnerId) {
    return { status: "error", message: "Your application needs to be approved before you can request a payout." };
  }

  const currency = formData.get("currency");

  if (typeof currency !== "string" || !currency.trim()) {
    return { status: "error", message: "That request was malformed. Reload the page and try again." };
  }

  const result = await createPartnerPayoutRequest(access.profile.referralPartnerId, {
    currency: currency.trim(),
    requestedByAccountId: access.account.id,
  });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  revalidatePath("/partner-portal");
  revalidatePath("/admin/payouts");

  return { status: "done", message: "Payout requested. Bluepass will be in touch once it's sent." };
}

export type CreatorRequestState = { status: "idle" } | { status: "done" | "error"; message: string };

/** A creator answering an operator's pick. The creator comes from the session, never the form. */
export async function respondToPickAction(campaignId: string, accept: boolean): Promise<CreatorRequestState> {
  const access = await currentPartnerAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry." };
  const result = await respondToPick({ partnerProfileId: access.profile.id, campaignId, accept });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/partner-portal");
  return { status: "done", message: accept ? "Accepted. Your link is ready below." : "Declined. Thanks for letting them know." };
}

/** A creator sharing the post that features the operator. */
export async function markFeaturedAction(campaignId: string, _prev: CreatorRequestState, form: FormData): Promise<CreatorRequestState> {
  const access = await currentPartnerAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry." };
  const result = await markFeatured({ partnerProfileId: access.profile.id, campaignId, postUrl: String(form.get("postUrl") ?? "") });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/partner-portal");
  return { status: "done", message: "Thanks. Your share is paid once the operator's week to check it has passed." };
}
