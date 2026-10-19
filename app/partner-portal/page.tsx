import AdminPageHeader from "@/components/admin/AdminPageHeader";
import PartnerCommissionStats from "@/components/partner/PartnerCommissionStats";
import PartnerPayoutSettings from "@/components/partner/PartnerPayoutSettings";
import PartnerProfileSettings from "@/components/partner/PartnerProfileSettings";
import PartnerReferralLinks from "@/components/partner/PartnerReferralLinks";
import CreatorRequests, { type CreatorRequest } from "@/components/partner/CreatorRequests";
import { markFeaturedAction, respondToPickAction } from "@/app/partner-portal/actions";
import { campaignsForCreator } from "@/lib/services/onboarding/creator-campaigns";
import { loadPartnerCommissionSummary, loadPartnerReferralLinks } from "@/lib/services/partner/dashboard";
import { requirePartnerOrRedirect } from "@/lib/services/partner/guard";
import { getRequestablePartnerBalance } from "@/lib/services/partner/payout-requests";
import { hasStoredPartnerPayoutDetails } from "@/lib/services/partner/payout-settings";

export const metadata = { title: "Your partner dashboard · Bluepass" };

/**
 * What a partner sees when they sign in: their referral link and how it's doing, what they've
 * earned, and their own profile to edit. The gate runs again here for the same reason the operator
 * page's does — see requireOperatorOrRedirect.
 */
export default async function PartnerDashboardPage() {
  const { profile } = await requirePartnerOrRedirect("/partner-portal");
  const referralPartnerId = profile.referralPartnerId;

  const [links, commissionSummary, balances, hasPayoutDetails, requests] = await Promise.all([
    loadPartnerReferralLinks(referralPartnerId),
    loadPartnerCommissionSummary(referralPartnerId),
    referralPartnerId ? getRequestablePartnerBalance(referralPartnerId) : Promise.resolve([]),
    hasStoredPartnerPayoutDetails(profile.id),
    campaignsForCreator(profile.id),
  ]);

  return (
    <>
      <AdminPageHeader
        title={profile.handle ?? "Your partner dashboard"}
        support="Your referral link, what it's earned so far, and your own profile."
      />

      <CreatorRequests requests={requests as CreatorRequest[]} actions={{ respond: respondToPickAction, featured: markFeaturedAction }} />
      <PartnerReferralLinks status={profile.status} links={links} />
      <PartnerCommissionStats summary={commissionSummary} balances={balances} />
      <PartnerPayoutSettings hasDetailsOnFile={hasPayoutDetails} />
      <PartnerProfileSettings profile={profile} />
    </>
  );
}
