# CMS sites and pages data contract

Status: in use for every site the CMS publishes.

Last verified: 2026-11-11, site resolution queue and writer lease recovery

A site is an organization's website: its settings, menus and domains, and
the draft pages assembled from block instances. Publishing copies a page or
the site settings into a published collection that the public renderer reads
from KV. This contract covers the site document, its menus, the page
document, the published copies, the version fields and the datasets the
renderer reads. Block instances are in `edge/docs/data-contracts/cms-blocks/`;
posts in `edge/docs/data-contracts/cms-posts/`; the workflow rules in
`docs/engineering/cms-publication.md`.

## Storage

| Documents | Path |
| --- | --- |
| Draft site settings | `organizations/{orgId}/sites/{siteId}` |
| Draft pages | `organizations/{orgId}/sites/{siteId}/pages/{pageId}` |
| Published pages | `organizations/{orgId}/sites/{siteId}/published/{pageId}` (the same id as the draft) |
| Published site settings | `organizations/{orgId}/published-site-settings/{siteId}` (the same id as the site) |
| Template pages | `organizations/{orgId}/sites/templates/pages/{pageId}`: the `templates` site is not a public site; its pages are copied when a theme seeds a site or a page is created from a template |
| Legacy published site | `organizations/{orgId}/sites-published/{siteId}`: only the registrar's attach and detach callables keep its `domains` in step; nothing else reads or writes it |
| Site-resolution state | `cms-site-resolution-locks/writer`: backend-only project-wide writer lease; `cms-site-resolution/{sha256(siteKey)}`: cleanup intent and successful projection checkpoint; `cms-site-resolution-pending/{siteHash}`: durable work per site |
| Auth-domain reconciliation state | `cms-auth-domain-sync/{projectId}`: backend-only project-wide lease and successful managed-host ledger |

The Hub writes sites and pages from the browser through
`edgeFirebase.storeDoc` (full replace) and `changeDoc`; the wrapper adds
`last_updated`, `uid` and `doc_created_at`. The operations `site.create`,
`site.update`, `page.create`, `page.update`, `page.placeBlock`,
`page.setValues`, `page.removeBlock` and `page.moveBlock` write the draft
documents from the
Functions with the same builders (`edge/docs/data-contracts/cms-operations/`).

## Fields

### Site

Defaults come from `siteSettingsDefaults` in `edge/lib/cmsOperations.js`,
which the Hub's new-site form (`siteSettingsTemplate.js`) and `site.create`
share.

<!-- fields: site generated from CMS_DOCUMENT_FIELDS -->

### Branding artwork and icon preview

`appIcon` is an optional Site string URL for installed-app artwork, separate
from `logo` and `favicon`. It defaults to an empty string; missing and empty
values compare equally for legacy sites. The Branding tab provides selection,
removal and a URL-input alternative. Changing it participates in site settings
publication, change summaries and Discard changes. The normal whole-document
publisher and `sites:` KV serialization retain the field without a new index.

### Splash screen settings

`splashImage` is an optional image URL. `splashBackgroundColor` is an optional
color **key** in the site's selected theme `extend.colors`, not a literal CSS
color. Both default to an empty string. Nested color keys use dots, for example
`brand.500`; a nested `DEFAULT` leaf uses its parent key. Nonstandard theme
names are supported. The UI offers only the selected theme's defined colors.

The Splash Screen tab follows Branding. It includes media selection/removal,
background swatches and a local phone preview using the current working copy.
The local-only iOS/Android toggle does not persist a setting. iOS previews
`splashImage`; Android previews `appIcon` and points editors to Branding to
change it. Both use the selected theme background. Missing artwork shows a
platform-specific prompt without substituting a logo. The preview centers
artwork without cropping. A missing theme color is flagged and
white is used for the illustrative preview without changing the stored token.

Both fields participate in draft save, unpublished-change comparisons, settings
change summaries, publication and Discard changes. Missing and empty compare
equally for existing sites. Theme default settings can seed both fields. The
existing whole-document site publisher and `sites:` KV document retain them;
no new endpoint, index, rules or migration is required. The image remains
separate from `appIcon`, `favicon` and logo settings. The public renderer must
consume these new fields before they affect home-screen launches; native
appearance is device dependent.

### Branding icon preview

Preview icons opens a full-screen, local-only dialog using the current settings,
including unsaved selections. It never saves or publishes. It shows original
artwork, labeled sizes, actual-size/enlarged views, source/transform information,
image errors and browser-reported returned dimensions. High-resolution sources
are recommended, ideally at least 512px on the longest side; square is preferred
but not required. Rectangular app artwork is padded into a square.

Browser favicon previews request 16, 32, 48 and 96px from favicon then logo.
Apple touch requests 180px from appIcon then favicon then logo. Selected
Cloudflare app artwork uses padded square path variants on white: Apple touch
180px JPEG and installed-app 192/512px JPEG at quality 90. Unsupported/external
app images keep their original any-size source. Default renderer artwork is
resolved on the configured CMS frontend URL, never the Hub origin.

The installed-app preview requires an explicit appIcon selection. Missing or
cleared artwork shows Choose an app icon with a picker action, without
previewing logo fallback. Public fallback orders remain appIcon then logo then
default artwork for manifest icons, appIcon then favicon then logo then default
for Apple touch, and favicon then logo then default for browser icons.

`edge/lib/cmsBrandingIconPreview.js` owns preview URL construction. Favicon
requests preserve the renderer's existing query transformations; returned file
dimensions are shown because they may differ from the requested sizes. No
existing-site backfill, new endpoint, index or Firestore rule is required.


### Audience registration response

For an unauthenticated successful `cms-restrictedContentBeginRegistration`,
`registrationCode` is the ID of the global `staged-users/{stagedUserDocId}`
record used by the registration client. `audienceUserId` and `memberId` remain
the site-specific `audience-users/{audienceUserId}` ID. These IDs can differ.
This response correction does not change staged-record selection or grants:
the function adds `user` at the audience document path and `editor` at its
`data` path, preserving existing permissions on the selected staged record.

### Menus

`menus` is `{ 'Site Root': [entry], 'Not In Menu': [entry], ...otherMenus }`.
Both root menus always exist (`withRootMenus`); `Site Root` is the
navigation, `Not In Menu` holds routable pages the navigation hides.

| Entry | Shape |
| --- | --- |
| Page | `{ name: slug, menuTitle, item: pageId, disableRename?, disableDelete? }` |
| Folder | `{ name, menuTitle?, folderTitle?, item: { [folderSlug]: [entry] } }` |
| External link | `{ name, item: { type: 'external', url } }` |

`name` is the page's route slug; `menuTitle` is what the navigation shows.
The Hub's custom-post menu also uses the matching `menuTitle`, preserving its
capitalization independently of the route slug; see the posts contract.
Page Settings from the menu and page preview both expose Index/Detail and,
only while it is checked, the shared custom-post type settings.
A theme's `defaultMenus` has the same shape with template page ids, which
seeding replaces with the new pages' ids.

### Page

Defaults come from `blankPagePayload` (a blank page) and
`buildPagePayloadFromTemplateDoc` (a page copied from a template page) in
`edge/lib/cmsOperations.js`, the same builders as `menu.vue`.

<!-- fields: page generated from CMS_DOCUMENT_FIELDS -->

## Public projection

### Publishing

- **A page** (`page.vue` `publishPage`): the draft document is stored as
  `published/{pageId}`, a full copy; `pageVersions.{pageId}` is set to the
  page's `version` on the site and on `published-site-settings` (created
  with `docId` when the site settings are not published yet).
- **The site settings** (`site.vue` `publishSiteSettings`): the site
  document is stored as `published-site-settings/{siteId}`, a full copy with
  the consent fields defaulted and the next `version`, which is also written
  to the site.
- **The whole site** (`publishSite`): every draft page is copied to
  `published` with its version, and `pageVersions` and the next site
  `version` are written to both the site and the published settings.
- **Unpublish** removes every published page and the published site
  settings. **Discard** copies the published settings' fields back onto the
  site document without republishing.
- The published copy's existence is the publication state; a draft that
  differs from its copy is "published with unpublished changes"
  (`page.unpublished-changes` in the readiness report).

### KV datasets

| Key | Value | Indexes and metadata |
| --- | --- | --- |
| `sites:{orgId}:{siteId}` | The published settings without `cacheVerification`, with current published `pageVersions` and generated `revision`/`publishedAt` (`onSiteWritten`) | `idx:sites:docId:{orgId}:{slug(siteId)}:{siteId}`, `idx:sites:domains:{slug(domain)}` per domain |
| `site-resolution:v1:{normalizedHostname}` | Active resolution record or disabled tombstone (see below) | exact key, no index or expiration |
| `pages:{orgId}:{siteId}:{pageId}` | The published page document (`onPublishedPageWritten`) | none |

Every mirror writes `{ canonical }` metadata on its index keys and keeps an
`idx:manifest:` entry per canonical key (`functions/kv/kvMirror.js`).

### Exact hostname resolution and published revisions

`site-resolution:v1:<normalized-hostname>` is additive in the same KV namespace
as `sites:{orgId}:{siteId}`. Normalize the hostname to lowercase ASCII/IDNA,
remove the port and trailing dot, and exclude scheme/path/query. Do not slug it.

An active value is:

```json
{
  "schemaVersion": 1,
  "status": "active",
  "orgId": "org-id",
  "siteId": "site-id",
  "siteKey": "sites:org-id:site-id",
  "revision": "sha256:<opaque-digest>",
  "publishedAt": "2026-11-08T12:00:00.000Z"
}
```

The full KV site document has matching top-level `revision` and `publishedAt`.
These are mirror-generated public projection fields, not editable Site fields.
Revision equality is the cache contract; the hash format is opaque and does not
replace the existing numeric `version`. A deterministic revision covers the
public settings and current published-page contents. It changes for settings,
routing, theme-triggered site-version bumps, published-page changes, block
propagation and page unpublishing, including page edits whose numeric version
was not advanced. Draft documents are never read. The KV `pageVersions` map is
reconciled from currently published pages, removing obsolete deletion entries.
`publishedAt` comes from the latest included Firestore source commit, not worker
execution time; completed identical projections retain their timestamp.

`cms-onSiteWritten`, `cms-syncSiteResolutionFromPublishedPage` and
`cms-syncSiteResolutionFromDomainRegistry` merge work into one backend pending
record per organization/site, keyed by SHA-256 of the site KV key. It holds
`orgId`, `siteId`, a fresh `generation`, `readyAt` (Unix milliseconds), and
optional `touchedHosts` merged as a set so domain cleanup hints survive bursts.
`cms-drainSiteResolution` checks every minute for work that has been quiet for
three seconds and reconciles the latest saved state rather than an event
payload. It removes the pending record only if its generation is unchanged.
New work during a reconciliation survives for another pass. Busy or superseded
work stays pending without surfacing an event error. Unexpected failures are
logged and deferred. Site resolution can lag a publish by a scheduler interval
plus the quiet window and processing time; separate page KV mirroring is unchanged.

The existing KV retry worker and backfill still reconcile directly through
the same writer. One backend project-wide transactional lease serializes
canonical-site and shared hostname writes across organizations. KV requests
are bounded to 15 seconds without automatic HTTP retries. A rejected KV
mutation retains the four-minute lease (longer than the 180-second handlers)
because the write may still complete upstream. A source change or other
failure without an uncertain KV mutation releases the lease immediately.
Pending hostname/index cleanup intent is durable before KV writes; a successful
checkpoint clears pending intent. No client permissions or composite indexes
are added; the pending queue uses Firestore's single-field `readyAt` index.

Write the site document successfully before advertising its revision on hosts.
Registry ownership and the published domain list must both match. Expand the
existing apex/www pair for each alias; `canonicalDomain` and `forwardApex`
continue controlling redirects separately. Conflicting or malformed owners
fail closed. Old-owner events resolve the current owner, including cross-org
moves, rather than disabling another site's record. Removed domains and
unpublished/deleted sites get stable disabled tombstones:

```json
{
  "schemaVersion": 1,
  "status": "disabled",
  "orgId": null,
  "siteId": null,
  "siteKey": null,
  "revision": null,
  "publishedAt": null
}
```

A disabled record is authoritative. Only an absent new record uses the legacy
lookup fallback during rollout. Existing site/domain indexes, manifests and
collection-version markers remain supported. Keys are overwritten, not
version-suffixed, and tombstones do not expire.

KV has no multi-key atomic write or conditional compare-and-swap. Serialization
prevents older Hub workers/retries from overtaking newer Hub writes; it cannot
promise immediate global propagation or cancel an already accepted upstream
request after a timeout. The frontend must compare the fetched site document's
revision with the active record and never mark a mismatch current. This does
not make separately mirrored page/theme documents an atomic snapshot.

Rollout: deploy the scheduled drain with all three event producers and the
updated writer. Allow old deployed invocations to finish. Existing resolution
records need no migration or backfill for this queue change. For a first-time
resolution-key rollout, use the dry-run-first shared backfill from the Hub root:

```sh
node edge/scripts/backfill-site-resolution.cjs --project <project-id>
# Only with explicit production authorization:
node edge/scripts/backfill-site-resolution.cjs --project <project-id> --apply --production
```

The backfill paginates published settings and prior managed-site state by
standard document-name order, deduplicates sites and queues current-state work
through `topic-queue`/`kv-mirror-retry`. It does not publish drafts. Production
writes require both flags; emulator writes require `--apply` without
`--production`. Existing retry/dead-letter handling applies. No backfill is
performed merely by deploying this code.

### What the renderer reads

The Hub's Published Site Preview copy action builds the configured public
renderer URL with `?siteId=<orgId>-<siteId>`, using the active organization
and the site document id. Both ids are required; the query value is URL-encoded.
It is available only for published site settings, not template sites. This
client link format does not change stored documents or KV keys.

When a published domain has matching registry org/site ownership, successful
recorded DNS sync (`dnsSyncSucceeded`) and a connected, error-free www/apex
variant (`wwwAdded`/`apexAdded`), the header instead links to View Published
Site. Published page actions, labeled View Published Page, use that origin and
the saved published route. Selection uses published `domains`, `canonicalDomain`
and `forwardApex`, never draft domain edits. Missing/failed readiness keeps the
renderer fallback; an unready canonical domain cannot fall back to another
domain that redirects to it. This reuses `cms-getCloudflarePagesProject` and its
existing registry payload, not new fields or a live uptime check. Page/sidebar
components share the site's reactive origin rather than issuing extra lookups.

Hub draft preview links use that same selector plus `preview=true`. Page links
also carry `route=<menu-path>` (root `/` or nested slugs), derived independently
from the saved draft or published menus. Published page actions require a
published copy; draft actions do not require publication. Unroutable/orphaned
pages and templates have no external route. Unsaved editor state is not sent.
These are client URLs only: no new stored fields, public projections or reads
authorized by the URL. The authenticated frontend reads permitted saved draft
site/page/theme snapshots; collection/API delivery remains published.

This external-renderer behavior is separate from the Hub's own editor canvas:
an enabled custom-post page's Index canvas and small site-page preview read
its type's saved draft posts. Their preview cache signatures include draft
changes. The override changes no saved block, menu, source or published
projection; other page previews retain their normal collection loading.

`emd-cms-front` resolves the request's host through `idx:sites:domains` to
the site, reads `sites:` for `menus`, `theme`, `pageVersions`, the logos,
contact and social fields, SEO and tracking settings, then `pages:` for the
page the route's slug names in `menus`, `themes:` for the theme and
`posts:` for post routes. A post template page (`post: true`, with a block
that calls `#renderBlocks` over a `posts` collection) serves
`/{page-slug}/{post-name}` from its `postContent`
(`edge/lib/cmsPostRoutes.js`). `version` and `pageVersions` key the
renderer's caches: a theme change or a block release that touches a
published page raises them.

### SEO fields the renderer resolves

- **Title and description** resolve independently: the post view's
  `postMetaTitle` / `postMetaDescription` (only on a matched post route),
  then the page's `metaTitle` / `metaDescription`, then the site's, then
  empty. Whitespace is not empty.
- **Structured data:** a post route uses `postStructuredData`, otherwise the
  page's `structuredData`. Site and page objects combine as one `@graph`;
  missing `WebSite` and `WebPage` names and descriptions are filled from the
  site and the final title and description.
- **Tokens** in these strings are `{{ path }}` only: letters, digits,
  underscore, dot, `$` and hyphen. On a post route a path reads the
  hydrated record (`{{ meta_title }}`, `{{ item.meta_title }}`); a missing
  value becomes an empty string. Template v2 helpers such as
  `{{ money(price) }}` are not evaluated and stay literal. `{{cms-url}}` is
  the canonical URL of the route, `{{cms-site}}` the canonical origin
  (`canonicalDomain` and `domains`, else the request's host) and
  `{{cms-logo}}` the site logo on that origin.
- Record collections a Hub publishes may carry `meta_title` and
  `meta_description` that their post template pages reference this way. A
  template page's copied SEO values do not show what a site's own page has.

The renderer side of this resolution (hydration order, client and server
precedence, overrides with their own head) is in
`docs/engineering/cms-publication.md`.

## Contact form history and recipient routing

CMS forms submit through the public renderer's shared helper and `/api/history`
proxy to Hub `POST /api/history/{orgId}` (`cms-trackHistory`), with
`action: "Contact Form"`. `data` carries form fields plus the page, block and
site context. The Hub records the history/action and sends the form email; a
Hub may add its own consumers of the same submitted data (its "This Hub"
section names them).

- Envelope `userId` is only a claimed visitor identity. Identified requests must
  include `firebaseIdToken` at the envelope level. The Hub verifies it with this
  project's Firebase Auth, checks any claimed UID against the decoded UID, and
  requires an account email. Missing, invalid, revoked, or mismatched tokens
  return 401 before history, audience linkage, lead processing, or email writes.
  Fully anonymous requests omit both fields. Tokens are never persisted or
  included in form email. Legacy `data.userId` is not used for this linkage.
  Visitor identity is never a recipient override. In particular, signing in as
  an organization member must not direct a generic inquiry to that member.
- `data.recipientUserId` explicitly selects a registered recipient (for
  example on an agent-profile form). The helper accepts case-insensitive field
  names (the frontend normalizes names to lowercase), including the existing
  `fields`, `formFields` and `formData` form containers. Bare/legacy `userId`
  is not a recipient fallback. The selected ID must match a user in this
  organization and a root user with `meta.contactEmail` or `meta.email`.
- A valid explicit recipient overrides email delivery. Otherwise email uses the
  published block instance's `values.emailTo`, then the site's `contactEmail`
  (published first, draft fallback). Client-submitted email addresses do not
  select the destination.
- **Form tests** (`data.formTest: true`, used by the `edge-site-launch`
  skill): only for `Contact Form`, and only from an identified request
  (`firebaseIdToken`) whose user can write the organization's sites; 401 or
  403 otherwise, before anything is written. A test records no history,
  audience link or lead action, and sends the email to the tester's account
  email with the subject prefixed `[Form test]` and the recipients the
  submission would have reached. The response is `{ test: true, routedTo,
  sentTo, sendgrid: { ok, status, message } }`. The public renderer's form
  helper must forward the flag (an `emd-cms-front` change, handed off).

## Consumers

- **Hub:** `edge/components/cms/site.vue` (sites, settings, publish,
  unpublish, discard, seeding from a theme), `siteSettingsForm.vue`,
  `menu.vue` (menus, page creation and deletion), `page.vue` (the editor
  and page publish), `posts.vue` (post routes), the site readiness dialog.
- **Functions** (`functions/cms.js` and its `edge/functions/` copy):
  `onSiteWritten`, `onPublishedPageWritten`, `onPageUpdated`,
  `syncPublishedSyncedBlocks`, `onPageDeleted`, `onSiteDeleted`,
  `populateSiteContactFromPrimaryUserOnCreate`,
  `syncUserMetaFromPublishedSiteSettings`, `syncSiteSettingsFromUserMeta`,
  `syncPublishedRestrictedContentFromSite`, `ensurePublishedSiteDomains`,
  `siteAiBootstrapEnqueue` and `siteAiBootstrapWorker`, the registrar and
  domain callables, the release worker
  (`functions/helpers/cmsBlockPropagation.js`), the theme mirror's version
  follow-up, `cms-getPreviewRenderPayload`, the contact form email, and the
  operations and readiness (`functions/cmsOperations.js`).
- **Public renderer:** `emd-cms-front` reads the `sites:` and `pages:`
  datasets.
- **Agents and tooling:** the operations (`site.create`, `site.update`,
  `site.settings`, `site.menus`, `template.*`, `page.*`), `cms-siteReadiness`, the CMS MCP (`cms_find_usage`,
  `cms_preview_url`, `cms_site_readiness`, `cms_list_pages`,
  `cms_get_page`), the `edge-design-to-site` skill.

## Invariants and validation codes

- **Slugs:** a page's `name` is unique across both root menus; `page.create`
  and seeding make it unique (`ensureUniqueSlug`, `uniqueRootSlug`).
- **The templates site** is never published, and a release never updates
  its published copies. It needs no site document. Templates are created
  and changed with `template.create`, `template.update` and the page block
  operations (`siteId: "templates"`); `page.create`, `site.settings` and
  `site.menus` refuse it. Pages and sites copy a template when they are
  created, so a template change reaches new copies only.
- **Site settings and menus by operation:** `site.settings` writes the
  allow-listed branding, contact, social and tracking settings, never
  `domains` or `forwardApex`; `site.menus` replaces the menus with every
  draft page listed once. Both write the draft site only.
- **Versions:** every save and every page operation increments the page's
  `version`; publishing never changes a draft's version. A published page
  updated by a release takes the next version and writes `pageVersions` on
  both the site and the published settings.
- **Synced instances** (`edge/docs/data-contracts/cms-blocks/`, synced): when a
  page is saved, `onPageUpdated` copies each synced instance to the other
  draft pages holding the block if its `blockUpdatedAt` is newer; when a
  page is published, `syncPublishedSyncedBlocks` does the same for the other
  published pages and the draft pages.
- **Deleting a page** removes its published copy, removes it from the
  published settings' menus (keeping both root menus) and drops its
  `pageLastModified` entry. **Deleting a site** removes its draft pages and
  its published settings.
- **Domains** are unique across the organization's sites. When the published
  settings are written, `ensurePublishedSiteDomains` claims each domain in
  the top-level `domain-registry`, drops a domain another site owns and
  records why in `domainError`, and connects the rest to the Cloudflare
  Pages project; a sync failure is also recorded in `domainError` and
  cleared when the domains connect. Domains reach the renderer only through
  the published settings.
- **The primary user:** on creation, blank `contactEmail`, `contactPhone`
  and the six social fields are filled from `users[0]`'s profile; after
  publishing, those fields are copied to that user's profile, and a profile
  change is copied back to the user's sites.
- **Restricted content** on the site is copied to the published settings
  whenever it changes, without a publish.
- **Structured data** on a page or the site is empty or a JSON-LD object or
  list; the operations refuse anything else and warn about tokens the
  renderer will not replace (`edge/docs/data-contracts/cms-operations/`).
- **Page structure** is validated by `validatePageDocument`
  (`edge/lib/cmsBlockValidation.js`): the `page.*` codes cover ids,
  placement and post template scaffolds. The readiness report's `site.*`,
  `page.*` and `seo.*` codes are in the operations contract.
- **Site record lookups** from blocks use `path: "sites"` with
  `canonicalLookup: { key: "{orgId}:{siteId}" }`, never a literal site id
  (`sources.site-id`).

### Checks that enforce this contract

Each Hub lists the tests in its own checkout under "This Hub". Shared:

- `node --test edge/tools/mcp/cms/test/*.test.js`

## Related contracts

- `edge/docs/data-contracts/cms-blocks/README.md`: the instances pages hold,
  propagation and releases.
- `edge/docs/data-contracts/cms-operations/README.md`: the site and page
  operations, document shapes and the readiness codes.
- `edge/docs/data-contracts/cms-themes/README.md`: the theme a site renders with
  and the menus it seeds.
- `edge/docs/data-contracts/cms-posts/README.md`: the posts a post template page
  renders.

### Per-site sitemap configuration (Hub editor)

The optional `sitemap` object belongs to one `sites/{siteId}` document, not to
an organization or theme. Actual saved sites expose the Sitemaps tab in
Site Settings under the existing site-edit permissions. Post sitemap choices
are available without Dev Mode. Collection and API sitemap sections appear
only while `edgeGlobal.edgeState.devOverride === true`; hiding those controls
preserves their saved configuration. These are UI visibility controls, not a
new Firestore authorization boundary. Settings navigation wraps into as many
rows as its actual container width needs, keeping section labels readable.

Saving writes only the site's draft. The field participates in unpublished
settings detection and the settings comparison dialog. Publishing settings
copies it to `published-site-settings/{siteId}` and the existing full-document
site mirror carries it in `sites:{orgId}:{siteId}`; discard restores its
published value (or null for an older site). No new Function or index is needed.
Missing/null means unconfigured. An explicit empty configuration means no
additional collection/API maps; ordinary page maps remain renderer-owned.
Opening the UI does not initialize the field, inherit a theme/org configuration,
or migrate the existing renderer files.

```json
{
  "sitemap": {
    "collections": [
      {
        "collection": "posts",
        "fileName": "posts_sitemap.xml",
        "routePrefix": "blog",
        "pathField": "name",
        "scope": "site",
        "indexField": "type",
        "indexValue": "post"
      }
    ],
    "apis": [
      {
        "fileName": "products_sitemap.xml",
        "sourceUrl": "https://api.example.com/sitemap?category=products&page=1"
      }
    ]
  }
}
```

Collection fields retain the renderer definition semantics: `routePrefix` is a
relative public route; omitted/empty `pathField` uses the record name as a slug.
A stored relative path is joined beneath the prefix; a leading slash is rooted
at the site. `scope` selects **data** indexes (`org`, the default, or `site` for
published posts); configuration ownership always remains per site. There is no
`siteIds` array. `indexField` defaults to `name`; omitted `indexValue` queries
all indexed values, otherwise it is a string, boolean, or finite number. The
editor preserves types, including false and zero.

Collection and API filenames share a unique, case-insensitive namespace and
must be plain XML filenames. `sitemap.xml` and `pages_sitemap.xml` are reserved.
Collections, paths, indexes, scope and filter values are validated before draft
saves and settings publication.

`apis` is a list of independent external sources, each with required `fileName`
and `sourceUrl`. Each URL must use HTTPS without embedded credentials or a
fragment. Query strings, including repeated parameters and encoded values, are
preserved as entered (apart from surrounding whitespace). The UI has no fixed
States field, state-code validation, parameter builder, or property-specific
API toggle. Remove an entry to remove that source from the configuration.
Both lists default to empty; an entry is never silently dropped for being
incomplete. This supersedes the unshipped `property` prototype; no production
migration or compatibility reader for that prototype is introduced.

Each entry names a source, not an individual pagination page. For example,
Clearwater can configure a URL with `?state=MT&page=1` and another with
`?state=ID&page=1`. The separate frontend integration owns the supported API
response contract, pagination discovery, generated filenames and URL mapping.
Saving an arbitrary API URL here does not make an unsupported response format
renderable. The Hub neither fetches the URLs nor checks API responses.

The renderer **does not yet consume this field**. A separate frontend task must
resolve the published site's configuration, retain the existing query/path and
cache-version semantics, and decide the transition away from bundled
`site_maps/` files. This Hub change does not fetch any source URL or render XML,
and has no remote/static XML map editor. No production backfill is performed.

### Post-type sitemap controls

Site Settings → Sitemaps has a Posts section with Enable Sitemap controls for
Default (`post`), Event (`event`) and this site's page-defined custom types.
The index/detail page has no sitemap toggle. Its optional
`postType: { enabled, icon, event }` defines a custom content type, its icon,
and optional event-entry behavior. `event: true` enables the standard event
details envelope while retaining the custom type identity.

Saved preferences live under `site.sitemap.posts`, a boolean map:

```json
{
  "post": true,
  "event": false,
  "page:custom-page-id": true
}
```

Without an explicit choice, existing compatible site-level post sitemaps show
their corresponding Default/Event/custom checkbox as checked. Recognition
requires the posts collection, site scope, a type index filter and an empty or
`name` path field. Explicit boolean choices always win, including `false`.
Opening the editor never writes inferred preferences. Changing a post choice
preserves the other inferred selections; saving changes only draft Site Settings.
With no saved `posts` preferences, publication preserves the legacy configuration.
New types without an existing sitemap are not automatically enabled.
When Site Settings is published, reconciliation uses those saved preferences
and the site's published page snapshots. It resolves the first matching
published Default/Event index/detail page in menu order; a custom type uses
its defining page. Missing/disabled types or absent routes are simply omitted.
A subsequent settings publication removes their previous managed entries.
No guessed paths or missing-route warnings are generated.

Generated `sitemap.collections` entries use the existing posts dataset, `scope:
"site"`, `pathField: "name"`, a published `routePrefix`, and `indexField:
"type"` with the stored kind/custom-type value. Each includes `managedPostType`
(`post`, `event`, or `page:<pageId>`) so reconciliation can update/remove only
its own entries. These generated rows are completely hidden from the manual
Collections editor, as are recognized legacy post entries. Unrelated manual
collection/API entries remain unchanged (visible only in Dev Mode). A recognized
legacy entry is adopted when preferences are saved and settings published:
its filename stays intact, its route follows the published detail page, and no
duplicate entry is created. Explicitly disabling the type removes its recognized
legacy entry when Site Settings is published.
Generated XML filenames avoid manual/API/reserved filename collisions.

Reconciliation updates the saved baseline as well as the published snapshot,
so generated rows do not immediately appear as unpublished changes. It affects
only this site. It is not triggered by post or page publication and requires no
changes to the existing sitemap reader. Page/route/type changes reach sitemap
configuration on the next Site Settings publication.


## Firebase Auth membership domains

`cms-syncFirebaseAuthDomainsFromDomainRegistry` reconciles the project's Firebase
Auth authorized domains after a `domain-registry/{domain}` write. It reads all
current top-level registry records with `authEnabled: true` and expands their
hostnames with the same apex/www rules used for site domains. The Auth list is
project-wide, so this read intentionally covers every organization in the Hub.
The self-registration toggle does not determine domain authorization.

Event before/after values identify touched hosts and log context, never current
membership requirements. Deleting the redundant www registry entry must retain
both Auth hosts while the canonical entry still needs them. Stale create/delete
events also reconcile current registry state. Enabled-to-enabled writes are not
skipped: they restore a required hostname missing from Auth without toggling
membership off and on.

The reconciler adds every currently required host. It removes a touched or
previously managed host only when no current enabled registry entry needs it.
Other existing Auth entries, including provider/Hub domains and manually added
unrelated hosts, are preserved. It does not infer ownership of arbitrary old
Auth entries or backfill disabled domains that were never recorded as managed.

`cms-auth-domain-sync/{projectId}` stores:

- `leaseOwner`: unique invocation token, empty when released;
- `leaseExpiresAt`: numeric epoch milliseconds, zero when released;
- `managedDomains`: sorted host set required at the last successful sync;
- `syncedAt`: ISO timestamp of that successful reconciliation.

Firestore transactionally acquires the project-wide lease before the external
Auth config GET/PATCH, preventing competing handlers from replacing one another's
lists. The lease lasts four minutes, exceeding the trigger's three-minute
execution limit. Each API call has a 20-second timeout; ownership and sufficient
remaining lease time are checked before PATCH and before recording success.
Release clears only the caller's lease and preserves the prior ledger on errors.
A crashed lease expires on its next acquisition attempt, without a TTL policy.

The registry read is an unfiltered top-level collection scan, like the existing
CORS reconciliation: its size is configured project hostnames, not users/posts.
The lease uses point reads/writes. No composite index, client rules change,
public projection or frontend change is required. The lease lives outside the
registry so its bookkeeping cannot retrigger the domain handlers.

The trigger enables retries. Busy leases, permission/network failures, invalid
Auth responses and lost leases throw rather than acknowledge a skipped sync.
No PATCH is sent for an unchanged domain set, even if ordering differs. Auth
configuration and registry writes cannot form one cross-service transaction;
a subsequent/retried registry event converges on the latest required hosts.
Deploying the code alone does not run a global repair: a subsequent registry
write performs the reconciliation. Source changes do not alter production data.
