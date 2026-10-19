# Prepared operator pages

A page for an operator who has not signed up yet, built from what they already publish
about their own trips, checked by a person, and turned into a bookable page by the
operator themselves when they claim it and connect Rezdy.

## The flow

1. **Research.** One JSON file per operator, in the shape in
   `operator-pages-pilot/SCHEMA.md`: facts copied exactly from the operator's own website,
   each trip with the page it came from, summaries written fresh. Rezdy's public pages are
   behind a bot check and are never read.
2. **Import.** `npx tsx --env-file=.env.local scripts/import-operator-pages.ts <folder>`
   - measures every photo first and leaves out banners, plain backgrounds, thumbnails,
     screenshots and dead links (`photo-check.ts`); a site whose bot check blocks the
     measuring keeps its photos, marked to judge by eye;
   - sets each trip's From price to the main activity's adult price (`main-price.ts`);
   - holds the trips on a placeholder account (`prebuilt+<slug>@ops.bluepass.co`) as
     draft Rezdy trips with no product yet.
   - fingerprints every photo so one photo served at several sizes appears once, at its
     best copy, and checks every video can be shown on another site (YouTube and Vimeo
     oEmbed), keeping Vimeo's still for the video tile.
   Running it again changes only what changed on the website: a trip whose facts changed
   goes back to waiting for a check; a change in photos alone does not. A page the
   operator has claimed is left alone: it is theirs to correct from then on.
3. **Check** at `/admin/operator-pages`. Each fact sits beside its source page, with the
   researcher's doubts and anything the automatic check thinks is out of date
   (`stale-signs.ts`). A wrong fact is corrected in place (`prepared-edits.ts`); the
   correction is kept apart from the website's facts, so no import undoes it. Trips are
   approved one by one or all at once, then the page.
4. **Public.** `/operators/<slug>` shows an approved page with its approved trips, says
   the operator has not confirmed it, and sends travellers to the operator's own booking
   link. It shows none of the operator's photos yet.
5. **Claim.** Once the operator's claim is approved, `/operator/your-page` asks them which of
   their website's photos travellers see; those stay linked from their own website, never
   copied. A photo their site will not send to other pages cannot show anywhere but there,
   so the page hides it.
6. **Their own media.** On the same screen the operator uploads their logo and photos (for
   the page or for one trip) and links videos (`own-media.ts`). Uploads are shrunk in the
   browser, then checked, turned upright, re-encoded without camera metadata
   (`upload-image.ts`) and stored in the `operator-media` Supabase bucket
   (`lib/services/storage/operator-media.ts`; locally, without a key, in
   `public/dev-uploads`). Theirs show straight away and lead the page. This is how a page
   whose website blocks its photos, or has no logo file, gets them.
7. **Bookable.** When they connect Rezdy, every sync matches the page's trips to their
   Rezdy trips by name (`prepared-booking.ts`), only where the match is clear. A matched
   trip that is on sale gets a Book button into the normal Rezdy booking flow, at Rezdy's
   live price. The operator sees every match and can change it; their choice is kept.

## Where things live

| What | Where |
| --- | --- |
| Page facts, check, corrections, photo approval | `PreparedOperatorPage` |
| The operator's own logo, photos and videos | `PreparedOperatorPage.operatorMedia` |
| Trip facts, check, corrections, Rezdy match | `OperatorListing.channelData` (`source: "operator-website"`) |
| Local operator who has claimed a page | `scripts/seed-claim-demo.ts <slug>` |

The local Rezdy simulator's account is already connected to the demo operator from
`scripts/seed-rails-demo.ts`, so to see a claimed page become bookable locally, set that
operator's `claimedOperatorSlug` to a page whose trip names match the simulator's.
