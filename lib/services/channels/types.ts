/**
 * What every channel hands the booking page and the agent API, whatever system the
 * seats live in. A native trip, a Rezdy trip and anything after them fill in the same
 * shapes, so a traveller sees one booking card and Kai calls one API.
 */

export type ChannelRate = {
  /** The key a party's quantities are sent back under. Rezdy's price option label. */
  id: string;
  label: string;
  amountCents: number;
  currency: string;
  /** False for a price that covers the whole group, as a private charter does. */
  perGuest: boolean;
  /** Seats one of these takes: a "Family of 4" is four. */
  seatsUsed: number;
  minQuantity: number | null;
  maxQuantity: number | null;
  minAge: number | null;
  maxAge: number | null;
  isDefault: boolean;
};

export type ChannelDeparture = {
  departsAt: string;
  localTime: string;
  /** Runs all day, so no time is shown. */
  allDay: boolean;
  seatsLeft: number;
  minGuests: number;
  available: boolean;
  block: "full" | "cutoff" | "closed" | null;
  note: string | null;
  /** Prices for this departure. Rezdy prices per session, so two times on one day can differ. */
  rates: ChannelRate[];
};

/** An optional add-on sold with the trip: a camera, a locker, lunch. */
export type ChannelExtra = {
  /** The operator's own name for it, which is also how it is booked. */
  name: string;
  description: string | null;
  amountCents: number;
  /** "any": the traveller picks how many. "perBooking": once for the booking. "perGuest": one for every guest. */
  kind: "any" | "perBooking" | "perGuest";
};

export type ChannelQuestion = {
  /** The operator's own label, sent back to their system exactly as written. */
  label: string;
  type: "text" | "list" | "boolean" | "phone" | "date";
  options: string[];
  required: boolean;
};

export type ChannelQuestions = {
  /** Asked once per booking. */
  booking: ChannelQuestion[];
  /** Asked for every guest. */
  participant: ChannelQuestion[];
  pickups: { name: string; detail: string | null }[];
  pickupRequired: boolean;
  /** The operator's system will not take the booking without a mobile number. */
  phoneRequired: boolean;
  /** Nor without "anything the crew should know" filled in. */
  notesRequired: boolean;
};

export type ChannelAnswers = {
  fields: Record<string, string>;
  participants: Record<string, string>[];
  pickup: string | null;
};

export const NO_QUESTIONS: ChannelQuestions = {
  booking: [],
  participant: [],
  pickups: [],
  pickupRequired: false,
  phoneRequired: false,
  notesRequired: false,
};

export const CHANNEL_NAMES: Record<string, string> = {
  NATIVE: "Bluepass",
  REZDY: "Rezdy",
  FAREHARBOR: "FareHarbor",
  BOKUN: "Bokun",
};
