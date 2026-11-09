# Barbados operator pages: research brief

You are building Bluepass pages for Barbados marine operators, from each operator's own website.
For every operator you are given, write two files in this folder
(`/Users/anthonycargill/BluePass Build/operator-pages-pilot/barbados/`):

1. `<slug>.json`: the facts, in the shape of `../SCHEMA.md` (read it first).
2. `media/<slug>.json`: photos, videos and logo, in the shape of `../media/MEDIA_SCHEMA.md` (read it too).

Use the slug you are given, exactly. Work through your operators one at a time.

## What is different for Barbados

- `"country": "BB"` on every facts file. `"state": "Barbados"`. `"town"` is where trips leave
  from, as a traveller would know it (Bridgetown, Carlisle Bay, Holetown, Speightstown, Oistins,
  St Lawrence Gap, Bathsheba, Silver Sands). `"rezdyAlias": null`.
- Phone numbers as the site gives them, in +1 246 form where possible.
- Prices exactly as shown, with their currency: `"USD"` when the site says US$, USD or "US
  dollars"; `"BBD"` when it says BDS$, Bds$, BBD or "Barbados dollars". If the site shows only
  "$" and never says which dollar, use `"USD"` and write `Currency not stated, shown as $` in that
  trip's `checkNotes`. Keep per-person and per-boat (private charter) prices apart and labelled.
- Booking links: record the links you find on the operator's own pages (FareHarbor, Peek, Rezdy,
  Bokun, Wix Bookings, their own booking page). Never open `*.rezdy.com`, `*.fareharbor.com` or
  `*.peek.com` / `book.peek.com` pages. Do not record Viator, GetYourGuide, TripAdvisor or Expedia
  links as booking links (those are marketplaces, not the operator).
- A trip booked only by WhatsApp, phone or email has `"bookingLinks": []`. Put a `wa.me` link, if
  the site shows one, in `contact.whatsapp`.
- Turtles: Barbados limits feeding and touching sea turtles. If a trip advertises feeding turtles,
  describe the trip plainly, do not repeat the feeding claim in our summary, and write
  `Advertises turtle feeding` in that trip's `checkNotes`. Same for jet ski tours: add
  `Jet ski tour` to `checkNotes`.

## Is the business still trading?

Some operators are marked `unverified` in your list. For those, and for anyone whose site looks
old, check before building: prices or dates for 2025 or 2026, a working booking page, or recent
news on their own site. If the site looks abandoned (nothing newer than 2023, booking pages gone,
"temporarily closed"), still write `<slug>.json` with `"trips": []` and put the evidence in the
top-level `checkNotes`, starting with `Looks closed:`. Do not write a media file for it.

## The usual rules (from the Australian pages)

- Only the operator's own website and pages on the same domain, plus a YouTube or Vimeo channel
  the site links to. No Facebook or Instagram. No stock photos.
- Respect bot checks: a captcha, "checking your browser" page or 403 means stop on that site and
  say so in `checkNotes` (and the media file's `notes`). Never try to get past it, and never send
  a user agent that starts with "Mozilla". Use WebFetch or curl's default user agent.
- About 40 pages per operator at most, one at a time.
- If a domain does not resolve, check it through DNS over HTTPS before calling it dead (this
  machine's ISP rewrites DNS): `curl -s -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=DOMAIN&type=A'`.
- Facts copied exactly; unknown is null or []. Summaries rewritten in plain, calm words: no hype
  (amazing, unforgettable, breathtaking, paradise, once-in-a-lifetime), no emojis, no em dashes,
  no percentages, never mention Bluepass.
- If the site sells trips through a booking widget on one of its own pages rather than per-trip
  links, put that page's URL in each trip's `bookingLinks`.
- Validate each file with `python3 -m json.tool <file>` before moving on.

## When you finish

Reply with one line per operator: slug, number of trips, whether prices were found (and the
currency), the booking route (online link / widget page / enquiry only), and anything that
stopped you (bot check, site down, looks closed). Do not read other agents' files or transcripts.
