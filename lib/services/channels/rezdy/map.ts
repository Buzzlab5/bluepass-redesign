import { findCountryByDial } from "@/lib/countries";
import { addDays } from "@/lib/services/operators/listing-availability";
import type {
  RezdyBookingField,
  RezdyBookingRequest,
  RezdyOrderStatus,
  RezdyPickup,
  RezdyPriceOption,
  RezdyProduct,
  RezdySession,
} from "@/lib/services/channels/rezdy/api";
import type { ChannelFee } from "@/lib/services/channels/fees";
import type {
  ChannelAnswers,
  ChannelDeparture,
  ChannelExtra,
  ChannelQuestion,
  ChannelQuestions,
  ChannelRate,
} from "@/lib/services/channels/types";

/**
 * Rezdy's shapes turned into Bluepass's, and back. Pure: nothing here calls Rezdy or
 * the database, so every rule about what can be sold is testable on its own.
 */

// ---------------------------------------------------------------------------
// Accounts and products
// ---------------------------------------------------------------------------

/**
 * The alias in whatever an operator pastes: "reefrunner", "reefrunner.rezdy.com", the
 * address of their booking page, or of one product on it. Rezdy's booking forms also
 * live at "<alias>-booking-form.rezdy.com".
 */
export function parseRezdyAlias(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  if (/^https?:\/\//.test(raw) || raw.includes(".rezdy.com")) {
    try {
      host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
    } catch {
      return null;
    }
    const match = host.match(/^([a-z0-9-]+?)(?:-booking-form)?\.rezdy(?:-staging)?\.com$/);
    if (!match) return null;
    host = match[1];
  }
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(host) ? host : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };

/** Rezdy descriptions are HTML from its editor. Bluepass shows paragraphs of plain text. */
export function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "· ")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CATEGORY_BY_TYPE: Record<string, string> = {
  ACTIVITY: "Activity",
  DAYTOUR: "Day trip",
  MULTIDAYTOUR: "Expedition",
  PRIVATE_TOUR: "Private charter",
  CHARTER: "Charter",
  TICKET: "Ticket",
  LESSON: "Lesson",
  EVENT: "Event",
  TRANSFER: "Transfer",
};

function primaryImage(product: RezdyProduct): string | null {
  const images = product.images ?? [];
  const image = images.find((i) => i.isPrimary) ?? images[0];
  return image ? image.largeSizeUrl || image.itemUrl || image.mediumSizeUrl || null : null;
}

/** The cheapest per-person price worth advertising: never a free infant ticket. */
export function priceFrom(options: RezdyPriceOption[] | undefined, advertised?: number): number | null {
  const paid = (options ?? []).filter((o) => o.priceGroupType !== "TOTAL" && o.price > 0);
  if (paid.length) return Math.min(...paid.map((o) => o.price));
  return advertised && advertised > 0 ? advertised : null;
}

/** The listing fields a Rezdy product fills. The operator edits these in Rezdy; Bluepass mirrors them. */
export function productToListing(product: RezdyProduct) {
  const address = product.locationAddress ?? {};
  const region = [address.city, address.state].filter(Boolean).join(", ") || address.countryCode?.toUpperCase() || "Australia";
  const meetingPoint = [address.addressLine, address.city].filter(Boolean).join(", ") || null;
  const description = plainText(product.description) || plainText(product.shortDescription) || product.name;
  const from = priceFrom(product.priceOptions, product.advertisedPrice);
  const currency = product.currency || "AUD";
  return {
    title: product.name.trim().slice(0, 140),
    description: description.slice(0, 6000),
    heroImageUrl: primaryImage(product),
    region: region.slice(0, 80),
    category: CATEGORY_BY_TYPE[product.productType ?? ""] ?? "Tour",
    durationMinutes: product.durationMinutes && product.durationMinutes > 0 ? product.durationMinutes : null,
    meetingPoint,
    confirmationNote: plainText(product.additionalInformation) || null,
    maxGuests: product.quantityRequiredMax && product.quantityRequiredMax > 0 ? product.quantityRequiredMax : null,
    priceFrom: from,
    priceSignal: from !== null ? `From ${currency} ${from}` : null,
    currency,
  };
}

/** The two ways Bluepass can be paid for a Rezdy trip. */
export type RezdyPaymentMode = "automated" | "agent";

export function paymentMode(product: RezdyProduct): RezdyPaymentMode | null {
  if (product.agentPaymentType === "PAYOUTS") return "automated";
  if (product.agentPaymentType === "FULL_AGENT") return "agent";
  return null;
}

/**
 * Why a product cannot be sold on Bluepass, in words the operator can act on, or null
 * when it can. Bluepass sells trips paid in full at booking: either Rezdy charges the
 * card and splits it (automated payments), or Bluepass takes it and pays the operator
 * after the trip (full payment to agent). Deposits and pay-the-operator rates would
 * leave a traveller with a balance Bluepass cannot see.
 */
export function productIssue(product: RezdyProduct): string | null {
  if (product.isApiBookingSupported === false || product.apiBookingSupported === false) {
    return "Rezdy does not let agents book this kind of product (rentals, gift cards and trips priced by the hour).";
  }
  if (product.bookingMode === "NO_DATE") return "This is an open-dated ticket. Bluepass sells trips with a date.";
  switch (product.agentPaymentType) {
    case "PAYOUTS":
    case "FULL_AGENT":
      break;
    case "DOWNPAYMENT":
      return "Bluepass's rate in Rezdy takes a deposit and leaves the rest for the day. Set it to automated payments or full payment to agent.";
    case "FULL_SUPPLIER":
      return "Bluepass's rate in Rezdy has travellers pay you directly. Set it to automated payments or full payment to agent.";
    default:
      return "Bluepass's rate in Rezdy takes no payment. Set it to automated payments or full payment to agent.";
  }
  if (!(product.priceOptions ?? []).some((o) => o.price > 0)) return "This trip has no prices in Rezdy.";
  return null;
}

// ---------------------------------------------------------------------------
// Prices and sessions
// ---------------------------------------------------------------------------

/**
 * A session's prices for one product. Sessions shared between products carry every
 * product's overrides, so Rezdy says to keep only the ones for the product being sold.
 * A session with no prices of its own sells at the product's.
 */
export function ratesFor(product: RezdyProduct, session?: RezdySession | null): ChannelRate[] {
  const own = (session?.priceOptions ?? []).filter((o) => !o.productCode || o.productCode === product.productCode);
  const options = own.length ? own : product.priceOptions ?? [];
  const currency = product.currency || "AUD";
  const defaultLabel =
    options.find((o) => /\badult\b/i.test(o.label))?.label ?? options.find((o) => o.price > 0)?.label ?? options[0]?.label;
  return options.map((o) => ({
    id: o.label,
    label: o.label,
    amountCents: Math.round(o.price * 100),
    currency,
    perGuest: o.priceGroupType !== "TOTAL",
    seatsUsed: Math.max(1, o.seatsUsed ?? 1),
    minQuantity: o.minQuantity ?? null,
    maxQuantity: o.maxQuantity ?? null,
    minAge: null,
    maxAge: null,
    isDefault: o.label === defaultLabel,
  }));
}

/**
 * The taxes and fees Rezdy adds on top of this product's prices. Ones already inside
 * the price add nothing; per-duration fees belong to rentals, which agents cannot book.
 */
export function feesFor(product: RezdyProduct): ChannelFee[] {
  return (product.taxes ?? []).flatMap((t): ChannelFee[] => {
    const label = t.label?.trim() || (t.taxFeeType === "FEE" ? "Fee" : "Tax");
    if (t.taxType === "PERCENT") {
      return t.priceInclusive || !t.taxPercent ? [] : [{ label, kind: "percent", percent: t.taxPercent, amountCents: 0, compound: Boolean(t.compound) }];
    }
    if (t.taxType === "FIXED_PER_QUANTITY" && t.taxAmount) return [{ label, kind: "perUnit", percent: 0, amountCents: Math.round(t.taxAmount * 100), compound: false }];
    if (t.taxType === "FIXED_PER_ORDER" && t.taxAmount) return [{ label, kind: "perBooking", percent: 0, amountCents: Math.round(t.taxAmount * 100), compound: false }];
    return [];
  });
}

/**
 * The add-ons Rezdy sells with this product, in Rezdy's three kinds: the traveller's
 * choice of quantity, once per booking, or one for every guest.
 */
export function extrasFor(product: RezdyProduct): ChannelExtra[] {
  return (product.extras ?? [])
    .filter((e) => e.name?.trim() && e.price >= 0)
    .map((e) => ({
      name: e.name.trim(),
      description: e.description?.trim() || null,
      amountCents: Math.round(e.price * 100),
      kind: e.extraPriceType === "FIXED" ? "perBooking" : e.extraPriceType === "QUANTITY" ? "perGuest" : "any",
    }));
}

/**
 * The add-ons a traveller chose, as quantities Rezdy will accept: a per-booking one is
 * always one, a per-guest one is always the party's size, whatever the request says.
 */
export function chosenExtras(product: RezdyProduct, chosen: Record<string, number> | undefined, units: number):
  { ok: true; extras: { name: string; quantity: number; amountCents: number }[] } | { ok: false; reason: string } {
  const offered = extrasFor(product);
  const out: { name: string; quantity: number; amountCents: number }[] = [];
  for (const [name, raw] of Object.entries(chosen ?? {})) {
    const wanted = Math.floor(Number(raw));
    if (!wanted) continue;
    const extra = offered.find((e) => e.name === name);
    if (!extra) return { ok: false, reason: `"${name}" is not an add-on for this trip.` };
    if (!(wanted > 0 && wanted <= 50)) return { ok: false, reason: `That number of ${name} does not look right.` };
    const quantity = extra.kind === "perBooking" ? 1 : extra.kind === "perGuest" ? units : wanted;
    out.push({ name: extra.name, quantity, amountCents: extra.amountCents });
  }
  return { ok: true, extras: out };
}

export function localDateOf(session: RezdySession) {
  return session.startTimeLocal.slice(0, 10);
}

function departureOf(product: RezdyProduct, session: RezdySession, now: Date, closed?: Set<number>): ChannelDeparture {
  const departsAt = new Date(session.startTime.replace(" ", "T"));
  const noticeMs = Math.max(0, product.minimumNoticeMinutes ?? 0) * 60_000;
  const tooLate = departsAt.getTime() - noticeMs <= now.getTime();
  const allDay = Boolean(session.allDay) || (product.bookingMode === "DATE_ENQUIRY" && session.startTimeLocal.endsWith("00:00:00"));
  const minGuests = Math.max(1, product.quantityRequiredMin ?? 1);
  const seatsLeft = Math.max(0, session.seatsAvailable);
  // Closed on Bluepass: the operator called the departure off here (weather) and Rezdy
  // has not caught up. Bluepass stops selling it either way.
  const block = closed?.has(departsAt.getTime()) ? "closed" : tooLate ? "cutoff" : seatsLeft < minGuests ? "full" : null;
  return {
    departsAt: departsAt.toISOString(),
    localTime: allDay ? "" : session.startTimeLocal.slice(11, 16),
    allDay,
    seatsLeft,
    minGuests,
    available: block === null,
    block,
    note: null,
    rates: ratesFor(product, session),
  };
}

export type ChannelMonthDay = { date: string; status: "available" | "soldout" | "closed" | "none"; fromCents: number | null; seatsLeft: number };

/** One month of the booking page's calendar from Rezdy's sessions. */
export function monthFromSessions(input: {
  product: RezdyProduct;
  sessions: RezdySession[];
  month: string;
  today: string;
  now: Date;
  closed?: Set<number>;
}): ChannelMonthDay[] {
  const { product, sessions, month, today, now, closed } = input;
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  const byDate = new Map<string, RezdySession[]>();
  for (const s of sessions) {
    if (s.productCode && s.productCode !== product.productCode) continue;
    const date = localDateOf(s);
    byDate.set(date, [...(byDate.get(date) ?? []), s]);
  }

  const days: ChannelMonthDay[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const daySessions = byDate.get(date) ?? [];
    if (date < today || daySessions.length === 0) {
      days.push({ date, status: "none", fromCents: null, seatsLeft: 0 });
      continue;
    }
    const departures = daySessions.map((s) => departureOf(product, s, now, closed));
    const open = departures.filter((d) => d.available);
    const prices = departures.flatMap((d) => d.rates.filter((r) => r.perGuest && r.amountCents > 0).map((r) => r.amountCents));
    const fromCents = prices.length ? Math.min(...prices) : null;
    if (open.length) days.push({ date, status: "available", fromCents, seatsLeft: Math.max(...open.map((d) => d.seatsLeft)) });
    else if (departures.some((d) => d.block === "full")) days.push({ date, status: "soldout", fromCents, seatsLeft: 0 });
    else days.push({ date, status: "closed", fromCents: null, seatsLeft: 0 });
  }
  return days;
}

/** The departures on one date, each with its own prices. */
export function dayFromSessions(product: RezdyProduct, sessions: RezdySession[], date: string, now: Date, closed?: Set<number>): ChannelDeparture[] {
  return sessions
    .filter((s) => (!s.productCode || s.productCode === product.productCode) && localDateOf(s) === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((s) => departureOf(product, s, now, closed));
}

/** The Rezdy session a departure instant refers to, if it still exists. */
export function findSession(sessions: RezdySession[], departsAt: Date): RezdySession | null {
  return sessions.find((s) => new Date(s.startTime.replace(" ", "T")).getTime() === departsAt.getTime()) ?? null;
}

export type PricedRezdyParty =
  | { ok: true; guests: number; seats: number; totalCents: number; lines: { rateId: string; label: string; amountCents: number; quantity: number; perGuest: boolean }[] }
  | { ok: false; reason: string };

/**
 * Prices a party against one session's options, the way Rezdy will: each option's
 * price times its quantity, seats counted by each option's seat use. The figure Rezdy
 * quotes is still the one charged; this is what the traveller is shown first.
 */
export function priceRezdyParty(product: RezdyProduct, session: RezdySession, quantities: Record<string, number>): PricedRezdyParty {
  const rates = ratesFor(product, session);
  const lines: { rateId: string; label: string; amountCents: number; quantity: number; perGuest: boolean }[] = [];
  let seats = 0;
  for (const [label, raw] of Object.entries(quantities)) {
    const quantity = Math.floor(Number(raw));
    if (!quantity) continue;
    if (!(quantity > 0 && quantity <= 100)) return { ok: false, reason: "That number of guests does not look right." };
    const rate = rates.find((r) => r.id === label);
    if (!rate) return { ok: false, reason: `"${label}" is not a price for this departure. Pick the time again.` };
    if (rate.minQuantity && quantity < rate.minQuantity) return { ok: false, reason: `${rate.label} needs at least ${rate.minQuantity}.` };
    if (rate.maxQuantity && quantity > rate.maxQuantity) return { ok: false, reason: `${rate.label} takes at most ${rate.maxQuantity}.` };
    seats += quantity * rate.seatsUsed;
    lines.push({ rateId: rate.id, label: rate.label, amountCents: rate.amountCents, quantity, perGuest: rate.perGuest });
  }
  if (!lines.length) return { ok: false, reason: "Add at least one guest." };
  const min = product.quantityRequiredMin ?? 1;
  const max = product.quantityRequiredMax ?? null;
  if (seats < min) return { ok: false, reason: `This trip books ${min} or more.` };
  if (max && seats > max) return { ok: false, reason: `This trip books at most ${max} at a time.` };
  const totalCents = lines.reduce((sum, l) => sum + l.amountCents * l.quantity, 0);
  return { ok: true, guests: seats, seats, totalCents, lines };
}

// ---------------------------------------------------------------------------
// Booking questions
// ---------------------------------------------------------------------------

/** Answered from the lead guest's own details; never asked twice. */
const FILLED_FROM_LEAD = new Set(["first name", "last name", "email", "mobile", "phone", "country", "special requirements"]);
const IGNORED = new Set(["barcode"]);

function questionOf(field: RezdyBookingField, required: boolean): ChannelQuestion {
  const type =
    field.fieldType === "List" ? "list"
      : field.fieldType === "Boolean" ? "boolean"
        : field.fieldType === "Phone" ? "phone"
          : field.fieldType === "Date" ? "date"
            : "text";
  const options = type === "list" ? (field.listOptions ?? "").split(/\r?\n/).map((o) => o.trim()).filter(Boolean) : [];
  return { label: field.label, type, options, required };
}

/**
 * What the booking form has to ask for this product. Only what the operator made
 * required: Rezdy now refuses a booking that leaves one out, and every optional
 * question is one more reason not to finish booking. Name, email, mobile and country
 * come from the lead guest; the first guest's name too.
 */
export function questionsFor(product: RezdyProduct, pickups: RezdyPickup[]): ChannelQuestions {
  const fields = (product.bookingFields ?? []).filter((f) => f.fieldType !== "Hidden" && !IGNORED.has(f.label.trim().toLowerCase()));
  const lower = (f: RezdyBookingField) => f.label.trim().toLowerCase();

  const booking = fields
    .filter((f) => f.requiredPerBooking && !FILLED_FROM_LEAD.has(lower(f)))
    .map((f) => questionOf(f, true));
  const participant = fields
    .filter((f) => f.requiredPerParticipant)
    .map((f) => questionOf(f, true));
  const requiredLead = fields.filter((f) => f.requiredPerBooking && FILLED_FROM_LEAD.has(lower(f))).map(lower);

  return {
    booking,
    participant,
    pickups: pickups.map((p) => ({
      name: p.locationName,
      detail: [p.address, p.minutesPrior ? `${p.minutesPrior} min before departure` : null].filter(Boolean).join(" · ") || null,
    })),
    // Rezdy offers pickups as a choice; travellers making their own way leave it empty.
    pickupRequired: false,
    phoneRequired: requiredLead.some((l) => l === "mobile" || l === "phone" || l === "country"),
    notesRequired: requiredLead.includes("special requirements"),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const E164 = /^\+[1-9]\d{6,14}$/;

/** Checks answers the way Rezdy will, so a refusal reads in Bluepass's words, not Rezdy's. */
export function checkAnswers(questions: ChannelQuestions, answers: ChannelAnswers, guests: number): string | null {
  const check = (q: ChannelQuestion, value: string | undefined, who: string) => {
    const v = (value ?? "").trim();
    if (!v) return q.required ? `Add ${who}${q.label.toLowerCase()}.` : null;
    if (q.type === "date" && !DATE.test(v)) return `${q.label} has to be a date.`;
    if (q.type === "phone" && !E164.test(v.replace(/[\s-]/g, ""))) return `${q.label} has to be a full number with its country code.`;
    if (q.type === "list" && q.options.length && !q.options.includes(v)) return `Pick ${q.label.toLowerCase()} from the list.`;
    if (q.type === "boolean" && !/^(true|false)$/i.test(v)) return `${q.label} has to be yes or no.`;
    if (v.length > 500) return `${q.label} is too long.`;
    return null;
  };
  for (const q of questions.booking) {
    const problem = check(q, answers.fields[q.label], "");
    if (problem) return problem;
  }
  if (questions.participant.length) {
    for (let i = 0; i < guests; i += 1) {
      for (const q of questions.participant) {
        const problem = check(q, answers.participants[i]?.[q.label], guests > 1 ? `guest ${i + 1}'s ` : "");
        if (problem) return problem;
      }
    }
  }
  if (answers.pickup && !questions.pickups.some((p) => p.name === answers.pickup)) return "Pick a pickup from the list.";
  if (questions.pickupRequired && !answers.pickup) return "Pick where you would like to be collected.";
  return null;
}

export function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** ISO country of a number in international form, which is what Rezdy's Country field takes. */
export function countryOfPhone(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits ? findCountryByDial(digits)?.iso ?? null : null;
}

export type BuildBookingInput = {
  product: RezdyProduct;
  session: RezdySession;
  quantities: { label: string; quantity: number }[];
  /** Add-ons, by the operator's name for each. */
  extras?: { name: string; quantity: number }[];
  lead: { name: string; email: string | null; phone: string | null };
  notes: string | null;
  answers: ChannelAnswers;
  reference: string;
  /** How Rezdy is paid: a card token it charges, a hold Bluepass pays for next, or money Bluepass already has. */
  payment:
    | { kind: "card"; token: string }
    | { kind: "hold" }
    | { kind: "paid"; amountCents: number; currency: string; label: string; at: Date };
};

/**
 * The order Rezdy is sent. Customer details come from the lead guest; the operator's
 * own booking questions are answered in their exact words; Rezdy's emails to the
 * traveller are switched off because Bluepass sends the confirmation, with the
 * operator's own after-booking notes in it.
 */
export function buildBookingRequest(input: BuildBookingInput): RezdyBookingRequest {
  const { product, session, lead, answers } = input;
  const name = splitName(lead.name);
  const fields = (product.bookingFields ?? []).filter((f) => f.fieldType !== "Hidden");
  const has = (label: string) => fields.some((f) => f.label.trim().toLowerCase() === label);
  const bookingAt = (label: string) => fields.find((f) => f.label.trim().toLowerCase() === label && (f.visiblePerBooking || f.requiredPerBooking));

  const bookingFields: { label: string; value: string }[] = [];
  const add = (label: string | undefined, value: string | null | undefined) => {
    if (label && value) bookingFields.push({ label, value });
  };
  add(bookingAt("first name")?.label, name.firstName);
  add(bookingAt("last name")?.label, name.lastName);
  add(bookingAt("email")?.label, lead.email);
  add(bookingAt("mobile")?.label, lead.phone);
  add(bookingAt("phone")?.label, lead.phone);
  add(bookingAt("country")?.label, countryOfPhone(lead.phone));
  add(bookingAt("special requirements")?.label, input.notes);
  for (const [label, value] of Object.entries(answers.fields)) {
    if (value?.trim() && !bookingFields.some((f) => f.label === label)) bookingFields.push({ label, value: value.trim() });
  }

  const seats = input.quantities.reduce((n, q) => n + q.quantity, 0);
  const askedPerGuest = fields.filter((f) => f.requiredPerParticipant || f.visiblePerParticipant);
  const participants = askedPerGuest.length
    ? Array.from({ length: seats }, (_, i) => {
        const given = answers.participants[i] ?? {};
        const values: { label: string; value: string }[] = [];
        for (const f of askedPerGuest) {
          const key = f.label.trim().toLowerCase();
          const value = given[f.label]?.trim()
            || (i === 0 && key === "first name" ? name.firstName : "")
            || (i === 0 && key === "last name" ? name.lastName : "");
          if (value) values.push({ label: f.label, value });
        }
        return { fields: values };
      })
    : undefined;

  const request: RezdyBookingRequest = {
    customer: {
      firstName: name.firstName,
      lastName: name.lastName,
      ...(lead.email ? { email: lead.email } : {}),
      ...(lead.phone ? { phone: lead.phone } : {}),
    },
    items: [
      {
        productCode: product.productCode,
        startTimeLocal: session.startTimeLocal,
        quantities: input.quantities.map((q) => ({ optionLabel: q.label, value: q.quantity })),
        ...(participants ? { participants } : {}),
        ...(input.extras?.length ? { extras: input.extras.map((e) => ({ name: e.name, quantity: e.quantity })) } : {}),
        ...(answers.pickup ? { pickupLocation: { locationName: answers.pickup } } : {}),
      },
    ],
    ...(bookingFields.length ? { fields: bookingFields } : {}),
    resellerReference: input.reference.slice(0, 30),
    resellerComments: `Booked on Bluepass, reference ${input.reference}.`,
    ...(input.notes && !has("special requirements") ? { comments: input.notes.slice(0, 1000) } : {}),
    sendNotifications: false,
  };

  if (input.payment.kind === "card") request.creditCard = { cardToken: input.payment.token };
  if (input.payment.kind === "hold") request.status = "PROCESSING";
  if (input.payment.kind === "paid") {
    request.payments = [{
      type: "CREDITCARD",
      amount: input.payment.amountCents / 100,
      currency: input.payment.currency,
      date: input.payment.at.toISOString(),
      label: input.payment.label.slice(0, 120),
      recipient: "RESELLER",
    }];
  }
  return request;
}

/** Bluepass's booking status for a Rezdy order status. */
export function statusOfOrder(status: RezdyOrderStatus | string | undefined): "PENDING_PAYMENT" | "REQUESTED" | "CONFIRMED" | "CANCELLED" | null {
  switch (status) {
    case "CONFIRMED":
      return "CONFIRMED";
    case "PENDING_SUPPLIER":
    case "PENDING_CUSTOMER":
    case "NEW":
    case "ON_HOLD":
      return "REQUESTED";
    case "PROCESSING":
      return "PENDING_PAYMENT";
    case "CANCELLED":
    case "ABANDONED_CART":
      return "CANCELLED";
    default:
      return null;
  }
}

export function toCents(amount: number | undefined | null): number | null {
  return typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) : null;
}
