/**
 * One throwaway inquiry for testing the WhatsApp operator loop (accept / decline / counter) with a
 * real phone, without touching a real operator or traveller.
 *
 *   npx tsx --env-file=.env scripts/whatsapp-loop-test.ts create <+countrycode-phone>
 *   npx tsx --env-file=.env scripts/whatsapp-loop-test.ts report
 *   npx tsx --env-file=.env scripts/whatsapp-loop-test.ts reset      (back to OPERATOR_PENDING, clears events)
 *   npx tsx --env-file=.env scripts/whatsapp-loop-test.ts remove [--with-receipts]
 *
 * There is no separate test database, so these rows live in the same database as production. `create`
 * writes rows ONLY: it sends nothing to Meta. It makes one BookingInquiry (status OPERATOR_PENDING)
 * and one WhatsAppOutboundMessage addressed to the phone you give, which is what makes that phone the
 * "operator" for this inquiry. The reply commands are then sent by hand from that phone to the
 * business number, e.g. `accept`, `counter Available 2 Nov, USD 4,100`, `decline`.
 *
 * Everything is found through the test marker (selectedYachtSlug), never through a name match, so
 * `report` lists exactly what `remove` would delete. Events and outbound rows go with the inquiry
 * (cascade). Inbound receipts have no foreign key; `remove --with-receipts` deletes the receipts
 * sent from the test phone since the inquiry was created, and nothing else.
 *
 * `create` refuses a phone that is not written with its country code ("+..."), a phone that belongs
 * to a real OperatorProfile, and a second test inquiry while one exists.
 */
import { prisma } from "@/lib/db/prisma";
import { toStorageE164 } from "@/lib/phone";

const MARKER_SLUG = "whatsapp-loop-test";
const MARKER_NAME = "BluePass WhatsApp loop test (test)";
const [command, ...flags] = process.argv.slice(2);

async function scope() {
  const inquiries = await prisma.bookingInquiry.findMany({
    where: { selectedYachtSlug: MARKER_SLUG },
    select: {
      id: true,
      status: true,
      createdAt: true,
      outboundMessages: { select: { id: true, recipientPhone: true } },
      events: { select: { id: true, fromStatus: true, toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const phones = [...new Set(inquiries.flatMap((i) => i.outboundMessages.map((m) => m.recipientPhone)))];
  const digits = phones.map((p) => p.replace(/\D/g, ""));
  const since = inquiries.length ? new Date(Math.min(...inquiries.map((i) => i.createdAt.getTime()))) : null;
  const receipts =
    since && digits.length
      ? await prisma.whatsAppInboundReceipt.findMany({
          where: { fromPhone: { in: digits }, createdAt: { gte: since } },
          select: { id: true, outcome: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
  return { inquiries, phones, receipts };
}

function print(found: Awaited<ReturnType<typeof scope>>) {
  if (found.inquiries.length === 0) {
    console.log("No test inquiry exists.");
    return;
  }
  for (const i of found.inquiries) {
    console.log(`inquiry ${i.id} (ref ${i.id.slice(-6)})  status=${i.status}  outbound=${i.outboundMessages.length}`);
    for (const e of i.events) console.log(`  event ${e.fromStatus ?? "-"} -> ${e.toStatus}  ${e.createdAt.toISOString()}`);
  }
  console.log(`inbound receipts from the test phone since creation: ${found.receipts.length}`);
  for (const r of found.receipts) console.log(`  receipt ${r.id}  outcome=${r.outcome}  ${r.createdAt.toISOString()}`);
}

async function create(rawPhone: string | undefined) {
  if (!rawPhone || !/^\s*(\+|00)/.test(rawPhone)) {
    throw new Error("Give the phone with its country code, e.g. +62812...");
  }
  const phone = toStorageE164(rawPhone);
  if (!phone) throw new Error("That phone does not parse as a real number.");

  const existing = await scope();
  if (existing.inquiries.length) throw new Error("A test inquiry already exists. Run `report`, then `remove` first.");

  const real = await prisma.operatorProfile.findMany({ where: { whatsappE164: { not: null } }, select: { whatsappE164: true } });
  const digits = phone.replace(/\D/g, "");
  if (real.some((p) => (p.whatsappE164 ?? "").replace(/\D/g, "") === digits)) {
    throw new Error("That phone belongs to a real operator profile. Use a phone that is not an operator's.");
  }

  const inquiry = await prisma.$transaction(async (tx) => {
    const created = await tx.bookingInquiry.create({
      data: {
        sourceChannel: "WHATSAPP",
        selectedYachtSlug: MARKER_SLUG,
        selectedYachtName: MARKER_NAME,
        dateWindow: "20 July 2026",
        guests: 2,
        notes: "Throwaway inquiry for the WhatsApp loop test. Safe to delete.",
        status: "OPERATOR_PENDING",
      },
    });
    await tx.whatsAppOutboundMessage.create({
      data: {
        bookingInquiryId: created.id,
        recipientPhone: phone,
        templateName: "booking_inquiry_operator",
        status: "SENT",
        sentAt: new Date(),
      },
    });
    return created;
  });
  console.log(`Created inquiry ${inquiry.id}. Send these from ${phone} to the business number:`);
  console.log(`  accept:${inquiry.id.slice(-6)}   |   counter:${inquiry.id.slice(-6)} Available 2 Nov, USD 4,100   |   decline:${inquiry.id.slice(-6)}`);
}

async function reset() {
  const found = await scope();
  if (found.inquiries.length !== 1) throw new Error(`Expected exactly one test inquiry, found ${found.inquiries.length}.`);
  const id = found.inquiries[0].id;
  await prisma.$transaction([
    prisma.bookingInquiryEvent.deleteMany({ where: { bookingInquiryId: id } }),
    prisma.bookingInquiry.update({ where: { id }, data: { status: "OPERATOR_PENDING" } }),
  ]);
  console.log(`Reset inquiry ${id} to OPERATOR_PENDING, events cleared.`);
}

async function remove(withReceipts: boolean) {
  const found = await scope();
  print(found);
  if (found.inquiries.length === 0) return;
  await prisma.$transaction([
    prisma.bookingInquiry.deleteMany({ where: { id: { in: found.inquiries.map((i) => i.id) } } }),
    ...(withReceipts ? [prisma.whatsAppInboundReceipt.deleteMany({ where: { id: { in: found.receipts.map((r) => r.id) } } })] : []),
  ]);
  console.log(`\nRemoved ${found.inquiries.length} inquiry(ies)${withReceipts ? ` and ${found.receipts.length} receipt(s)` : ""}. After:`);
  print(await scope());
}

async function main() {
  if (command === "create") await create(flags[0]);
  else if (command === "report") print(await scope());
  else if (command === "reset") await reset();
  else if (command === "remove") await remove(flags.includes("--with-receipts"));
  else console.log("Usage: create <+phone> | report | reset | remove [--with-receipts]");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
