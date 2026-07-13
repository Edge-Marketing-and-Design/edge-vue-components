# TODO

## APP-003 — Restrict CMS block data sources to published KV capabilities

- State: Planned; implementation not authorized.
- Scope owned here: define and distribute the machine-readable KV mirror
  capability contract, use it in the block data-source builder, and make the CMS
  preview Function resolve only block `dataSources` collection records through
  public KV semantics while keeping all other preview context in Firestore.
- Authoring rules: `queryItems` fields require KV indexes; final
  `collection.query` and `collection.order` fields require metadata available at
  filtering/sorting time. New choices should be restricted to supported
  collections and fields; existing incompatible blocks require an explicit
  warning-versus-enforcement decision.
- Dependencies: `edgeTemplateEngine` owns query/hydration semantics;
  `clearwater-hub` is the initial integration environment; `emd-cms` and
  `iafsc-hub` validate later rollouts.
- Exclude: D1, moving complete previews to KV, Firestore fallback after KV
  failure, automatic subtree rollout, package publication, deployment, or
  production writes.

## Candidate — Shared accessibility contract fixtures

- Add only after repeated verified failures identify a stable shared boundary
  and clear fixture ownership with `edgeTemplateEngine`.
