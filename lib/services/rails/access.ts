/**
 * Whether an operator can use the booking console.
 *
 * Every operator can. Each trip says where its seats live (Bluepass's own calendar,
 * the operator's Rezdy, or their FareHarbor), so an operator on Rezdy sees their Rezdy
 * trips and the bookings Bluepass made on them, and the seats are never kept in two
 * places. Kept as a function, with its old shape, so a future reason to close the
 * console to someone has one place to live.
 */
export type RailsAccess =
  | { enabled: true }
  | { enabled: false; platform: string; reason: string };

export async function railsAccess(_profile: { id: string; rezdySupplierId: string | null }): Promise<RailsAccess> {
  return { enabled: true };
}
