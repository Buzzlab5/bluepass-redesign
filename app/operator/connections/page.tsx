import { randomBytes } from "node:crypto";
import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import Notice from "@/components/auth/Notice";
import { FareHarborConnection, RezdyConnection, type ChannelConnectionView } from "@/components/rails/ChannelPanels";
import { AlertSettings, CalendarFeed, GoogleConnected } from "@/components/rails/ConnectionsPanels";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { prisma } from "@/lib/db/prisma";
import { FAREHARBOR_AFFILIATE_REQUEST_URL, FAREHARBOR_LINK_STEPS, fareHarborAffiliate } from "@/lib/services/channels/fareharbor/links";
import { rezdyConfig } from "@/lib/services/channels/rezdy/api";
import { REZDY_SHARE_STEPS } from "@/lib/services/channels/rezdy/sync";
import { googleConfig } from "@/lib/services/rails/google/api";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { googleSubscribeLink, siteUrl, webcalLink } from "@/lib/services/rails/links";
import { notificationSettings, whatsappSwitchedOn } from "@/lib/services/rails/notify";

export const metadata = { title: "Connections · Bluepass" };

const GOOGLE_RESULTS: Record<string, { tone: "success" | "error" | "info"; text: string }> = {
  connected: { tone: "success", text: "Google Calendar is connected. Your booked departures are on their way into it now." },
  cancelled: { tone: "info", text: "Nothing was connected. You can connect Google whenever you like." },
  expired: { tone: "error", text: "That sign-in took too long or came from another session. Start again from here." },
  failed: { tone: "error", text: "Google did not complete the connection. Try again in a minute." },
  "missing-permissions": {
    tone: "error",
    text: "Google needs every box ticked on its permission screen for bookings to sync. Nothing was kept; connect again and leave them ticked.",
  },
  "not-configured": { tone: "info", text: "Google sign-in is not set up on Bluepass yet." },
  unavailable: { tone: "info", text: "Calendar sync is for trips sold through Bluepass's own booking system." },
};

function ago(date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} ${hours === 1 ? "hour" : "hours"} ago` : `${Math.round(hours / 24)} days ago`;
}

/**
 * Where an operator's bookings meet the places they already live: the booking system
 * they run (Rezdy or FareHarbor), the calendar on their phone and WhatsApp. Each
 * section says what it does, what Bluepass can and cannot see, and how to undo it.
 */
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { profile, rails } = await requireRailsOperator("/operator/connections");
  if (!rails.enabled) return <RailsUnavailable title="Connections" reason={rails.reason} />;
  const { google } = await searchParams;
  const result = google ? GOOGLE_RESULTS[google] : undefined;

  // The feed link is made the first time it is needed, so every operator has one to copy.
  let feedToken = (await prisma.operatorRailsSettings.findUnique({ where: { operatorProfileId: profile.id } }))?.calendarFeedToken;
  if (!feedToken) {
    feedToken = randomBytes(24).toString("base64url");
    await prisma.operatorRailsSettings.upsert({
      where: { operatorProfileId: profile.id },
      create: { operatorProfileId: profile.id, calendarFeedToken: feedToken },
      update: { calendarFeedToken: feedToken },
    });
  }
  const feedUrl = `${siteUrl()}/api/rails/feed/${feedToken}.ics`;

  const [connection, settings, trips, channels] = await Promise.all([
    prisma.operatorGoogleConnection.findUnique({ where: { operatorProfileId: profile.id } }),
    notificationSettings(profile.id),
    prisma.operatorListing.findMany({
      where: { operatorProfileId: profile.id, status: { not: "ARCHIVED" } },
      select: { id: true, title: true, busyCalendarId: true, channel: true, status: true, channelIssue: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.operatorChannelConnection.findMany({ where: { operatorProfileId: profile.id } }),
  ]);
  const view = (platform: "REZDY" | "FAREHARBOR"): ChannelConnectionView | null => {
    const c = channels.find((x) => x.platform === platform);
    return c
      ? { status: c.status, accountKey: c.accountKey, displayName: c.displayName, lastSynced: c.lastCheckedAt ? ago(c.lastCheckedAt) : null, lastError: c.lastError, autoPublish: c.autoPublish }
      : null;
  };
  const rezdyTrips = trips.filter((t) => t.channel === "REZDY");
  const fareHarborTrips = trips.filter((t) => t.channel === "FAREHARBOR");
  const googleReady = Boolean(googleConfig());
  const whatsappOn = whatsappSwitchedOn();
  const linked = trips.filter((t) => t.busyCalendarId);

  return (
    <>
      <AdminPageHeader
        eyebrow="Connections"
        title="Connections"
        support="Your trips and bookings, where you already work: your booking system, your calendar and WhatsApp."
      />

      {result ? (
        <div className="rl-gap">
          <Notice tone={result.tone}>{result.text}</Notice>
        </div>
      ) : null}

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Rezdy</h2>
          <p className="ds-caption adm-block__note">
            Already on Rezdy? Your trips come to Bluepass from there and their seats stay there, so nothing is sold twice. Bookings made on Bluepass land in Rezdy as agent bookings, and a booking you cancel or move in Rezdy updates here and tells the guest.
          </p>
        </header>
        <RezdyConnection
          configured={Boolean(rezdyConfig())}
          connection={view("REZDY")}
          trips={{
            total: rezdyTrips.length,
            selling: rezdyTrips.filter((t) => t.status === "LIVE" && !t.channelIssue).length,
            needsAttention: rezdyTrips.filter((t) => t.channelIssue).length,
          }}
          steps={REZDY_SHARE_STEPS}
        />
      </section>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">FareHarbor</h2>
          <p className="ds-caption adm-block__note">
            Already on FareHarbor? Bluepass sells your trips through your own FareHarbor checkout as an affiliate. FareHarbor shares no calendar with affiliates, so the dates and prices travellers see are FareHarbor&rsquo;s own.
          </p>
        </header>
        <FareHarborConnection
          ready={Boolean(fareHarborAffiliate())}
          connection={view("FAREHARBOR")}
          trips={fareHarborTrips.length}
          steps={FAREHARBOR_LINK_STEPS}
          requestUrl={FAREHARBOR_AFFILIATE_REQUEST_URL}
        />
      </section>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Google Calendar</h2>
          <p className="ds-caption adm-block__note">
            Every booked departure appears in a &ldquo;Bluepass bookings&rdquo; calendar in your Google account, with who is coming, a minute after it is booked. Bluepass can only change the calendar it makes.
          </p>
        </header>
        {connection ? (
          <GoogleConnected
            email={connection.googleEmail}
            lastSynced={connection.lastSyncedAt ? ago(connection.lastSyncedAt) : null}
            needsReconnect={connection.status === "NEEDS_RECONNECT"}
            lastError={connection.lastError}
          />
        ) : googleReady ? (
          <div className="adm-card rl-stack">
            <p className="ds-body-sm rl-muted">
              Once connected, you can also let your own calendar close departures: a private charter in your diary takes the public trip off sale. Bluepass sees only when you are busy, never what the entry is.
            </p>
            <div className="rl-actions">
              <a href="/api/google/oauth/start" className="rl-btn rl-btn--primary">Connect Google Calendar</a>
            </div>
          </div>
        ) : (
          <div className="adm-card adm-empty">
            <p className="ds-body-sm adm-empty__title">Google Calendar is not switched on yet.</p>
            <p className="ds-body-sm adm-empty__body">Bluepass&rsquo;s Google sign-in is still being set up. The subscribe link below works with any calendar today.</p>
          </div>
        )}
        {connection && connection.status === "CONNECTED" ? (
          <p className="ds-caption rl-muted rl-after-card">
            {linked.length === 0
              ? "No trip is set to close when you are busy. Choose a calendar on a trip's setup page, under Closed dates."
              : `${linked.map((t) => t.title).join(", ")} ${linked.length === 1 ? "closes" : "close"} when your chosen calendar shows you busy.`}{" "}
            <Link href="/operator/trips">Trips ›</Link>
          </p>
        ) : null}
      </section>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Any other calendar</h2>
          <p className="ds-caption adm-block__note">Apple Calendar, Outlook, or a crew member&rsquo;s own phone can subscribe to your bookings with this link.</p>
        </header>
        <CalendarFeed feedUrl={feedUrl} appleUrl={webcalLink(feedUrl)} googleUrl={googleSubscribeLink(feedUrl)} />
      </section>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">WhatsApp</h2>
          <p className="ds-caption adm-block__note">
            {profile.whatsappE164
              ? `Alerts go to ${profile.whatsappE164}.`
              : "Add your WhatsApp number on the dashboard and alerts will go there."}{" "}
            Guests who tick WhatsApp when they book get their confirmation, a reminder the day before and any update you send, from Bluepass&rsquo;s number.
          </p>
        </header>
        {!whatsappOn ? (
          <div className="rl-gap">
            <Notice tone="info">WhatsApp messages start once Meta approves Bluepass&rsquo;s message templates. Until then, everything goes by email.</Notice>
          </div>
        ) : null}
        <AlertSettings {...settings} />
      </section>
    </>
  );
}
