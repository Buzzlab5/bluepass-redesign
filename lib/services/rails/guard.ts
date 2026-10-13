import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { railsAccess, type RailsAccess } from "@/lib/services/rails/access";

/**
 * The gate for every booking-CMS page: an operator, and one who sells through the
 * native rails. The page renders its own explanation when the second check fails,
 * because a Rezdy operator who follows an old link deserves to be told where their
 * bookings are, not bounced to a login form.
 */
export async function requireRailsOperator(next: string) {
  const access = await requireOperatorOrRedirect(next);
  const rails: RailsAccess = await railsAccess(access.profile);
  return { ...access, rails };
}
