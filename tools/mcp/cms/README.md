# Edge CMS MCP

This MCP server serves one Edge Hub (Clearwater Hub, emd-cms, iafsc-hub or
any other): read-only Firestore visibility, a guarded local workspace for CMS
library blocks, production theme context for block and page building, and
draft-only CMS operations through an agent key. It is shared Edge code
(`edge/tools/mcp/cms` in every Hub); each Hub keeps its own config.

Reads use the Firebase Admin SDK on a read-only service account. Writes never
use it: the only write tools, `cms_check_operation` and `cms_run_operation`,
call the Hub's `cms-agentOperation` endpoint with an agent key, and that
endpoint can only create drafts (see "Draft-only CMS operations"). Nothing
here can publish a page, release a block, or touch Cloudflare KV.
`cms_checkout_block` only writes local files beneath the configured
workspace.

## Generic Firestore Tools

- `firestore_list_collections`: list child collections at the root or below a document path.
- `firestore_get_document`: read one document by path.
- `firestore_sample_collection`: sample documents from one collection.
- `firestore_infer_schema`: infer a field/type summary from sampled collection documents.
- `firestore_compare_schema`: compare the current inferred schema to a saved schema JSON object.
- `firestore_find_field`: scan sampled collection documents for documents missing or containing a field.

Collection/document paths can use configured aliases such as `@listings` when `defaultOrgId` is configured.

## CMS Block Workspace Tools

- `cms_find_block`: find production library blocks by exact `docId` or bounded name/tag/type/theme search. Results are in document id order; pass `nextStartAfter` back as `startAfter` to page past `limit`.
- `cms_audit_blocks`: validate every production library block in an
  organization with the shared block validator and Hub import settings. It
  applies the required keys and organization themes, runs render checks with
  empty and sample Data Source records, and reports renderer ownership. It
  reads production once, writes the full per-block report to
  `.tmp/cms-block-audits/<orgId>/<timestamp>.json`, and returns a summary by
  rule plus the blocks with errors.
- `cms_checkout_block`: download one exact production block into a guarded local workspace.
- `cms_status`: compare the immutable checkout base, editable local block, and current production document.
- `cms_diff`: diff `base-local`, `base-production`, or `local-production`.
- `cms_resolve_override`: report the exact matching `emd-cms-front` Vue override, ambiguity, or CMS HTML fallback.
- `cms_find_usage`: find persisted page/template instances whose `blockId` references the library block.
- `cms_validate`: validate a local or production block with the Hub's shared
  block validator (`edge/lib/cmsBlockValidation.js`). It checks Template v2
  structure, schema, and grammar, including unbalanced loops and
  conditionals, and renders the block with empty and generated sample Data
  Source records. It also reports renderer ownership. The response keeps
  `errors`, `warnings` and `info` as strings, plus `templateVersion`,
  `renderingOwner`, `declaredSources` and `sourceCalls`. It adds `issues`, the
  structured findings (`{ code, severity, path, message }`). Render checks use
  `@edgedev/template-engine` from the Hub's root `node_modules`; when it cannot
  load, they are reported as `render.skipped`.

The default checkout location is:

```text
.tmp/cms-block-workspace/<orgId>/<docId>/
  block.json
  base.json
  checkout.json
```

- `block.json` is the editable working copy.
- `base.json` is the immutable production document captured at checkout.
- `checkout.json` records the Firestore path, update time, content hash, and resolved renderer component.

Running `cms_checkout_block` again is safe only while `block.json` still matches the recorded base. If local work exists, checkout stops without replacing any file.

### Recommended CMS Workflow

1. Use `cms_find_block`, preferably with the exact production `docId`.
2. Use `cms_checkout_block`.
3. Use `cms_resolve_override` to confirm whether the public owner is CMS HTML or an exact Vue component.
4. Edit only the returned `block.json` or the exact reported renderer component, according to ownership.
5. Use `cms_validate`.
6. Use `cms_status` and `cms_diff` immediately before any manual import.
7. If status is `production-changed` or `diverged`, reconcile the production change before importing.

Phase 1 intentionally does not upload or import a block. A later guarded write phase must use an authenticated compare-and-swap boundary rather than adding Firebase write credentials to this server.

## CMS Theme Context Tools

- `cms_find_theme`: find production themes by exact `docId`, exact visible
  `name`, or a bounded case-insensitive id/name search.
- `cms_get_theme`: read one exact production theme and return the five theme
  editor surfaces needed by block/page builders.

`cms_get_theme` requires the exact theme id so a duplicate or similar visible
name cannot silently select the wrong theme. Its response includes:

- `themeJSON`: the persisted `theme` value as the exact raw string plus a parsed
  object and validity result.
- `headJSON`: the persisted `headJSON` value as the exact raw string plus a
  parsed object and validity result.
- `customFonts`: bounded public font metadata from organization `files` whose
  `meta.themeId` matches and whose `meta.cmsFont` is true. It also reports whether
  each URL appears in Head JSON and any matching `@font-face` properties.
- `extraCSS`: the exact persisted `extraCSS` string.
- `defaultTemplates`: the persisted `defaultMenus`, `defaultPages`, and
  `defaultSiteSettings`, plus the referenced template page ids derived from the
  menu/page configuration.

### HTML/CSS Block Builder Workflow

1. Use `cms_find_theme` with the visible name if the theme id is unknown.
2. Confirm the returned `themeId`; use `cms_get_theme` with that exact id.
3. Give the returned Theme JSON, Head JSON, Custom Fonts, and Extra CSS to the
   block builder along with the HTML/CSS source package.
4. Build and validate the block/page import package against the returned theme
   tokens and custom classes.
5. Continue manually importing blocks/pages and pasting any proposed theme
   changes into the Hub UI. These MCP tools cannot save or publish them.

## Draft-only CMS operations (agent key)

- `cms_check_operation`: plan an operation (theme, draft page, block
  placement and content, new block, block draft) and get what would change,
  any problems, and a checksum. Writes nothing.
- `cms_run_operation`: run a checked operation with its checksum. The Hub
  refuses it if anything the check read changed since, or if it has
  problems. Results are drafts, recorded in the organization's
  `cmsOperations` audit with the key.
- `cms_block_base`: a block's current definition (open draft, else released)
  and its fingerprint, which `block.draft` must send as `baseHash`.
- `cms_preview_url`: a 15-minute link to the Hub's preview of one draft page
  (or its published copy), rendered with the Hub's block renderer and the
  site's theme. Open it in a browser and screenshot it to compare with the
  design. Vue override components don't render there. Needs
  `CMS_PREVIEW_TOKEN_SECRET` in the Hub's Functions environment.

Every operation type and field is in
`docs/data-contracts/cms-operations/README.md`. Results are the Hub's JSON
answer plus `httpStatus`; refusals are returned (`ok: false`, `code`,
`message`), not thrown.

The key comes from a developer: in the Hub, Dev Mode > Agent Keys. It acts as
that developer, in one organization, expires and can be revoked. Give it to
the MCP through `EDGE_CMS_AGENT_KEY`, or save it (one line, `chmod 600`) to
the file named by `agentKeyFile` in the Hub's MCP config (Clearwater:
`~/.config/clearwater/cms-agent-key`). The endpoint defaults to
`https://us-central1-<projectId>.cloudfunctions.net/cms-agentOperation`;
`agentEndpoint` in the config or `EDGE_CMS_AGENT_ENDPOINT` overrides it.

## Setup

Install dependencies once, in the Hub's main checkout:

```bash
npm --prefix edge/tools/mcp/cms install
```

### Hub config

Each Hub has its own config file, named by `EDGE_CMS_MCP_CONFIG` (relative
paths resolve from the Hub root). Clearwater's are
`tools/mcp/config/clearwater.production.json` (production reads) and
`tools/mcp/config/clearwater.emulator.json` (QA). A config with
`"requireEmulator": true` refuses to start unless `FIRESTORE_EMULATOR_HOST`
points at a local emulator. Fields: `serverName`, `projectId` (required),
`environment`, `defaultOrgId`, `allowedPathPrefixes`, `collectionAliases`,
`agentEndpoint`, `agentKeyFile`, `credentialsFile`, `cmsWorkspaceRoot`,
`cmsRendererRepoPath`, scan limits and redaction lists.

Every `EDGE_CMS_MCP_*` setting also accepts its older
`CLEARWATER_FIRESTORE_MCP_*` name, and `EDGE_CMS_WORKSPACE_ROOT`,
`EDGE_CMS_RENDERER_REPO`, `EDGE_CMS_AUDIT_ROOT` accept `CLEARWATER_CMS_*`.

### Credentials

Run the MCP on the read-only service account
`firebase-readonly-mcp@clearwater-hub.iam.gserviceaccount.com`. Its only
role is `roles/datastore.viewer` (Cloud Datastore Viewer, read-only
Firestore). The server looks for its key at:

```text
~/.config/clearwater/firebase-readonly-mcp.json
```

No environment setup is needed when the key is there. To use a different
location, set `EDGE_CMS_MCP_CREDENTIALS` (preferred),
`GOOGLE_APPLICATION_CREDENTIALS`, or `credentialsFile` in the MCP config.
Precedence is in that order, then the default path. A path set through
either variable that does not exist is a startup error; the server doesn't
fall back.

Without a key, the server falls back to Application Default Credentials,
which is your own `gcloud auth application-default login`. It writes a
warning to stderr. Those credentials are usually **not** read-only: safety
then rests only on this server having no write tools.

Every tool result includes
`credentials: { source, account, readOnlyServiceAccount }`, so you can
confirm which identity served a read.

To set up the key (an operator with IAM access):

```bash
gcloud iam service-accounts create firebase-readonly-mcp --project=clearwater-hub --display-name="Firebase read-only MCP"
gcloud projects add-iam-policy-binding clearwater-hub --member="serviceAccount:firebase-readonly-mcp@clearwater-hub.iam.gserviceaccount.com" --role="roles/datastore.viewer"
mkdir -p ~/.config/clearwater && gcloud iam service-accounts keys create ~/.config/clearwater/firebase-readonly-mcp.json --iam-account=firebase-readonly-mcp@clearwater-hub.iam.gserviceaccount.com && chmod 600 ~/.config/clearwater/firebase-readonly-mcp.json
```

Keep the key out of the repository, and rotate it by creating a new key and
deleting the old one in Google Cloud.

Environment variables:

```bash
export EDGE_CMS_MCP_CONFIG=tools/mcp/config/clearwater.production.json   # required
export EDGE_CMS_MCP_PROJECT=clearwater-hub                               # optional override
export EDGE_CMS_MCP_DEFAULT_ORG_ID=your-default-org-id                   # optional
export EDGE_CMS_AGENT_KEY=cmsak....                                      # optional; or agentKeyFile
export EDGE_CMS_WORKSPACE_ROOT=/absolute/path/to/local/cms-block-workspace
export EDGE_CMS_RENDERER_REPO=/absolute/path/to/emd-cms-front
```

The default renderer path is the sibling `emd-cms-front` checkout.

Start the MCP server from the Hub root:

```bash
EDGE_CMS_MCP_CONFIG=tools/mcp/config/clearwater.production.json node edge/tools/mcp/cms/src/server.js
```

### Git worktrees

The project `.mcp.json` always starts the server from the main checkout
(`git rev-parse --git-common-dir`), not from the session's own directory. A
git worktree, such as the ones Claude Code creates under
`.claude/worktrees/`, has no `node_modules` for the server (they are
gitignored), so starting it from the worktree fails with "Cannot find
package 'firebase-admin'" and the client reports the server as
disconnected. Starting from the main checkout also makes the default
workspace (`.tmp/cms-block-workspace`) and renderer path (`../emd-cms-front`)
resolve to the real locations. Install the dependencies once, in the main
checkout.

## Codex MCP Config

Point Codex or another MCP client at the Hub's main checkout, with the
Hub's config:

```bash
EDGE_CMS_MCP_CONFIG=tools/mcp/config/clearwater.production.json node /absolute/path/to/clearwater-hub/edge/tools/mcp/cms/src/server.js
```

Credentials resolve as described under **Credentials**; no client environment is needed when the key is at the default path.

## Aliases

The default config includes:

- `@organization` -> `organizations/{orgId}`
- `@blocks` -> `organizations/{orgId}/blocks`
- `@themes` -> `organizations/{orgId}/themes`
- `@listings` -> `organizations/{orgId}/listings`
- `@organizationUsers` -> `organizations/{orgId}/users`
- `@socialTemplates` -> `organizations/{orgId}/socialTemplates`
- `@socialTemplateVersions` -> `organizations/{orgId}/socialTemplateVersions`

Examples:

```text
firestore_sample_collection collectionPath=@listings
firestore_find_field collectionPath=@listings fieldPath=photos mode=missing
cms_find_block docId=clearwater-agent-bio-contact
cms_checkout_block docId=clearwater-agent-bio-contact
cms_status docId=clearwater-agent-bio-contact
cms_diff docId=clearwater-agent-bio-contact comparison=base-local
cms_find_theme query=Clearwater Main
cms_get_theme themeId=ZfAQ5pwetm9j2iXYFnE8-copy
```

## Safety Notes

- Reads use the Firebase Admin SDK. Firestore security rules are not the safety boundary for reads; use a read-only service account.
- No tool calls `set`, `create`, `update`, `delete` or `storeDoc`. The only writes go through `cms-agentOperation` with an agent key, which authorizes as the key's creator and can only create drafts; the Hub records every run.
- An emulator config (`requireEmulator: true`) never talks to a real project.
- `cms_checkout_block` is the only tool that changes local state, and it refuses to overwrite a locally changed checkout.
- Keep service account JSON files out of git.
- Keep `allowedPathPrefixes` narrow when production data access is enabled.
- CMS block/page/site scans are bounded. Treat `scanTruncated`, `siteScanTruncated`, or `resultTruncated` as an incomplete result, not proof of absence.
- Theme and custom-font reads are bounded. Treat `scanTruncated` on either
  response as incomplete rather than proof that no other theme/font exists.
- Override resolution diagnoses the local renderer checkout. The actually deployed `emd-cms-front` build remains authoritative.
- Sensitive fields matching `redactedFieldNames` or `redactedFieldPatterns` are redacted from returned documents.

## Verification

```bash
npm --prefix edge/tools/mcp/cms test
npm --prefix edge/tools/mcp/cms run check
```
