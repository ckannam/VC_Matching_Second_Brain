# How the JHTV Second Brain Works — and How to Make It Better

*A complete walkthrough of the VC↔technology matching tool, structured along its real
workflow. Each stage explains **(A) how it works today** and **(B) 🔧 where outside help or
data would improve it** — so this doubles as an explainer and a roadmap.*

**Live tool:** `https://ckannam.github.io/VC_Matching_Second_Brain/` *(currently offline —
see [Hosting note](#a-note-on-hosting))*
**Research backend:** `https://vc-matching-second-brain.onrender.com`

---

## What the tool does (in one sentence)

A JHTV staff member types a **VC firm name** and gets back the **top JHTV technologies** that
firm is most likely to fund — with a fit score, warm-intro connections through JHU alumni, and
a downloadable one-pager. It also works in reverse: click any **technology** to see which VCs
best fit it.

## The architecture in one picture

```
   ┌────────────────────────────────────────────────────────────────┐
   │  BROWSER (index.html + style.css)                              │
   │  • loads the 4 JSON files                                      │
   │  • runs ALL matching/scoring in JavaScript, client-side       │
   │  • renders results, JHU connections, grant screen             │
   └───────────────▲────────────────────────────┬──────────────────┘
                   │ fetch() 4 files             │ (only when researching
                   │                             │  an UNKNOWN VC)
   ┌───────────────┴──────────────┐   ┌──────────▼──────────────────┐
   │  DATA — data/*.json  (git)   │   │  BACKEND — server.js (Render)│
   │  the "database"              │   │  Claude + web search →       │
   │  vcs / technologies /        │◄──┤  commits a new VC into       │
   │  jhu_connections / relations │   │  vcs.json via the GitHub API │
   └──────────────────────────────┘   └─────────────────────────────┘
```

The key mental model: **this is a static website, and the JSON files are the database.** There
is no live server database. When you open the page, the browser downloads all the data and does
every calculation itself. The Render backend is *optional* — it only wakes up when someone
researches a VC the tool has never seen.

### Why the data lives in JSON files (not a database)

This is a deliberate, defensible choice for *this* tool:

- **The dataset is tiny and read-mostly.** ~74 technologies, ~28 VCs, 827 people — a few hundred
  kilobytes. Staff look things up; they don't write to it live. A real database (Postgres, etc.)
  would be complexity and cost we don't need.
- **Free hosting.** GitHub Pages serves static files for free. No server to run or pay for.
- **Git gives version history for free.** Every data change is a commit — full history, diffs,
  blame, one-click rollback, and pull-request review. A database gives none of that without extra
  tooling.
- **Human-readable and directly editable.** Anyone can open `technologies.json`, read it, and
  correct a typo. Diffs in review are meaningful.
- **Atomic deploys.** Code and data ship together in one `git push`; no separate migration step.

The honest tradeoff: JSON-in-git is wrong for *large* data, *frequent* writes, or *many*
simultaneous editors. None of those apply here. The single exception is the "write" path — a
static site can't write to itself, which is exactly why the backend exists (it commits a
researched VC through the GitHub API).

---

# The 5-stage workflow

**Acquire → Store → Make Live → Score → Return**

---

## Stage 1 — ACQUIRE (where the data comes from)

Each of the four datasets has its own pipeline.

### Technologies (`data/technologies.json`, 74 entries)
Source of truth: the Word one-pagers in `one-pagers/Tech One Pagers/*.docx`.
1. `scripts/populate_technologies.js` reads the filenames and creates stub entries
   (`id`, `name`, `onePager`; empty `sectors/stage/pi/description`).
2. A human sets `sectors[]` (which of the 8 domains the tech belongs to) by hand.
3. `scripts/enrich_tech_data.js` opens each `.docx` (via the `mammoth` library), sends the text
   to **Claude Haiku**, and extracts `stage`, `pi` (principal investigator), and `description`.

### VCs (`data/vcs.json`, ~28 entries) — two sources
- **Curated (12):** hand-made PDF one-pagers in `one-pagers/VC One Pagers/…`.
  `scripts/populate_vcs.js` (uses Python `pdfminer`) reads the **"JHTV PORTFOLIO MATCHES"**
  section from each PDF and records those techs in `matchedTechs[]`. These are human-vetted.
- **Provisional (16):** auto-researched. The backend calls `researchVC()` in
  `scripts/generate_vc.js`, which runs **Claude Opus + web search** to produce a structured
  profile (`investmentFocus`, `stages`, `checkSize`, `geographicFocus`, `thesis`), scores all 74
  techs, and stores the top 4. Flagged `provisional: true`.

### JHU connections (`data/jhu_connections.json`, 827 people / 736 firms)
Source of truth: `JHU_VC_Network.xlsx` (originally from PitchBook). `scripts/convert_jhu_connections.js`
reads the "JHU VC Network" sheet, drops header rows (empty Firm column), and writes 5 fields per
person: `name, firm, connection, role, entityType`.
*(A plan to auto-sync this from Excel is documented but deferred — the file now lives in
SharePoint, but a headless job can't fetch it without Microsoft authentication. See `CLAUDE.md`.)*

### JHTV relationships (`data/jhtv_relationships.json`, currently empty)
Hand-edited: `[{ firm, tier?, note? }]` — the firms JHTV actually works with, tiered.

### 🔧 Where help plugs in at ACQUIRE

| Opportunity | What it needs | Payoff |
|---|---|---|
| **Richer, real VC profiles** | **PitchBook** data (Stew's Bloomberg/PitchBook seat) — stage distribution, deal sizes, recent investments, fund vintage | Replaces shaky web-research guesses with real behavior; unlocks the rubric upgrades in Stage 4 |
| **Fill the relationships list** | Export of JHTV/JHU co-investment history (Bloomberg terminal) | Populates `jhtv_relationships.json` so JHTV's real partners surface first |
| **Better tech tagging** | A standard taxonomy (see [taxonomy](#the-8-bucket-question)) | Kills the lossy hand-mapping step used in scoring |

---

## Stage 2 — STORE (the JSON "database")

Four files in `data/`:

| File | Records | Shape (key fields) |
|---|---|---|
| `technologies.json` | 74 | `id, name, sectors[], stage, pi, description, onePager` |
| `vcs.json` | ~28 | `id, name, aliases[], focus, sectors[], stage[], checkSize{min,max}, geographicFocus, matchedTechs[], vcOnePager, provisional` |
| `jhu_connections.json` | 827 | `name, firm, connection, role, entityType` |
| `jhtv_relationships.json` | 0 | `firm, tier?, note?` |

**Curated vs. provisional VCs** is the crucial distinction: curated entries have a real
`vcOnePager` PDF and human-picked `matchedTechs`; provisional ones are `provisional: true` with
algorithm-picked matches and no PDF.

### 🔧 Where help plugs in at STORE
- Add fields for incoming PitchBook data (e.g. `stageDistribution`, `dealSizeByStage`,
  `fundVintage`, `recentDeals`) — the schema is just JSON, so this is additive and low-risk.
- `jhtv_relationships.json` is empty and needs the Bloomberg-sourced relationship list.

---

## Stage 3 — MAKE LIVE (how data becomes the running app)

Everything happens in `index.html` (one file, inline `<script>`, no build step):

1. **`loadData()`** (`index.html:87`) fetches all four JSON files in parallel into the globals
   `VCS`, `TECHS`, `JHU_CONNECTIONS`, `JHTV_RELATIONSHIPS`.
2. **`resolveRelationships()`** joins the relationship list to VCs by name.
3. **`buildSearchIndex()`** builds the typeahead index (firms, techs, people, domains).
4. **`dispatchRoute()`** reads the URL hash and renders the right view. Routes: `#/vc/<id>`,
   `#/tech/<id>`, `#/domain/<sector>`, `#/all`, `#/briefs`, home. Deep links and refresh work.

All matching runs **in the browser** — there is no server round-trip for normal use.

### 🔧 Where help plugs in at MAKE LIVE
Minimal — the rendering layer just needs to *consume* any new fields. The one worthwhile addition
is a **data-confidence indicator** so a provisional (web-researched) VC visibly reads as less
certain than a curated one.

---

## Stage 4 — SCORE (the rubric) ⭐

This is the heart of the tool, and the part most worth improving. The scorer lives in
`vcFitScore()` (`index.html:895`) and is **mirrored** in `scoreTech()`
(`scripts/generate_vc.js:124`) — the backend uses it to pick a new VC's top-4 techs, the browser
uses it to rank all VCs on a tech's page. **These two copies must stay in sync** (they have
already drifted slightly — see the audit below).

Every VC↔tech pair gets a **0–1 score** from a weighted sum of four parts:

```
score = 0.375·industry  +  0.30·stage  +  0.225·checkSize  +  0.10·geography
```

### The four components, as they work today

**1. Industry match — 37.5% (heaviest).** A lookup table `INDUSTRY_TO_DOMAIN` translates the VC's
focus words into JHTV's 8 domains (e.g. `"oncology"` → Diagnostics + Therapeutics). The score is
the **fraction of the tech's domains** that fall in the VC's set: `hits / techDomains.length`
(`index.html:906`). *Rationale: sector fit is the most fundamental gate — a climate fund is simply
wrong for a cancer drug.*

**2. Stage compatibility — 30%.** `techStageScore()` (`index.html:878`) checks whether any of the
VC's rounds (Seed/A/B/Growth) is compatible with the tech's maturity via a keyword map. Match =
**1.0**, no match = **0.2**. *Rationale: a growth fund won't touch a pre-clinical NewCo.*

**3. Check size — 22.5%.** Each domain is tagged "early" or "mid" maturity; the VC's check range
must fit a hardcoded band (early → max ≤ $15M; mid → $1–50M), else **0.4** (`index.html:917`).

**4. Geography — 10% (lightest).** Mid-Atlantic/East Coast = 1.0 (Hopkins region), National/blank
= 0.8, West Coast/International = 0.4 (`index.html:912`). *Rationale: nice-to-have for warm intros,
not a dealbreaker.*

### 🔧 Where help plugs in at SCORE — concrete redesign specs

> Format: **NOW** (today's logic) → **NEW** (proposed) → **DATA NEEDED** → **CODE**.

#### 4.1 Industry — stop punishing multi-domain techs
- **NOW:** `industryScore = hits / techDomains.length`. A tech tagged in **2** domains where the
  VC matches only **1** scores **0.5** — even though it's a genuine fit on that axis. Being
  classified in more domains *lowers* the score. That's backwards.
- **NEW:** score on the tech's **primary domain / best match**, not the average. If the VC covers
  *any* of the tech's domains, that's a strong match; additional domains can only *add* signal,
  never subtract. Concretely: `industryScore = techDomains.some(d => matched.has(d)) ? 1.0 : 0`,
  optionally graded by how central the domain is. Later, weight by the VC's **actual sector
  allocation %** (what share of its deals are in that domain).
- **DATA NEEDED:** PitchBook per-firm sector breakdown (for the weighted version).
- **CODE:** `index.html:902–908` **and** the twin in `generate_vc.js:128–137`.

#### 4.2 Stage — weight by what the firm actually does
- **NOW:** binary 1.0 / 0.2.
- **NEW:** use the VC's **real stage distribution** — e.g. a firm that does 60% Seed, 30% A, 10% B
  scores a Seed-stage tech high and a Growth-stage tech low, on a smooth scale instead of a cliff.
  **Recency-weight** it so the firm's *current* focus dominates over historical deals.
- **DATA NEEDED:** PitchBook "% of deals by stage" + recent deal list per firm.
- **CODE:** replace the return in `techStageScore()` (`index.html:878–893`) + twin
  `generate_vc.js:90–106`.

#### 4.3 Check size — benchmark against real round sizes *(worst logic today)*
- **NOW:** crude hardcoded cutoffs ($15M / $1–50M) with a blunt 0.4 fallback that ignores the
  tech's stage entirely.
- **NEW:** build a **benchmark table of typical round size by (domain × stage)** from PitchBook
  (median + inter-quartile range). Then score by **interval overlap** between the VC's check range
  and the expected round size for *this* tech's domain+stage. A fund that writes $200M checks
  scores low for a $2M seed round, high for a $150M growth round — automatically and defensibly.
- **DATA NEEDED:** PitchBook deal-size percentiles segmented by sector and stage.
- **CODE:** replace the `checkSz` block (`index.html:917–922`) + twin `generate_vc.js:116–122`.

#### 4.4 Geography — fine for now
- Keep as-is. A future PitchBook signal (does the firm actually invest in this region / has it done
  deals near Baltimore) could refine it, but it's the lowest-weight factor and works.

### What the rubric is missing (independent audit)

These are gaps *beyond* the four components — worth raising with your boss:

1. **The weights have never been validated.** 37.5 / 30 / 22.5 / 10 are reasonable guesses, not
   derived from outcomes. **The single highest-value fix:** back-test against JHTV techs that
   *actually raised* from known VCs, and calibrate the weights to reproduce those real matches.
   That turns "these numbers feel right" into "these numbers are tuned to reality."
2. **No negative / disqualifying signals.** Wrong geography only softens to 0.4; nothing ever
   disqualifies a firm. All-positive scoring inflates weak matches.
3. **No dry-powder / fund-cycle signal.** A firm that just closed a fund is actively deploying; one
   at the end of its fund won't write new checks. PitchBook fund-vintage data would capture this.
4. **No "does this VC do university spin-outs" factor** — probably the *strongest real predictor*
   for JHTV specifically, and currently absent.
5. **No lead-vs-participant distinction**, and **no portfolio-conflict check** (already backed a
   direct competitor).
6. **No penalty for over-generic VCs** that match nearly everything (a firm matching all 74 techs
   is not really a signal).
7. **Provisional VCs are scored on shaky web data but ranked beside curated ones** — no confidence
   weighting.
8. **The two scoring copies have already drifted** — the catch-all case returns a flat `0.5` in
   `generate_vc.js` but `max(fraction, 0.5)` in `index.html`. This should become a **single source
   of truth** to prevent silent divergence.

### The 8-bucket question

The 8 domains (Therapeutics, Diagnostics, Medical Devices, Digital Health, Research Technologies,
Clean Tech, Agricultural Tech, Cybersecurity) came from a single JHTV document. Two real problems:
- **Uneven granularity** — "Therapeutics" is enormous; "Cybersecurity" is narrow.
- **They're used as a *lossy translation layer*.** VC language is hand-mapped into them through the
  `INDUSTRY_TO_DOMAIN` keyword table, and techs are squeezed into 1–2 buckets. Nuance is lost on
  both sides, and the table is maintained by hand.

**Options:**
- **(Recommended)** Adopt a **shared standard taxonomy** (e.g. PitchBook verticals/keywords) for
  *both* techs and VCs. Matching then happens apples-to-apples and the entire hand-built
  translation table disappears.
- A **two-level system**: keep the 8 broad domains for display, add a richer tag layer underneath
  for matching.
- **Empirically derive** buckets from the actual tech corpus rather than one document.

---

## Stage 5 — RETURN (how results reach the user)

`findVCsForTech()` (`index.html:941`) ranks the VCs and the UI presents them:

- **Tiers** (`fitTier`, `index.html:931`): **Strong ≥ 0.80**, **Good ≥ 0.60**, **Possible**
  otherwise. Anything below **0.45** is dropped — *unless* it's a curated brief match.
- **Human override:** a VC with a real PDF one-pager whose `matchedTechs` include this tech gets a
  gold **"In VC brief"** badge and a **+0.1 sort bonus**, so human-vetted picks float to the top.
  Where a person made a real judgment, that judgment wins over the algorithm.
- **JHU connection pills** — warm intros surfaced by fuzzy-matching the firm name against the 827
  alumni.
- **Preliminary grant screen** — pulls the Grant Finder engine and deep-links prefilled.
- **One-pager download** — the source PDF/docx.

### 🔧 Where help plugs in at RETURN
- **"Why matched" explanations** — show *which* factor drove the score, so staff trust it.
- **Confidence badges** — visually separate curated from provisional matches.

---

## Where assistance plugs in — summary (the ask)

| What I need | Workflow stage | Source | What it unlocks |
|---|---|---|---|
| VC stage %, deal sizes, recent deals, fund vintage | Acquire → Score | **PitchBook** (Stew's seat, Commercialization Academy) | Real stage-weighting (4.2), check-size benchmarks (4.3), dry-powder & recency signals |
| JHTV/JHU co-investment history, tiered | Acquire → Store | **Bloomberg terminal** (Stew's seat) | Fills `jhtv_relationships.json`; real partners surface first |
| Standard vertical taxonomy | Acquire → Score | PitchBook verticals | Removes the lossy `INDUSTRY_TO_DOMAIN` layer; fixes multi-domain scoring |
| Historical raise outcomes (which techs raised from whom) | Score | JHTV records + PitchBook | **Validates and calibrates the weights** — the biggest credibility win |

---

## Appendix — file & function reference

| Concern | File · function |
|---|---|
| Config (backend URL) | `index.html:78` `RESEARCH_SERVER` |
| Load all data | `index.html:87` `loadData()` |
| Routing | `index.html` `dispatchRoute()` |
| Typeahead index | `index.html` `buildSearchIndex()` |
| **Scoring (browser)** | `index.html:895` `vcFitScore()`, `:878` `techStageScore()`, `:931` `fitTier()`, `:941` `findVCsForTech()` |
| **Scoring (backend twin)** | `scripts/generate_vc.js:124` `scoreTech()` |
| Industry table | `INDUSTRY_TO_DOMAIN` in both `index.html` and `generate_vc.js:17` |
| VC research (Claude + web) | `scripts/generate_vc.js:149` `researchVC()`, `:218` `buildEntry()` |
| Tech import from filenames | `scripts/populate_technologies.js` |
| Tech enrichment (Claude Haiku) | `scripts/enrich_tech_data.js` |
| VC import from PDFs | `scripts/populate_vcs.js` |
| JHU xlsx → json | `scripts/convert_jhu_connections.js` |
| Backend endpoints | `server.js` — `POST /api/research-vc`, `GET /api/job/:jobId` |

## A note on hosting

The live site currently returns **404** because the repository was switched to private, which
unpublishes GitHub Pages on a free plan. To restore it: make the repo public again, upgrade to
GitHub Pro, or move hosting to Netlify/Vercel (which serve private repos free). This is an open
decision, independent of everything above.
