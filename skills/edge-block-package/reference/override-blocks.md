# Override blocks and the emd-cms-front handoff

An override block is a normal Template v2 block whose **name** the public renderer resolves to a Vue component: the name is normalized to camelCase (`"Mule Walking vs Rucking Calculator"` → `muleWalkingVsRuckingCalculator`) and looked up in the component registry with Pascal, camel, and kebab variants. The block JSON carries an accessible static fallback (what Hub preview shows, and what the public site shows if the override is not deployed) and every input the Vue component reads from `block.values`.

Fidelity rule: the CMS block is the design source of truth. Its template, schema defaults and fallback HTML define what the override shows; the Vue component matches the block (the same `block.values` keys, the same content and layout at the same breakpoints, no field the schema lacks). A design change lands in the block first, as a draft revision the developer releases, and the override follows it. An override that shows something the block does not is a defect in the override, not a design decision.

Rules:

- `isOverrideBlock: true` on the block and in the manifest entry (a hint for humans and agents; omit on ordinary blocks). Manifest `rendererChanges: true` with a `rendererHandoff` note.
- The validator computes the same normalization and asserts the Vue file exists in the project's runtime source, and that the schema carries every value the component reads.
- Renaming a block silently turns it back into the static fallback; say so in the README.
- Site-scoped folder in emd-cms-front: `app/blocks/<project>-<organizationId>/` (precedent `app/blocks/clearwater-nSyJmnm6i2xLMPQ1PCX2/`). Theme-ID-prefixed files (`<themeId>_name.vue`) only when a second theme needs a different implementation.
- The deploy is a separate task in the emd-cms-front repository. Write a handoff note (files to copy, import path fixes, boundaries: no changes to `app/pages/[...page].vue`, template engine, tracking, KV, project configs, shared blocks; build and lint must pass; verify on the public renderer). Never edit emd-cms-front from the block session.
