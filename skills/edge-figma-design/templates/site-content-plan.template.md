# <Site name>: Site Content Plan

<!-- Template for the edge-figma-design skill. Replace every <…>; delete these comments.
     The finished example is examples/moe-site-content-plan.md (Montana Outdoor Expo, 2026-10). -->

This plan turns the final website copy into a page-by-page build plan, so an agent can draw every page and every new block in Figma. A designer then reviews and adjusts the Figma frames, and the `edge-design-to-site` skill turns them into Hub blocks and pages.

- **Copy source:** `<copy document file name>`, <n> pages. The copy in this plan is quoted from it. Do not reword it in Figma; if it reads awkwardly in a layout, leave it and add a note for the designer.
- **Hub org:** <organization name>, `<orgId>`, theme `<theme name>` (`<themeId>`, or "to be created")
- **Figma file:** `<fileKey>`, anchor frame `<name>` (`<node id>`, <width> × <height>) on page `<page>`
- **Anchor status:** <how the anchor was made and approved; whether it is live and whether its sections are already CMS blocks>
- **The copy document wins.** Where the copy and the anchor disagree, follow the copy. Decisions are recorded in §9.

## Contents

1. Workflow and rules for the Figma agent
2. Design language (from the anchor)
3. Existing block inventory and reuse decisions
4. Site map, navigation and global elements
5. Page-by-page plan
6. New block specifications
7. Imagery and asset list
8. Links and forms
9. Copy conflicts and open questions
10. Design map

---

## 1. Workflow and rules for the Figma agent

### Sequence
1. **Content plan** (this document). The developer answers §9 and approves §3 and §6.
2. **Agent drafts in Figma** with the `edge-figma-design` skill: tokens and text styles (§2), the component kit, each new block on `Site — New Blocks` (one frame per block, variants as siblings, phone frames where §6 says), each page on `Site — Pages`, then §10.
3. **Designer review** in Figma. The designer's frames are the source of truth.
4. **Build:** `edge-design-to-site` builds blocks and pages from the reviewed frames and records `meta.design` on every block.

### Hard rules
- **Never edit the anchor frame** `<node id>` or its children.
- **Real copy only**, word for word from §5. Missing content is a visible muted `[TBD: …]` text layer named `TBD — …`. Never invent prices, names, statistics, dates, prizes, contacts or URLs.
- **Images** are placeholders named `Image (<shot id>: <description>)` with the shot ids in §7. **Logos** are dashed placeholders named `Logo (<owner>)`.
- **Repeated items** (cards, rows, tiers, list items) are instances of one component; each becomes a CMS array.
- **Rhythm** (§2.4): neighbouring sections never share a background.

---

## 2. Design language

<!-- Every value measured from the anchor (get_design_context, get_screenshot, a read-only tree dump).
     Note anchor-vs-brand-guide differences in §9. -->

### 2.1 Color tokens
| Token | Hex | Use (where the anchor uses it) |
|---|---|---|
| `primary` | | Dark section backgrounds, dark buttons |
| `onPrimary` | | Text on primary |
| `secondary` | | Eyebrows on light, numbers, links |
| `tertiary` | | Eyebrows on dark, emphasis |
| `onTertiary` | | |
| `accent` | | Primary buttons, accent heading line, bullets |
| `canvas` | | Light background |
| `surface` | | Cards |
| `surfaceAlt` | | Tinted background (25%), placeholders, body on dark (80%) |
| `text` | | Body text on light |
| `textMuted` | | Notes, captions |
| `heading` | | Headings on light |
| `border` | | Card borders |
| `success` | | Status badges |

### 2.2 Type
| Role | Font, weight, case | Desktop / mobile size and line height |
|---|---|---|
| H1 hero | | |
| H1 interior | | |
| H2 section | | |
| H3 card or panel | | |
| Eyebrow | | |
| Display number | | |
| Quote / statement | | |
| Body, card body, small | | |
| Labels | | |
| Buttons | | |

### 2.3 Components and patterns
<!-- Container width and padding, section padding, section header pattern and alignment, buttons per kind
     (radius, padding, shadow), cards, panels, bullets, stat callouts, pills and chips, photo treatments,
     textures (with the node to clone), banners. -->

### 2.4 Section rhythm
<!-- The order of dark / light / tinted sections; what every page starts and ends with. -->

---

## 3. Existing block inventory

| Block | Figma node | What it is | Reuse in the full site |
|---|---|---|---|
| `<block id>` | `<node>` | | **REUSE** / **REUSE + FIELD** / not reused |

**Anchor-only content that does not carry over:** <list>

---

## 4. Site map, navigation and global elements

| Page | Slug | Copy section | Nav label |
|---|---|---|---|

- **Header nav:** <links, call-to-action>
- **Footer links / banner:** <…>
- **Global bands** (newsletter, logo strips) and the pages they appear on.

---

## 5. Page-by-page plan

<!-- One table per page. Copy is quoted exactly; designer labels not in the copy are marked "(label, C<n>)". -->

### 5.1 <Page> `/<slug>`

**Goal:** <one line>

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | nav REUSE | | |
| 2 | `<block id>` NEW | | **Eyebrow:** "…". **H1:** "…" |
| n | footer REUSE | | |

---

## 6. New block specifications

<!-- Tier 1: used on three or more pages; built and checked first. Tier 2: the rest.
     For each: purpose, layout, variants, fields (suggested), "Mobile frame needed" where it matters. -->

### Tier 1

**N1 `<block id>`**: <purpose>. *Mobile frame needed.*
- <layout>
- Variants: <…>
- Fields: <…>

### Tier 2

### Block-to-page matrix
| Block | <Page> | <Page> | … |
|---|---|---|---|

---

## 7. Imagery and asset list

### Photos
| Id | Page / block | Shot | Crop |
|---|---|---|---|

### Logos and graphics
### Files
### Icons (line style)

---

## 8. Links and forms

| Copy CTA | Pages | Target |
|---|---|---|

---

## 9. Copy conflicts and open questions

| # | Issue | Copy says | Anchor says | Plan default / **Decided** (date) |
|---|---|---|---|---|

---

## 10. Design map

The Figma agent fills this in as frames are created. The build copies node ids into each block's `meta.design`; both sync directions read it.

| Block / page | Figma page | Frame name | Node id | Mobile node id | Used on | Status | Last synced | Baseline |
|---|---|---|---|---|---|---|---|---|
| `<Tokens>` variables | — | — | | | — | | | |
| Kit (icons, placeholders, items) | Site — New Blocks | Kit / … | | | all | | | |
| `<block id>` | Site — New Blocks | `<block id>` | | | | | | |
| Page / <Page> | Site — Pages | Page / <Page> | | | — | | | |

Anchor nodes, unchanged: <list>.
