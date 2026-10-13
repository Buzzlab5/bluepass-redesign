# Bluepass — Website Redesign

Next.js (App Router) implementation of `Bluepass Website Redesign.dc.html` from the
Claude Design project, built against the **Bluepass Design System**
(`bluepass-design-system-12358043-6d5c-4675-9247-b4665d96e37a`), with GSAP motion.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
```

## Structure

| Path | What's in it |
| --- | --- |
| [app/tokens.css](app/tokens.css) | The design system's tokens, ported verbatim (colors, typography, spacing, radius, shadow) plus the `.ds-*` type classes |
| [app/globals.css](app/globals.css) | Layout, responsive rules, and the CSS side of the motion primitives |
| [lib/data.ts](lib/data.ts) | Home copy and image seeds, lifted from the design's `renderVals()` |
| [lib/discover.ts](lib/discover.ts) | Discover copy — regions, trips, steps, partners |
| [lib/conservation.ts](lib/conservation.ts) | Conservation copy — promises, named partners, report lines |
| [lib/partners.ts](lib/partners.ts) | Partners copy — stats, beats, moves, toolkit, creators |
| [lib/gsap.ts](lib/gsap.ts) | Plugin registration + the two house eases (`bp-out`, `bp-inOut`) |
| [components/](components/) | One file per home section, plus `ui/` primitives and shared `Nav` / `SiteFooter` |
| [components/discover/](components/discover/) | Discover sections — hero + search, region rail, trip grid, steps, partner marquee |

## Routes

| Route | Page |
| --- | --- |
| `/` | Home — the `.dc.html` design |
| `/discover` | Discover — search, regions, filterable trip grid, how-it-works, partners |
| `/conservation` | Conservation — the 5% promise, named partners, report anatomy |
| `/partners` | Partners — the booking path, four moves, partner toolkit, creators |
| `/blog` | The Bluepass Journal — article index, category chips, featured lead |
| `/blog/[slug]` | An article — contents rail, share row, related posts, JSON-LD |
| `/blog/category/[slug]` | A category archive |
| `/admin/blog` | The editorial CMS (admin only) |

`Nav`, `SmoothScroll`, `Grain` and `KaiChat` live in [app/layout.tsx](app/layout.tsx) so they
persist across routes; only the page body swaps. `SmoothScroll` resets Lenis and refreshes
ScrollTrigger on every path change, since the new page's triggers must measure against the
new layout rather than the old scroll position.

## Blog & SEO

The blog exists to win search results for Bluepass's own name and for the questions its customers
ask before they book. Everything in it is arranged around that.

- **Admin** — `/admin/blog` lists every article with a "Needs SEO" queue; `/admin/blog/new` and
  `/admin/blog/[id]` are the editor; `/admin/blog/categories` manages the archives. Same
  `requireCurrentAdmin()` gate as the rest of the console, re-checked inside every server action.
- **Authoring** — bodies are Markdown, rendered by
  [lib/services/blog/markdown.ts](lib/services/blog/markdown.ts). It escapes everything and emits
  only its own tags, so no author-supplied HTML ever reaches a public page. The editor's preview
  runs the same renderer the article page does.
- **The checklist** — [lib/services/blog/seo.ts](lib/services/blog/seo.ts) is pure and isomorphic:
  the browser recomputes it on every keystroke, the server recomputes it on save. Nothing it says
  blocks publishing; it is advice, scored.
- **What search engines get** — a self-referencing canonical, Open Graph and Twitter cards,
  `BlogPosting` + `BreadcrumbList` + `Organization` JSON-LD (with `FAQPage`/`HowTo` when the
  article is built that way), plus [app/sitemap.ts](app/sitemap.ts) and
  [app/robots.ts](app/robots.ts). `noindex` posts are dropped from the sitemap rather than merely
  marked.
- **Entry point** — one link, in the footer's Journal column. The blog's audience arrives from
  search, not from the nav.

Images upload to the `blog-images` Supabase bucket via `/api/admin/blog/upload`. The bucket
provisions itself on the first upload, so the only setup is `SUPABASE_SERVICE_ROLE_KEY` in the
environment; without it the editor falls back to pasting image URLs, which is always available.

## Design-system fidelity

- Token values are unchanged. The only rewiring is the font stack: `--font-display`
  and `--font-body` are fed by `next/font` (Geist + Inter) instead of the CDN
  `@import`s, which keeps the DS readme's GT Walsheim → Geist substitution intact
  while removing render-blocking requests.
- `Button` reproduces the DS component's three variants, geometry and its
  scale-0.96 press signature.
- Display sizes are clamped for small screens; the token value is the 1440px maximum
  and is never exceeded.
- Photography is `picsum.photos` at the seeds the design specifies — swap
  `lib/data.ts` for real assets.

## Motion

Long, weighted, single-direction. No bounce outside two deliberate uses
(button press-release, the "5% built in" chip). Everything is scoped with
`useGSAP` so it tears down cleanly, and every animation has a rest state that
renders identically under `prefers-reduced-motion: reduce` — which also disables
Lenis and the grain loop.

| Where | Motion |
| --- | --- |
| Global | Lenis smooth scroll driven off the GSAP ticker so scrubs stay frame-locked; drifting film grain |
| Nav | Fixed and fully transparent over the hero — no bar, no reserved space — then materialises a blurred surface once past it; plus logo wave line-draw, hide-down/reveal-up, pill indicator that tracks hover, clip-path mobile overlay |
| Hero | Photo settles out of over-scale, headline lines rise from clip masks, staggered copy, looping scroll cue, content lifts and dissolves on scrub |
| Why | Cards deal in with an x-axis tilt, icon paths draw themselves, hover lifts a step up the surface ramp |
| Explore | Frames unmask upward while photos settle out of over-scale; alternating column drift (five-across only); hover push-in |
| Conservation | Fare card counters count up, chip pops, rows slide in as their hairline draws across |
| Partners | Slot-based carousel — one tween of x/scale/opacity/blur per card, autoplay with hover pause, drag/swipe, arrows, morphing dots. Slot pitch is derived from card width + scale + gutter so neighbours sit apart rather than overlapping |
| Close | Footer columns stagger, wordmark letters rise from clip masks and its tracking tightens on scrub |
| Ask Kai | Delayed overshoot entrance, pulsing presence dot, hover tilt |
| Discover hero | Same photo-settle + masked headline, with the search bar and its fields rising in sequence |
| Region rail | Drag-to-pan strip with a progress rule that tracks scroll position, cards stagger in, photo push-in on hover |
| Trip grid | Filter pills reuse the nav's sliding indicator; changing a filter clears the current cards out before the new set staggers in |
| How it works | Cards rise as the connecting rule draws left to right; icon paths draw themselves |
| Partners | Seamless marquee that slows on hover rather than stopping dead |
| Conservation hero | Glass panel wipes open, headline rises inside it, and the 5% counts up |
| The promise | Cards stagger in, index rules draw outward, values rise from their own clips |
| Partner evidence | Frames unmask upward over a parallaxed backdrop; hover lifts the card |
| Report anatomy | Rows slide in as their dividers draw; icon paths draw themselves |
| Partners hero | Page-hero system plus a money-path strip: client pays → you earn → reef gets |
| Four quiet moves | Cards descend as a stair while the diagonal connecting path draws through them |
| Partner toolkit | The tracked link types itself in; the copy button actually copies |
| Featured creators | Portrait cards whose bio expands from under the name on hover |
| Reels proof | The home page's `ReelCarousel`, reused rather than rebuilt |
| Partners close | Four ruled edges draw themselves around the panel — no photo, no box fill |

## Booking CMS (native rails)

Bluepass's own booking system for operators with none: what Rezdy or FareHarbor would be for them,
built into the operator console. An operator states once how a trip runs ("Tue, Thu and Sat at 8am,
fourteen seats") and what it costs; the calendar, booking page, website widget and Kai all sell from
that rule. Operators already on Rezdy or FareHarbor use the same console with their trips coming
from there (see Channels below). Every trip has exactly one source of seats
(`OperatorListing.channel`), so nothing is sold twice.

| Route | What it is |
| --- | --- |
| `/operator/trips`, `/operator/trips/[id]` | Setup: schedule rule, prices, closed dates, meeting point, booking link and widget |
| `/operator/calendar` | The next seven days of departures, with how full each is |
| `/operator/departures/[listingId]/[epochMs]` | Manifest: check-in, change capacity, stop sales, weather-cancel with refunds |
| `/operator/bookings`, `/operator/bookings/[ref]`, `/operator/bookings/new` | Every booking; phone and walk-up bookings |
| `/book/[slug]`, `/book/[slug]/confirmed` | The public booking page and confirmation |
| `/embed/book/[slug]` | The widget an operator pastes into their own website (resizes itself) |

**How a seat is sold.** `reserveSeats` prices the party from the operator's rates (never from the
request), then holds the seats for 34 minutes under a Postgres advisory lock per departure, so two
travellers paying for the last seat cannot both get it. Stripe Checkout takes the money; the webhook,
or the confirmation page asking Stripe directly, calls `confirmPayment`, which is idempotent and
refunds in full anyone who paid after their seats were resold. Money is held until the trip has run;
`/api/cron/rails-settle` then pays the operator's share by Connect transfer (behind
`NATIVE_SETTLEMENT_ENABLED`). The 5% to the reef is recorded on every online booking; bookings the
operator took and was paid for directly carry none.

**For Kai and other agents.** The same three endpoints the booking page uses:

- `GET /api/rails/[slug]/calendar?month=2026-11`: bookable days
- `GET /api/rails/[slug]/departures?date=2026-11-12&guests=2`: departures, seats left, prices, and
  a reason for every refusal that can be repeated to a traveller
- `POST /api/rails/[slug]/reserve`: holds seats and returns a Stripe payment link. Sent with
  `Authorization: Bearer <KAI_CORE_ADMIN_TOKEN or BLUEPASS_SERVICE_TOKEN>`, the booking is recorded
  as sold by Kai.

**Google Calendar.** An operator connects their Google account on `/operator/connections`. Bluepass
creates a "Bluepass bookings" calendar there and keeps one event per booked departure in it, with
the guest list in the notes, written straight after each change and retried every 15 minutes by
`/api/cron/rails-calendar`. Each trip can also name one of the operator's own calendars; while it
shows them busy (read through FreeBusy, so times only), that departure is closed to online sales,
re-checked live just before seats are held. Scopes are the narrowest available:
`calendar.app.created`, `calendar.calendarlist.readonly`, `calendar.freebusy`. Setup is in
`.env.example`. Any other calendar app can subscribe to `/api/rails/feed/<secret>.ics`.

**WhatsApp.** Guests who tick WhatsApp on the booking page (or whose operator ticks it for a phone
booking) get their confirmation, a reminder the day before and any cancellation or update, from
Kai's number. Operators get a new-booking alert and an evening-before summary from the ops number.
Every message, email included, is logged in `RailsNotification` once per dedupe key, with Meta's
delivery receipts moving it from sent to delivered to read. The six templates are in
`docs/whatsapp-templates.md` (generated from `lib/services/rails/whatsapp-templates.ts`); nothing is
sent on WhatsApp until they are approved and `WHATSAPP_RAILS_ENABLED=true`.
`/api/cron/rails-notify` sends reminders and summaries hourly.

**Channels: Rezdy and FareHarbor.** An operator connects on `/operator/connections`; the rest is
automatic. Details and the one-time setup on each side are in `docs/channels.md`.

- *Rezdy* (`lib/services/channels/rezdy`), through Bluepass's agent account. The operator names
  their Rezdy account (checked against their approved business name or email domain, so nobody can
  attach someone else's). Every product they share with Bluepass becomes a trip; new ones sell on
  their own, changed ones update, withdrawn ones stop. Seats, per-session prices, taxes, booking
  questions and pickups are read live from Rezdy when a traveller books. Automated-payment rates:
  the card is tokenised in the browser on Rezdy's Stripe account and Rezdy charges it as it books.
  Full-payment-to-agent rates: seats are held in Rezdy as a processing order, Bluepass's checkout
  takes the money, the order is confirmed with the payment recorded, and the operator is paid after
  the trip less Rezdy's commission. Cancellations and moves made in Rezdy reach Bluepass by webhook
  and by `/api/cron/channel-sync` every 15 minutes: the guest is refunded and told, or told the new time.
- *FareHarbor* (`lib/services/channels/fareharbor`), as an affiliate. FareHarbor gives affiliates
  no data below its API threshold, so a FareHarbor trip books in FareHarbor's own checkout, opened
  over the Bluepass page with Bluepass's affiliate tag and a reference of Bluepass's own as the
  voucher number (`ChannelHandoff`), which matches FareHarbor's affiliate report back to the trip
  and the referrer. FareHarbor takes the payment and runs changes and refunds. Its bookings reach
  Bluepass when the affiliate report is imported on `/admin/channels`.

**Running it locally.** The engine's tests run against a real Postgres because the race for the last
seat is the thing most worth testing. They refuse to run unless the database is local, since each
test empties the booking tables; set `RAILS_TEST_DATABASE_URL` to give them a database of their own.
`GOOGLE_API_ORIGIN_OVERRIDE` (development only) points the Google calls at a local stand-in.

`scripts/mock-rezdy.ts` serves an in-memory Rezdy (the same simulator the tests use) over Rezdy's
HTTP shapes, so the whole Rezdy flow runs locally without an approved agent key.

```bash
npx vitest run --config vitest.rails.config.ts
npx tsx --env-file=.env.local scripts/seed-rails-demo.ts   # demo operator, trips and bookings
npx tsx scripts/mock-rezdy.ts                              # a local Rezdy on 127.0.0.1:3199
npx tsx --env-file=.env.local scripts/seed-admin-demo.ts    # a local admin, to open /admin
```
