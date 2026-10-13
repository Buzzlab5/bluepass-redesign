import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminTabs from "@/components/admin/AdminTabs";
import ReviewCard from "@/components/admin/ReviewCard";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listPendingApprovals, type ReviewItem } from "@/lib/services/admin/review-queue";

export const metadata = { title: "Approvals · Bluepass Admin" };

export default async function ApprovalsPage() {
  await requireAdminOrRedirect("/admin/approvals");

  const { claims, applications } = await listPendingApprovals();
  const total = claims.length + applications.length;

  /* Split rather than a single merged list: a partner application and an operator application are
     different decisions with different consequences (a referral link either way, but a company
     versus a person), and the merged list sorted everyone by wait time alone — a same-day partner
     application could sit invisible below a stack of week-old operator ones. */
  const partnerApplications = applications.filter((item) => item.kind === "partner-application");
  const operatorApplications = applications.filter((item) => item.kind === "operator-application");

  return (
    <>
      <AdminPageHeader
        title="Approvals"
        support={
          total === 0
            ? "Nothing is waiting on a decision right now."
            : `${total} ${total === 1 ? "submission is" : "submissions are"} waiting on a decision.`
        }
      />

      <AdminTabs
        tabs={[
          {
            id: "claims",
            label: "Operator claims",
            count: claims.length,
            content: (
              <ReviewList
                items={claims}
                empty="No operator is waiting to claim their page."
                note="Approving a claim also moves that operator's own profile to approved and provisions their referral link — you do not need to action it separately."
              />
            ),
          },
          {
            id: "partner-applications",
            label: "Partners",
            count: partnerApplications.length,
            content: (
              <ReviewList
                items={partnerApplications}
                empty="No partner applications are waiting."
                note="Approving provisions a referral partner and a live referral link for the applicant."
              />
            ),
          },
          {
            id: "operator-applications",
            label: "Operators",
            count: operatorApplications.length,
            content: (
              <ReviewList
                items={operatorApplications}
                empty="No operator applications are waiting."
                note="Approving provisions a referral partner and a live referral link for the applicant."
              />
            ),
          },
        ]}
      />
    </>
  );
}

function ReviewList({
  items,
  empty,
  note,
}: {
  items: ReviewItem[];
  empty: string;
  note: string;
}) {
  if (!items.length) {
    return (
      <div className="adm-card adm-empty">
        <p className="ds-body adm-empty__title">{empty}</p>
        <p className="ds-body-sm adm-empty__body">
          New submissions land here as soon as they are sent — this page reads live.
        </p>
      </div>
    );
  }

  return (
    <div className="adm-list">
      <p className="ds-caption adm-list__note">{note}</p>
      {items.map((item) => (
        <ReviewCard key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  );
}
