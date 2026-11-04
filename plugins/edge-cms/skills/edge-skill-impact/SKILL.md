---
name: edge-skill-impact
description: Keep the Edge CMS skills, their references, the data contracts and the agent guide in step with the code. Reads a change (the working tree, a branch or a commit range), finds the documents that describe the changed code through edge/skills/knowledge-map.json, tests the behavior where in doubt, and drafts the document edits in the same change. Also runs a full sweep of every map area on request. Use at the end of any developer task that changed shared CMS behavior (edge/lib, edge/components/cms, the CMS Functions, the CMS MCP, the template engine version), when asked "what docs does this change affect", "check the skills are current", "skill impact", or for the monthly sweep. Needs a Hub checkout; it edits documents only, never code behavior.
---

# Edge skill impact

Block work depends on knowing how the system behaves, and the documents that
say so drift when code changes: a reversed contract rule the engine never
followed, an input type the skills don't mention, an operation the guide
says agents can't do. This skill finds those documents for a change and
brings them back in line, in the same change.

It runs from a Hub checkout (emd-cms, clearwater-hub, iafsc-hub) and reads
the map at `edge/skills/knowledge-map.json`. Documents in `emd-cms-front`
are read from the sibling checkout; edits there are a separate task (a
handoff note), never part of this change.

## The map

`edge/skills/knowledge-map.json` lists areas. Each has:

- `code`: globs of the code that defines the behavior (a `diffPattern`
  narrows a file to changes whose lines match, for example the template
  engine's version in `package.json`);
- `documents`: each document (and section) that describes it, with `says`,
  what it claims about the area;
- `probe` (some areas): a script that shows the real behavior.

## Run it

1. **Read the change.**

   ```bash
   node edge/skills/edge-skill-impact/scripts/impact.mjs                 # this branch and the working tree vs origin/main
   node edge/skills/edge-skill-impact/scripts/impact.mjs --range A..B    # a commit range (edge-vue-components commits work too)
   ```

   It lists each touched area, its changed code, and each document with
   `changed` or `unchanged` and what it says. `NEEDS REVIEW` marks an area
   whose code changed while none of its documents in this checkout did.
   Add `--json` for the report as data.

2. **Decide per document section.** For every section of every touched
   area (not only the `NEEDS REVIEW` ones: a changed document can still be
   wrong), read the section and the code change, and decide:
   - **still true**: say so in your notes;
   - **needs an edit**: the section describes behavior the change altered;
   - **needs a new entry**: the change adds behavior the section should
     cover (a new input type, a new operation, a new readiness code).

3. **Test, don't trust.** When the behavior is in doubt, run it instead of
   reading either side; documents can be wrong, and so can a reading of the
   code:
   - an area with a `probe`: run it (`node <probe>`); for the template
     grammar it renders the condition cases with the Hub's and
     `emd-cms-front`'s engines;
   - templates: render with `@edgedev/template-engine`
     (`renderTemplateAsync`, edge-block-package
     `reference/scripting-against-a-hub.md`);
   - operations and readiness: `cms_check_operation` (writes nothing) or the
     unit tests;
   - the renderer: the Hub preview (`cms_preview_url`) or the public site.
   Record each test and its result.

4. **Draft the edits** in the same change, smallest correct wording, in the
   document's own voice. Contracts: update `Last verified`. Then:

   ```bash
   node edge/plugins/sync-skills.mjs && node --test edge/tests/pluginSkills.test.mjs
   node scripts/cms/sync-agent-contracts.mjs && node scripts/cms/sync-agent-contracts.mjs --check
   ```

   (`sync-agent-contracts.mjs` after a contract or the agent guide changed;
   the guide has a copy in `functions/agentGuide/` to keep identical.)

5. **Unmapped code.** The report lists changed system code no area covers.
   For each, decide whether it changes documented behavior; if it does, add
   a map entry (area, code, documents, `says`) in the same change.

6. **Hand back** a short table: area, document section, verdict (still
   true, edited, new entry, left for the developer), and the test behind
   each verdict. List what you could not settle, and every `emd-cms-front`
   section that needs an edit as a handoff note for that repository.

## When no document needs to change

The backstop test (`edge/tests/skillImpact.test.mjs`) fails while mapped
code changed and none of its documents did. When step 2 found every section
still true, record that decision in a commit message trailer:

```
Skill-Impact: none (refactor of the readiness loop; behavior unchanged, tests pass)
```

The reason says why, in plain words. Never add the trailer to skip the
review.

## Full sweep

On request, or monthly: every area's documents checked against current
behavior, not only the changed ones.

1. For each area, read each document section and test the claims that can
   be tested (the probes, a render, a check operation, the deployed engine
   version in `emd-cms-front`'s `package.json` against the Hub's).
2. Compare the renderer guide (`emd-cms-front/docs/cms-template-v2-blocks.md`)
   with the Hub's contracts where both describe the same behavior.
3. Report drift as a table (area, document, what it says, what the system
   does, the test), fix the Hub-side documents in one change, and list the
   rest.

## Do not

- Change code behavior to match a document; documents follow the code
  unless the developer decides the code is wrong.
- Edit `emd-cms-front`, IAFSC or another repository; write a handoff note.
- Add `Skill-Impact: none` without having reviewed every section.
- Commit, push or deploy unless the developer asks.
