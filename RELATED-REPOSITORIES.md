# Related Repositories

Repository names are used instead of local paths so this document works on any
developer's machine.

- **clearwater-hub**, **emd-cms**, and **iafsc-hub** — Consume this repository
  as their `edge/` Git subtree. Shared work is developed and tested in one
  selected current Hub, promoted upstream with that Hub's `edge-push.sh`, and
  then reviewed and rolled out independently in other Hubs.
- **edgeTemplateEngine** — Direct dependency imported by shared CMS components
  for template rendering and hydration. Source changes affect consumers only
  after a package release and consumer version update.
- **edge-media-api** — Direct service dependency called by the shared
  `functions/edgeMedia.js` integration distributed to the Hubs.

For shared Firebase Functions, make intended additions or updates identically
in the selected Hub's deployable `functions/` directory and `edge/functions/`
before testing, deployment, commit, or `edge-push`.

## Cross-Repository Task Handoff

If shared Edge work reveals required work owned by another repository, Codex
may create or update a Markdown TODO, plan, scope, or handoff file in that
repository when its checkout is available. Before writing, read that
repository's instructions and relationship file, check its Git status, and
preserve unrelated work.

The related repository's TODO must describe only the work it owns and must say
that implementation requires a separate task opened in that repository. The
current Hub task must not modify the related repository's source code, tests,
dependencies, configuration, generated files, data, or deployment state. If
the repository is unavailable or its existing work conflicts, report the
proposed TODO instead of writing it.
