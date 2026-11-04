---
name: edge-site-launch
description: Launch an Edge CMS site the same way every time - pre-launch checks on the draft site (setup standards, SEO, headings and alt text, links, forms, mobile, media, override components), the launch steps only a person does (real domain, DNS, publishing, Google Analytics, MyStats) with exact instructions, and post-launch checks on the live domain (HTTPS and forwarding, robots and sitemap, analytics hits, Lighthouse mobile and desktop, field data, links and forms) - ending in a launch report kept with the site's files. Use when asked to launch, go live with, pre-launch check, or post-launch check a site in a Hub (emd-cms, clearwater-hub, iafsc-hub). Never publishes, changes DNS or domains, or edits emd-cms-front; it stops for the person at each launch step.
---

# Edge site launch

Every launch follows `launch-standards.json` in this skill's folder: a
person reads it as the checklist, you work from it as the plan. Three
stages; you stop only where a person must act.

Record every check in `importfiles/<site>/launch-results.json` as
`{ "<item id>": { "ok": true|false, "evidence": "<command and result>" } }`
(the workspace folder without a checkout), and evaluate it any time with:

```bash
node edge/skills/edge-site-setup/scripts/standards-report.mjs \
  --standards edge/skills/edge-site-launch/launch-standards.json \
  --readiness readiness.json --results importfiles/<site>/launch-results.json
```

## Tools

- The Hub's CMS tools (local server from a Hub checkout, or remote):
  `cms_site_readiness`, `cms_list_pages`, `cms_get_page`, `cms_preview_url`,
  `cms_override_component` (local).
- `chrome-devtools` (bundled with the edge-cms plugin,
  `chrome-devtools-mcp`): drives a local Chrome. `navigate_page`,
  `emulate` / `resize_page` for phone width, `evaluate_script`,
  `list_console_messages`, `list_network_requests`, `lighthouse_audit`
  (accessibility, best practices, SEO; it excludes performance) and
  `performance_start_trace` / `performance_stop_trace` /
  `performance_analyze_insight` for performance. For a Lighthouse
  performance score, `npx lighthouse@13.6.0 <url> --only-categories=performance
  --form-factor=mobile --output=json --quiet --chrome-flags="--headless=new"`.
  Needs Node 22 and a current Chrome.
- `scripts/crawl-links.mjs` (links) and `scripts/check-live.mjs` (HTTPS,
  forwarding, robots, sitemap) in this skill's folder.
- The analytics MCP (`run_realtime_report`) when the property is connected.
- PageSpeed Insights API for field data, no key for occasional calls:
  `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<url>&strategy=mobile`
  (`loadingExperience`). A free key is only needed if keyless calls are
  rate-limited.

## 1. Pre-launch (the draft site)

1. **Setup standards** (`pre.setup`): run edge-site-setup's check (its
   section 3) and record the table. `site.placeholder-domain` is expected
   here.
2. **Readiness** (`pre.media`, `pre.blocks`, part of `pre.seo` and
   `pre.forms`): `cms_site_readiness`, saved as `readiness.json`. Fix
   errors through the operations (drafts), then run it again.
3. **SEO** (`pre.seo`): for every page, meta title about 30–60 characters
   and description about 70–160, none duplicated across pages; structured
   data valid with its tokens. Fix with `page.update`.
4. **Headings and alt text** (`pre.headings`): open each preview link
   (`cms_preview_url`) in `chrome-devtools`; `evaluate_script` counts
   `h1` (exactly one) and images without `alt`; or `lighthouse_audit` with
   accessibility. Fix values with `page.setValues`; markup issues are
   `block.draft`s the developer releases.
5. **Links** (`pre.links`): Hub previews render in the browser, so a plain
   request sees only the app shell. Open each page's preview link
   (`cms_preview_url`; links expire in 15 minutes) in `chrome-devtools`,
   save `document.documentElement.outerHTML` from `evaluate_script` to a
   file once the blocks have rendered, and run
   `node edge/skills/edge-site-launch/scripts/crawl-links.mjs --html
   home.html@<preview url> --html about.html@<preview url> ...`.
6. **Forms** (`pre.forms`): list every form (pages whose blocks have an
   `emailTo` field) with where it routes: its `emailTo`, else the site's
   contact email (sites-and-pages contract, recipient routing). A real test
   submission sends mail, so it uses the Hub's form test
   (`data.formTest: true`): the email goes to the signed-in developer, not
   the recipients, and nothing is recorded. The public form helper forwards
   the flag only after an `emd-cms-front` change (handed off 2026-11-04):
   then open each form's page at `?cms-form-test=1` in `chrome-devtools`,
   signed in on the site as a Hub developer, fill the form and submit; the
   response names `routedTo`, which must match the table. Until it ships, record the routing table as the evidence and list
   "submit each form once after launch and confirm with the recipient" as
   a person step.
7. **Mobile** (`pre.mobile`): each page at phone width (`cms_preview_url`
   with `viewport: "mobile"`, or `chrome-devtools` `emulate` at 390×844):
   `document.documentElement.scrollWidth <= innerWidth`, body text at least
   16px, tap targets at least 44px apart where it matters (navigation,
   buttons). Screenshot each.
8. **Overrides** (`pre.overrides`): readiness `deployedRenderer` for every
   override block; with a checkout, `cms_override_component` for each.
   A missing component blocks launch: hand it off for `emd-cms-front`.

Stop when pre-launch is clean (or each open item has the developer's
decision), and report.

## 2. Launch (a person)

Give the person these steps, exactly, and wait for them to say each is
done; then verify what you can:

1. **Domain** (`launch.domain`): Hub > the site > Settings > Domains:
   replace `<site-slug>.test` with the real domain (base hostname, no www),
   set the canonical domain and apex forwarding, save, and publish the site
   settings. Verify: the draft site's `domains` (`firestore_get_document`),
   and readiness no longer reports `site.placeholder-domain`.
2. **DNS** (`launch.dns`): in Cloudflare, add the records the Hub's domain
   status shows for the domain; wait until the Hub shows it connected.
   Verify: `check-live.mjs` (section 3) once it resolves.
3. **Publish** (`launch.publish`): release the block drafts the site uses
   (Block Editor), then publish every page and the site settings.
   Verify: readiness has no `page.unpublished` or `block.unreleased`.
4. **Google Analytics** (`launch.analytics`): create or link the property
   and set its measurement id in the site settings if it wasn't set at
   setup (then publish the settings). Verify: the site settings'
   `trackingGoogleAnalytics`.
5. **MyStats** (`launch.mystats`): set the site up in MyStats through the
   Claude session that works in the `EdgeMyStats` project. Record whether
   the person says it was done; you don't check it.

## 3. Post-launch (the live domain)

1. **HTTPS and forwarding** (`post.https`, `post.robots-sitemap`):
   `node edge/skills/edge-site-launch/scripts/check-live.mjs --domain
   <domain>` (add `--canonical <domain>` when the apex is canonical).
2. **Analytics** (`post.analytics`): open the site in `chrome-devtools`,
   then `run_realtime_report` for the property: at least one active user.
   Without the analytics MCP, say so and ask the person to look at the
   Realtime report.
3. **Lighthouse** (`post.lighthouse`): the home page and the key pages (a
   page per template), mobile and desktop: `lighthouse_audit` for
   accessibility, best practices and SEO, and the performance score with
   the trace tools or `npx lighthouse`. Record each score and the failing
   audits.
4. **Field data** (`post.field-data`): PageSpeed Insights for the home
   page; a new site usually has none yet: record that.
5. **Links and forms again** (`post.links-forms`):
   `crawl-links.mjs --start https://<host>/`, and the form tests (or the
   person's test submissions).
6. **Report** (`post.report`): `importfiles/<site>/launch-report.md` with
   the date, the standards table, each check's evidence and scores, the
   person steps and who did them, MyStats, and what is still open. Keep
   `launch-results.json` beside it so a later re-check can compare.

## Do not

- Publish, release, change domains, DNS or site settings that change live
  routing, or ask the tools to.
- Submit a real form without the form test flag before launch.
- Edit `emd-cms-front` or another repository; write a handoff note.
- Commit, push or deploy unless the developer asks.
