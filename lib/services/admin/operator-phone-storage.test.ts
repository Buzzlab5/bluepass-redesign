/**
 * DB-backed regression tests for marker-preserving operator phone writes:
 * admin onboarding/edit and the dispatch path must store canonical E.164
 * (with its "+" marker) so the webhook authorization comparison never has to
 * guess a bare number's country. Runs under vitest.rails.config.ts (local
 * Postgres only) - never the shared database; cleans up its own prefixed rows.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createManualOperator } from "./operator-onboarding";
import { updateOperatorBasicInfo } from "./operator-edit";
import { dispatchInquiryToOperator } from "@/lib/services/operators/operator-dispatch-service";

const EMAIL_PREFIX = "phone-storage-test+";
const COMPANY_PREFIX = "Phone Storage Test";
const ADMIN_EMAIL = "phone-storage-test-admin@bluepass.co";

function input(overrides: Partial<Parameters<typeof createManualOperator>[0]> = {}) {
  return {
    companyName: `${COMPANY_PREFIX} ${randomUUID()}`,
    payoutContactEmail: `${EMAIL_PREFIX}${randomUUID()}@ops.bluepass.co`,
    payoutMethod: "MANUAL_BANK_TRANSFER" as const,
    createdByEmail: ADMIN_EMAIL,
    ...overrides,
  };
}

afterAll(async () => {
  const accounts = await prisma.bluePassAccount.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true },
  });
  await prisma.bluePassAccount.deleteMany({ where: { id: { in: accounts.map((a) => a.id) } } });
  const inquiries = await prisma.bookingInquiry.findMany({
    where: { selectedYachtName: COMPANY_PREFIX },
    select: { id: true },
  });
  await prisma.bookingInquiry.deleteMany({ where: { id: { in: inquiries.map((i) => i.id) } } });
});

describe("createManualOperator WhatsApp storage", () => {
  it("stores a national number as canonical E.164 under the project default country", async () => {
    const result = await createManualOperator(input({ whatsappE164: "0412 345 678" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const profile = await prisma.operatorProfile.findUniqueOrThrow({ where: { id: result.operatorProfileId } });
    expect(profile.whatsappE164).toBe("+61412345678");
  });

  it("reads a national number under the country the form collected", async () => {
    const result = await createManualOperator(input({ whatsappE164: "0812 3456 789", country: "ID" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const profile = await prisma.operatorProfile.findUniqueOrThrow({ where: { id: result.operatorProfileId } });
    expect(profile.whatsappE164).toBe("+628123456789");
  });

  it("lets a marked international number carry its own country", async () => {
    const result = await createManualOperator(input({ whatsappE164: "+62 812 3456 7001", country: "au" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const profile = await prisma.operatorProfile.findUniqueOrThrow({ where: { id: result.operatorProfileId } });
    expect(profile.whatsappE164).toBe("+6281234567001");
  });

  it("rejects a number that cannot canonicalize instead of storing it ambiguous", async () => {
    const result = await createManualOperator(input({ whatsappE164: "123" }));
    expect(result.ok).toBe(false);
    if (result.ok || result.code !== "VALIDATION") return;
    expect(result.field).toBe("whatsappE164");
  });

  it("rejects bare international digits without a marker rather than guessing the country", async () => {
    const result = await createManualOperator(input({ whatsappE164: "61412345678" }));
    expect(result.ok).toBe(false);
    if (result.ok || result.code !== "VALIDATION") return;
    expect(result.field).toBe("whatsappE164");
  });
});

describe("updateOperatorBasicInfo WhatsApp storage", () => {
  it("stores canonical E.164 on edit, never a dial-detectable bare national", async () => {
    const created = await createManualOperator(input({}));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateOperatorBasicInfo({
      operatorProfileId: created.operatorProfileId,
      companyName: `${COMPANY_PREFIX} ${randomUUID()}`,
      whatsappE164: "0412 345 678",
      websiteUrl: "",
      country: "",
      rezdySupplierId: "",
      updatedByEmail: ADMIN_EMAIL,
    });
    expect(updated.ok).toBe(true);
    const profile = await prisma.operatorProfile.findUniqueOrThrow({ where: { id: created.operatorProfileId } });
    expect(profile.whatsappE164).toBe("+61412345678");
  });

  it("rejects ambiguous bare digits instead of mis-storing them (reviewer regression)", async () => {
    const created = await createManualOperator(input({}));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // "412345678" is the attack shape: dial-detectable as Swiss (+41) but
    // possibly a trunk-less AU national - either reading could point at the
    // wrong subscriber, so the write refuses and asks for an explicit form.
    // "61412345678" bare is the admin lockout shape: silently storing it as
    // +6161412345678 would deny the real operator forever.
    for (const ambiguous of ["412345678", "61412345678"]) {
      const updated = await updateOperatorBasicInfo({
        operatorProfileId: created.operatorProfileId,
        companyName: `${COMPANY_PREFIX} ${randomUUID()}`,
        whatsappE164: ambiguous,
        websiteUrl: "",
        country: "",
        rezdySupplierId: "",
        updatedByEmail: ADMIN_EMAIL,
      });
      expect(updated.ok).toBe(false);
      if (updated.ok) continue;
      expect(updated.field).toBe("whatsappE164");
    }
    const profile = await prisma.operatorProfile.findUniqueOrThrow({ where: { id: created.operatorProfileId } });
    expect(profile.whatsappE164).toBeNull();
  });

  it("rejects an unrecognisable number on edit", async () => {
    const created = await createManualOperator(input({}));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateOperatorBasicInfo({
      operatorProfileId: created.operatorProfileId,
      companyName: `${COMPANY_PREFIX} ${randomUUID()}`,
      whatsappE164: "not a phone",
      websiteUrl: "",
      country: "",
      rezdySupplierId: "",
      updatedByEmail: ADMIN_EMAIL,
    });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.field).toBe("whatsappE164");
  });
});

describe("dispatchInquiryToOperator recipientPhone storage", () => {
  async function seedInquiry() {
    return prisma.bookingInquiry.create({
      data: {
        sourceChannel: "WHATSAPP",
        selectedYachtName: COMPANY_PREFIX,
        dateWindow: "20 July 2026",
        guests: 2,
        status: "DRAFT",
      },
    });
  }

  it("stores the recipient as canonical marked E.164 (the send itself may fail without Meta creds)", async () => {
    const inquiry = await seedInquiry();
    await dispatchInquiryToOperator({ inquiryId: inquiry.id, operatorPhone: "0412 345 678" }).catch(
      () => undefined,
    );
    const outbound = await prisma.whatsAppOutboundMessage.findFirstOrThrow({
      where: { bookingInquiryId: inquiry.id },
    });
    expect(outbound.recipientPhone).toBe("+61412345678");
  });

  it("refuses to dispatch to an unrecognisable number, writing nothing", async () => {
    const inquiry = await seedInquiry();
    await expect(
      dispatchInquiryToOperator({ inquiryId: inquiry.id, operatorPhone: "abc" }),
    ).rejects.toThrow(/not a recognisable number/);
    expect(await prisma.whatsAppOutboundMessage.count({ where: { bookingInquiryId: inquiry.id } })).toBe(0);
  });
});
