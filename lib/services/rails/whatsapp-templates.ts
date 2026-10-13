import type { WhatsAppSenderRole, WhatsAppTemplateComponent } from "@/lib/services/whatsapp/client";

/**
 * The WhatsApp messages the booking CMS sends, as Meta must approve them.
 *
 * WhatsApp only lets a business start a conversation with a pre-approved template,
 * so every message here is defined once, in this file, and the same definition both
 * builds the API call and prints the sheet the templates are submitted from
 * (docs/whatsapp-templates.md). Change a body here and it must be re-approved
 * before it will send.
 *
 * All are UTILITY: each is about a booking the person made, never a promotion. That
 * is the category Meta prices lowest and the one these messages honestly are. Bodies
 * never start or end on a variable and never put two variables side by side, which
 * Meta's review rejects.
 *
 * Traveller messages go from Kai's number, so a guest who replies is talking to the
 * same concierge they may have booked with. Operator messages go from the ops number.
 */

export type RailsTemplate = {
  name: string;
  language: string;
  audience: "traveller" | "operator";
  sender: WhatsAppSenderRole;
  /** Named variables in {{double braces}}, in the order Meta shows them. */
  body: string;
  params: string[];
  example: Record<string, string>;
  /** A link button. A URL ending in {{1}} takes the per-message value; any other URL is fixed. */
  button?: { text: string; url: string; example?: string };
};

const SITE = "https://bluepass.co";

export const RAILS_TEMPLATES = {
  bookingConfirmed: {
    name: "bluepass_booking_confirmed",
    language: "en",
    audience: "traveller",
    sender: "kai",
    body:
      "Hi {{guest_name}}, you're booked on {{trip}} with {{operator}}: {{when}}, {{guests}}. " +
      "Meet at {{meeting_point}}. Your booking reference is {{reference}}. Reply here with any questions.",
    params: ["guest_name", "trip", "operator", "when", "guests", "meeting_point", "reference"],
    example: {
      guest_name: "Mia",
      trip: "Outer Reef Snorkel Day",
      operator: "Reef Runner Charters",
      when: "Saturday 10 October at 8:00am",
      guests: "2 Adult, 1 Child",
      meeting_point: "Marina Pier B, Cairns",
      reference: "BP-7K3QX9",
    },
    button: { text: "View booking", url: `${SITE}/trip/{{1}}`, example: `${SITE}/trip/abc123` },
  },
  tripReminder: {
    name: "bluepass_trip_reminder",
    language: "en",
    audience: "traveller",
    sender: "kai",
    body:
      "Hi {{guest_name}}, a reminder that {{trip}} leaves {{when}}. Meet at {{meeting_point}}. {{note}} " +
      "Your booking reference is {{reference}} if the crew asks.",
    params: ["guest_name", "trip", "when", "meeting_point", "note", "reference"],
    example: {
      guest_name: "Mia",
      trip: "Outer Reef Snorkel Day",
      when: "tomorrow at 8:00am",
      meeting_point: "Marina Pier B, Cairns",
      note: "Check in 30 minutes early and bring reef-safe sunscreen.",
      reference: "BP-7K3QX9",
    },
    button: { text: "View booking", url: `${SITE}/trip/{{1}}`, example: `${SITE}/trip/abc123` },
  },
  bookingCancelled: {
    name: "bluepass_booking_cancelled",
    language: "en",
    audience: "traveller",
    sender: "kai",
    body:
      "Hi {{guest_name}}, your booking {{reference}} for {{trip}} on {{when}} has been cancelled. " +
      "Reason: {{reason}}. {{refund}} Reply here if you would like another date.",
    params: ["guest_name", "reference", "trip", "when", "reason", "refund"],
    example: {
      guest_name: "Mia",
      reference: "BP-7K3QX9",
      trip: "Outer Reef Snorkel Day",
      when: "Saturday 10 October",
      reason: "Weather conditions are unsafe",
      refund: "Your A$378 is on its way back to your card.",
    },
  },
  departureUpdate: {
    name: "bluepass_departure_update",
    language: "en",
    audience: "traveller",
    sender: "kai",
    body:
      "Hi {{guest_name}}, an update from {{operator}} about {{trip}} on {{when}}: {{message}} " +
      "Reply here if you have any questions.",
    params: ["guest_name", "operator", "trip", "when", "message"],
    example: {
      guest_name: "Mia",
      operator: "Reef Runner Charters",
      trip: "Outer Reef Snorkel Day",
      when: "Saturday 10 October at 8:00am",
      message: "We are now leaving from Pier C, two berths along from the usual spot.",
    },
    button: { text: "View booking", url: `${SITE}/trip/{{1}}`, example: `${SITE}/trip/abc123` },
  },
  operatorNewBooking: {
    name: "bluepass_operator_new_booking",
    language: "en",
    audience: "operator",
    sender: "ops",
    body:
      "New booking for {{trip}}, {{when}}: {{guests}} with {{lead_guest}}. " +
      "That departure now has {{booked}} booked.",
    params: ["trip", "when", "guests", "lead_guest", "booked"],
    example: {
      trip: "Outer Reef Snorkel Day",
      when: "Saturday 10 October at 8:00am",
      guests: "3 guests",
      lead_guest: "Mia Torres (+61 411 204 118)",
      booked: "10 of 14",
    },
    button: { text: "Open manifest", url: `${SITE}/operator/m/{{1}}`, example: `${SITE}/operator/m/abc_1791410400000` },
  },
  operatorDigest: {
    name: "bluepass_operator_tomorrow",
    language: "en",
    audience: "operator",
    sender: "ops",
    body: "Tomorrow, {{date}}: {{departures}}. {{total_guests}} booked in all.",
    params: ["date", "departures", "total_guests"],
    example: {
      date: "Saturday 10 October",
      departures: "Outer Reef Snorkel Day 8:00am, 12 guests; Sunset Sail 5:00pm, 4 guests",
      total_guests: "16 guests",
    },
    button: { text: "Open calendar", url: `${SITE}/operator/calendar` },
  },
} satisfies Record<string, RailsTemplate>;

export type RailsTemplateKey = keyof typeof RAILS_TEMPLATES;

/** Free-text values (an operator's message, a reason) may run longer than labels. */
const LONG_PARAMS = new Set(["note", "message", "reason", "departures", "refund"]);

/**
 * WhatsApp rejects a parameter with a line break, a tab or a run of spaces (error
 * 132018), and an empty one. Values are flattened to one line and given a fallback
 * rather than sent as something Meta will refuse.
 */
export function cleanParam(name: string, value: string | null | undefined, fallback: string): string {
  const flat = (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const max = LONG_PARAMS.has(name) ? 300 : 120;
  const text = flat || fallback;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The components for one send: the named body variables, and the link button's value if it has one. */
export function templateComponents(
  template: RailsTemplate,
  params: Record<string, string>,
  buttonValue?: string,
): WhatsAppTemplateComponent[] {
  const missing = template.params.filter((p) => !params[p]);
  if (missing.length > 0) throw new Error(`Template ${template.name} is missing ${missing.join(", ")}.`);
  const components: WhatsAppTemplateComponent[] = [
    {
      type: "body",
      parameters: template.params.map((p) => ({ type: "text" as const, parameter_name: p, text: params[p] })),
    },
  ];
  if (template.button?.url.endsWith("{{1}}")) {
    if (!buttonValue) throw new Error(`Template ${template.name} needs a value for its link button.`);
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: buttonValue }] });
  }
  return components;
}

/** The template as a reviewer would read it, with its example values filled in. */
export function renderExample(template: RailsTemplate): string {
  return template.body.replace(/\{\{(\w+)\}\}/g, (_, name: string) => template.example[name] ?? `{{${name}}}`);
}
