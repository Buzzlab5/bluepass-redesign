# Rezdy and FareHarbor as channels

Operators who already run Rezdy or FareHarbor keep running it. Their trips come to Bluepass from
there, their seats stay there, and Bluepass sells them. This page is the one-time setup on each side
and what each channel can and cannot do.

## Rezdy

Rezdy is connected through **Bluepass's own Rezdy agent account** and its agent API
(developers.rezdy.com/rezdyapi/index-agent.html). One key reads every operator who shares trips with
Bluepass.

### Bluepass, once

1. Get the agent account's API key approved by Rezdy and set `REZDY_API_KEY`.
2. In that Rezdy account, under Integrations, Webhooks, add **Updated Order** and **Cancelled Order**
   pointing at `https://bluepass.co/api/channels/rezdy/webhook?key=<REZDY_WEBHOOK_SECRET>`.
   Rezdy does not retry failed webhooks; the 15-minute `/api/cron/channel-sync` catches anything missed.
3. Nothing else: the Discover sync and every operator connection use the same key.

### Each operator, once

1. On Bluepass, **Connections**, type their Rezdy booking address (`yourcompany.rezdy.com`).
   Bluepass checks the account belongs to them: their approved business name, the domain of the
   email they signed in with, or a Rezdy supplier id Bluepass already holds for them.
2. In Rezdy, give Bluepass a rate on the trips to sell, with **automated payments** or **full
   payment to agent**. Trips appear on Bluepass within 15 minutes, or at once with "Check again".

### What happens after that

| In Rezdy | On Bluepass |
| --- | --- |
| A product is shared with Bluepass | A trip appears, selling at once (or waiting, if the operator switched that off) |
| A product changes | Title, description, photo, duration, location and after-booking notes update |
| A product stops being shared | The trip stops selling and says why |
| A session's seats or prices change | Read live: the booking page always shows Rezdy's own |
| A Bluepass booking is cancelled | The guest is refunded and told |
| A Bluepass booking is moved | The guest is told the new time |
| A booking needs accepting (manual confirm) | The guest waits, is told when it is accepted |

**Payments.**

- *Automated payments* (`PAYOUTS`, what Rezdy marketplace rates use; 301 of 302 products on Rezdy's
  staging marketplace). The card is tokenised in the traveller's browser on Rezdy's Stripe account,
  with Rezdy's published key, and Rezdy charges it as it makes the booking, then pays the operator
  and Bluepass's commission itself. Bluepass never holds the money; the 5% to the reef comes out of
  the commission. A Rezdy cancellation refunds the card itself.
- *Full payment to agent* (`FULL_AGENT`, on negotiated rates). Bluepass's own Stripe checkout takes
  the money, held until the trip runs, as for Bluepass's own trips. The seats are held in Rezdy as a
  processing order while the traveller pays; the order is then confirmed with the payment recorded
  as a card payment to the agent (never as cash). The operator's payout is the fare less the
  commission Rezdy reports.
- Deposit and pay-the-operator rates are not sold: the trip shows the operator how to change it.

**Booking questions.** Whatever the operator made required in Rezdy is asked, in their words:
per booking and per guest, lists, dates, yes or no. Name, email, mobile and country come from the
lead guest. Pickups are offered when the product has them. Rezdy's own emails to the traveller are
switched off; Bluepass's confirmation carries the operator's after-booking information and the
Rezdy order number.

**Add-ons.** Rezdy's extras are offered on the booking card in Rezdy's three kinds: the traveller
picks how many, once for the booking, or one for every guest (sized to the party, whatever the request
says). They are priced into the first total, sent to Rezdy with the booking, and shown on the
confirmation and the manifest.

**When filing fails after a charge.** If Rezdy charged the card but Bluepass could not record the
booking, the traveller is told they are booked, with Rezdy's reference, and asked not to book again;
the 15-minute job finds the order by its Bluepass reference and files it, sending the confirmation.

**Not handled yet.** Open-dated tickets (`NO_DATE`), rentals and gift cards are not sold (Rezdy does
not allow agents to book the last two). Card payments that need 3-D Secure fail for EU suppliers, a
limit of Rezdy's API.

## FareHarbor

FareHarbor opens its API to an affiliate once $50,000 of bookings have gone through it in the past
12 months (tracked in the affiliate dashboard), with a connection fee and a yearly fee on top
(FareHarbor's "Affiliate booking methods" help page). Below that it offers affiliates the booking
link and nothing else: no item feed, no availability, no booking notifications. Every affiliate
booking Bluepass sends counts toward that threshold. So a FareHarbor trip books in **FareHarbor's own checkout**,
opened over the Bluepass page (FareHarbor's Lightframe) with Bluepass's affiliate tag.

### Bluepass, once

1. Join FHDN as an affiliate and set `FAREHARBOR_AFFILIATE_SHORTNAME` to the shortname FareHarbor issues.
2. Agree a commission with each operator; FareHarbor sets it up when the operator requests it.

### Each operator, once

1. Send FareHarbor a New Affiliate Request for Bluepass (fareharbor.com/submit/new-affiliate-request/).
2. In FareHarbor: Settings, Book Buttons & Embeds, **Book button or link** for a trip; under Advanced
   settings set **ASN company** to Bluepass; copy the link.
3. On Bluepass, **Connections**, paste it, then **Add a FareHarbor trip**: the trip's link, a name,
   a few lines and a photo. Or paste the link on an existing trip's page to switch it to FareHarbor.

### What Bluepass records

Every "Check dates and book" is a `ChannelHandoff` with a reference (`BP-…`) that travels as
FareHarbor's affiliate voucher number (`asn-ref`), alongside `ref=bluepass`. Each booking in
FareHarbor's affiliate report therefore names the hand-off it came from, and through it the trip and
any creator who referred the traveller. FareHarbor takes the payment and handles changes and refunds.
Bluepass does not see FareHarbor bookings until the affiliate report is imported: **Admin, Rezdy &
FareHarbor**, paste the report or choose its CSV, check what was read, import. Columns are found by
their headers, since FareHarbor does not publish the layout; only rows whose voucher number is a
Bluepass hand-off are imported, the rest are listed. Imported bookings appear on the operator's
calendar and manifest, count toward the 5% to the reef, credit any referrer, and record the
commission each operator owes Bluepass. Importing the same report again updates rather than doubles,
and picks up cancellations. Report times are read in the operator's own timezone, taken from their
browser when they connect FareHarbor.

## Running it locally

`scripts/mock-rezdy.ts` serves the Rezdy simulator over Rezdy's HTTP shapes on 127.0.0.1:3199,
with a page at `/` to cancel, confirm or move a booking as the operator would in Rezdy. Point
`REZDY_API_URL` at it (development only; refused in production). The tests use the same simulator,
and the mapping tests run against real responses captured from Rezdy's staging demo account
(`lib/services/channels/rezdy/__fixtures__`).
