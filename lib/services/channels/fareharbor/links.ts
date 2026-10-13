/**
 * FareHarbor booking links, read and written.
 *
 * FareHarbor gives affiliates below its API threshold no data access: no item feed,
 * no availability, no booking notifications. What it does give is the affiliate link:
 * the operator's own checkout, opened with Bluepass's affiliate shortname (`asn`), so
 * the booking lands in their FareHarbor tagged as Bluepass's and the commission is
 * tracked there. FareHarbor takes the payment and runs refunds.
 *
 * URL shapes and parameter names follow FareHarbor's own WordPress plugin and its
 * Lightframe docs: `asn`, `asn-ref` (the affiliate voucher number) and `ref` on the
 * URL; `asn`, `asnRef` and `ref` in `FH.open()`.
 */

export type FareHarborLink = {
  shortname: string;
  itemId: string | null;
  flow: string | null;
  availabilityId: string | null;
  asn: string | null;
  ref: string | null;
};

const SHORTNAME = /^[a-z0-9][a-z0-9_-]{1,79}$/;

/**
 * Reads any FareHarbor link an operator might paste: an embed link
 * (fareharbor.com/embeds/book/<shortname>/items/<id>/...), a full-page link
 * (fareharbor.com/<shortname>/items/<id>/...), or the bare shortname.
 */
export function parseFareHarborLink(input: string): FareHarborLink | null {
  const raw = input.trim();
  if (!raw) return null;
  if (SHORTNAME.test(raw.toLowerCase()) && !raw.includes(".")) {
    return { shortname: raw.toLowerCase(), itemId: null, flow: null, availabilityId: null, asn: null, ref: null };
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/(^|\.)fareharbor\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean).map((p) => p.toLowerCase());
  const start = parts[0] === "embeds" && parts[1] === "book" ? 2 : 0;
  const shortname = parts[start];
  if (!shortname || !SHORTNAME.test(shortname) || ["embeds", "api", "help", "submit"].includes(shortname)) return null;
  const rest = parts.slice(start + 1);
  const itemAt = rest.indexOf("items");
  const itemId = itemAt >= 0 && /^\d+$/.test(rest[itemAt + 1] ?? "") ? rest[itemAt + 1] : null;
  const availAt = rest.indexOf("availability");
  const availabilityId = availAt >= 0 && /^\d+$/.test(rest[availAt + 1] ?? "") ? rest[availAt + 1] : null;
  const flow = url.searchParams.get("flow");
  return {
    shortname,
    itemId,
    flow: flow && /^\d+$/.test(flow) ? flow : null,
    availabilityId,
    asn: url.searchParams.get("asn")?.toLowerCase() || null,
    ref: url.searchParams.get("ref") || null,
  };
}

/** Bluepass's affiliate shortname on FareHarbor, once FareHarbor has issued it. */
export function fareHarborAffiliate(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.FAREHARBOR_AFFILIATE_SHORTNAME?.trim().toLowerCase();
  return value && SHORTNAME.test(value) ? value : null;
}

/** What every Bluepass hand-off is labelled with in the operator's dashboard. */
export const FAREHARBOR_REF = "bluepass";

/** The operator's checkout for one trip, tagged as Bluepass's, carrying the hand-off's reference. */
export function fareHarborBookingUrl(link: FareHarborLink, opts: { asn: string; asnRef?: string | null }): string {
  const path = link.itemId ? `items/${link.itemId}/` : "items/";
  const url = new URL(`https://fareharbor.com/embeds/book/${link.shortname}/${path}`);
  url.searchParams.set("full-items", "yes");
  if (link.flow) url.searchParams.set("flow", link.flow);
  url.searchParams.set("asn", opts.asn);
  if (opts.asnRef) url.searchParams.set("asn-ref", opts.asnRef);
  url.searchParams.set("ref", FAREHARBOR_REF);
  return url.toString();
}

/** The same, for FareHarbor's Lightframe, which opens the checkout over Bluepass's page. */
export function fareHarborLightframe(link: FareHarborLink, opts: { asn: string; asnRef?: string | null }) {
  return {
    shortname: link.shortname,
    ...(link.itemId ? { view: { item: Number(link.itemId) } } : {}),
    ...(link.flow ? { flow: Number(link.flow) } : {}),
    asn: opts.asn,
    ...(opts.asnRef ? { asnRef: opts.asnRef } : {}),
    ref: FAREHARBOR_REF,
    fullItems: "yes",
    fallback: "simple",
  };
}

export const FAREHARBOR_AFFILIATE_REQUEST_URL = "https://fareharbor.com/submit/new-affiliate-request/";

export const FAREHARBOR_LINK_STEPS = [
  "If Bluepass is not one of your affiliates yet, send FareHarbor a New Affiliate Request for Bluepass. They add it to your dashboard.",
  "In FareHarbor, open Settings, then Book Buttons & Embeds, and choose Book button or link for the trip.",
  "Under Advanced settings, set ASN company to Bluepass, copy the link and paste it here.",
];
