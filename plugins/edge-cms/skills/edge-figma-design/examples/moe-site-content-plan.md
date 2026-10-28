# Montana Outdoor Expo 2027: Site Content Plan

This plan turns the final website copy into a page-by-page build plan, so an agent can draw every page and every new block in Figma. A designer then reviews and adjusts the Figma frames, and the `edge-design-to-site` skill turns them into Hub blocks and pages.

- **Copy source:** `Montana Outdoor Expo 2027 Website Copy_FINAL.docx`, eight pages. The copy in this plan is quoted from that document. Do not reword it in Figma. If it reads awkwardly in a layout, leave it and add a note for the designer.
- **Hub org:** Montana Outdoor Expo, `aYSLvgDLaAaVnHKxfSZP`, theme `moe2-theme` (`apIOmt8aZrYFbZpsls5F`)
- **Figma file:** `COusYQPkdCMaYXohzlhA9s`, page `Page 1`, frame `Landing page design` (`5:792`, 1171 × 8888)
- **Status:** The live landing page is temporary but **stays up, unchanged, until the full site launches**. The full site gets a **new Home page**, built alongside the landing page and designed to look nearly identical to it wherever the content allows. Nothing in this plan edits, replaces or unpublishes the landing page, its Figma frame `5:792`, or how its blocks render. The nine `moe2-*` blocks stay in use, and some get new fields (see §3); every new field must leave the landing page rendering exactly as it does today.
- **The copy document wins.** Where the copy and the landing page disagree, follow the copy. Decisions from 2026-10-08 are recorded in §9.

## Contents

1. [Workflow and rules for the Figma agent](#1-workflow-and-rules-for-the-figma-agent)
2. [Design language (from the landing page and theme)](#2-design-language)
3. [Existing block inventory and reuse decisions](#3-existing-block-inventory)
4. [Site map, navigation and global elements](#4-site-map-navigation-and-global-elements)
5. [Page-by-page plan](#5-page-by-page-plan)
6. [New block specifications](#6-new-block-specifications)
7. [Imagery and asset list](#7-imagery-and-asset-list)
8. [Links and forms](#8-links-and-forms)
9. [Copy conflicts and open questions](#9-copy-conflicts-and-open-questions)
10. [Design map (fill in as frames are created)](#10-design-map)

---

## 1. Workflow and rules for the Figma agent

### Sequence
1. **Content plan** (this document). Dustin approves the reuse and new-block decisions in §3 and §6.
2. **Agent drafts in Figma** (Figma MCP `use_figma`; load the `figma-use` and `figma-generate-design` skills first):
   1. Create a Figma variable collection **`MOE2 Tokens`** from §2 (colors, radii) and text styles for the type scale. The file currently has **no variables**, and the landing frame uses raw values.
   2. Build each **new block** on a Figma page named **`Site — New Blocks`**, as one top-level frame per block, named exactly with the block id (for example `moe2-page-hero`). Put variants beside it as sibling frames (`moe2-feature-grid / compact`). Desktop width is **1171** to match the landing frame. Add a **390-wide mobile frame** for the blocks marked *mobile frame needed* in §6.
   3. Build each **page** on a Figma page named **`Site — Pages`**, as one vertical frame per page, named `Page / Home`, `Page / About`, and so on, 1171 wide, stacking the blocks in the order §5 gives.
      - **Reused blocks:** duplicate the matching section frame from the landing frame (node ids in §3) and change only text and image placeholders. Do not restyle. Name it `moe2-stats (reuse)`.
      - **New blocks:** use instances or copies of the frames from `Site — New Blocks`, not one-off drawings.
   4. Record every new frame's node id in §10.
3. **Designer review** in Figma. She adjusts spacing, imagery and details. Her frames are the source of truth.
4. **Build:** `edge-design-to-site` builds blocks and pages from the reviewed frames and records `meta.design` (file plus node) on every block from day one.

### Hard rules
- **Never edit the landing frame `5:792`** or its children. Live blocks are mapped to those nodes.
- **Real copy only.** Use the copy in §5 word for word. Write missing content (policies, highlights, exhibitor list) as a visible placeholder: muted text `[TBD: weather/cancellation policy]` on a layer whose name starts with `TBD —`. Never invent prices, names, statistics, dates, prizes or contacts.
- **Images:** no photography is supplied. Draw every image as a placeholder in the landing page's "Photo coming" style: a `surfaceAlt` fill, or `white/5` on dark backgrounds, a 32px line image icon, and an uppercase 12px label. Name the layer `Image (<shot id>: <description>)` using the shot ids in §7, for example `Image (H-01: Expo floor wide shot)`. This matches the landing convention, e.g. `Image (Montana Outdoor Expo floor)`.
- **Logos:** draw a dashed-border placeholder box like the Sponsors section's "Sponsor logo" box. Name it `Logo (<owner>)`.
- **Icons:** use simple 1.5–2px line icons in the style of the contact-card phone and mail icons (Lucide style), coloured with tokens.
- Every repeatable item (cards, list rows, prizes, tiers) must look like one repeated component, because each becomes an array field in the CMS.
- Keep the vertical rhythm in §2.4: neighbouring sections must not share a background.

---

## 2. Design language

These rules come from the landing frame and the `moe2-theme` theme. New blocks must look like they came from the same hand.

### 2.1 Color tokens (theme names, use as Figma variables)
| Token | Hex | Use |
|---|---|---|
| `primary` | `#083D38` | Dark pine section backgrounds, dark buttons, headings on light |
| `onPrimary` | `#FFFFFF` | Text on primary |
| `secondary` | `#43A1A3` | Teal: eyebrows on light, stat numbers, FAQ icons, links, Plata card |
| `tertiary` | `#E3A326` | Gold: eyebrows on dark, emphasis in dark copy, goal bar, Oro card |
| `onTertiary` | `#083D38` | |
| `accent` | `#EC782B` | Orange: primary buttons, heading accent line, bullets on dark, footer banner |
| `canvas` | `#F8F6EF` | Light section background (with dot grid) |
| `surface` | `#FFFFFF` | Cards |
| `surfaceAlt` | `#E3DBC7` | Sand: alt section tint (used at 25%), placeholders, body text on dark (80%) |
| `text` | `#63513D` | Body text on light |
| `textMuted` | `#7A6A57` | Notes, captions |
| `heading` | `#083D38` | Headings on light |
| `border` | `#E3DBC7` | Card borders |
| `success` | `#A3A82B` | Status badge ("Filled") |

### 2.2 Type
| Role | Font | Spec (desktop / mobile) |
|---|---|---|
| H1 hero | Sofia Sans Extra Condensed 800, uppercase | 117/117 (landing hero) / 64/61. Interior heroes use **88/88 desktop** |
| H2 section | Sofia Sans Extra Condensed 800, uppercase | 70/70 / 48/48 |
| H3 card or panel title | Sofia Sans Extra Condensed 800, uppercase | 47/47 / 36/36; small titles 28/42 bold, tracking 0.05em |
| Eyebrow | Fraunces italic, "wonky" alternates, 400 | 18/28; teal on light, gold on dark |
| Display serif (tier names, big numbers, quotes) | Fraunces 900 / 600 italic | numbers 47; quotes 35/44 italic |
| Body | Sofia Sans 400 | 18/29; card body 16/26; small 14/20 |
| Labels | Sofia Sans 700, uppercase, tracking 0.05–0.1em | 12–14 |
| Buttons | Sofia Sans Extra Condensed 700, uppercase, tracking 0.08em | 18–20 |

### 2.3 Components and patterns
- **Container:** max 1280, 24px side padding. Section padding is 80px top and bottom (96 on large showcase sections).
- **Section header:** eyebrow, H2, optional intro paragraph (max ~640px). Centered for showcase sections (Sponsors, Gallery, FAQ, Contact). Left-aligned for split sections (Stats, Affiliate).
- **Buttons:** radius 12. *Primary* is orange fill with white text and a shadow. *Secondary on dark* is a 2px sand/40 outline. *Light alternative* is a teal fill (FAQ "Email us"). *On coloured cards* the button is a pine fill.
- **Cards:** white, 1px `border`, radius 16, small shadow, 24–32 padding. **Panels:** radius 24, coloured fills (`primary`, `tertiary`, `secondary`).
- **Bullets:** 10–12px solid dots, orange on dark or sand backgrounds, pine on gold or teal cards. No checkmarks.
- **Stat callouts:** a Fraunces 900 number in teal or orange over an uppercase 12–14px label.
- **Pills and chips:** fully rounded, `white/10` with a `white/20` border on dark (hero event chip). Status badge in `success`.
- **Photo treatments:** rounded 16. A slightly rotated two-photo collage (Stats). A masonry grid of 1×1 and 2×2 tiles (Gallery). Faded background photos at 10–20% behind dark panels (Affiliate, title sponsor).
- **Textures:** `texture-topo` (topographic lines at 7%) on pine sections. `texture-dots` (24px dot grid) on canvas sections. A giant watermark word (e.g. "MONTANA" at 5%) behind a canvas section.
- **Footer banner:** orange band with a pine treeline silhouette rising into the footer.

### 2.4 Section rhythm
Rotate backgrounds so neighbours never match: **pine (topo)** → **canvas (dots)** → **sand tint (`surfaceAlt` 25%)** → **pine** … Every page starts with the pine hero under the pine nav and ends with the orange banner and pine footer. The section before the footer should therefore be light.

---

## 3. Existing block inventory

All nine blocks are released and mapped to the landing frame. Reuse modes:
- **REUSE:** same block, new values per page.
- **REUSE + FIELD:** same block with a small new field or conditional. The change must not alter how the landing page renders, and it goes through the block-update workflow.
- **NEW:** see §6.

| Block | Figma node | What it is | Reuse in the full site |
|---|---|---|---|
| `moe2-navigation` | `5:796` NavBar | Sticky pine bar with logo, menu from Site Root, socials, orange CTA; mobile slide-out panel | **REUSE** on every page. CTA becomes **"Get Tickets"** linking to the ticket form. Menu items are set in the Hub (§4). |
| `moe2-hero` | `5:830` Hero | 900px full-bleed photo hero: eyebrow, 3-line H1 (middle line orange), event chip, body, 2 buttons | **REUSE** on Home only. Interior pages use the new `moe2-page-hero`. |
| `moe2-stats` | `5:861` Stats | Canvas section: eyebrow, H2, body, 2×2 stat cards, rotated photo collage, "MONTANA" watermark; pine growth-chart panel (3 bars) | **REUSE** on Past Expos (full block, recap numbers). |
| `moe2-sponsorship` | `5:983` Sponsors | Title sponsor card; gold "Oro" and teal "Plata" tier cards (availability dots, price, benefits, button); Big Hearts Benefactor panel; closing quote and CTA | **REUSE + FIELD** on Sponsors: the gold and teal cards carry the copy's *Event Sponsor* and *Booth Sponsor* tiers. **New:** the Benefactor panel hides when `benefactorName` is empty. The full site **drops the Benefactor tier** (C1, decided); the field exists only so the landing page, which still shows it, keeps rendering unchanged. |
| `moe2-gallery` | `5:1243` Gallery | Pine section, centered header, masonry grid of 12 tiles (small 1×1 or large 2×2) with placeholders | **REUSE** on Home (2026 photos) and Past Expos (one instance per year). |
| `moe2-faq` | `5:1299` FAQ | Canvas, centered header, accordion cards, "Still have questions?" and teal email button | **REUSE** on Attendees as **Event Policies** (one accordion item per policy). |
| `moe2-affiliate` | `5:1393` Affiliate | Pine split: left eyebrow, H2, body, orange button; right "Why become an affiliate?" bullets and quote card | **REUSE + FIELD** on Sponsors. The copy has no reasons list or quote, so the **right column must hide when `reasons` is empty** (today `reasonsHeading` always renders). See C6. |
| `moe2-contact` | `5:1462` Contact | Canvas, centered header, person cards (initial badge, name, role, phone, email) | **REUSE** on Media (media contact: Will Israel). Optional on Contact (C9). |
| `moe2-footer` | `5:1526` Footer | Orange banner (heading, venue, note, email button, treeline art), pine footer (logo, socials, links, copyright) | **REUSE** on every page. Links point to real pages (§4). **Optional field:** banner button label and URL, so the banner can say "Get Tickets" instead of showing only the email (C10). |

**Landing-only content that does not carry over to the full site:** the landing page's sponsor-pitch hero copy, the FAQ questions (sponsor-oriented, no answers), the Oro/Plata/Benefactor tiers and their benefit lists, the affiliate reasons list and quote, and the landing statistics (6,500 / 100-vendor goal, 55 vendors in 2025). The copy document replaces all of them. That content stays on the landing page itself while it remains live.

---

## 4. Site map, navigation and global elements

| Page | Slug | Copy section | Nav label |
|---|---|---|---|
| Home (new) | built as a separate draft page, e.g. `home-2027`; becomes `/` at launch | HOME PAGE | (logo) |
| About | `/about` | ABOUT US PAGE | About |
| Attendees | `/attendees` | ATTENDEES PAGE | Attend |
| Exhibitors | `/exhibitors` | EXHIBITORS PAGE | Exhibit |
| Sponsors & Affiliates | `/sponsors` | SPONSORS & AFFILIATES PAGE | Sponsor |
| Past Expos | `/past-expos` | PAST EXPOS PAGE | Past Expos |
| Media | `/media` | PRESS/MEDIA KIT PAGE | (footer only) |
| Contact | `/contact` | CONTACT US PAGE | Contact |
| *(optional)* Event Policies | `/policies` | Attendees → Event Policies | (footer only) |

- **Header nav** (Site Root menu, set by Dustin in the Hub because agents cannot change menus): About · Attend · Exhibit · Sponsor · Past Expos · Contact, then socials, then the **Get Tickets** button. Six links fit the 1171 bar; the landing bar had five plus the CTA. Media and Policies live in the footer.
- **Footer links:** About · Attend · Exhibit · Sponsor · Past Expos · Media · Contact (+ Policies if standalone).
- **Footer banner (all pages):** heading "April 2–4, 2027 · Helena, MT", venue "Lewis & Clark County Fairgrounds", note *(TBD, the landing's sponsor-only note does not fit every page; suggestion for the designer: leave empty)*, and the button (email today, or "Get Tickets" with the new field).
- **Newsletter band** (`moe2-newsletter`, new): appears on Home, Attendees and Contact, exactly as the copy places it. Copy: *"Stay in the loop on exhibitors, speakers, entertainment, and ticket deals for the upcoming Montana Outdoor Expo."*
- **Figma page frames** show the nav at the top and the footer at the bottom of every page, as duplicates of `5:796` and `5:1526`.

---

## 5. Page-by-page plan

Each page lists its sections top to bottom with the **block**, **background**, **layout** and **content** (exact copy). `→` marks a link target from §8.

### 5.1 Home (new page; the landing page stays live)

**Goal:** one-screen answer to *what, when, where, buy tickets*, then route the three audiences.

**This is a new page, not an edit of the landing page.**
- **Figma:** build it as its own frame, `Page / Home`, on `Site — Pages`. Do not touch `5:792`.
- **Look:** keep it nearly identical to the landing page wherever the content allows. Use the same nav, the same full-bleed photo hero, the same pine/canvas/sand section rhythm, the same gallery and the same footer, all duplicated from the landing frame with only the copy changed. New blocks on this page (event facts, highlights, pathways, newsletter, logo strip) should read as siblings of the landing sections, not a new style.
- **Hub:** build it as a separate draft page (e.g. `home-2027`). It replaces the landing page at `/` only when Dustin decides to launch. The landing page, its block values and its menu stay as they are until then.

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | `moe2-navigation` REUSE | pine | CTA "Get Tickets" → Ticket form |
| 2 | `moe2-hero` REUSE | pine + photo `H-01` | **Eyebrow:** "Built by Montanans for Montanans". **H1** (3 lines): "The Premier Event" / *(orange)* "for Outdoor" / "Adventurers". **Chip:** "April 2–4, 2027 · Lewis & Clark County Fairgrounds · Helena, MT". **Body:** "Join hunters, anglers, hikers, campers, families, and other outdoor enthusiasts for three days of interaction with outfitters, guides, hunting and fishing companies, outdoor apparel brands, conservation groups, and recreation organizations." **Buttons:** "Buy Tickets!" → Ticket form; secondary "Plan Your Visit" → `/attendees`. *The title line "Montana Outdoor Expo:" is already in the logo; it can go in the eyebrow if the designer prefers.* |
| 3 | `moe2-event-facts` NEW | canvas (dots), overlapping the hero bottom edge by ~48px as a floating white card row | 3 facts with icons: **When** "April 2–4, 2027" · **Where** "Lewis & Clark County Fairgrounds, Helena, MT" · **Hosted by** "Montana Outfitters and Guides Association (MOGA)". No CTA (the hero already has one). |
| 4 | `moe2-feature-grid` NEW (default variant) | canvas (dots) | **Eyebrow:** "Something for every Montana outdoor enthusiast". **H2:** "Why attend the Montana Outdoor Expo?". **Sub-heading:** "Expo Highlights". **5 cards** (icon, short title, copy). Layout: 3 on top, 2 centered below; or a 2-column list on the left with photo `H-02` on the right. Short titles are designer labels drawn from the copy's first words, so keep them literal: **"100+ Vendors"** "Discover gear and services from 100+ vendors: outfitters, outdoor apparel brands, boats, and ATVs, along with gear-testing opportunities" · **"Licensed Guides"** "Meet and sign up with local licensed guides for hunting, fly fishing, and backcountry drop-camp adventures" · **"Family Programming"** "Enjoy family-friendly programming, including interactive youth experiences and the fan-favorite bear-attack simulator" · **"Conservation"** "Learn from conservation organizations and state agencies (MT Fish, Wildlife & Parks, Wild Sheep Foundation, Big Hearts under the Big Sky)" · **"Food, Beer & Fun"** "Enjoy food, beer, raffles, entertainment, and networking with Montana outdoor professionals and other enthusiasts". *Card titles need approval (C11).* |
| 5 | `moe2-pathways` NEW | pine (topo) | No section heading needed; optional eyebrow "Plan your Expo". **3 tall cards**, each with a photo strip on top (`H-03`, `H-04`, `H-05`), audience label, copy and arrow link. **Montanans and visitors:** "Get more event details and plan your visit" → `/attendees` · **Outdoor-oriented vendors:** "Reserve exhibit space to showcase your goods and services." → `/exhibitors` · **Sponsors & Local Businesses:** "Put your brand in front of a targeted outdoor audience." → `/sponsors` |
| 6 | `moe2-logo-grid` NEW (sponsor variant) | sand tint | **Required by the sponsorship terms:** Event Sponsors get "prominent logo display on … website home page". Label: "Thank you to our sponsors". Title sponsor logo large ("Title Sponsor": Chevrolet GMC of Helena, see C2), then a row of up to 3 Event Sponsor logo placeholders. *Not in the copy as a section; confirm (C12).* |
| 7 | `moe2-newsletter` NEW | canvas (dots) | **H2:** "Email/Newsletter Signup" *(designer may shorten to "Stay in the Loop"; C11)*. **Body:** "Stay in the loop on exhibitors, speakers, entertainment, and ticket deals for the upcoming Montana Outdoor Expo." Email field and button "Sign Up". |
| 8 | `moe2-gallery` REUSE | pine (topo) | **Eyebrow:** "From the 2026 MOE". **H2:** "Photo Gallery". Body: empty, or keep the landing's "350+ photos…" line if approved. 12 tiles, shots `G-01`…`G-12`. |
| 9 | `moe2-footer` REUSE | orange / pine | §4 |

Note on rhythm: newsletter (canvas) before the gallery (pine) before the footer keeps the rule. The gallery being dark next to the orange banner is fine; the landing page already does it with Contact then Footer reversed. Designer's call.

### 5.2 About `/about`

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | nav REUSE | | |
| 2 | `moe2-page-hero` NEW | pine + photo `A-01` | **Eyebrow:** "About the Montana Outdoor Expo" *(label, C11)*. **H1:** "Celebrating Montana's" / *(orange)* "Outdoor Traditions," / "Businesses and Communities". If 3 lines at 88px is too tall, drop the orange line to 2 lines. No buttons. |
| 3 | `moe2-split-content` NEW (text + list) | canvas | **Left (7/12):** P1 "Uniquely focused on Montana's outdoor recreation economy and culture, the Montana Outdoor Expo brings together business, education, conservation, entertainment, and family activities in a single event that captures Montana's personal feel." (lead paragraph, 22/34). P2 "What began as the Montana Outfitters and Guides Association (MOGA)'s member and partner trade show has expanded to include local and national businesses supporting all things outdoors, including hunting, fishing, guns, rods, gear, apparel, and recreational vehicles, as well as nonprofits and state and federal agencies focused on wildlife and habitat conservation." P3 "Rebranded to reflect this new inclusiveness, the event was held in Butte in 2025, with the second held in Helena in 2026." **Right (5/12): white card** titled "The Expo offers something for everyone who is outdoors-focused:" with 7 dot bullets: Hunters and anglers · Outdoor adventure seekers · Families · Campers, hikers, and recreationists · Outfitters and guides · Montana residents and visitors from neighboring states · Youth interested in outdoor recreation. |
| 4 | `moe2-callout` NEW (pine variant, with logo) | pine (topo) | Charity logo placeholder `Logo (Big Hearts under the Big Sky)` on the left, statement on the right in Fraunces italic 28/40: "Proceeds from the Montana Outdoor Expo support MOGA's ongoing advocacy for Montana's outfitting and guiding industry and for the Big Hearts under the Big Sky program, which MOGA started to provide no-cost therapeutic outdoor adventures to veterans, first responders, and children with life-threatening illnesses." Optional link "Learn about Big Hearts" → URL TBD. |
| 5 | `moe2-team` NEW | sand tint | **H2:** "The team behind MOE". **Eyebrow:** "Founders and key players". **3 cards** (photo `A-02`…`A-04` or initial badge fallback; name; role; bio). **Will Israel**, Executive Director, Montana Outfitters and Guides Association: "Will's background in running nonprofit events and organizations laid the foundation for expanding the MOGA trade show into the Montana Outdoor Expo. He has overseen MOGA since 2025 and also oversees Big Hearts under the Big Sky and other major MOGA events, including golf tournaments, banquets, and the winter convention." · **Christa Holcombe**, Director, Big Hearts under the Big Sky: "Christa's extensive experience leading nonprofits and nonprofit events has helped shape the Expo's planning and execution. She works with Will on Big Hearts programming, trips, nominations, events, branding, and the website." · **Jessica Willcut**, Event Manager: "Jessica is a seasoned event professional who has supported MOGA and Big Hearts events for five years and now serves as the event manager for MOE." |
| 6 | `moe2-pathways` REUSE of new block (compact variant) | canvas | Optional close: the same 3 audience links as Home, in a compact single row. *Not in the copy; optional.* |
| 7 | footer REUSE | | |

### 5.3 Attendees `/attendees`

**Goal:** everything a visitor needs, with tickets always one click away. This is the longest page, so keep sections tight.

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | nav REUSE | | |
| 2 | `moe2-page-hero` NEW | pine + photo `T-01` | **Eyebrow:** "Montana Outdoor Expo". **H1:** "Find Everything You Need" / *(orange)* "for Your Next Adventure". **Button:** "Get Tickets!" → Ticket form. |
| 3 | `moe2-event-facts` NEW (detailed variant) | canvas | One wide white card in **3 columns** with icon headers. **Dates & Times:** Friday, April 2: 3:00 PM – 6:00 PM / Saturday, April 3: 10:00 AM – 6:00 PM / Sunday, April 4: 10:00 AM – 4:00 PM (each day on its own row, day bold). **Location:** "Lewis and Clark County Fairgrounds, 98 W. Custer Ave., Helena, MT" with a "Get directions" link (map URL TBD). **General Admission:** "$10 per person" (large Fraunces number "$10") / "Children 12 and under admitted free." / "Ticket includes a free drink or $5 meal voucher." **CTA** under the card: "Get Tickets!" → Ticket form. |
| 4 | `moe2-feature-grid` NEW (attractions variant) | sand tint | **Eyebrow:** "Over 100 vendors!". **H2:** "Main attractions". **Cards** (photo top `T-02`…`T-07`, title, copy): **Outfitter Row** "Meet licensed Montana outfitters face-to-face, along with outfitters from Canada, Alaska, Wyoming, and across the U.S. Guns, fly rods, and whatever you need to enhance the performance and enjoyment of your sport." · **Gear & Apparel** "Check out Silencer Central, SKRE Gear, Maven Optics, and dozens more. See, touch, and try the latest designs before you buy." · **Adventure Opportunities** "Book a real Montana adventure, or an adventure beyond with licensed guides: elk, deer, or bear hunts, drop camps, or fishing trips for the seasons ahead." · **ATVs, Boats & More** "See full-size equipment on display. Get hands-on with ATVs, boats, and outdoor tech that could change your next season." · **Bear Attack Simulator**, as a **featured wide card** with an orange "A fan favorite!" badge: "Test your skills with bear spray when a bear is coming right at you! A great way for adults and kids to learn how to respond to a real bear encounter." · **Conservation & Education** "MT Fish, Wildlife & Parks, Wild Sheep Foundation, Big Hearts under the Big Sky, and more exhibiting all weekend." **Footer line** under the grid (centered, Fraunces italic): "Plus, youth interactive booths, food, beer and entertainment." Layout: 3-column grid; the featured card spans 2 columns with its photo on the left. |
| 5 | `moe2-raffle` NEW | pine (topo) | §6 spec. **Eyebrow:** "Raffle & Prizes". **H2:** "2027 Raffle Prizes". **Grand prize panel:** "Get in on the exclusive MOE raffle, where the top prize is a brand-new truck awarded by Chevrolet GMC of Helena, and there are all sorts of other prizes any outdoorsperson would want! All proceeds go to Big Hearts under the Big Sky." (photo `T-08` truck, logo `Logo (Chevrolet GMC of Helena)`). **Badge row:** "Over $10,000 in Value!" · "Six chances to win!". **Prize cards (6):** Two (2) 5-Watt Rocky Talkies · "Litter Gitter" from Yogi Bin · Jerky Box from Frontier Flavors · 6AM Madison Mini Tent with ground cloth, game bag set, & glacier gear grabs 5 pack · MT Net Co. Walk and Wade Net · Turtlebox Original (Gen 3) Speaker (each with a product image placeholder `T-09`…`T-14`). **Purchase note:** "Buy your raffle tickets all day Friday and Saturday and until 2 p.m. Sunday! Or get them here online today! You do not need to be present to win!" **Button:** "Buy Raffle Tickets" → Raffle form. |
| 6 | `moe2-newsletter` NEW | canvas | same copy as Home |
| 7 | `moe2-logo-grid` NEW (hotel variant) | sand tint | **H2:** "Book your stay in Helena". **Sub:** "Take advantage of discounted rates". Grid of hotel logo cards (placeholders `Logo (Hotel 1…n)`), each linking to that hotel's discount page; caption under each, "View discount →". Count TBD (C7). |
| 8 | `moe2-floor-plan` NEW | canvas | **H2:** "Expo floor plan". Large floor-plan image placeholder `F-01` (16:10, white card); "Download floor plan (PDF)" button; caption placeholder `[TBD]`. |
| 9 | `moe2-faq` REUSE as policies | sand tint, or pine if the rhythm needs it | `id="policies"`. **Eyebrow:** "Before you go". **H2:** "Event Policies". **Items:** "Inclement weather/cancellation", answer `[TBD: weather/cancellation policy]` · "Ticket refunds", answer `[TBD: ticket refund policy]` · "Prohibited items": "Bringing firearms, bear spray, or alcohol to the event is prohibited. Please contact us directly with any questions about bringing specific items." **Closing:** "Still have questions?" with button "Contact Us" → `/contact`. *Could become a standalone page later (copy note).* |
| 10 | footer REUSE | | |

### 5.4 Exhibitors `/exhibitors`

**Goal:** sell booth space. The flow runs proof, then why, then what's included and the price, then reserve.

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | nav REUSE | | |
| 2 | `moe2-page-hero` NEW | pine + photo `E-01` | **Eyebrow:** "Montana Outdoor Expo". **H1:** "Exhibitors Hall". **Body:** "Connect with a wide range of outdoor enthusiasts in one location!" **Buttons:** "Reserve a Booth" → Booth form; secondary "See Pricing" → `#pricing`. |
| 3 | `moe2-split-content` NEW (text + stats) | canvas | **Left:** paragraph "The Montana Outdoor Expo attracts a passionate audience of outdoor enthusiasts, including hunters, anglers, hikers, campers, backpackers, backcountry dwellers, families, and adventurers from across Montana and the surrounding region. In 2026, we welcomed over 4,100 attendees and earned an average post-event score of 8.5/10. For 2027, we're aiming to grow attendance by 1.5–2 times, bringing an energized, larger crowd of engaged buyers, brand advocates, and repeat visitors eager to discover new gear, experiences, and local expertise." **Right:** 3 stacked stat cards in the `moe2-stats` card style: **4,100+** "2026 attendees" (teal) · **8.5/10** "Average post-event score" (orange) · **1.5–2×** "2027 attendance goal" (teal). |
| 4 | `moe2-feature-grid` NEW (numbered variant) | pine (topo) | **H2:** "Why participate?". 5 items as numbered rows (large Fraunces "01"…"05" in gold, text in sand/90) in a 2-column layout, with the 5th spanning both columns. Copy: "Reach a highly engaged, outdoors-focused audience ready to buy, book trips, and support brands they trust." · "Growth trajectory: an ambitious 2027 goal means greater exposure, amplified brand reach, and amplified ROI for early partners." · "Connect with fellow industry leaders, recruit customers, and showcase products through interactive demos and premium exhibit space." · "Community influence: attendees include influencers in local outdoor communities and family decision-makers who shape purchasing and travel choices." · "Align your brand with a fast-growing community event that consistently scores high attendee satisfaction and meaningful ROI. Our 8.5/10 average rating signals a well-run event and a high likelihood of return visits and referrals." *For items with a lead phrase ("Growth trajectory:", "Community influence:"), set the phrase bold and gold.* |
| 5 | `moe2-feature-grid` NEW (compact variant) | canvas | **H2:** "Our exhibitor offerings include:". **10 compact tiles** (icon, bold category, one-line list), 2 columns × 5 rows desktop: Hunting: "Guns, gun accessories (scopes, slings, silencers), bowhunting gear, bow accessories, binoculars, and spotting scopes." · Fishing/angling: "Rods, boats, flies, and lines" · Gear: "Packs, pouches, hydration, and apparel (cold weather systems, boots, shirts, hats, caps, boots, and socks)" · Camping: "Campers, RVs, tents, trailers, wall tents, generators, and cooking" · Hiking/walking: "Boots, packs, gear, sticks, and apparel" · Outfitters: "Hunting, fishing, backcountry, trail rides, and lodges" · Vehicles: "Trucks, ATVs, side-by-sides, dirt bikes, trailers, and accessories" · Nonprofits/gov't agencies: "FWP, US Forest Service, conservation, wildlife, habitat, sportsmen, and veterans" · Presentations and youth education: "Wilderness skills, first aid, bear attack simulator, youth hunting and fishing education" · Food and beer (no description). *"boots" appears twice in Gear (C13).* |
| 6 | `moe2-booth-pricing` NEW | sand tint, `id="pricing"` | §6 spec. **H2:** "Booth space availability and pricing". **Badge:** "20% discount for MOGA members and nonprofits". **3 tier cards** (the middle one emphasised in a pine fill): **Standard Booth** 10 x 10, **$750**, members/nonprofits "$600 (20% off)", revenue "$3,000 – $5,000" · **Double Booth** 20 x 10, **$1,200**, "$960 (20% off)", "$5,500 – $8,500" · **Premium Booth** 20 x 20, **$2,000**, "$1,600 (20% off)", "$9,000 – $16,000". In each card, the revenue row is labelled "Revenue ranges reported by vendors at the 2026 event". **Included list** under the cards (dot bullets, 2 columns): "Price covers 5 days, from setup to teardown (Thursday, April 1st - Monday, April 5th)" · "Includes pipe, drape, tables, chairs, Wi-Fi, and electricity" · "Full payment is due upon booking to reserve the space." · "Payments can be made by check, credit card, or electronic transfer." **Button:** "Reserve a Booth" → Booth form. |
| 7 | `moe2-callout` NEW (orange CTA variant) | accent-orange band, short | "Join us to connect with an authentic, motivated outdoor audience ready to engage, buy, and spread the word." Button "Reserve a Booth" (white) → Booth form. *Two orange bands (this and the footer) on one page: designer may switch this one to pine.* |
| 8 | `moe2-exhibitor-directory` NEW | canvas | **H2:** "2027 Exhibitors" *(label, C11)*. Optional category filter chips. Logo card grid (4 columns): logo, name, category, booth #, link. **Empty state** until the list exists: "Exhibitor directory coming soon." `[TBD: exhibitor directory]` |
| 9 | `moe2-floor-plan` NEW | sand tint | Same block as Attendees. "Expo floor plan", image `F-01`, download button. |
| 10 | `moe2-callout` NEW (split, light variant with logo) | canvas | **H3:** "Get booth and exhibit support!". Body: "Need help designing a booth or exhibit that best conveys your brand and highlights your products or services?" "We partner with B3 Exhibits, a distinguished 25-year trade show exhibit and graphic design company, to provide consulting and deliver booth development and assembly services for our exhibitors." `Logo (B3 Exhibits)`. Link button "Visit B3 Exhibits to learn more" → https://b3exhibits.com/ (new tab). |
| 11 | footer REUSE | | |

### 5.5 Sponsors & Affiliates `/sponsors`

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | nav REUSE | | |
| 2 | `moe2-page-hero` NEW | pine + photo `S-01` | **Eyebrow:** "Sponsors & Affiliates". **H1:** "Get Your Brand" / *(orange)* "in Front of" / "Your Best Customers". This deliberately echoes the landing hero. **Body:** "The Montana Outdoor Expo is quickly becoming the must-attend event for hunters, anglers, families, outfitters, and outdoor enthusiasts throughout the Treasure State." **Buttons:** "Become a Sponsor" → Sponsor form; secondary "Join Us as an Affiliate" → `#affiliate`. |
| 3 | `moe2-feature-grid` NEW (stat variant) | canvas (dots) | **Intro paragraph** (left-aligned, max 720): "The Expo offers expert-led demonstrations, hands-on experiences, and unmatched opportunities to connect with Montana's outdoor community, all designed to inspire participation, support local businesses, and expand the state's outdoor economy." **Sub-heading:** "Key Highlights". **4 cards**, each with a big stat on top, a bold lead and the copy: **4,100+** / "Standout results:" "In 2026, we hosted more than 4,100 attendees and 84 exhibitors, earning an average post-event rating of 8.5/10 ― proof the Expo delivers a high-quality experience that resonates." · **1.5–2×** / "Ambitious growth target:" "For 2027, we're targeting 1.5–2x attendance, dramatically expanding our reach while scaling exhibitor opportunities and programming to match demand." · *(icon, no number)* / "Sponsor and affiliate value:" "We're committed to increasing foot traffic, enhancing exhibitor placements, and creating customized sponsor activations that drive measurable returns and long-term relationships." · **1M+** / "Powerful promotion:" "Our focused digital marketing program drives strong engagement across Facebook, Instagram, and LinkedIn. Recent campaigns generated over one million impressions on Facebook." 2×2 grid, or 4 across on wide screens. |
| 4 | `moe2-sponsorship` REUSE + FIELD | sand tint | **Eyebrow:** "Sponsorship Tiers" *(the landing eyebrow "More than a logo on a sign" is optional)*. **H2:** "Sponsorship Tiers". **Intro:** empty, or reuse the landing intro if approved. **Title card:** label "Title Sponsor", name "Chevrolet GMC of Helena" (C2, decided: copy name), logo placeholder, body empty or TBD (the copy gives only the logo), badge "Filled". **Gold card (`oro*` fields):** level "Event Sponsor", name "Event Sponsor", price "$5,000", availability "3 available", dots 3; benefits: 20 x 20 booth · Featured sponsor for educational booth · Prominent logo display on event materials and displays and website home page · Included in announcements and radio advertising · Opportunity to contribute to MOE raffle; button "Become a Sponsor" → Sponsor form. **Teal card (`plata*`):** "Booth Sponsor", "$2,500", "4 available", dots 4; benefits: 20 x 10 booth · Logo on event materials and displays and website sponsor page · Opportunity to contribute to MOE raffle; button "Become a Sponsor". **Benefactor panel:** dropped; the full site has no Benefactor tier (C1, decided). **Quote:** "Join us at the Montana Outdoor Expo, where Montana's outdoorspeople gather, discover, and celebrate the best of our state's hunting, fishing, and recreation culture." **CTA:** "Become a Sponsor" → Sponsor form. *In Figma, duplicate `5:983`, change the text, and delete the Benefactor panel from the duplicate. Use only the copy's benefit lists, not the landing's Oro/Plata lists.* |
| 5 | `moe2-affiliate` REUSE + FIELD | pine (topo) | `id="affiliate"`. **Eyebrow:** empty, or the landing's "You don't have to exhibit to benefit" if approved. **H2:** "Affiliate Opportunities & Pricing" (C6, decided: keep the copy heading as written). **Body:** "We invite local businesses to partner with us to offer discounted accommodations and services to our attendees. You not only get your brand in front of our audience but also build goodwill through your discounted offerings." **Button:** "Join Us as an Affiliate" → Affiliate form. **Right column:** hidden, because the copy has no reasons list or quote. Do not reuse the landing's reasons. Body and button sit left with a background photo `S-02` on the right. |
| 6 | footer REUSE | | |

### 5.6 Past Expos `/past-expos`

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | nav REUSE | | |
| 2 | `moe2-page-hero` NEW | pine + photo `P-01` | **Eyebrow:** "Recap of Past Montana Outdoor Expos". **H1:** "Building Momentum" / *(orange)* "Year over Year". |
| 3 | `moe2-stats` REUSE | canvas | **Eyebrow:** "Since 2025". **H2:** "Recap of Past Montana Outdoor Expos" *(or drop the H2 and keep the eyebrow, to avoid repeating the hero)*. **Body:** "Since the Montana Outdoor Expo debuted in 2025, the event has grown into a must-attend for outdoor enthusiasts and brands alike. In just one year, the crowd swelled from 2800 to more than 4,000 attendees in 2026, and participants rewarded the experience with strong post-show satisfaction — an average of 8.5 out of 10. Exhibitor presence has surged as well, climbing from 65 to over 85 vendors, bringing more gear demos, guided adventure offerings, and hands-on workshops than ever before." **Stat cards:** 2,800 "2025 attendees" · 4,000+ "2026 attendees" · 8.5/10 "Avg. post-show rating" · 85+ "2026 vendors". **Growth panel:** eyebrow "Building momentum year over year", heading "Growing Every Year" *(label)*, body from the Sponsors copy: "For 2027, we're targeting 1.5–2x attendance, dramatically expanding our reach while scaling exhibitor opportunities and programming to match demand." **Bars:** 2025 "2,800" / "65 vendors" · 2026 "4,000+" / "85+ vendors" · 2027 goal bar labelled "1.5–2×" / "Goal". Do not use the landing's 6,500 / 100-vendor goal or its 55-vendor 2025 figure. *Numbers follow the copy on every page, as written for that page (C3, decided).* Photos `P-02`, `P-03`. |
| 4 | `moe2-year-recap` NEW | sand tint | **2025 MOE in Butte, MT, Highlights**: year badge "2025", location "Butte, MT", mini stats (attendees, vendors), highlights `[TBD: 2025 MOE highlights]`, 3-photo strip `P-04`…`P-06`. Then **2026 MOE in Helena, MT, Highlights**, mirrored (photo strip left): `[TBD: 2026 highlights]`, photos `P-07`…`P-09`. Alternate left/right per year. |
| 5 | `moe2-gallery` REUSE ×2 *(optional)* | pine | If the highlight photo strips are not enough: one gallery per year, titled "2025 in Butte" / "2026 in Helena". Otherwise skip. |
| 6 | footer REUSE | | |

### 5.7 Media `/media`

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | nav REUSE | | |
| 2 | `moe2-page-hero` NEW | pine + photo `M-01` | **Eyebrow:** "Media: You're invited". **H1:** "Join Us at the" / *(orange)* "Montana Outdoor Expo!". **Body:** "Everything journalists need to cover MOE". **Button:** "Request a Press Pass" → Media form. |
| 3 | `moe2-split-content` NEW (text only) | canvas | Lead paragraph: "We welcome media attendance and offer full access to event activities, interviews, background materials, and ready-to-use assets, so you can focus on the people, products, and outdoor stories that matter." |
| 4 | `moe2-resource-list` NEW | sand tint | **H2:** "Montana Outdoor Expo media kit includes:". **4 download cards** (icon by file type, title, action): "Official fact sheet with event overview and highlights" (PDF) → `[TBD]` · "High-resolution logo" (download) → `[TBD]` · "Event photos and videos" (link to page) → `[TBD]` · "Press release" (PDF) → `[TBD]`. 2×2 grid. |
| 5 | `moe2-contact` REUSE | canvas | **Eyebrow:** "Media contact". **H2:** "Media contact". **Body:** "Reach out with any questions, interview requests, or to obtain press credentials or photo access." **One card:** Will Israel, role empty or "Executive Director", 406.449.3578, director@mogamt.org. *One card in a 2-column grid: the designer should centre it (may need a layout tweak, C9).* |
| 6 | footer REUSE | | |

### 5.8 Contact `/contact`

| # | Block | Bg | Content and layout |
|---|---|---|---|
| 1 | nav REUSE | | |
| 2 | `moe2-page-hero` NEW (short, no photo) | pine (topo only) | **Eyebrow:** "Contact Us". **H1:** "Any questions about" / *(orange)* "attending, exhibiting," / "or sponsoring?" |
| 3 | `moe2-pathways` NEW (compact variant) | canvas | **Intro:** "Hopefully, you found the information you need on our attendees, exhibitors, or sponsors and affiliates pages." 3 compact link cards → `/attendees`, `/exhibitors`, `/sponsors`. |
| 4 | `moe2-contact-form` NEW | sand tint | **Lead:** "If not, choose the topic that fits your question and send us a note." *(The copy's "please link to a form for the appropriate contact listed below" is an editor's instruction and must not appear on the page. This replacement line is proposed, so mark it for approval, C8.)* **Topic selector** shown as 4 selectable tiles: Attending/Purchasing tickets · Exhibiting · Sponsoring · Media Registration/Press Pass. Below them, the form: name, email, phone (optional), message, submit "Send". **Confirmation copy:** "We'll respond to your inquiry as soon as possible!" If MOE uses four external forms instead, the tiles become link cards and the form is dropped (C8). |
| 5 | `moe2-newsletter` NEW | canvas | same copy as Home |
| 6 | footer REUSE | | |

---

## 6. New block specifications

Sixteen new blocks. **Tier 1** blocks are used on three or more pages; build them first, because they set the interior-page look. Field names are suggestions for the build step. Every image field has an alt-text partner.

### Tier 1

**N1 `moe2-page-hero`**: interior hero. *Mobile frame needed.*
- Based on `moe2-hero` but **~520px tall desktop** (360 without a photo), with H1 at 88px.
- Pine background, optional photo with the same pine gradient overlay, `texture-topo` when there is no photo.
- Left-aligned content in the 1280 container: eyebrow, H1 (`headingLine1`, optional orange `headingAccent`, optional `headingLine3`), optional body (max 600), optional primary and secondary buttons.
- Optional breadcrumb above the eyebrow ("Home / Exhibitors", 14px sand/60).
- Variants to draw: with photo plus buttons (Exhibitors), with photo and no buttons (About), no photo (Contact).
- Fields: eyebrow, headingLine1, headingAccent, headingLine3, body, primaryLabel/Url, secondaryLabel/Url, backgroundImage(+alt).

**N2 `moe2-feature-grid`**: header plus cards. *Mobile frame needed (attractions variant).*
- Section header: eyebrow, H2, optional sub-heading (Fraunces italic or small caps label), optional intro paragraph, optional footer line.
- Item fields: icon (option list), image (optional), stat (optional), lead (optional bold), title, body, featured (yes/no), link label/URL (optional).
- **Variants:**
  - `default`: white icon cards, 3 columns (Home highlights).
  - `attractions`: photo-top cards with a featured wide card and badge (Attendees).
  - `numbered`: pine background, gold "01" numerals, 2-column rows (Exhibitors why).
  - `compact`: icon plus bold category plus one line, 2-column list (Exhibitor offerings).
  - `stat`: big Fraunces number, bold lead and text (Sponsors highlights).
- The variant is an option field (`style`) plus a background option (canvas / sand / pine).

**N3 `moe2-callout`**: statement band.
- One block with a `style` option:
  - `pine`: logo left, Fraunces italic statement right (About proceeds).
  - `orange`: centred statement plus white button (Exhibitors CTA).
  - `light-split`: H3, body and link on the left, logo card on the right (B3 Exhibits).
- Fields: style, eyebrow, heading, body (richtext), logo(+alt), buttonLabel, buttonUrl, newTab.

**N4 `moe2-newsletter`**: email signup band. *Mobile frame needed.*
- Canvas or sand background, max 896 wide.
- Left: H2 plus body. Right: email input and orange "Sign Up" button inline (stacked on mobile), with a small privacy line under it (optional, TBD).
- Uses the CMS form helper (`form.cms-form`), which records a contact-form history event. **There is no mailing-list integration today (C5).**
- Fields: heading, body, buttonLabel, successMessage.

**N5 `moe2-split-content`**: two-column text section.
- Left (7/12): eyebrow, H2 (optional), richtext body with a lead first paragraph.
- Right (5/12) as a `side` option:
  - `list`: a white card with a title and dot bullets (About).
  - `stats`: stacked stat cards (Exhibitors).
  - `image`: a rounded photo.
  - `none`: body spans a 720 measure (Media).
- Fields: eyebrow, heading, body, side, sideTitle, sideItems[], stats[{value,label,color}], image(+alt).

**N6 `moe2-pathways`**: audience routing cards.
- Fields: eyebrow, heading, intro, items[{label, text, linkLabel, url, image(+alt)}], style (`tall` with photo / `compact`).
- `tall`: 3 photo-top cards on pine, white card bodies, orange arrow link.
- `compact`: 3–4 white link cards in one row on canvas, with an arrow icon right.

### Tier 2

**N7 `moe2-event-facts`**: event essentials.
- `simple`: 3 icon facts in a white card row that overlaps the section above (Home).
- `detailed`: 3 columns (Dates & Times with a day list, Location with address and directions link, Admission with a big price and notes) plus a CTA (Attendees).
- Fields: items[{icon, label, value(richtext), linkLabel, url}], ctaLabel, ctaUrl, style.

**N8 `moe2-team`**: team bios.
- Sand tint, header, 3-column cards: photo (1:1, rounded 16) or `moe2-contact`-style initial badge fallback, name (bold 20), role (uppercase 14), bio (16/26).
- Fields: eyebrow, heading, people[{photo, alt, initial, color, name, role, bio}].

**N9 `moe2-booth-pricing`**: tiered price cards. *Mobile frame needed.*
- Header plus a discount badge (gold pill).
- 3 cards: size label (Sofia Extra Condensed 47, "10 x 10"), tier name, price (Fraunces 900 47), member price line ("$600 with 20% off" in teal), a divider, a "Reported vendor revenue (2026)" row with the range, and a featured flag for the pine-fill middle card.
- Below: an included list in 2 columns and the CTA.
- Fields: eyebrow, heading, badge, tiers[{name,size,price,memberPrice,revenue,featured}], revenueLabel, includedTitle, included[], buttonLabel, buttonUrl.

**N10 `moe2-raffle`**: prizes. *Mobile frame needed.*
- Pine background.
- Top split: grand-prize photo card on the left (truck `T-08`, "Grand Prize" orange ribbon, sponsor logo); eyebrow, H2, intro copy and 2 gold pills ("Over $10,000 in Value!", "Six chances to win!") on the right.
- Then a 3×2 grid of prize cards (white/10 glass cards: image placeholder, prize name).
- Then a centred purchase note and orange button, with a small "All proceeds go to Big Hearts under the Big Sky" line plus the charity logo.
- Fields: eyebrow, heading, intro, badges[], grandPrizeLabel, grandPrizeImage, sponsorLogo, prizes[{name,image,alt}], note, buttonLabel, buttonUrl, beneficiaryLogo.

**N11 `moe2-logo-grid`**: logo wall.
- `hotel` variant: white cards (logo centred, optional name, "View discount →"), 4 columns.
- `sponsor` variant: a featured title-sponsor row (one large logo), then a smaller row; label above in Fraunces italic.
- Fields: eyebrow, heading, intro, featured{logo,alt,url,label}, logos[{logo,alt,name,url,linkLabel}], style.

**N12 `moe2-floor-plan`**: plan image.
- Header, a white card holding the plan image (click opens the full image or PDF), a download button and an optional caption or legend list.
- Placeholder state: "Floor plan coming soon".
- Fields: heading, intro, image(+alt), fileUrl, buttonLabel, caption.

**N13 `moe2-exhibitor-directory`**: exhibitor list.
- Header, optional category chips (static anchors), a 4-column grid of white cards (logo 3:2, name, category tag, "Booth 12", website link).
- An empty-state panel when the list is empty.
- Data starts as a **manual array**: exhibitors[{name, logo, category, booth, url}]. A Firestore-backed `exhibitors` collection with KV mirror is a later option (C14).

**N14 `moe2-contact-form`**: topic and form. *Mobile frame needed.*
- Lead text; 4 topic tiles (radio-style cards with icon and label; selected tile in a teal border); form fields in 2 columns (name, email / phone, topic select on mobile) with the message full width; orange submit; success and error message area.
- Uses `form.cms-form`; the topic is a real `<select>` or radio group so it is submitted with the message.
- Fields: lead, topics[{label, icon}], buttonLabel, successMessage.

**N15 `moe2-year-recap`**: per-year rows.
- Each row: a big year numeral ("2025", Fraunces 900, 120px, teal/20 behind), H3 "2025 MOE in Butte, MT", location chip, 2 mini stats, highlights richtext, and a 3-photo strip (one large and two small) on the other side.
- Rows alternate sides.
- Fields: eyebrow, heading, years[{year, title, location, stats[{value,label}], highlights, photos[{image,alt}]}].

**N16 `moe2-resource-list`**: downloads.
- Header, a 2×2 grid of white cards: file-type icon in a teal circle, title, short description (optional), action link ("Download PDF ↓" / "View photos →").
- Fields: heading, intro, items[{title, description, type(pdf/image/link), url, linkLabel}].

### Block-to-page matrix
| Block | Home | About | Attend | Exhibit | Sponsor | Past | Media | Contact |
|---|---|---|---|---|---|---|---|---|
| navigation / footer | ● | ● | ● | ● | ● | ● | ● | ● |
| hero | ● | | | | | | | |
| page-hero (N1) | | ● | ● | ● | ● | ● | ● | ● |
| feature-grid (N2) | ● | | ● | ●● | ● | | | |
| callout (N3) | | ● | | ●● | | | | |
| newsletter (N4) | ● | | ● | | | | | ● |
| split-content (N5) | | ● | | ● | | | ● | |
| pathways (N6) | ● | ○ | | | | | | ● |
| event-facts (N7) | ● | | ● | | | | | |
| team (N8) | | ● | | | | | | |
| booth-pricing (N9) | | | | ● | | | | |
| raffle (N10) | | | ● | | | | | |
| logo-grid (N11) | ○ | | ● | | | | | |
| floor-plan (N12) | | | ● | ● | | | | |
| exhibitor-directory (N13) | | | | ● | | | | |
| contact-form (N14) | | | | | | | | ● |
| year-recap (N15) | | | | | | ● | | |
| resource-list (N16) | | | | | | | ● | |
| stats | | | | | | ● | | |
| sponsorship (+field) | | | | | ● | | | |
| affiliate (+field) | | | | | ● | | | |
| gallery | ● | | | | | ○ | | |
| faq (as policies) | | | ● | | | | | |
| contact | | | | | | | ● | ○ |

● planned, ○ optional

---

## 7. Imagery and asset list

**No photos are supplied.** The 2026 event library ("350+ photos", per the landing gallery) is the expected source. Every image is drawn as a named placeholder in Figma; the designer or client swaps in real photos. Preferred crops are listed so the layouts are drawn to the right proportions.

### Photos
| Id | Page / block | Shot | Crop |
|---|---|---|---|
| H-01 | Home hero | Expo floor, wide, high angle, busy aisles (the landing hero's photo can be reused) | 16:9, full-bleed |
| H-02 | Home highlights (if split) | Attendees trying gear at a booth | 4:5 |
| H-03 | Home pathway: visitors | Family or kids at the bear simulator or youth booth | 3:2 |
| H-04 | Home pathway: vendors | Exhibitor talking with customers at a booth | 3:2 |
| H-05 | Home pathway: sponsors | Sponsor signage or branded booth (Chevrolet truck display) | 3:2 |
| G-01…G-12 | Home gallery | 2026 mix: floor, booths, seminars, boats/ATVs, families, food and beer | 1:1 and 2:2 tiles |
| A-01 | About hero | Montana landscape or outfitter booth with mounts | 16:9 |
| A-02…A-04 | About team | Headshots: Will Israel, Christa Holcombe, Jessica Willcut | 1:1 |
| T-01 | Attendees hero | Crowd at the entrance or aisle, energetic | 16:9 |
| T-02…T-07 | Attractions | Outfitter Row · Gear & apparel (Silencer Central, SKRE, Maven) · Guide booking table · ATVs/boats · Bear attack simulator · FWP / Wild Sheep Foundation booth | 3:2 |
| T-08 | Raffle | 2027 truck (Chevrolet GMC of Helena; landing says 2027 Colorado) | 16:10 |
| T-09…T-14 | Raffle prizes | Product shots: Rocky Talkies, Litter Gitter, Frontier Flavors jerky box, 6AM Madison Mini Tent set, MT Net Co. net, Turtlebox speaker | 1:1, light background |
| E-01 | Exhibitors hero | Overhead floor showing booth rows | 16:9 |
| S-01 | Sponsors hero | Title sponsor truck display or main-stage sponsor banner | 16:9 |
| S-02 | Affiliate background | Helena downtown or a hotel lobby (decorative, 20%) | 1:1 |
| P-01 | Past Expos hero | 2026 wide crowd | 16:9 |
| P-02, P-03 | Past Expos stats collage | Seminar overhead; attendees at a booth (same as landing) | 4:3 |
| P-04…P-06 | 2025 recap | Butte 2025 photos | 1 × 4:3 + 2 × 1:1 |
| P-07…P-09 | 2026 recap | Helena 2026 photos | 1 × 4:3 + 2 × 1:1 |
| M-01 | Media hero | Press/interview moment or stage | 16:9 |
| F-01 | Floor plan | 2027 floor plan (supplied by MOE as image + PDF) | 16:10 |

### Logos and graphics
- MOE logo (already in Site settings; light version for the pine nav and footer)
- Chevrolet GMC of Helena (title sponsor and raffle)
- Event Sponsor logos ×3 (when signed)
- Big Hearts under the Big Sky (About, raffle, Sponsors)
- MOGA (Home "Hosted by", optional)
- B3 Exhibits (Exhibitors)
- Partner hotels ×n (Attendees)
- Exhibitor logos ×n (directory)
- MT FWP, Wild Sheep Foundation *(optional, conservation card)*
- Footer treeline art (exists on landing; upload to `bannerArt`)

### Files
Fact sheet PDF · press release PDF · high-res logo package · media photo/video page or folder · floor plan PDF.

### Icons (line style)
Calendar · map pin · flag/handshake (hosted by) · clock · ticket · store/tent (vendors) · compass (guides) · family · leaf/paw (conservation) · beer mug · target/crosshair (hunting) · fish · backpack · tent · boot · truck/ATV · bear · graduation (education) · file-pdf · image · download · mail · phone.

---

## 8. Links and forms

Every bracketed link in the copy, with its target. **All external form URLs are TBD**: ask MOE what ticketing and form tools they use (C4).

| Copy CTA | Pages | Target |
|---|---|---|
| Buy Tickets! / Get Tickets! / nav "Get Tickets" | Home, Attendees, nav | **Ticket purchase form**: URL TBD |
| Plan your visit | Home | `/attendees` |
| Reserve exhibit space / Reserve a Booth | Home, Exhibitors | **Booth reservation form**: URL TBD (`/exhibitors` from Home) |
| Put your brand in front of… | Home | `/sponsors` |
| Become a Sponsor | Sponsors | **Sponsorship sign-up form**: URL TBD |
| Join Us as an Affiliate | Sponsors | **Affiliate inquiry form**: URL TBD |
| Raffle tickets online | Attendees | **Raffle ticket form**: URL TBD |
| Hotel logos | Attendees | each hotel's discount page: TBD |
| Visit B3 Exhibits | Exhibitors | https://b3exhibits.com/ |
| Contact topic forms (4) | Contact | `moe2-contact-form` with topic, or 4 external forms (C8) |
| Media kit items (4) | Media | file URLs TBD |
| Newsletter signup | Home, Attendees, Contact | CMS form helper; no list provider (C5) |
| Email | footer, FAQ | info@montanaoutdoorexpo.com (landing); Media: director@mogamt.org |

---

## 9. Copy conflicts and open questions

Rows marked **Decided** were settled by Dustin on 2026-10-08: **the copy document wins** over the landing page. The remaining rows still need answers from MOE. **The Figma draft follows the final copy document. Where the copy is silent, it uses the placeholder shown.**

| # | Issue | Copy doc says | Live landing says | Plan default |
|---|---|---|---|---|
| C1 | Sponsorship tiers | Event Sponsor $5,000 (3 avail.), Booth Sponsor $2,500 (4 avail.), no Benefactor | Oro $5,000 (3), Plata $2,500 (**5**), Big Hearts Benefactor $5,500 ×4; different benefit lists | **Decided:** copy tiers and benefit lists; **Benefactor dropped** from the full site |
| C2 | Title sponsor name | "Chevrolet GMC of Helena" | "Lithia Chevrolet GMC of Helena" | **Decided:** copy name ("Chevrolet GMC of Helena") |
| C3 | Stats | Past Expos: 2025 = 2,800 attendees / **65** vendors; 2026 = "more than 4,000" / "over **85**" vendors. Sponsors: 2026 = 4,100+ / **84** exhibitors | 2025 **55** vendors; 2026 4,100 / 84; 2027 goal 6,500 / 100 | **Decided:** follow the copy, page by page, exactly as written; no landing figures |
| C4 | Form and ticketing URLs | "[Button linked to form …]" ×6 | n/a | Placeholders |
| C5 | Newsletter provider | Signup on 3 pages | n/a | CMS form helper stores submissions only; does MOE use Mailchimp or similar? |
| C6 | "Affiliate Opportunities & **Pricing**" | Heading says pricing; no pricing given; no reasons list | Landing has 5 reasons + quote | **Decided:** copy heading as written; no reasons list or quote (right column hidden) |
| C7 | Hotels | "[Insert hotel logos …]" | n/a | 4 placeholders; need the list |
| C8 | Contact page | "please link to a form for the appropriate contact" (an editor note) and 4 topic forms | n/a | **Decided:** the editor note must not appear. One form with a topic selector; proposed lead line in §5.8 still needs approval |
| C9 | People on Contact and Media | Media: Will only; Contact: none | Will and Jessica cards with phones | Media: Will card. Show Will and Jessica on Contact too? |
| C10 | Footer banner | n/a | Sponsor-specific note and email button | Note emptied; optional "Get Tickets" button field |
| C11 | Labels not in the copy | e.g. Home highlight card titles, "2027 Exhibitors", "About the Montana Outdoor Expo", newsletter heading | | Marked as designer labels; approve |
| C12 | Sponsor logos on Home | Event Sponsor benefit promises a home-page logo | n/a | Logo strip added to Home |
| C13 | Copy typos | "outdoorsfocused", "fastgrowing" (lost hyphens); "boots" twice in Gear; "$1200"/"$2000" without commas | | Hyphens restored, commas added, duplicate "boots" kept but flagged |
| C14 | Exhibitor directory data | "[Exhibitor directory to be inserted here.]" | n/a | Manual array; a Firestore collection later if the list is long |
| C15 | Missing content | Weather/cancellation and refund policies; 2025 and 2026 highlights; media kit files; floor plan; gallery photos | | `[TBD]` placeholders |
| C16 | Raffle grand prize | "brand-new truck awarded by Chevrolet GMC of Helena" | "2027 Colorado (~$42,000 value)", drawing April 4, 2027 | Copy doc wording; the model and value can be added if approved |

---

## 10. Design map

The Figma agent fills this in as frames are created. The build step copies these into each block's `meta.design`.

| Block / page | Figma page | Frame name | Node id | Mobile node id | Status |
|---|---|---|---|---|---|
| `MOE2 Tokens` variables | — | — | `VariableCollectionId:149:2` (14 colors, 6 radii) + 25 `MOE2/*` text styles | — | Drafted. Translucent tints (e.g. `white/5`, `secondary/12%`) are plain colors, not variable-bound: Figma drops the opacity of variable-bound paints inside instances |
| Item components (array items), placeholders, icons | Site — New Blocks | MOE2 / Item components · MOE2 / Placeholders · MOE2 / Icons | `157:166` · `157:137` · `151:2` | — | Drafted: 23 `item/*` components, 4 `ph/*` placeholders, 43 `icon/*` |
| moe2-page-hero (photo + buttons) | Site — New Blocks | moe2-page-hero | `161:98` | `161:119` | Drafted |
| moe2-page-hero / photo-no-buttons | Site — New Blocks | moe2-page-hero / photo-no-buttons | `161:140` | | Drafted |
| moe2-page-hero / no-photo | Site — New Blocks | moe2-page-hero / no-photo | `161:154` | | Drafted |
| moe2-feature-grid (default) | Site — New Blocks | moe2-feature-grid | `161:160` | | Drafted; card titles need approval (C11) |
| moe2-feature-grid / attractions | Site — New Blocks | moe2-feature-grid / attractions | `161:228` | `161:307` | Drafted |
| moe2-feature-grid / numbered | Site — New Blocks | moe2-feature-grid / numbered | `161:386` | | Drafted |
| moe2-feature-grid / compact | Site — New Blocks | moe2-feature-grid / compact | `161:406` | | Drafted; duplicate "boots" kept (C13) |
| moe2-feature-grid / stat | Site — New Blocks | moe2-feature-grid / stat | `161:511` | | Drafted |
| moe2-callout (pine) | Site — New Blocks | moe2-callout | `161:548` | | Drafted; Big Hearts URL TBD |
| moe2-callout / orange | Site — New Blocks | moe2-callout / orange | `161:563` | | Drafted |
| moe2-callout / light-split | Site — New Blocks | moe2-callout / light-split | `161:568` | | Drafted |
| moe2-newsletter | Site — New Blocks | moe2-newsletter | `161:586` | `161:598` | Drafted; heading label needs approval (C11) |
| moe2-split-content (list) | Site — New Blocks | moe2-split-content | `161:610` | | Drafted |
| moe2-split-content / stats | Site — New Blocks | moe2-split-content / stats | `161:648` | | Drafted |
| moe2-split-content / text-only | Site — New Blocks | moe2-split-content / text-only | `161:662` | | Drafted. The `image` side option is not drawn (no page uses it) |
| moe2-pathways (tall) | Site — New Blocks | moe2-pathways | `161:665` | | Drafted |
| moe2-pathways / compact | Site — New Blocks | moe2-pathways / compact | `161:712` | | Drafted |
| moe2-event-facts (simple) | Site — New Blocks | moe2-event-facts | `167:464` | | Drafted |
| moe2-event-facts / detailed | Site — New Blocks | moe2-event-facts / detailed | `167:498` | | Drafted; map URL TBD |
| moe2-team | Site — New Blocks | moe2-team | `167:545` | | Drafted |
| moe2-booth-pricing | Site — New Blocks | moe2-booth-pricing | `167:586` | `167:643` | Drafted |
| moe2-raffle | Site — New Blocks | moe2-raffle | `167:700` | `167:795` | Drafted |
| moe2-logo-grid (sponsor) | Site — New Blocks | moe2-logo-grid | `167:890` | | Drafted; confirm (C12) |
| moe2-logo-grid / hotel | Site — New Blocks | moe2-logo-grid / hotel | `167:932` | | Drafted; hotel list TBD (C7) |
| moe2-floor-plan | Site — New Blocks | moe2-floor-plan | `167:976` | | Drafted; plan image and PDF TBD |
| moe2-exhibitor-directory (empty state) | Site — New Blocks | moe2-exhibitor-directory | `167:993` | | Drafted |
| moe2-exhibitor-directory / populated | Site — New Blocks | moe2-exhibitor-directory / populated | `167:1028` | | Drafted with `[TBD]` sample cards (C14) |
| moe2-contact-form | Site — New Blocks | moe2-contact-form | `167:1149` | `167:1234` | Drafted; lead line needs approval (C8) |
| moe2-year-recap | Site — New Blocks | moe2-year-recap | `167:1319` | | Drafted; highlights TBD |
| moe2-resource-list | Site — New Blocks | moe2-resource-list | `167:1394` | | Drafted; file URLs TBD |
| moe2-sponsorship (benefactor hidden) | Site — New Blocks | moe2-sponsorship / no-benefactor | `167:1443` | | Drafted (duplicate of `5:983`) |
| moe2-affiliate (no reasons) | Site — New Blocks | moe2-affiliate / no-reasons | `167:1625` | | Drafted (duplicate of `5:1393`) |
| Page / Home | Site — Pages | Page / Home | `172:32` | | Drafted |
| Page / About | Site — Pages | Page / About | `172:402` | | Drafted |
| Page / Attendees | Site — Pages | Page / Attendees | `173:242` | | Drafted |
| Page / Exhibitors | Site — Pages | Page / Exhibitors | `173:724` | | Drafted |
| Page / Sponsors | Site — Pages | Page / Sponsors | `175:603` | | Drafted |
| Page / Past Expos | Site — Pages | Page / Past Expos | `175:977` | | Drafted |
| Page / Media | Site — Pages | Page / Media | `175:1263` | | Drafted |
| Page / Contact | Site — Pages | Page / Contact | `175:1454` | | Drafted |

Figma pages: `Site — New Blocks` = `149:48`, `Site — Pages` = `149:49`. The landing frame `5:792` was not edited.

Existing mapped nodes, unchanged: nav `5:796` · hero `5:830` · stats `5:861` · sponsorship `5:983` · gallery `5:1243` · faq `5:1299` · affiliate `5:1393` · contact `5:1462` · footer `5:1526`.
