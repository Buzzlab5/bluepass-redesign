# Operator page data, one JSON file per operator

File: `<slug>.json` in this folder. UTF-8, pretty-printed. Every fact comes from the operator's own
website and carries the URL it was read from. Nothing is invented: unknown means null.

```jsonc
{
  "slug": "imagine-cruises",                 // given in the brief
  "name": "Imagine Cruises",                  // as the business writes it
  "website": "https://imaginecruises.com.au",
  "rezdyAlias": "imaginecruises52",           // given in the brief
  "state": "NSW",
  "town": "Nelson Bay",                       // where trips leave from, the town
  "category": "Whale & dolphin cruises",      // 2 to 4 words, plain
  "summary": "…",                             // 2 or 3 short sentences, Bluepass voice (rules below)
  "standouts": ["Eco Certified (Advanced) by Ecotourism Australia", "…"],  // only claims the site makes, max 4, each verifiable
  "contact": { "phone": "+61 2 …", "email": "…", "address": "…" },          // public contact details from the site
  "heroImage": "https://…jpg",                // the operator's own photo URL, the best wide shot
  "sourceUrls": ["https://…", "…"],           // every page read
  "trips": [
    {
      "title": "Dolphin Watch Cruise",        // as the operator names it
      "kind": "cruise",                       // one of: cruise, tour, swim, dive, snorkel, kayak, sail, charter, liveaboard, course, other
      "summary": "…",                         // 2 or 3 sentences, Bluepass voice
      "highlights": ["…", "…"],               // up to 4 short factual points from the site
      "duration": "1.5 hours",                // as stated
      "durationMinutes": 90,                  // number, or null if not stated
      "departureTimes": ["10:30", "13:30"],   // 24h, local, as stated; [] if not stated
      "season": "Year round" ,                // or "June to November", as stated; null if not stated
      "departsFrom": "d'Albora Marina, Nelson Bay",
      "prices": [ { "label": "Adult", "amount": 39, "currency": "AUD", "note": null } ],  // every price option shown, exact
      "priceFrom": 39,                        // the lowest adult or per-person price shown, or null
      "includes": ["…"],                      // what is included, from the site
      "bring": ["…"],                         // what to bring / requirements, from the site
      "requirements": "Minimum age 6",        // age, swimming ability, fitness, certification; null if none stated
      "offer": null,                          // or { "text": "…", "conditions": "…", "validUntil": "2026-11-30" or null }
      "images": ["https://…", "…"],           // up to 4 of the operator's own photo URLs for this trip
      "bookingLinks": ["https://imaginecruises52.rezdy.com/123456/dolphin-watch"],  // booking links found ON the operator's site (do not open rezdy.com pages)
      "sourceUrl": "https://…",               // the page this trip was read from
      "checkNotes": "Price differs between the tour page and the prices page; used the prices page."  // anything a fact-checker should look at, or null
    }
  ],
  "offers": [ { "text": "Gift vouchers available", "conditions": null, "validUntil": null, "sourceUrl": "https://…" } ],  // operator-wide specials, packages, vouchers
  "checkNotes": "…"                           // operator-level doubts, or null
}
```

## Rules

- Read only the operator's own website (and pages it links to on the same domain). Do not open any
  `*.rezdy.com` page: Rezdy's booking pages are behind bot protection and must not be crawled. Do
  record Rezdy booking links you find on the operator's own pages.
- Be polite: fetch pages one at a time, no more than about 40 pages per operator.
- Facts are copied exactly: prices, currencies, durations, times, ages, places, inclusions, dates.
  If a fact is not on the site, it is null or an empty list. Never estimate.
- Summaries are rewritten, never copied: plain, specific, calm. Short sentences. No hype words
  (amazing, unforgettable, breathtaking, once-in-a-lifetime, paradise). No emojis. No em dashes
  (use commas, full stops or "and"). Do not state any percentage. Do not mention Bluepass.
- Every trip the operator sells counts: day tours, cruises, swims, dives, courses, charters, private
  tours, liveaboards, seasonal tours, and gift vouchers or packages (as offers).
- Prices exactly as the site shows them, with the currency (AUD unless stated). Keep every price
  option (adult, child, family, concession, private charter). If prices are only shown inside the
  booking widget and not on the page, set prices [] and say so in checkNotes.
- Images: only the operator's own photo URLs as they appear on their site (absolute https URLs).
- If something is ambiguous or conflicting, choose the more specific page and explain in checkNotes.
