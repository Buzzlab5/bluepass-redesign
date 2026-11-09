# Operator page data

The researched facts behind the prepared operator pages: one JSON file per operator, in the
shape in `SCHEMA.md`, with that operator's own photos, videos and logo in `media/<slug>.json`
(`media/MEDIA_SCHEMA.md`). Every fact was copied from the operator's own website and carries
the page it came from. `docs/prepared-pages.md` describes the whole flow.

| Folder | Pages | Trips | Files with no trips |
| --- | --- | --- | --- |
| `.` (Australia) | 70 | 505 | 8 |
| `barbados` | 86 | 576 | 13 |

A file with no trips is an operator whose site blocked us or had nothing to read. The importer
skips it ("not imported, no trips") and it makes no page; the file is kept as the record of
what was found, and those operators still have a claim page from the outreach seed.

## Importing

Two runs, one per folder, against the database the app is pointed at:

    npx tsx --env-file=.env.local scripts/import-operator-pages.ts data/operator-pages
    npx tsx --env-file=.env.local scripts/import-operator-pages.ts data/operator-pages/barbados

Each run fetches and measures every photo, so give it time and a good connection; the
measurements are remembered for a week in `.photo-checks.json` beside the files (ignored by
git). Running it again changes only what changed: a page an operator has already claimed is
left alone.

## Nothing is public until a person approves it

Every page arrives with `qcStatus: "pending"`, and `/operators/<slug>` answers 404 until the
page is approved at `/admin/operator-pages`, trip by trip and then the page. Importing on
production therefore publishes nothing on its own.

Read `barbados/REVIEW.md` before approving the Barbados pages: it lists the operators that
need a decision first (a broker reselling other operators' boats, a hacked website, businesses
that may no longer trade) and the trips that touch Barbados's turtle-feeding and jet ski rules.
