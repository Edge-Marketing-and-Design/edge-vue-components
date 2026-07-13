# Edge Shared Code Agent Guide

Read `RELATED-REPOSITORIES.md` when shared work may affect a direct consumer or
dependency.

## Hub-First Source Workflow

This `edge/` subtree is the working source for `edge-vue-components`; a
standalone checkout is not required. Before shared work, confirm the selected
Hub's last pulled subtree commit is current upstream and review later local
Edge changes. Keep feature and coordination TODOs in the selected Hub's normal
TODO/plan location outside this subtree; the Hub TODO should name the shared
files to edit here. Implement and test shared changes in the Hub, and promote
only the committed subtree with the Hub's root `edge-push.sh` after explicit
commit and push authorization.

This folder is shared Edge code. Changes here can affect every project that pulls Edge updates, so keep edits generic and avoid project-specific behavior unless the user explicitly approves it.

## Organization Mode

Edge uses organization-scoped data and roles underneath. A project being "single-org" or "multi-org" is mostly determined by app-shell UX and auth/registration choices, not by `cmsMultiOrg`.

Single-org projects typically hide org switching and registration org-selection flows, then auto-select the user's org after login.

Multi-org projects typically expose org switching and allow registration/join flows that can create or request access to different orgs.

The preferred source of truth is the public runtime flag derived from:

```env
SINGLE_ORG=true
```

If `SINGLE_ORG` is missing or set to anything other than `true`, Edge treats it as multi-org mode.

Expose the flag from the project Nuxt config:

```js
runtimeConfig: {
  public: {
    singleOrg: process.env.SINGLE_ORG === 'true',
  },
}
```

Read it through:

```js
const { singleOrg, cmsMultiOrg } = useEdgeOrgMode()
```

### CMS Permission Compatibility Flag

`cmsMultiOrg` is not the source of truth for whether a project is single-org or multi-org. It is a CMS-specific compatibility flag used by some CMS components to decide whether to enforce newer feature/sub-permission checks or older admin/basic role behavior.

If a project needs the newer CMS feature/sub-permission checks, set this in the project shell, usually `pages/app.vue`:

```js
const { cmsMultiOrg } = useEdgeOrgMode()
useState('cmsMultiOrg', () => cmsMultiOrg.value)
```

`cmsMultiOrg` is derived from `SINGLE_ORG`: it is `false` when `SINGLE_ORG=true`, and `true` otherwise.

If a project must override the derived behavior, it can still set:

```js
useState('cmsMultiOrg', () => false)
```

`cmsMultiOrg` is shared Nuxt state by key. Edge components may also call `useState('cmsMultiOrg', fallback)`, but the first initialized value wins. Do not describe `cmsMultiOrg` as what makes a project single-org or multi-org.

### Sidebar/User-Menu Org Switching

```vue
<edge-side-bar :single-org="singleOrg" />
```

Single-org mode hides the org switcher UI in the sidebar/user menu. Multi-org mode shows org switching UI.

Sidebar/menu components should also hide `/app/account/my-organizations` when `singleOrg` is true.

### Registration Org Flow

```vue
<edge-auth type="register" />
```

`edge-auth` reads `singleOrg` from `useEdgeOrgMode()`. Single-org mode hides organization name/id and join-existing-org registration flows, and does not pass/use registration code. Multi-org mode allows organization-related registration fields and can use `config.public.registrationCode`.

Login does not directly use `singleOrganization`. After login, `edge-auth` loads organizations and selects the stored `organizationID` if valid, otherwise the current organization if set, otherwise the first available organization.

## Dev Mode

Dev-only menu/features require `edgeGlobal.edgeState.devOverride === true`.

The `Dev Mode` toggle should be visible on local dev and live servers only for root admins:

```js
const canUseDevModeToggle = computed(() =>
  currentUserIsRootAdmin.value,
)
```

Local dev should still show the environment warning regardless of this toggle. The toggle controls dev-only menu/features, not whether the app displays the local/emulator warning.

Root admin means a user role with:

```js
{ collectionPath: '-', role: 'admin' }
```

## App Shell Migration

`edge/scripts/migrate-app-cms-access.js` is the migration helper for project `pages/app.vue` files. It should conservatively add or refresh:

- `useEdgeCmsAccess`
- root-admin access handling
- root-admin `Dev Mode` toggle wiring
- the sidebar `Dev Mode` button when the shell has a compatible sidebar header

`edge/edge-update-all.sh` runs this migration when `pages/app.vue` exists.

## Functions Sync

When a Function addition or update is intended for `edge-vue-components`, make the corresponding change identically in both the Hub's deployable `functions/` path and `edge/functions/` during the same work cycle. Neither copy is generated from the other. Verify task-relevant pairs before testing, deployment, commit, or `edge-push`, and keep Hub-only Function files and exports outside the shared Edge export block.

Use a direct check when verifying:

```sh
diff -q functions/<shared-file>.js edge/functions/<shared-file>.js
```

## Firestore Index Sync

`edge/edge-update-all.sh` should merge `firestore.indexes.json` rather than blindly overwriting it. It must preserve local `fieldOverrides` and append/merge Edge `fieldOverrides` so a local non-empty `fieldOverrides` array is not replaced by Edge's empty array.

## Edge Update Script

`edge/edge-update-all.sh` is the preferred way to pull and apply Edge updates. It syncs Edge functions/config, merges index/config files, runs the app shell migration, and installs packages listed by Edge.

Do not run full builds unless the user explicitly permits it.
