import { prisma } from "@/lib/db/prisma";
import { sendAuthEmail } from "@/lib/services/auth/email";

/**
 * Links in an email have to work from the partner's inbox, so they always point at the live site:
 * an approval clicked on a laptop would otherwise mail out http://localhost links. EMAIL_LINK_BASE_URL
 * overrides it (a staging site, say).
 */
export function emailSiteUrl(env: Record<string, string | undefined> = process.env) {
  const configured = env.EMAIL_LINK_BASE_URL?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim() || "";
  const usable = configured && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configured);
  return (usable ? configured : "https://bluepass.co").replace(/\/+$/, "");
}

export function buildPartnerApprovedEmail(input: { name?: string | null; referralUrl: string; dashboardUrl: string }) {
  const firstName = input.name?.trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const text = [
    greeting,
    "",
    "Good news: your BluePass partner application is approved. Welcome aboard.",
    "",
    "Here is your personal link. Share it anywhere, and every booking that comes through it earns you commission:",
    input.referralUrl,
    "",
    "Your partner dashboard shows your link, the bookings it brings in and what you have earned. Sign in with this email address:",
    input.dashboardUrl,
    "",
    "Thanks for helping people book the ocean, and leave it better.",
    "The BluePass team",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #092033; max-width: 520px;">
      <p>${escapeHtml(greeting)}</p>
      <p>Good news: your BluePass partner application is approved. Welcome aboard.</p>
      <p>Here is your personal link. Share it anywhere, and every booking that comes through it earns you commission:</p>
      <p style="padding: 12px 14px; background: #f1f5f9; border-radius: 10px; font-family: monospace; word-break: break-all;">
        <a href="${escapeHtml(input.referralUrl)}" style="color: #006f8e;">${escapeHtml(input.referralUrl)}</a>
      </p>
      <p>Your partner dashboard shows your link, the bookings it brings in and what you have earned. Sign in with this email address.</p>
      <p>
        <a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;background:#006f8e;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">
          Open my partner dashboard
        </a>
      </p>
      <p>Thanks for helping people book the ocean, and leave it better.<br />The BluePass team</p>
    </div>
  `;

  return { subject: "You're a BluePass partner", text, html };
}

/**
 * Tells a newly approved partner they are in, with their referral link and dashboard. Reads the
 * address from the profile's own account, never from a form. Best effort by design: the caller
 * logs a failure, it never undoes an approval.
 */
export async function sendPartnerApprovedEmail(partnerProfileId: string) {
  const profile = await prisma.partnerProfile.findUnique({
    where: { id: partnerProfileId },
    include: { account: true, referralPartner: { include: { links: { orderBy: { createdAt: "asc" } } } } },
  });
  const link = profile?.referralPartner?.links[0];
  if (!profile || !link || !profile.account.email) return { sent: false as const, reason: "No approved partner with a link." };

  const base = emailSiteUrl();
  const referralUrl = new URL(link.targetPath?.startsWith("/") ? link.targetPath : "/", base);
  referralUrl.searchParams.set("ref", link.code);

  const email = buildPartnerApprovedEmail({
    name: profile.account.displayName,
    referralUrl: referralUrl.toString(),
    dashboardUrl: `${base}/partner`,
  });
  const delivery = await sendAuthEmail({ to: profile.account.email, ...email });
  return { sent: delivery.delivered, delivery };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
