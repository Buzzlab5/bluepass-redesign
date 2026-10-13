/**
 * Every link a booking message carries, built in one place so an email, a WhatsApp
 * message and the booking page never disagree about where something lives.
 */

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.BLUEPASS_APP_URL || "https://bluepass.co").replace(/\/$/, "");
}

/** The guest's own booking page. The token is the only key to it, so it is never an id. */
export function tripUrl(guestToken: string) {
  return `${siteUrl()}/trip/${guestToken}`;
}

export function tripCalendarFileUrl(guestToken: string) {
  return `${siteUrl()}/trip/${guestToken}/calendar.ics`;
}

function googleStamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Google Calendar's "add this event" page, prefilled. No account link or API call:
 * the traveller lands in their own calendar with one button to save.
 */
export function googleCalendarLink(input: { title: string; startsAt: Date; endsAt: Date; details: string; location?: string | null; timezone?: string }) {
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${googleStamp(input.startsAt)}/${googleStamp(input.endsAt)}`,
    details: input.details,
    ...(input.location ? { location: input.location } : {}),
    ...(input.timezone ? { ctz: input.timezone } : {}),
  });
  return `https://calendar.google.com/calendar/render?${query}`;
}

/** Digits only, for wa.me and the WhatsApp API. Null unless the number carries its country code. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "");
  if (!international || digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return digits;
}

/** Opens a WhatsApp chat with this number on whatever device taps it, optionally with a first line typed. */
export function whatsappChatLink(phone: string | null | undefined, text?: string) {
  const digits = whatsappDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** A Google Calendar "subscribe to this feed" link. Google only accepts it for a feed served over https. */
export function googleSubscribeLink(feedUrl: string) {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl.replace(/^https?:\/\//, "webcal://"))}`;
}

/** The same feed as a webcal:// link, which Apple Calendar and Outlook open as a subscription. */
export function webcalLink(feedUrl: string) {
  return feedUrl.replace(/^https?:\/\//, "webcal://");
}

/** Short link for an operator's WhatsApp button: one path segment, so Meta's URL variable can carry it. */
export function manifestShortPath(listingId: string, departsAt: Date) {
  return `/operator/m/${listingId}_${departsAt.getTime()}`;
}
