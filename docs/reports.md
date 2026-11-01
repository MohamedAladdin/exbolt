# Reports

Every account can answer its own questions from inside the system: pick a
source, pick what to measure, break it down, keep it, and hand it over as a
spreadsheet or a printable page. **Reports** sits in the sidebar (`/reports`)
for every plan; the deeper metrics belong to GROWTH and SCALE.

Three ways in — a ready-made report, a saved one, or the builder — all end at
the same runner, so what a manager saves is exactly what they were looking at.

## What is in the box

| Dataset | Answers | Default breakdown |
| --- | --- | --- |
| Messages | volume, inbound/outbound, delivery, failures, AI replies | day |
| Conversations | new threads, open/closed, unassigned, first response | day |
| Contacts | new contacts per period, by channel or tag | day |
| Deals | deals, won/lost, value, won value, days to close | day |
| Campaigns | recipients, delivered, read, replied, rates | campaign |
| Team replies | replies, avg/median/p90 response, within target | team member |

Dimensions available per dataset: `period`, `agent`, `channel`, `status`,
`tag`, `number`, plus `pipeline`/`stage` on deals and `broadcast` on campaigns.
Two dimensions maximum — a third turns the table into a spreadsheet nobody
scans. Filters are the same vocabulary, per dataset; a filter that does not
apply is **refused**, never ignored, because a silently dropped filter is a
report that lies.

## Who gets what (packaging, migration 083)

| Plan | Reports | History | Saved |
| --- | --- | --- | --- |
| Core $65 | ready-made + CSV export | 90 days | none |
| Growth $129 | + builder, filters, comparison, advanced metrics | 365 days | 50 |
| Scale $229 | + everything | unlimited | unlimited |

`reports` is true on every plan — hiding a client's own numbers is not a
feature. `reports_advanced` is the **customization** switch (builder, saving,
comparison, advanced metrics) and the two ceilings live in `plans.limits`
(`report_history_days`, `saved_reports`, `null` = unlimited).

Enforcement is why `/api/reports/run` takes two shapes:

* `{ preset, days }` — any plan. The server builds the config from the
  catalogue, so a preset cannot carry a metric or dimension the plan lacks.
* `{ config }` — Growth+ only (`402 reports_custom_missing`).

The history floor is checked on both the run **and** the export (a file that
ignores the plan is the way around the gate), and comparison is refused on
Core (`reports_compare_not_in_plan`) even though the same request would work
on Growth.

## Comparing with the previous period

`compare: true` on a run also aggregates the **equal-length window immediately
before** `from` and returns `previous: { from, to, totals }`. Equal length on
purpose: a 31-day month must not be flattered by a 30-day one. The UI renders a
four-card strip with the delta and colours it by direction — a rising response
time or failure count is bad news even though the number is bigger, which is
what `lowerIsBetter()` exists for.

## Where the numbers come from

`supabase/migrations/082_reports.sql` installs two things:

* `saved_reports` — a named config per account (`config` is JSONB). RLS:
  any member reads the shared ones plus their own; any agent creates their
  own; admin+ may edit or delete anyone's. Writes go through
  `/api/reports`, which resolves the account from the session.
* `run_report(config)` — one read-only, `SECURITY DEFINER` runner for all six
  datasets. It resolves the account from `auth.uid()`, computes every bucket
  in the caller's timezone (a "day" is the clinic's day), and returns
  `{columns, rows, totals, rowCount, truncated}`.

Why the aggregation is SQL and not TypeScript: a 90-day message report is
thousands of rows; pulling them into Node to sum them moves the account's
whole traffic over the wire to answer a question Postgres can answer with an
index. Why the config is not interpolated: every dimension and metric is
mapped through a `CASE` in the function, and an unknown key raises `22023`.
That is also the drift guard — `src/lib/reports/catalog.test.ts` reads this
migration and asserts the catalogue and the runner agree per dataset.

Response times use the same turn definition as `member_profile` (a customer
message → the first non-failed agent reply), so the number on a member profile
and the same number in a report agree. `tag` deliberately multiplies rows: a
contact with two tags counts once per tag, because the tag is the unit of the
breakdown.

Totals are recomputed over the whole filtered set, **not** summed from the
rows — an average of averages is a wrong number, and the totals line is the
one that gets quoted in a meeting.

## API

| Route | What it does |
| --- | --- |
| `GET /api/reports` | Saved reports (shared + own), newest edit first |
| `POST /api/reports` | Validate and save a config under a name |
| `PATCH /api/reports/[id]` | Rename, edit config, share/unshare |
| `DELETE /api/reports/[id]` | Delete |
| `POST /api/reports/run` | Run a config, return rows + totals + the normalised config |
| `POST /api/reports/export` | `format: "csv" \| "html"` — the file for what is on screen |

Plan gates: `requireFeature('reports')` on all of them, `exports` on the
download, and `reports_advanced` decides whether `advanced` metrics are
accepted. The browser hides what the plan lacks; the route is what refuses it
(`400 metric_not_in_plan`, `402` for the feature itself).

## Exports

* **CSV** — UTF-8 **with BOM** and CRLF (Excel reads Arabic headers correctly;
  without the BOM it renders mojibake). Numbers are unformatted and cells that
  begin with `= + - @` are quoted, so a contact named `=HYPERLINK(...)` cannot
  execute in the spreadsheet.
* **Print / PDF** — a self-contained A4 HTML page (`src/lib/reports/document.ts`)
  that the browser prints. No PDF engine ships in the image, and a naive one
  prints disconnected, reversed Arabic glyphs; the browser shapes text for
  free. Everything user-controlled is escaped.

A saved report stores the **shape**, not the dates: it runs on whatever period
you choose, so "last 30 days" does not silently become last March.

## Known scope

* No scheduled email delivery yet — the runner and the export are the pieces
  it would need.
* Row cap is 5,000 (`truncated: true` above that): narrow the period or add a
  filter. Pagination is not offered on purpose — a report is meant to be read
  whole.
