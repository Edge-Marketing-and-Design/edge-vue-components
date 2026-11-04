---
name: edge-site-setup
description: Set up a new Edge CMS site in a Hub the same correct way every time, end to end, through the Hub's draft-only operations - theme, site on a placeholder domain, settings, menus, pages from the theme's templates, site chrome, SEO, images and forms - asking one round of questions at the start and stopping only at the end for one review, with every item of site-standards.json checked. Use when asked to set up, create or start a new site (an agent site, an office site, a client site) in a Hub (emd-cms, clearwater-hub, iafsc-hub), or when edge-design-to-site reaches the site itself. Never publishes, never sets a real domain, never edits emd-cms-front.
---

# Edge site setup

Every site starts from the same standard: `site-standards.json` in this
skill's folder. A person reads it as a checklist; you work from it as your
plan, and the Hub's readiness report enforces most of it (the `check`
codes). The run has one stop for questions at the start and one review at
the end. Everything in between is yours.

Read `site-standards.json` first. Each item says how it is set (`set`) and
checked (`check`); `person: true` items are for a person, with exact
instructions in your report.

## Tools

The Hub's CMS tools. With a Hub checkout (developers), the local server the
Hub's `.mcp.json` starts (`edge/tools/mcp/cms/launch.sh`), Firestore reads,
and scripts against the Hub's code; without one, the same operations
remotely. Call `cms_contract` for `operations` and `sites-and-pages` before
the first check; build every operation from those fields.

| Need | Operation or tool |
| --- | --- |
| Theme | `cms_find_theme`, `cms_get_theme`; `theme.create` for a new one (edge-design-to-site section 1 for a theme from a design) |
| Site | `site.create` (name, theme, `domains: ["<site-slug>.test"]`, SEO settings) |
| Settings | `site.settings` (logo, favicon, app icon, contact, social, menu position, tracking) |
| Menus | `site.menus` (the whole menus object; read it with `cms_list_pages`) |
| Pages | seeded by `site.create` from the theme's default menus; `page.create` for others; `page.placeBlock` / `page.setValues` |
| SEO | `site.update`, `page.update` |
| Images | `cms_find_media`, `cms_upload_media` (Hub URLs only) |
| Templates | `template.create`, `template.update`, and the page block operations with `siteId: "templates"` when the theme lacks a page the standard needs |
| Check | `cms_site_readiness`, `cms_preview_url`, `scripts/standards-report.mjs` |

## 1. Questions, once

Gather everything the standard needs that the Hub can't tell, in **one
message**. First read what the Hub has and fill it in rather than asking:

- the organization, its themes (`cms_find_theme`) and their default pages
  (`cms_get_theme` `defaultPages` / `defaultMenus`);
- for an agent or office site, the person's or office's record (name,
  email, phone, photo, social links: `firestore_get_document` with a
  checkout, or the collection the Hub's contract names);
- existing media for logos and icons (`cms_find_media`).

Then send one message listing every field of `answers.template.json` with
the value you found (marked "from the Hub") or a question. Ask for: site
name and slug, owner, theme, the launch domain if known (it is not set now),
contact email and phone, social links, analytics ids, which default pages,
logo, favicon and app icon files. Save the answers as
`importfiles/<site>/site-setup.answers.json` (or the workspace folder without
a checkout). Don't ask again later: anything missing becomes a report item.

## 2. Build without stopping

In this order, checking and running each operation:

1. **Theme**: an existing theme, or `theme.create` (for a design handoff,
   edge-design-to-site section 1 does the theme and its checkpoint first).
2. **Site**: `site.create` with the name, the theme, `domains:
   ["<site-slug>.test"]` (the placeholder; `site.create` needs a domain and a
   person sets the real one at launch) and the site SEO (`metaTitle`,
   `metaDescription`, `structuredData` from the default WebSite template,
   tokens kept: `{{cms-url}}`, `{{cms-site}}`, `{{cms-logo}}`). The theme's
   default menus become draft pages.
3. **Images**: upload the logo, light logo, favicon and app icon with
   `cms_upload_media` (SVG logos rendered to PNG first), wait for `ready`.
4. **Settings**: `site.settings` with the logos, favicon, app icon, contact
   email and phone, social links (full URLs), tracking ids, menu position.
   Consent stays on unless the answers say otherwise.
5. **Pages**: the answers' pages: seeded ones kept, missing ones from a
   template (`page.create` then the template's blocks, or a new template
   with `template.create` when several sites will need it), extra seeded
   pages the owner doesn't want moved to `Not In Menu` (a person deletes
   pages in the Hub).
6. **Chrome**: the synced navigation and footer on every page
   (`page.placeBlock` without values; the first instance takes the schema
   defaults). List the synced values the person must edit in the Hub.
7. **Menus**: `site.menus` with every page listed once, in the owner's
   order and titles; `Not In Menu` for routable pages the navigation hides.
8. **Content and SEO per page**: values from the answers and the owner's
   records (never invented copy; empty stays empty and goes in the report),
   `page.update` meta title (about 60 characters), meta description (about
   155) and structured data with `name` and `description` filled.
9. **Forms**: every form block has a recipient: its `emailTo`, or the site
   contact email. Agent sites route to the agent.

## 3. Check

1. `cms_site_readiness` for the site; save the JSON. Fix every error and
   every warning the standard covers, then run it again. `site.placeholder-domain`
   stays until launch; that is expected.
2. Save the draft site document (`firestore_get_document`
   `organizations/<orgId>/sites/<siteId>`, its `data`) and run:

   ```bash
   node edge/skills/edge-site-setup/scripts/standards-report.mjs \
     --standards edge/skills/edge-site-setup/site-standards.json \
     --readiness readiness.json --site site.json --answers site-setup.answers.json
   ```

   Every item `done`, except `person` items and anything you explain.
3. `cms_preview_url` for each page at about 1440 pixels and with
   `viewport: "mobile"`; fix what looks wrong.

## 4. Report and hand over

One message:

- the standards table from the report (done, needs a person, open with the
  reason);
- a preview link per page;
- what a person does next, with exact steps: edit the synced chrome values
  (which block, which fields), release any block drafts, review and publish
  the pages and the site settings in the Hub; then launch with the
  `edge-site-launch` skill (real domain, DNS, analytics, MyStats);
- content left empty and why;
- the answers file's path.

## When to stop early

Only for a fact only a person has that blocks everything (no theme can be
chosen, no organization access), a refusal you can't fix, or the same
check failing after three honest attempts. Keep going on everything else
and list the rest in the report.

## Do not

- Publish, release, set a real domain, change DNS, or ask the tools to.
- Set `domains` or `forwardApex` through settings (the operation refuses
  them); the real domain is a launch step for a person.
- Leave an image linked from another site, even as a placeholder.
- Invent copy, contact details or social links.
- Edit `emd-cms-front`, commit, push or deploy.
