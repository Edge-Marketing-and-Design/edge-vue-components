# Shared Firebase deployment

The tooling lives in Edge; it deploys the consuming Hub's `functions/` and root
Firebase configuration. It never deploys `edge/functions/` directly. Paths are
resolved from `edge/deploy.sh`, so the caller's current directory does not
select a different project. There is no root launcher.

After pulling Edge, run `sh edge/edge-update-all.sh` for the normal project
setup and dependency installation. The shared package manifest includes `acorn`,
`eslint-scope`, and `yauzl`. Node, pnpm, Firebase CLI, authenticated gcloud, and
installed Hub/Functions dependencies must be available on PATH. The project
comes from the existing environment/`.firebaserc`; the region comes from
`FIREBASE_STORE_REGION`, then `functions/.env.prod`, then `us-west1`.

Portable verification:

```sh
node --test edge/tests/deploy/*.test.*
sh -n edge/deploy.sh
```

The preview updater leaves the shared entrypoint unchanged. It retains guard
insertion for legacy Hubs that still have only a root deployment script.
When adopting this entrypoint, update external CI/tasks to `sh edge/deploy.sh`
and retire any old root launcher manually.

## Incremental Functions deployment

Keep using `sh edge/deploy.sh`. The shared `edge/scripts/deploy-functions.cjs` runner
selects affected Functions and runs sequential Firebase CLI batches of up to
10 names, including all regions of each selected name. Hosting, Firestore and
Storage stages still run normally.

Firebase requires explicit confirmation when an event-triggered Function newly
enables retries. For those batches, the runner accepts the retry policy declared
in the discovered source by adding `--force` alongside `--non-interactive`.
Ordinary batches, and Functions already deployed with retries, do not add it.
Before adding it, the runner checks Firebase's matching name selectors against
both local and remote inventories: no unselected child names or locally removed
endpoints may match, and existing Functions cannot change generation or event
trigger type in that forced batch. Such migrations require a separate explicit
deployment. These checks retain deletion/migration protection that Firebase's
`--force` would otherwise bypass. Fingerprints/checkpoint formats do not change;
failed batches remain pending and only healthy successful batches checkpoint. Frontend-only changes skip Functions and
their IAM stage once a baseline exists.

```sh
sh edge/deploy.sh                     # Normal deployment, affected Functions only
sh edge/deploy.sh --plan-functions    # Read-only selection, no build or deployment
sh edge/deploy.sh --all-functions     # Force all Functions, then normal other stages
```

Before normal deployment work, `edge/deploy.sh` reads the shared deployment lock.
If present, it exits with the owning machine and start time, before Git fetches,
dependency installs, builds or preview configuration checks. This is a lock
check, not a claim that the remote process is still alive. It never clears a
lock. Missing locks permit normal checks; permission/API failures stop the run.
`--plan-functions` skips this early gate and remains available during a deploy.
The later generation-conditional acquisition still prevents concurrent runners
if another deployment starts after the early check. A conflict there uses the
same concise ownership message.

The plan loads production Function modules for SDK discovery, as Firebase CLI
does, but does not invoke handlers. It reads cloud metadata and shared state;
it does not create a bucket, acquire a lock, change IAM or write state. Installed
root/Functions dependencies and authenticated Firebase/gcloud CLIs are required.

Selection uses content fingerprints, not the last local Git commit. Each SDK
handler export is traced through its referenced declarations and local helper
exports, including destructured imports, namespace members and reexports.
For example, editing `verifyHistoryIdentity` selects `cms-trackHistory`, rather
than every function exported by `cms.js`. A shared helper selects all of its
consumers. Lexical scope distinguishes callback parameters from imported names.
Module initialization and its execution order are included because requiring a
module executes top-level work, even when an imported binding is unused.
Pure helper imports do not add a global startup dependency. Startup `import()`
promises follow module initialization separately from their exported values;
pure exports are included only for handlers that consume that promise. The
existing local `kvMirror` handler factories, `kvAllowList` serializer factory,
and `cmsAgentMcp.createRemoteCms` factory construct local values and are traced through their consumers. This exception
matches the resolved local export, not a function name in an unrelated module.
Changing those factories to perform unrelated global work would require updating
this initialization contract. Known Firebase v2 trigger registrations stored in
local constants also construct deferred handlers; their callback bodies belong
to the registered endpoint, not to every endpoint importing the entry module.
The tracer verifies the resolved official SDK import, or the configured SDK
wrapper in functions/config.js, rather than trusting a same-named function.
Options must be statically pure for this exception. Eager option calls,
non-SDK config replacements and unknown factory calls remain conservative.
The callbacks and their complete dependencies are still traced for the actual
endpoint consuming that registered handler. Expression-only local factories with statically pure bodies, static metadata
spreads, literal-array `join`, `path.join`/`resolve`, and `Promise.all` of literal
imports are local value construction. Imported modules still contribute any
actual startup side effects. Unknown startup calls remain conservative.

For example, adding this dependency changes `one`, not an unrelated `two`:

```js
const { value } = require('./pure-helper')
exports.one = onCall(() => value())
exports.two = onCall(() => 2)
```
Package inputs are scoped to handlers that import/use them, including package
subpaths, static `import()` and ESM side-effect imports. Each consumed package
includes its declared spec and the resolved npm lock dependency/optional/peer
closure, including nested versus hoisted resolution. Unused dependency and
dev-tool changes do not select unrelated handlers. Missing required peers,
missing/unrecognized locks and unsupported resolution retain whole-manifest/
lock comparison for the affected consumer. Linked/local package sources fail
closed because their content cannot be proven from an immutable npm lock entry.
Node runtime, module/build settings, lock format, SDK endpoint options and
shared deployment configuration remain shared inputs.

Production `.env` values remain shared because SDKs can read variables without
an explicit application `process.env.NAME` reference. They are parsed, so comments,
ordering and equivalent quoting do not trigger deployment. Value changes still
select all handlers conservatively. A consuming Hub may explicitly list retired
keys in its root `package.json` under `edgeDeploy.retiredEnvironmentKeys` (an
array of environment variable names). No keys are exempt by default. A listed
key is excluded only when none of the statically discovered production source
identifiers/string literals reference it. A reference disables the exemption.
This changes comparison only, never actual configuration/runtime values.
The same Hub policy is used when comparing immutable historical archives.
Exact v1–v7 comparison remains unchanged, preserving checkpoint source proof.
Runtime overrides referenced by application source remain included. Diagnostics show key names, never environment values.
For example, a template-engine upgrade now reports only its consumers:

```text
cms-runOperation: handler dependencies changed
  package @edgedev/template-engine: 26.10.2 -> 26.10.4
```

Cached local imports do not contribute a second initialization. Built-in module
imports add no global startup work. The reviewed `cmsAgentMedia.createAgentMedia`
factory constructs deferred operations; its implementation follows its actual
consumers. Immediate side-effect statements or unknown calls added to that
factory disable this exception. Genuine shared initialization, including
Firebase setup and unknown startup calls, still affects all consumers.
 Runtime assets
identified by literal local imports or `path.join(__dirname, ...)` /
`path.resolve(__dirname, ...)` follow their consuming handlers. Directory paths
include additions and removals. JSON imports are data dependencies rather than
global startup effects. For example:

```js
const path = require('node:path')
const contractsDir = path.join(__dirname, 'agent-contracts')
// Changes to index.json or a contract select handlers using contractsDir,
// rather than every Function in the deployment.
exports.contract = onCall(() => readContract(contractsDir))
```

Unclassified non-code assets remain global conservatively. Unreferenced source
backups (`*.js.backup`, `*.cjs.bak`, etc.) are excluded; explicitly consumed
backups are fingerprinted through their reader. Runtime Markdown follows known
paths, while unrelated documentation is excluded.
Comments outside traced definitions and unused pure declarations do not select
Functions. This is conservative static tracing, not runtime execution analysis:
unsupported module/export structures use the full local dependency closure.
Emulator/debug logs (`firestore-debug.log`, `pubsub-debug.log`, etc.),
`.env.dev`, `.env.local` and `.DS_Store` are excluded. Fingerprints normalize
ordinary permissions to `644` and executable permissions to `755`; differences
such as `600` versus `644` or `664` across developer checkouts do not select
Functions. Executable-bit changes remain meaningful. Selection output includes
the reason for each pending regional endpoint, plus aggregate reason counts.
Dynamic/unresolved dependency analysis forces all Functions. New/missing,
non-ACTIVE or externally updated remote Functions are selected too. Bump the
planner `VERSION` deliberately when its fingerprint semantics change; reconcile
the versioned state explicitly rather than silently accepting an old schema.

### Shared deployment state contract

The default bucket is `<project-id>-hub-deploy-state`; `DEPLOY_STATE_BUCKET`
can override the name. It must belong to the target project, enforce public
access prevention and use uniform bucket access. The first actual deployment
creates it if missing. No new public IAM grants are made for this bucket.
Deployers need project metadata read, bucket metadata read/create (create only
for initial setup), object read/create/update/delete, Function metadata read,
Cloud Run metadata/IAM read, and the existing Firebase deployment/invoker-update
permissions. Permission/API failures stop deployment rather than pretending
there are no changes. Everyone deploying this project must use the same bucket.
The one-time legacy transition additionally requires read access to the Gen 2
deployed source objects identified by `buildConfig.sourceProvenance`.

`functions/state-v1.json` contains `version`, `projectId`, and `functions`, a map
keyed by `<region>/<function-name>`. Each entry stores `fingerprint`,
`fingerprintVersion`, `remoteUpdateTime` and `deployedAt`. The object name stays
unchanged; its current schema/fingerprint version is 8. Exact version-1 through
version-7 fingerprint comparators remain available for migration. Version-6 and newer
entries additionally store `inputSummary`: file/definition hashes, consumed
package versions and lock-closure hashes, and environment-key hashes. This lets
the next plan name specific source, package, configuration and environment-key
changes without exposing source contents or secret values.

For an ACTIVE legacy endpoint whose remote update time matches its checkpoint,
the planner reads its immutable deployed source ZIP generation. It verifies
object identity, size and checksum, validates bounded ZIP paths/modes/content,
and materializes files only in a private temporary directory, removed afterward.
Historical source is analyzed statically and never required/executed. Matching
archive checksums share a download/analysis within the run. Metadata reads have
bounded concurrency. Repo-level configuration inputs absent from the archive
must also match the exact recorded old fingerprint before the proof is accepted.
This does not depend on Git history, local deploy history or the other
developer's checkout.

Only an exact original-format match can produce a new handler fingerprint for
that deployed source. The planner compares that old handler fingerprint to the
current handler fingerprint. Thus editing source before the first upgrade no
longer forces unchanged namespace siblings to deploy. Changed handlers remain
pending. Preview reports this comparison without changing cloud state.

A normal deployment migrates proven baselines under its existing lock and
generation precondition, rechecking server versions before writing. Unchanged
endpoints upgrade without deploying. A changed endpoint retains the **old**
handler fingerprint until its deployment passes health/IAM checks; failed or
interrupted deployments never mark pending code current. Original deployed
timestamps are preserved during conversion. Reconciliation evidence records
the immutable source bucket/object/generation and archive SHA-256, not source.
Unverified legacy source is explicitly reported. A missing, non-ACTIVE or
externally updated legacy endpoint is already selected for actual deployment;
it is never upgraded/skipped without proof, but does not need a baseline
conversion to deploy. Its checkpoint changes only after successful deployment.
For unchanged remote identities, ordinary deployment stops
before promoting checkpoints or starting batches if required proof is missing;
resolve read access/configuration or deliberately use `--all-functions`.
Explicit full deployments do not need source recovery. After migration, normal
handler comparisons require no historical source downloads. All deployers must
pull the updated scripts before using version-8 state; older runners fail closed.
An operator-requested `redeployRequested: true` selects just that checkpoint's
Function even when its fingerprint matches. Successful deployment replaces the
checkpoint and clears this one-time request; failed deployments retain it.
Older operator-initialized checkpoints may additionally retain `reconciledAt`
and `reconciliation` evidence from their original reconciliation.
No source, plaintext env values, tokens or
credentials are stored. A batch is checkpointed only after CLI success, ACTIVE
Function state, latest Gen 2 Cloud Run revision readiness, and callable invoker
verification. State updates use GCS generation preconditions.

The first deployment has no trusted baseline, so it deploys every Function.
After a failure, rerun the same command: successful batches stay checkpointed,
and the failed batch remains pending, even if some of its Functions succeeded.
Edits during deployment abort the current batch checkpoint. Removed tracked
Functions stop the runner for deliberate deletion/migration and state
reconciliation; this script never automatically deletes Functions. Direct CLI
deployments do not update this state and will be detected through remote
`updateTime` drift on the next normal deployment.

`functions/deploy-lock.json` stores a unique hostname/process/nonce owner and
start time. A generation-conditional lock serializes cooperating deployers;
there is no automatic stale-lock takeover. After a killed process, inspect that
exact object and confirm no local or remote deployment remains active before
an operator removes it with a matching generation precondition. Do not delete
the bucket or baseline to clear a lock. Direct Firebase CLI deployments bypass
this coordination, so do not run them concurrently with the script.

