import type { Prisma } from "@prisma/client";
import { CONSERVATION_PCT } from "@/lib/constants/economics";
import { prisma } from "@/lib/db/prisma";
import { zonedTimeToUtc } from "@/lib/services/operators/listing-availability";
import { markDepartureChanged } from "@/lib/services/rails/calendar-events";
import { normaliseReference } from "@/lib/services/rails/reference";
import { DEFAULT_ZONE } from "@/lib/services/rails/views";

/**
 * FareHarbor's affiliate report, brought into Bluepass.
 *
 * FareHarbor tells an affiliate nothing when a booking is made; the bookings exist on
 * Bluepass's side only once the report from the affiliate dashboard is imported. Each
 * hand-off sent its own reference as the affiliate voucher number, so every row that
 * carries one names its trip, its operator and anyone who referred the traveller.
 *
 * FareHarbor does not publish the report's layout, so columns are found by what their
 * headers say, the mapping is shown before anything is written, and a row that cannot
 * be read is reported rather than guessed at. Importing is repeatable: a booking is
 * keyed on FareHarbor's own booking number, so a later report updates it (a
 * cancellation, a changed total) instead of adding it twice.
 */

export type ReportColumns = {
  booking: number | null;
  voucher: number | null;
  start: number | null;
  total: number | null;
  commission: number | null;
  status: number | null;
  guests: number | null;
  name: number | null;
  item: number | null;
  currency: number | null;
};

const FIND: Record<keyof ReportColumns, RegExp[]> = {
  booking: [/^booking\s*(#|no\.?|number|id|pk)$/i, /^(booking|pk|id|confirmation)$/i, /booking\s*(#|number|id)/i],
  voucher: [/voucher/i, /asn\s*-?\s*ref/i, /affiliate\s*ref/i],
  start: [/^start/i, /availability/i, /activity date|tour date|trip date/i, /^date$/i],
  total: [/^(total|gross|amount|booking total|grand total)/i, /total/i],
  commission: [/commission/i],
  status: [/status/i, /cancel/i],
  guests: [/^(customers|guests|pax|people|qty|quantity|participants)$/i, /customer count|guest count|number of/i],
  name: [/^(contact|lead|customer name|guest name|name|contact name)$/i, /contact/i],
  item: [/^(item|activity|tour|product)/i],
  currency: [/currency/i],
};

/** A CSV as rows of cells, with quoted fields, doubled quotes and either line ending. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const clean = text.replace(/^﻿/, "");
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows.map((r) => r.map((v) => v.trim()));
}

export function detectColumns(headers: string[]): ReportColumns {
  const used = new Set<number>();
  const pick = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const i = headers.findIndex((h, j) => !used.has(j) && pattern.test(h.trim()));
      if (i >= 0) { used.add(i); return i; }
    }
    return null;
  };
  // Voucher before booking, so "Voucher #" is never taken as the booking number.
  const voucher = pick(FIND.voucher);
  const commission = pick(FIND.commission);
  const booking = pick(FIND.booking);
  return {
    booking, voucher, commission,
    start: pick(FIND.start),
    total: pick(FIND.total),
    status: pick(FIND.status),
    guests: pick(FIND.guests),
    name: pick(FIND.name),
    item: pick(FIND.item),
    currency: pick(FIND.currency),
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The local date and time in a cell, in the forms a US system writes them:
 * "2026-10-14 07:30", "10/14/2026 7:30 AM", "Oct 14, 2026 7:30am", "Wed, Oct 14, 2026, 7:30 AM".
 * Day-first dates are not guessed at: FareHarbor writes month first.
 */
export function parseLocalDateTime(value: string): { date: string; time: string } | null {
  const v = value.trim();
  const time = (h: string | undefined, m: string | undefined, ampm: string | undefined) => {
    let hour = Number(h ?? 0);
    const minute = Number(m ?? 0);
    if (ampm) {
      const pm = /p/i.test(ampm);
      if (hour === 12) hour = pm ? 12 : 0;
      else if (pm) hour += 12;
    }
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const t = time(m[4], m[5], undefined);
    return t ? { date: `${m[1]}-${m[2]}-${m[3]}`, time: t } : null;
  }
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?)?/i);
  if (m) {
    const t = time(m[4], m[5], m[6]);
    return t ? { date: `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`, time: t } : null;
  }
  m = v.match(/(?:[a-z]+,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4}),?(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?/i);
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    if (!month) return null;
    const t = time(m[4], m[5], m[6]);
    return t ? { date: `${m[3]}-${pad(month)}-${pad(Number(m[2]))}`, time: t } : null;
  }
  return null;
}

/** "$1,234.50", "USD 1234.5", "1.234,50" is not FareHarbor's style and is refused. */
export function parseMoney(value: string): number | null {
  const v = value.replace(/[^\d.,-]/g, "");
  if (!v || /,\d{2}$/.test(v)) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export type ReportRow = {
  line: number;
  bookingId: string | null;
  voucher: string | null;
  start: string;
  totalCents: number | null;
  commissionCents: number | null;
  cancelled: boolean;
  guests: number;
  name: string | null;
  item: string | null;
  currency: string | null;
  /** Set when the row matches one of Bluepass's hand-offs. */
  match: { handoffReference: string; listingId: string; listingTitle: string; operatorProfileId: string; operatorName: string; referralCode: string | null; timezone: string } | null;
  /** Why the row cannot be imported, if it cannot. */
  problem: string | null;
};

export type ReportPreview =
  | { ok: false; message: string; headers?: string[] }
  | { ok: true; columns: ReportColumns; headers: string[]; rows: ReportRow[] };

/** Reads a report and matches every row it can to a hand-off. Writes nothing. */
export async function previewReport(csv: string): Promise<ReportPreview> {
  const table = parseCsv(csv);
  if (table.length < 2) return { ok: false, message: "That does not look like a report: it needs a header row and at least one booking." };
  const [headers, ...body] = table;
  const columns = detectColumns(headers);
  const missing = (["booking", "voucher", "start", "total"] as const).filter((k) => columns[k] === null);
  if (missing.length) {
    return { ok: false, message: `Could not find a column for ${missing.join(", ")}. Columns found: ${headers.join(", ")}.`, headers };
  }

  const vouchers = [...new Set(body.map((r) => r[columns.voucher!]).filter(Boolean).map((v) => normaliseReference(v)))];
  const handoffs = await prisma.channelHandoff.findMany({
    where: { reference: { in: vouchers } },
    include: {
      listing: { select: { id: true, title: true } },
      operatorProfile: { select: { companyName: true, channelConnections: { select: { platform: true, timezone: true } } } },
    },
  });
  const byRef = new Map(handoffs.map((h) => [h.reference, h]));

  const cell = (r: string[], i: number | null) => (i === null ? "" : r[i] ?? "");
  const rows: ReportRow[] = body.map((r, i) => {
    const voucherRaw = cell(r, columns.voucher);
    const voucher = voucherRaw ? normaliseReference(voucherRaw) : null;
    const handoff = voucher ? byRef.get(voucher) : undefined;
    const totalCents = parseMoney(cell(r, columns.total));
    const commissionCents = columns.commission === null ? null : parseMoney(cell(r, columns.commission));
    const guests = Number(cell(r, columns.guests).replace(/\D/g, "")) || 1;
    const start = cell(r, columns.start);
    const row: ReportRow = {
      line: i + 2,
      bookingId: cell(r, columns.booking) || null,
      voucher: voucherRaw || null,
      start,
      totalCents,
      commissionCents,
      cancelled: /cancel|void|refund/i.test(cell(r, columns.status)),
      guests,
      name: cell(r, columns.name) || null,
      item: cell(r, columns.item) || null,
      currency: cell(r, columns.currency).toUpperCase().slice(0, 3) || null,
      match: handoff
        ? {
            handoffReference: handoff.reference,
            listingId: handoff.listing.id,
            listingTitle: handoff.listing.title,
            operatorProfileId: handoff.operatorProfileId,
            operatorName: handoff.operatorProfile.companyName ?? "Operator",
            referralCode: handoff.referralCode,
            timezone: handoff.operatorProfile.channelConnections.find((c) => c.platform === "FAREHARBOR")?.timezone ?? DEFAULT_ZONE,
          }
        : null,
      problem: null,
    };
    if (!row.bookingId) row.problem = "No booking number.";
    else if (!voucherRaw) row.problem = "No voucher number, so it cannot be traced to a Bluepass hand-off.";
    else if (!handoff) row.problem = `Voucher ${voucherRaw} is not one of Bluepass's hand-offs.`;
    else if (totalCents === null) row.problem = "The total could not be read.";
    else if (!parseLocalDateTime(start)) row.problem = `The date "${start}" could not be read.`;
    return row;
  });
  return { ok: true, columns, headers, rows };
}

/**
 * Writes the matched rows as bookings: on the operator's calendar and manifest, in the
 * 5% ledger, and credited to whoever referred the traveller. Nobody is messaged;
 * FareHarbor already confirmed the booking to the guest.
 */
export async function importReport(csv: string, actor: string) {
  const preview = await previewReport(csv);
  if (!preview.ok) return { ok: false as const, message: preview.message };
  let created = 0;
  let updated = 0;
  for (const row of preview.rows) {
    if (row.problem || !row.match || row.totalCents === null) continue;
    const when = parseLocalDateTime(row.start)!;
    const departsAt = zonedTimeToUtc(when.date, when.time, row.match.timezone);
    const externalReference = `FH-${row.bookingId}`;
    const listing = await prisma.operatorListing.findUniqueOrThrow({ where: { id: row.match.listingId }, select: { currency: true } });
    const total = row.totalCents;
    const commission = row.commissionCents;
    const money = row.cancelled
      ? { conservationCents: 0, operatorNetCents: 0 }
      : { conservationCents: Math.round(total * CONSERVATION_PCT), operatorNetCents: commission !== null ? Math.max(0, total - commission) : 0 };
    const data = {
      departsAt,
      timezone: row.match.timezone,
      guests: row.guests,
      lines: [{ rateId: "manual", label: "Guests", amountCents: 0, quantity: row.guests, perGuest: true }] as unknown as Prisma.InputJsonValue,
      totalCents: total,
      currency: row.currency ?? listing.currency,
      commissionCents: commission,
      status: row.cancelled ? ("CANCELLED" as const) : ("CONFIRMED" as const),
      paymentStatus: row.cancelled ? ("REFUNDED" as const) : ("PAID_VIA_CHANNEL" as const),
      refundedCents: row.cancelled ? total : 0,
      externalStatus: row.cancelled ? "CANCELLED" : "BOOKED",
      externalSyncedAt: new Date(),
      ...money,
      ...(row.cancelled ? { cancelledAt: new Date(), cancelledBy: "fareharbor", cancelReason: "Cancelled in FareHarbor" } : {}),
    };
    const existing = await prisma.listingBooking.findUnique({ where: { externalReference }, select: { id: true, departsAt: true } });
    if (existing) {
      await prisma.listingBooking.update({ where: { id: existing.id }, data });
      if (existing.departsAt.getTime() !== departsAt.getTime()) await markDepartureChanged(row.match.operatorProfileId, row.match.listingId, existing.departsAt);
      updated += 1;
    } else {
      const booking = await prisma.listingBooking.create({
        data: {
          ...data,
          reference: row.match.handoffReference,
          listingId: row.match.listingId,
          operatorProfileId: row.match.operatorProfileId,
          channel: "FAREHARBOR",
          externalReference,
          source: "ONLINE",
          leadName: row.name ?? "FareHarbor guest",
          referralCode: row.match.referralCode,
          paidAt: new Date(),
        },
      }).catch(async (error: unknown) => {
        // A second booking from the same hand-off: give it a reference of its own.
        if ((error as { code?: string }).code !== "P2002") throw error;
        return prisma.listingBooking.create({
          data: {
            ...data,
            reference: `${row.match!.handoffReference}-${row.bookingId}`.slice(0, 40),
            listingId: row.match!.listingId,
            operatorProfileId: row.match!.operatorProfileId,
            channel: "FAREHARBOR",
            externalReference,
            source: "ONLINE",
            leadName: row.name ?? "FareHarbor guest",
            referralCode: row.match!.referralCode,
            paidAt: new Date(),
          },
        });
      });
      await prisma.listingBookingEvent.create({ data: { bookingId: booking.id, type: "imported", actor, message: `FareHarbor booking ${row.bookingId}, affiliate report` } });
      created += 1;
    }
    await markDepartureChanged(row.match.operatorProfileId, row.match.listingId, departsAt);
  }
  const skipped = preview.rows.filter((r) => r.problem).length;
  return { ok: true as const, message: `${created} new, ${updated} updated${skipped ? `, ${skipped} not imported (see the preview)` : ""}.`, created, updated, skipped };
}
