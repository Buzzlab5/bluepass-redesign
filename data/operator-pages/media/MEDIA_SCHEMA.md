# Operator media files

One JSON file per operator, `media/<slug>.json`, next to the facts file `<slug>.json`.
It adds the operator's own photos, videos and logo to a page that already has its facts.
The importer measures every photo and leaves out banners, backgrounds, thumbnails and
screenshots by itself, so record every candidate rather than judging pixels by eye.

```json
{
  "slug": "moonraker-dolphin-swims",
  "logo": "https://.../logo.png",
  "heroImage": "https://.../best-wide-photo.jpg",
  "gallery": ["https://.../photo1.jpg", "https://.../photo2.jpg"],
  "videos": [
    { "url": "https://www.youtube.com/watch?v=VIDEO_ID", "title": "Swimming with dolphins", "sourceUrl": "https://.../page-it-was-on/" }
  ],
  "trips": [
    { "title": "3 hour Dolphin & Seal Swim", "images": ["https://.../a.jpg", "https://.../b.jpg"] }
  ],
  "notes": "Anything you could not get, and why."
}
```

## What goes where

- `logo`: the operator's own logo as an image file (SVG, PNG or WebP), usually the site
  header's logo. The largest version the site serves. Null if none.
- `heroImage`: only if you find a better wide landscape photo than the page has now: real
  people on the water, wildlife, or the boat in its setting. Otherwise leave it out.
- `gallery`: up to 16 of the operator's best general photos (wildlife, guests on trips,
  boats, places they go), from their home, about and gallery pages.
- `videos`: the operator's own videos, up to 6, best first. YouTube or Vimeo embeds found in
  their pages (record the watch URL: `https://www.youtube.com/watch?v=ID` or
  `https://vimeo.com/ID`), videos on a YouTube channel their site links to, or a video file
  they host themselves (an `.mp4` URL). Give each a short plain title.
- `trips`: for each trip in `<slug>.json`, with its `title` copied exactly, every photo on
  that trip's own page, best first, up to 10. Include the photos the facts file already
  has; the importer merges and removes repeats.

## Rules

- Only the operator's own website, and a YouTube or Vimeo channel their site links to.
  Never open `*.rezdy.com` or `*.fareharbor.com` pages. No Facebook or Instagram (they need
  a login). No stock photos (Pexels, Unsplash, Shutterstock file names or credits) and no
  photos credited to another business.
- Direct image file URLs only (ending .jpg, .jpeg, .png, .webp, .avif or .svg, or a CDN URL
  that serves an image). Prefer the full-size file: on WordPress sites the original is the
  URL without the `-1024x683` size suffix, but only use it if it loads.
- Respect each site's bot checks. If a site answers with a captcha, a "checking your
  browser" page or a 403, stop on that site and say so in `notes`. Never try to get past it.
- Keep to about 30 pages per operator. Do not download anything; record URLs.
- No em dashes anywhere in the file.
