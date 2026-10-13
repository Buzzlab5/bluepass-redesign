import { addDays, localDateInZone, zonedTimeToUtc } from "@/lib/services/operators/listing-availability";
import { feesOnTop } from "@/lib/services/channels/fees";
import { feesFor } from "@/lib/services/channels/rezdy/map";
import {
  RezdyError,
  type RezdyApi,
  type RezdyBooking,
  type RezdyBookingRequest,
  type RezdyCompany,
  type RezdyPickup,
  type RezdyProduct,
  type RezdySession,
} from "@/lib/services/channels/rezdy/api";

/**
 * A Rezdy account in memory, for tests and for the local mock server
 * (scripts/mock-rezdy.ts) that stands in for Rezdy during development.
 *
 * It behaves the way Rezdy's agent API is documented to: sessions lose seats to
 * processing and confirmed orders and get them back on cancel; automated-payment
 * products need a card token and a manual-payment hold can be confirmed by update;
 * required booking questions are enforced; a cancelled automated booking is refunded.
 * Supplier-side changes (a cancellation or a moved booking made in Rezdy's own screens)
 * are driven by the `supplier` helpers, which is how the reconciler is tested.
 */

export type SimProduct = RezdyProduct & {
  /** Departure times, local to the product's timezone. */
  times: string[];
  /** Days of the week it runs, 0 = Sunday. Empty is every day. */
  weekdays?: number[];
  seats: number;
  /** Bluepass's commission on it, as a fraction of the fare. */
  commission: number;
  pickups?: RezdyPickup[];
};

export type SimOptions = {
  companies: RezdyCompany[];
  products: SimProduct[];
  /** First day sessions exist, as yyyy-mm-dd in each product's zone. */
  from: string;
  /** Starts every order number. The mock server makes it unique per run. */
  orderPrefix?: string;
  days?: number;
  now?: () => Date;
};

type Order = RezdyBooking & { orderNumber: string; status: NonNullable<RezdyBooking["status"]>; seats: number; sessionKey: string };

const HOLDING = new Set(["PROCESSING", "NEW", "ON_HOLD", "PENDING_SUPPLIER", "PENDING_CUSTOMER", "CONFIRMED"]);

export function createRezdySim(options: SimOptions) {
  const now = options.now ?? (() => new Date());
  const orders = new Map<string, Order>();
  const seatOverrides = new Map<string, number>();
  const calls: { method: string; [k: string]: unknown }[] = [];
  let sequence = 1000;
  // Order numbers never repeat across restarts of the local mock, as real Rezdy's never do.
  const prefix = options.orderPrefix ?? "R";

  const product = (code: string) => options.products.find((p) => p.productCode === code) ?? null;
  const publicProduct = (p: SimProduct): RezdyProduct => {
    const { times: _t, weekdays: _w, seats: _s, commission: _c, pickups: _p, ...rest } = p;
    return rest;
  };

  function sessionsFor(p: SimProduct): RezdySession[] {
    const zone = p.timezone ?? "Australia/Brisbane";
    const out: RezdySession[] = [];
    for (let i = 0; i < (options.days ?? 60); i += 1) {
      const date = addDays(options.from, i);
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (p.weekdays?.length && !p.weekdays.includes(weekday)) continue;
      for (const time of p.times) {
        const start = zonedTimeToUtc(date, time, zone);
        const key = `${p.productCode}|${start.toISOString()}`;
        const seats = seatOverrides.get(key) ?? p.seats;
        const taken = [...orders.values()].filter((o) => o.sessionKey === key && HOLDING.has(o.status)).reduce((n, o) => n + o.seats, 0);
        out.push({
          id: Math.abs(hash(key)),
          productCode: p.productCode,
          startTime: start.toISOString().replace(".000", ""),
          endTime: new Date(start.getTime() + (p.durationMinutes ?? 120) * 60_000).toISOString().replace(".000", ""),
          startTimeLocal: `${date} ${time}:00`,
          endTimeLocal: `${date} ${time}:00`,
          allDay: false,
          seats,
          seatsAvailable: Math.max(0, seats - taken),
          priceOptions: p.priceOptions,
        });
      }
    }
    return out;
  }

  function findSession(p: SimProduct, startTimeLocal: string | undefined) {
    return sessionsFor(p).find((s) => s.startTimeLocal === startTimeLocal) ?? null;
  }

  function price(p: SimProduct, request: RezdyBookingRequest) {
    const item = request.items[0];
    let amount = 0;
    let seats = 0;
    let units = 0;
    for (const q of item.quantities) {
      const option = (p.priceOptions ?? []).find((o) => o.label === q.optionLabel);
      if (!option) throw new RezdyError(`Price option ${q.optionLabel} not found`, "BIZ_RULE", 400, false);
      amount += option.price * q.value;
      seats += (option.seatsUsed ?? 1) * q.value;
      units += q.value;
    }
    for (const e of item.extras ?? []) {
      const extra = (p.extras ?? []).find((x) => x.name === e.name);
      if (!extra) throw new RezdyError(`Extra ${e.name} not found`, "BIZ_RULE", 400, false);
      amount += extra.price * e.quantity;
    }
    const total = amount + feesOnTop(feesFor(p), Math.round(amount * 100), units) / 100;
    return { amount, total, seats, commission: Math.round(total * p.commission * 100) / 100 };
  }

  function validate(p: SimProduct, request: RezdyBookingRequest) {
    const item = request.items[0];
    const session = findSession(p, item.startTimeLocal);
    if (!session) throw new RezdyError("Session not found", "BIZ_RULE", 400, false);
    const priced = price(p, request);
    if (priced.seats > session.seatsAvailable) {
      throw new RezdyError(`Not enough availability. ${session.seatsAvailable} seats left`, "BIZ_RULE", 400, false, { seatsAvailable: session.seatsAvailable });
    }
    for (const f of p.bookingFields ?? []) {
      if (f.requiredPerBooking && !(request.fields ?? []).some((x) => x.label === f.label && x.value)) {
        throw new RezdyError(`Booking field ${f.label} is required`, "MISSING_FIELD", 400, false, { fields: [f.label] });
      }
      if (f.requiredPerParticipant) {
        for (const participant of item.participants ?? []) {
          if (!participant.fields.some((x) => x.label === f.label && x.value)) {
            throw new RezdyError(`Participant field ${f.label} is required`, "MISSING_FIELD", 400, false, { fields: [f.label] });
          }
        }
        if ((item.participants ?? []).length < priced.seats) {
          throw new RezdyError(`Participant field ${f.label} is required`, "MISSING_FIELD", 400, false);
        }
      }
    }
    if (item.pickupLocation?.locationName && !(p.pickups ?? []).some((x) => x.locationName === item.pickupLocation?.locationName)) {
      throw new RezdyError("Pickup location not found", "BIZ_RULE", 400, false);
    }
    return { session, ...priced };
  }

  function view(o: Order): RezdyBooking {
    const { seats: _s, sessionKey: _k, ...rest } = o;
    return structuredClone(rest);
  }

  function touch(o: Order) {
    o.dateUpdated = now().toISOString();
  }

  const api: RezdyApi = {
    async marketplaceProducts(q) {
      calls.push({ method: "marketplaceProducts", ...q });
      return options.products
        .filter((p) => (!q.supplierAlias || p.supplierAlias === q.supplierAlias) && (!q.supplierId || String(p.supplierId) === String(q.supplierId)))
        .map(publicProduct);
    },
    async product(code) {
      calls.push({ method: "product", code });
      const p = product(code);
      return p ? publicProduct(p) : null;
    },
    async pickups(code) {
      calls.push({ method: "pickups", code });
      return product(code)?.pickups ?? [];
    },
    async company(alias) {
      calls.push({ method: "company", alias });
      return options.companies.find((c) => c.alias === alias) ?? null;
    },
    async availability(q) {
      calls.push({ method: "availability", ...q });
      const p = product(q.productCode);
      if (!p) return [];
      return sessionsFor(p).filter((s) => s.startTimeLocal >= q.startTimeLocal && s.startTimeLocal <= q.endTimeLocal);
    },
    async quote(request) {
      calls.push({ method: "quote", request });
      const p = product(request.items[0].productCode);
      if (!p) throw new RezdyError("Product not found", "BIZ_RULE", 400, false);
      const v = validate(p, request);
      return { totalAmount: v.total, totalCurrency: p.currency, commission: v.commission, items: request.items };
    },
    async createBooking(request) {
      calls.push({ method: "createBooking", request });
      const p = product(request.items[0].productCode);
      if (!p) throw new RezdyError("Product not found", "BIZ_RULE", 400, false);
      const v = validate(p, request);
      const automated = p.agentPaymentType === "PAYOUTS";
      if (automated && !request.creditCard?.cardToken) throw new RezdyError("Credit card token is required for automated payments", "PAYMENT_ERROR", 400, false);
      if (request.creditCard?.cardToken === "tok_chargeDeclined") throw new RezdyError("Your card was declined.", "PAYMENT_CARD_TYPE_DECLINED", 400, false);
      const status = request.status === "PROCESSING" ? "PROCESSING" : p.confirmMode === "MANUAL" ? "PENDING_SUPPLIER" : "CONFIRMED";
      sequence += 1;
      const order: Order = {
        orderNumber: `${prefix}${sequence}`,
        status,
        supplierAlias: p.supplierAlias,
        supplierId: p.supplierId,
        customer: request.customer,
        items: [{ ...request.items[0], startTime: v.session.startTime, productName: p.name, amount: v.amount }],
        totalAmount: v.total,
        totalCurrency: p.currency,
        totalPaid: automated ? v.total : (request.payments ?? []).reduce((n, x) => n + x.amount, 0),
        commission: v.commission,
        payments: automated
          ? [{ type: "CREDITCARD", amount: v.total, currency: p.currency, label: "Automated payment", recipient: "REZDY" }]
          : request.payments ?? [],
        resellerReference: request.resellerReference,
        fields: request.fields,
        dateUpdated: now().toISOString(),
        seats: v.seats,
        sessionKey: `${p.productCode}|${new Date(v.session.startTime).toISOString()}`,
      };
      orders.set(order.orderNumber, order);
      return view(order);
    },
    async updateBooking(orderNumber, booking) {
      calls.push({ method: "updateBooking", orderNumber, booking });
      const o = orders.get(orderNumber);
      if (!o) throw new RezdyError("Booking not found", "BIZ_RULE", 404, false);
      const p = product(o.items![0].productCode)!;
      if (p.agentPaymentType === "PAYOUTS") throw new RezdyError("Only manual payment bookings can be updated", "BIZ_RULE", 400, false);
      if (o.status === "CANCELLED" || o.status === "ABANDONED_CART") throw new RezdyError("Booking is cancelled", "BIZ_RULE", 400, false);
      if (booking.status === "CONFIRMED") o.status = p.confirmMode === "MANUAL" ? "PENDING_SUPPLIER" : "CONFIRMED";
      if (booking.payments) {
        o.payments = booking.payments;
        o.totalPaid = booking.payments.reduce((n, x) => n + x.amount, 0);
      }
      touch(o);
      return view(o);
    },
    async cancelBooking(orderNumber) {
      calls.push({ method: "cancelBooking", orderNumber });
      const o = orders.get(orderNumber);
      if (!o) return null;
      o.status = "CANCELLED";
      if (product(o.items![0].productCode)?.agentPaymentType === "PAYOUTS") {
        o.payments = [...(o.payments ?? []), { type: "REFUND", amount: -(o.totalAmount ?? 0), currency: o.totalCurrency, recipient: "REZDY" }];
      }
      touch(o);
      return view(o);
    },
    async getBooking(orderNumber) {
      calls.push({ method: "getBooking", orderNumber });
      const o = orders.get(orderNumber);
      return o ? view(o) : null;
    },
    async searchBookings(q) {
      calls.push({ method: "searchBookings", ...q });
      return [...orders.values()]
        .filter((o) => (!q.resellerReference || o.resellerReference === q.resellerReference) && (!q.updatedSince || (o.dateUpdated ?? "") > q.updatedSince))
        .map(view);
    },
  };

  /** What the operator does in Rezdy's own screens. */
  const supplier = {
    cancel(orderNumber: string) {
      const o = orders.get(orderNumber)!;
      o.status = "CANCELLED";
      touch(o);
    },
    confirm(orderNumber: string) {
      const o = orders.get(orderNumber)!;
      o.status = "CONFIRMED";
      touch(o);
    },
    move(orderNumber: string, startTimeLocal: string) {
      const o = orders.get(orderNumber)!;
      const p = product(o.items![0].productCode)!;
      const session = findSession(p, startTimeLocal)!;
      o.items = [{ ...o.items![0], startTime: session.startTime, startTimeLocal }];
      o.sessionKey = `${p.productCode}|${new Date(session.startTime).toISOString()}`;
      touch(o);
    },
    /** Another channel sold seats, or the operator resized the session. */
    setSeats(productCode: string, startTime: Date, seats: number) {
      seatOverrides.set(`${productCode}|${startTime.toISOString()}`, seats);
    },
    withdraw(productCode: string) {
      const i = options.products.findIndex((p) => p.productCode === productCode);
      if (i >= 0) options.products.splice(i, 1);
    },
  };

  return { api, supplier, orders, calls, sessionsFor: (code: string) => sessionsFor(product(code)!), localDate: (d: Date, zone: string) => localDateInZone(d, zone) };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** A Cairns reef operator on Rezdy, shaped like the staging demo account's products. */
export function reefRunnerOnRezdy(from: string, overrides: Partial<SimOptions> = {}) {
  const base = {
    supplierId: 77001,
    supplierAlias: "reefrunner",
    supplierName: "Reef Runner Charters",
    timezone: "Australia/Brisbane",
    currency: "AUD" as const,
    bookingMode: "INVENTORY" as const,
    isApiBookingSupported: true,
    locationAddress: { addressLine: "Marina Pier B", city: "Cairns", state: "QLD", countryCode: "au" },
    images: [{ itemUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1600", largeSizeUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1600", isPrimary: true }],
    bookingFields: [
      { label: "First Name", requiredPerBooking: true, visiblePerBooking: true, fieldType: "String" as const },
      { label: "Last Name", requiredPerBooking: true, visiblePerBooking: true, fieldType: "String" as const },
      { label: "Email", requiredPerBooking: true, visiblePerBooking: true, fieldType: "String" as const },
      { label: "Mobile", requiredPerBooking: true, visiblePerBooking: true, fieldType: "Phone" as const },
      { label: "Country", requiredPerBooking: true, visiblePerBooking: true, fieldType: "List" as const },
      { label: "Special Requirements", visiblePerBooking: true, fieldType: "String" as const },
    ],
  };
  const products: SimProduct[] = [
    {
      ...base,
      productCode: "PRR001",
      name: "Outer Reef Snorkel and Dive",
      productType: "DAYTOUR",
      shortDescription: "Two outer reef sites, lunch and a marine biologist on board.",
      description: "<p>A full day on the outer edge of the reef with two snorkel sites chosen on the morning for the clearest water.</p><p>Lunch, reef tax, stinger suits and snorkel gear are included.</p>",
      advertisedPrice: 229,
      priceOptions: [
        { label: "Adult", price: 229, seatsUsed: 1, productCode: "PRR001" },
        { label: "Child", price: 129, seatsUsed: 1, productCode: "PRR001" },
        { label: "Family of 4", price: 640, seatsUsed: 4, productCode: "PRR001" },
      ],
      quantityRequiredMin: 1,
      quantityRequiredMax: 20,
      durationMinutes: 480,
      minimumNoticeMinutes: 720,
      confirmMode: "AUTOCONFIRM",
      agentPaymentType: "PAYOUTS",
      additionalInformation: "Check in at Marina Pier B 30 minutes before departure. Bring a hat, sunscreen and a towel.",
      dateUpdated: "2026-09-01T00:00:00Z",
      pickupId: 1,
      times: ["07:30"],
      seats: 24,
      commission: 0.2,
      taxes: [{ label: "Reef tax", taxFeeType: "FEE", taxType: "FIXED_PER_ORDER", taxAmount: 7, priceInclusive: false }],
      extras: [
        { name: "Underwater camera hire", description: "A waterproof camera for the day.", price: 35, extraPriceType: "ANY" },
        { name: "Introductory dive", description: "One guided dive with an instructor, gear included.", price: 95, extraPriceType: "ANY" },
        { name: "Hotel pickup", description: "Collected from your hotel and dropped back.", price: 20, extraPriceType: "QUANTITY" },
      ],
      pickups: [
        { locationName: "Cairns Esplanade hotels", address: "Pickup outside the hotel lobby", minutesPrior: 45 },
        { locationName: "Palm Cove", address: "Williams Esplanade bus stop", minutesPrior: 75 },
      ],
    },
    {
      ...base,
      productCode: "PRR002",
      name: "Sunset Sail Trinity Inlet",
      productType: "ACTIVITY",
      shortDescription: "Two hours under sail as the sun goes down over the ranges.",
      description: "<p>Two hours on a classic sailing catamaran.</p><p>Drinks and canapes on board.</p>",
      advertisedPrice: 99,
      priceOptions: [
        { label: "Adult", price: 99, seatsUsed: 1, productCode: "PRR002" },
        { label: "Child", price: 49, seatsUsed: 1, productCode: "PRR002" },
      ],
      quantityRequiredMin: 1,
      quantityRequiredMax: 12,
      durationMinutes: 120,
      minimumNoticeMinutes: 120,
      confirmMode: "AUTOCONFIRM",
      agentPaymentType: "FULL_AGENT",
      additionalInformation: "Board at the Marlin Marina finger 12 at 5pm.",
      dateUpdated: "2026-09-01T00:00:00Z",
      times: ["17:00"],
      seats: 12,
      commission: 0.15,
    },
    {
      ...base,
      productCode: "PRR003",
      name: "Private Reef Charter",
      productType: "CHARTER",
      shortDescription: "The whole boat, for up to 10.",
      description: "<p>Your own boat and crew for the day.</p>",
      advertisedPrice: 3900,
      priceOptions: [{ label: "Charter up to 10", price: 3900, seatsUsed: 1, priceGroupType: "TOTAL", productCode: "PRR003" }],
      quantityRequiredMin: 1,
      quantityRequiredMax: 1,
      durationMinutes: 480,
      minimumNoticeMinutes: 2880,
      confirmMode: "MANUAL",
      agentPaymentType: "PAYOUTS",
      dateUpdated: "2026-09-01T00:00:00Z",
      times: ["08:00"],
      weekdays: [1, 3, 5],
      seats: 1,
      commission: 0.1,
    },
    {
      ...base,
      productCode: "PRR004",
      name: "Reef Deposit Special",
      productType: "ACTIVITY",
      description: "<p>Held with a deposit.</p>",
      priceOptions: [{ label: "Adult", price: 150, productCode: "PRR004" }],
      confirmMode: "AUTOCONFIRM",
      agentPaymentType: "DOWNPAYMENT",
      dateUpdated: "2026-09-01T00:00:00Z",
      times: ["09:00"],
      seats: 10,
      commission: 0.2,
    },
  ];
  return {
    companies: [{ alias: "reefrunner", companyName: "Reef Runner Charters Pty Ltd", timezone: "Australia/Brisbane", currency: "AUD", website: "https://reefrunner.com.au" }],
    products,
    from,
    ...overrides,
  } satisfies SimOptions;
}
