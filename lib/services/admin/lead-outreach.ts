import "@/lib/validation/zod-messages";
import type { OperatorLeadStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { stopOutreachQuietly } from "@/lib/services/outreach/stop";

/**
 * The admin side of an operator lead: what the outreach desk sees on one lead, and the two things it
 * can do to it — move its status along, and write down what happened on a call.
 *
 * Both writes land in the same place: `OperatorOutreachEvent`, the log that already existed for the
 * self-service claim flow. Reusing it (rather than a second notes table) is what keeps one lead's
 * history readable as a single thread, whether the entry came from a claim link going out or from
 * someone picking up the phone.
 */

/** Statuses the outreach desk can set by hand. The claim-funnel values are deliberately absent —
 *  those are set by the claim flow itself, and letting BD pick them would misreport what happened. */
export const BD_LEAD_STATUSES = [
  "IMPORTED",
  "CONTACTED",
  "IN_DISCUSSION",
  "APPROVED",
  "DECLINED",
] as const satisfies readonly OperatorLeadStatus[];

export const BD_STATUS_LABELS: Record<(typeof BD_LEAD_STATUSES)[number], string> = {
  IMPORTED: "Not contacted",
  CONTACTED: "Contacted",
  IN_DISCUSSION: "In discussion",
  APPROVED: "Signed",
  DECLINED: "Declined",
};

export type LeadOutreachEvent = {
  id: string;
  type: string;
  message: string | null;
  createdAt: Date;
};

export type LeadDetailView = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  source: string;
  status: OperatorLeadStatus;
  lastOutreachAt: Date | null;
  createdAt: Date;
  events: LeadOutreachEvent[];
};

export async function getLeadForOutreach(leadId: string): Promise<LeadDetailView | null> {
  const lead = await prisma.operatorLead.findUnique({
    where: { id: leadId },
    include: {
      outreachEvents: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, type: true, message: true, createdAt: true },
      },
    },
  });

  if (!lead) {
    return null;
  }

  return {
    id: lead.id,
    slug: lead.slug,
    name: lead.name,
    category: lead.category,
    region: lead.region,
    email: lead.email,
    phone: lead.phone,
    websiteUrl: lead.websiteUrl,
    source: lead.source,
    status: lead.status,
    lastOutreachAt: lead.lastOutreachAt,
    createdAt: lead.createdAt,
    events: lead.outreachEvents,
  };
}

export type LeadOutreachResult = { ok: true } | { ok: false; message: string };

const statusSchema = z.object({
  status: z.enum(BD_LEAD_STATUSES),
  note: z.string().trim().max(2000).optional(),
});

export type UpdateLeadStatusInput = z.input<typeof statusSchema> & {
  leadId: string;
  actorEmail: string;
};

/**
 * Moves a lead along the funnel and records why in the same breath. `lastOutreachAt` only moves for
 * statuses that mean somebody actually made contact — leaving a lead's "last contacted" date
 * untouched when it is merely marked back to Not contacted keeps the follow-up queue honest.
 */
export async function updateLeadStatus(input: UpdateLeadStatusInput): Promise<LeadOutreachResult> {
  const parsed = statusSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the status." };
  }

  const lead = await prisma.operatorLead.findUnique({
    where: { id: input.leadId },
    select: { id: true, slug: true, status: true },
  });

  if (!lead) {
    return { ok: false, message: "That lead no longer exists." };
  }

  const { status, note } = parsed.data;
  const countsAsContact = status !== "IMPORTED";

  await prisma.$transaction([
    prisma.operatorLead.update({
      where: { id: lead.id },
      data: {
        status,
        ...(countsAsContact ? { lastOutreachAt: new Date() } : {}),
      },
    }),
    prisma.operatorOutreachEvent.create({
      data: {
        operatorLeadId: lead.id,
        operatorSlug: lead.slug,
        type: "bd_status_change",
        message: note?.trim()
          ? `${BD_STATUS_LABELS[lead.status as (typeof BD_LEAD_STATUSES)[number]] ?? lead.status} → ${BD_STATUS_LABELS[status]}: ${note.trim()}`
          : `${BD_STATUS_LABELS[lead.status as (typeof BD_LEAD_STATUSES)[number]] ?? lead.status} → ${BD_STATUS_LABELS[status]}`,
        metadata: { actorEmail: input.actorEmail, from: lead.status, to: status },
      },
    }),
  ]);

  // A person has the conversation now, so the automatic emails step back.
  if (PERSON_HAS_IT.includes(status)) {
    await stopOutreachQuietly({ operatorLeadId: lead.id }, `moved to ${BD_STATUS_LABELS[status]} by ${input.actorEmail}`);
  }
  if (status === "DECLINED") await suppressLeadEmail(lead.id, `declined in the CRM by ${input.actorEmail}`);

  return { ok: true };
}

const PERSON_HAS_IT: string[] = ["IN_DISCUSSION", "APPROVED", "LIVE", "DECLINED", "MANUAL_REVIEW"];

async function suppressLeadEmail(leadId: string, reason: string) {
  const email = (await prisma.operatorLead.findUnique({ where: { id: leadId }, select: { email: true } }))?.email?.trim().toLowerCase();
  if (!email) return;
  await prisma.outreachSuppression.upsert({ where: { email }, create: { email, reason, source: "crm" }, update: {} });
}

const noteSchema = z.object({
  note: z.string().trim().min(1, "Write something before saving.").max(2000),
});

export type AddLeadNoteInput = z.input<typeof noteSchema> & {
  leadId: string;
  actorEmail: string;
};

/** A note on its own, without moving the status — the "rang, no answer, try Tuesday" case. */
export async function addLeadNote(input: AddLeadNoteInput): Promise<LeadOutreachResult> {
  const parsed = noteSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Write something before saving." };
  }

  const lead = await prisma.operatorLead.findUnique({
    where: { id: input.leadId },
    select: { id: true, slug: true },
  });

  if (!lead) {
    return { ok: false, message: "That lead no longer exists." };
  }

  await prisma.operatorOutreachEvent.create({
    data: {
      operatorLeadId: lead.id,
      operatorSlug: lead.slug,
      type: "bd_note",
      message: parsed.data.note.trim(),
      metadata: { actorEmail: input.actorEmail },
    },
  });

  return { ok: true };
}

/**
 * Called after a lead has been turned into a real OperatorProfile through the existing onboarding
 * form, so the lead stops showing up in the outreach queue and its history says where it went.
 */
export async function markLeadSigned(input: {
  leadId: string;
  operatorProfileId: string;
  actorEmail: string;
}): Promise<LeadOutreachResult> {
  const lead = await prisma.operatorLead.findUnique({
    where: { id: input.leadId },
    select: { id: true, slug: true },
  });

  if (!lead) {
    return { ok: false, message: "That lead no longer exists." };
  }

  await prisma.$transaction([
    prisma.operatorLead.update({
      where: { id: lead.id },
      data: { status: "APPROVED", lastOutreachAt: new Date() },
    }),
    prisma.operatorOutreachEvent.create({
      data: {
        operatorLeadId: lead.id,
        operatorSlug: lead.slug,
        type: "bd_signed",
        message: "Onboarded as a Bluepass operator.",
        metadata: { actorEmail: input.actorEmail, operatorProfileId: input.operatorProfileId },
      },
    }),
  ]);
  await stopOutreachQuietly({ operatorLeadId: lead.id }, "signed as an operator");

  return { ok: true };
}
