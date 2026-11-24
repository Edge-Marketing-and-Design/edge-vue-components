---
name: edge-search-health
description: Check that Google can index an Edge CMS site and is indexing it: render each page template as Googlebot (robots.txt applied, failing requests, layout shift); check that links, redirects, sitemap entries and URL variants agree on one canonical address; read Search Console (URL inspection, sitemaps, traffic against a baseline), real-user Core Web Vitals, and the Pages report's not-indexed reasons from exported zips; save a dated report of what changed. Runs as a standalone audit, in edge-site-launch, as a 3/7/14/30-day post-launch watch and as a weekly audit. Use for SEO or search health audits, why pages are not indexed (soft 404, noindex, redirects, duplicates, crawled - currently not indexed), Core Web Vitals, traffic drops after a launch or renderer change, or search monitoring. Read-only; never publishes, edits the renderer or changes Search Console.
---

# Edge search health

Two questions, checked together:

1. **Can Google index the pages?** `scripts/crawler-render.mjs` loads one
   page per template in headless Chrome as Googlebot three ways: open;
   with the same-site requests robots.txt disallows failing; and with every
   same-site fetch/XHR failing (Google's renderer abandons slow requests
   even when robots.txt allows them). A page fails when a restricted load
   becomes an error screen, gains `noindex`, changes its title, h1 or
   canonical, or loses JSON-LD; in the robots load, losing content fails
   too. A made-up URL must return a real 404.
2. **Is Google indexing them?** `scripts/search-console.mjs` reads the
   Search Console API: URL inspection of the same pages (Soft 404,
   noindex, blocked, canonical chosen, rich results), the sitemaps (submitted,
   last read, errors) and daily clicks and impressions against a baseline.

3. **Does the site agree with itself about addresses?**
   `scripts/url-checks.mjs`: every sitemap page it renders must be final
   and canonical; uppercase, slashless and tracking-query copies must
   redirect to the canonical URL or name it as canonical; the site's own
   links (two per link pattern) must not point at redirects or aliases; old
   URLs must reach the canonical page in one redirect.
4. **Is it fast enough for real users?** `scripts/web-vitals.mjs` reads the
   Chrome UX Report (the data behind Search Console's Core Web Vitals
   report): LCP, INP and CLS at the 75th percentile for the site, phone and
   desktop, and for pages with enough traffic. The render also records
   layout shift at phone width per template, with the elements that moved.

Why all of it: in October 2026 Clearwater's server HTML, titles and JSON-LD
passed every check, yet the page swapped itself for an error screen when
Google's renderer could not fetch `/api/kv`. Google dropped the site as
Soft 404s; nothing looked at the rendered page or at Search Console for
three weeks.

## Setup (once per computer)

- **Chrome and Playwright:** the render uses the installed Google Chrome
  through Playwright. Without Playwright in the project, install it once
  outside any repository (no browser download):

  ```bash
  npm install --prefix ~/.cache/edge-skills playwright@1.56.1
  ```

- **Search Console access:** follow `reference/search-console-setup.md`
  (a service account added to each property, or your own login). Then
  `node edge/skills/edge-search-health/scripts/search-console.mjs sites`
  lists the properties it can read. Without access, the audit still runs
  the render and reports `search-console-unavailable`.
- **Core Web Vitals key:** a Google API key restricted to the PageSpeed
  Insights and Chrome UX Report APIs, in
  `~/.config/edge-search-console/pagespeed-api-key` (the same setup
  reference). Without it the audit reports `cwv-unavailable` and keeps the
  lab layout-shift check.

Without a Hub checkout (the edge-cms plugin), run the same scripts from
this skill's folder and pass `--out <folder>` to the audit; nothing else
changes. The scripts need Node 22 and no Hub.

## Audit a live site

```bash
node edge/skills/edge-search-health/scripts/audit.mjs --host www.example.com [--launch-date YYYY-MM-DD]
```

- `--host` is the canonical host (as in the site's canonical links).
- `--launch-date` compares traffic with the 28 days before launch (the old
  site); without it, with the 28 days before the last week.
- Pages come from the sitemap, one per template (home, detail pages of
  each collection, then top-level pages), up to `--max-pages 12`; add
  `--pages /a/,/b/` for specific URLs. `--inspect 12` caps URL
  inspections (Google allows 2,000 a day per property).
- **Pages report:** the Search Console API doesn't expose why pages are not
  indexed. Ask the person to export each reason: Search Console > Pages >
  "Why pages aren't indexed" > each reason > Export (zip). Pass each with
  `--coverage <zip>` (or `--coverage <folder of zips>`). Each reason is
  sampled and probed live: still noindex or fixed (then Validate fix),
  redirect chains, aliases, 404s. Duplicate exports of one reason are
  merged.
- It saves `importfiles/search-health/<host>/<date>.json` and `.md` in a Hub
  checkout (`--out <folder>` elsewhere) and compares with the previous
  run: new and resolved problems. Exit 1 when there are errors.
  The reports are working files; don't commit them.

Report to the person: PASS/FAIL, each error with its advice (the report's
"Problems and what to do"), and what changed since the last run. Traffic
alarms: either window (last 7 complete days, or last 3 days of fresh data)
down 50% or more from the baseline is an error; the last 7 days down 30% is
a warning. Sites under 3 clicks a day are too small to alarm on.
Core Web Vitals: poor (LCP > 4 s, INP > 500 ms, CLS > 0.25) is an error,
needs improvement a warning. For a failing metric, run Lighthouse on the
templates (edge-site-launch, `post.lighthouse`) for the specific cause:
render-blocking fonts and CSS, oversized images, a header that appears
after the first paint.

Reasons Google gives in the Pages report, and what they usually mean here:

| Reason | Usually | Fix |
| --- | --- | --- |
| Soft 404 | the rendered page is an error view | renderer; the crawler render shows it |
| Excluded by 'noindex' tag | an error view or block adds noindex | find what adds it; Validate fix once gone |
| Page with redirect | old URLs; never indexed themselves | one-step 301 to the canonical URL |
| Duplicate without user-selected canonical | the same page at several addresses | links, redirects, sitemap and canonical on one address |
| Alternate page with proper canonical tag | an alias doing its job | nothing |
| Crawled - currently not indexed | Google's choice; mixed address signals or syndicated content (MLS listings) | consistent canonical signals, unique text, internal links |
| Discovered - currently not indexed | not crawled yet; crawl budget | internal links, sitemap, fewer redirecting and duplicate URLs |
| Not found (404) | removed pages | fine; drop them from sitemaps and links |

When the render fails, the cause is in the renderer (`emd-cms-front`):
write a handoff, don't edit it. When Search Console shows Soft 404 or
noindex but the render passes, ask the person to run URL Inspection > Test
live URL > View tested page (Screenshot, More info > Page resources and
JavaScript console messages) on one of the pages and share it.

After a fix ships, tell the person: Request indexing on the key pages;
Pages report > the affected group (Soft 404, Excluded by noindex) >
Validate fix; check the sitemap is submitted.

## Before launch (preview host)

The published-site preview host renders the same renderer before the
domain moves. Preview hosts are always `noindex` and allow everything in
robots.txt, so only the open and no-API loads run:

```bash
node edge/skills/edge-search-health/scripts/crawler-render.mjs --base https://<project>.pages.dev --preview-site <siteId> --pages /,/about/,<one detail page per collection>
```

## Watch window and weekly audit

After a launch, and for every live site, schedule the audit with the
scheduled-tasks tool (`create_scheduled_task`; local, runs while the
Claude app is open, catching up on next launch). Cloud routines can't
reach the local credentials. Ask the person before creating them.

- **Watch window:** one-time tasks (`fireAt`) at 3, 7, 14 and 30 days after
  launch, each `search-health-<site>-day-<n>`.
- **Weekly:** `cronExpression: "0 8 * * 1"` (Mondays 8:00),
  `search-health-<site>-weekly`.

Each task's prompt must stand alone, for example:

> In the Hub checkout at `<absolute path>`, run
> `node edge/skills/edge-search-health/scripts/audit.mjs --host <host>
> --launch-date <date>`. Read the saved report. If it fails or lists new
> problems, send a push notification naming the errors and their advice,
> and summarize them; otherwise reply in one line that search health
> passed. Do not change anything.

Without the app, the same command runs from cron or launchd; the exit code
is 1 on errors.

## Do not

- Publish, change robots.txt, sitemaps or settings, request indexing or
  validate fixes yourself; Search Console actions stay with a person.
- Edit `emd-cms-front`; write a handoff with the failing pages, mode and
  problem codes.
- Print, copy or commit the credentials file.
