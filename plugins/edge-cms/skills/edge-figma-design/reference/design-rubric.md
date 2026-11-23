# Design rubric

How to tell whether an AI-made design is good enough to hand to a designer, or to ship on a site that gets no designer pass. It is used three times:

- **Before the anchor** (stage 0): part A, so the first AI pass starts from the client's world instead of the category's default look.
- **Before the designer handoff** (stage 4): parts B to D on every page frame, reported in the handoff.
- **After the build** (in the Hub preview): part D again on the rendered pages, where contrast and text size can be measured.

This file holds **principles, not a house style.** A designer's revision of one client's site teaches what kind of change makes a design feel made for its client. It does not teach which colors, shapes or textures every site should use. Read "What is not a rule" before adding anything.

## How a rule gets in

Each rule in parts B and C carries its evidence:

- **Principle**: seen in the designer's revisions on two or more sites. Apply it by default.
- **Candidate**: seen on one site so far. Apply it unless the anchor or brand clearly says otherwise, and note in the handoff when you departed from it.

When a designer revises an AI draft, compare the two versions page by page and list every change. Sort each change: a general move (it would improve a different client's site) or a brand choice (it only makes sense for this client). General moves raise or add rules here. Brand choices stay with that site's plan and never come here. Update the evidence log at the bottom.

## A. The client's world (before the anchor)

The generic look comes from starting with the category ("event site", "law firm", "café") instead of the client. Before any AI design pass, write these into the content plan's §2 and put them in the anchor prompt:

1. **What only this client has.** Three to five concrete things a competitor could not claim: a signature attraction, a place, a program, a number, a person. The design should show these, not describe them in card body copy.
2. **The audience's world.** Five to seven objects, places, materials or rituals the audience knows by heart (for an outdoor show: trail markers, topo maps, hunting tags; for a dental office: something else entirely). One line each on how it looks.
3. **One signature motif.** Pick one detail from that list and say how it repeats: on photos, on cards, as a separator, as a marker on small labels. One motif used everywhere beats several used once. It must come from this client's world, never from a previous site.
4. **Imagery direction per section.** Decide where photos should *inspire* (the experience, the place, the feeling) and where they should *prove* (the real venue, the real people, the real product). Write it down; the shot list (§7) follows it.
5. **The category's default look, named.** One sentence on what a template for this category looks like, so the draft can be checked against it.

## B. Structure and composition

| # | Rule | Evidence |
| --- | --- | --- |
| B1 | **Cards are earned.** Use a card only when the items are separate things a visitor compares or clicks. Lists of benefits, features, facts or audiences become editorial layouts: numbered rows with a photo, a heading beside its text, a single row of stats with separators. | Candidate |
| B2 | **No decorative icon chips.** An icon in a tinted circle or rounded square above or beside a heading is the default template; drop it. Facts like date and place are set as type. Keep icons that carry meaning (a form's topic, a file type). | Candidate |
| B3 | **Composition follows content.** No more than two sections in a row with the same shape (centered heading over an equal grid). Prefer a heading on one side and its text or list on the other; centered layouts are for short, single-idea sections. | Candidate |
| B4 | **Drama is spent once.** The home page gets the large hero. Interior pages share one short, consistent title band, and their first section does the explaining. | Candidate |
| B5 | **Section rhythm.** Use at least three grounds (for example dark, light, tinted) plus at most one accent band, and never two neighbours with the same ground. | Candidate |
| B6 | **One signature motif, applied consistently** (from A3) on photos, cards and small labels. | Candidate |
| B7 | **Chrome appears once.** The end of each page is one closing call to action and one footer. Newsletter sign-up, contact details and the final action are not stacked as three separate bands. | Candidate |
| B8 | **Density.** Tighten section padding and card padding until a page shows the same content in noticeably less height; empty space should separate ideas, not pad them. | Candidate |
| B9 | **Missing content does not get a designed section.** Keep `[TBD]` layers findable (SKILL rule 2), but a section that exists only to hold content nobody has (an empty sponsor grid, a "coming soon" directory with filters) is left out of the page and listed in the handoff instead. | Candidate |
| B10 | **One component per job.** Audience routing, the main button label and the closing action look and read the same on every page. | Candidate |

## C. Does it do its job (marketing pages)

These came from a critique of the draft, not from the designer's revision, so they start as candidates even though they are common usability practice.

| # | Rule | Evidence |
| --- | --- | --- |
| C1 | The visitor's main action is on the page in working form: price, dates, hours and the button, not only a link to another page. | Candidate |
| C2 | One label per action across the site ("Get tickets" everywhere, not three wordings). | Candidate |
| C3 | Never ask the visitor the same thing twice (topic cards and a topic dropdown). | Candidate |
| C4 | Proof before claims: real numbers and real photos near the claim they support. Goals and plans are not shown as results. | Candidate |
| C5 | The current page is marked in the navigation; header and footer menus agree. | Candidate |

## D. Legibility floor (pass or fail)

These are checked, not debated, and they apply to designer-made designs too:

- Text contrast meets WCAG AA: 4.5:1 for body and small labels, 3:1 for large text (24px+, or 19px+ bold). Brand orange or teal on cream often fails; check it.
- Functional text (links, labels, buttons, nav, meta rows) is at least 11px; body copy at least 16px on desktop and phone.
- Body text lines stay under about 80 characters.
- Wide letter spacing (over 0.05em) only on short uppercase labels.

## What is not a rule

- **A previous site's brand.** Its palette, textures, corner shapes, eyebrow typeface, illustrations, tickers or countdowns were chosen for that client. Copying them makes every site look like the first one.
- **Lists of "AI tells" from design-lint tools.** Cream grounds, italic serif accents, scrolling bands and accent-topped cards are flagged by such tools, but a designer may choose them on purpose. Flag them in a draft only when nothing in the client's world or anchor asked for them. Never fail an approved anchor's choices.
- **Taste calls between options.** When the rubric does not decide, the anchor does; when the anchor does not, list the choice in the handoff for the designer.

## Scoring and reporting

For each page frame, mark each rule in B, C and D as pass, partial or fail with one line of evidence, and fix fails before the handoff unless fixing would contradict the anchor (then report it). Part A is reported once, as written in the plan. The handoff (SKILL section 4) includes the table. The rubric does not replace the designer pass; it is meant to shorten it and to set a floor for sites that get no designer.

A second opinion helps: a fresh agent that critiques the page screenshots without seeing this rubric's answers, or a design-review tool such as Impeccable's `critique`. Treat its output as findings to check against this file, not as rules. Automated detectors are useful for part D only.

## Evidence log

| Date | Source | What changed here |
| --- | --- | --- |
| 2026-11 | First designer revision of an AI full-site draft (eight pages, same copy), compared page by page. A blind AI critique of the same draft matched about four of the designer's eleven changes in full and five in part. | Rubric created; B1–B10 and C1–C5 added as candidates. |
