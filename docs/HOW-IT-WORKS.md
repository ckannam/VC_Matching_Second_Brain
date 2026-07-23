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

This is the heart of the tool. The scorer is a **single source of truth** in `scoring.js`
(`vcFitScore()`), loaded as a classic script by the browser (`index.html`) and `require`d by the
backend (`scripts/generate_vc.js`) — the backend uses it to pick a new VC's matched techs, the
browser uses it to rank all VCs on a tech's page. There is no longer a second, drifting copy.

**Rubric v2 (portfolio-led, boss-approved July 2026).** Every VC↔tech pair gets a **0–1 score**
from a weighted sum of three parts:

```
Fit = 0.55·Portfolio  +  0.30·StageCheck  +  0.15·Sector
```

The insight behind v2: **revealed behavior beats stated preference.** What a firm has actually
funded (its portfolio) matters far more than the sectors it lists on its website, so Portfolio
carries the majority weight. The exact blend depends on what data exists for the firm (`vcFitScore`
in `scoring.js`):

- **`full`** (stated profile + scraped portfolio) → `0.55·P + 0.30·SC + 0.15·Sec`.
- **`portfolio`** (portfolio, no usable stated profile) → `P` alone.
- **`stated`** (profile only, no scraped portfolio) → `(0.30·SC + 0.15·Sec) / 0.45`, **capped at
  `STATED_MAX = 0.75`** — a firm with no revealed portfolio evidence can never reach "Strong" (≥ 0.80).

### The three components

**1. Portfolio — 55% (heaviest).** `portfolioFit()` scores the VC's *actual* portfolio companies
(`data/vc_portfolios.json`) against the tech: each company earns credit for a **shared JHTV domain**
scaled by **stage-ladder proximity** (same rung 1.0 · adjacent 0.75 · shared domain but unknown/distant
stage 0.5 · no shared domain 0). The per-company credits sum, then pass through a **smooth
de-saturating curve `1 − exp(−credit / 3)`** (`PORTFOLIO_K = 3`). This replaced the old hard
`min(1, credit/K)` clamp that pinned deep portfolios to a flat 1.0 (e.g. 2048 had 21 techs tied at
1.0). The curve is monotonic in depth with an asymptote below 1, so a deeper/closer portfolio always
outscores a shallower one; it also returns the uncapped **`depth`** used for tie-breaking.

**2. Stage-check — 30%.** `stageCheck = 0.5·stage + 0.5·checkSize`. The stage half checks whether the
firm's rounds line up with the tech's maturity on the round ladder; the check-size half tests whether
the firm's typical check fits the expected round size for the tech's domain+stage.

**3. Sector — 15% (lightest).** The tech's domains are matched against the firm's sectors through the
**324-keyword venture taxonomy** (`taxonomy.js`), which crosswalks both sides to JHTV's 8 domains via
primary/secondary buckets. **Primary-bucket overlap = full credit (1.0), secondary-only = half (0.5)**,
no overlap = 0. This replaced the old hand-maintained `INDUSTRY_TO_DOMAIN` keyword table.

### Shipped since v1

The redesign specs the earlier draft proposed have largely landed:

- **Portfolio-led rubric** — real scraped portfolios (`data/vc_portfolios.json`) now drive the
  majority of the score for the 12 curated firms, replacing the old sector-guess-heavy blend.
- **Multi-domain techs no longer punished** — the old `hits / techDomains.length` fraction is gone;
  sector credit is now primary/secondary bucket overlap (1.0 / 0.5) via the venture taxonomy.
- **De-saturation** — the `1 − exp(−credit/3)` curve fixed the saturated ceiling where deep
  portfolios tied at a flat 1.0.
- **Recency tiebreak** — same-score matches are ordered by `tieKey = depth × domain recency`
  (`data/vc_recency.json`, derived from real deal dates); ordering-only, never changes the score.
- **Shared standard taxonomy** — the 324-keyword venture taxonomy (`taxonomy.js`) replaced the
  hand-maintained `INDUSTRY_TO_DOMAIN` table, so both techs and VCs map through one crosswalk.
- **Single source of truth** — the two drifting scorer copies were consolidated into `scoring.js`.

### Still open (worth raising with your boss)

1. **The weights have never been validated against outcomes.** 0.55 / 0.30 / 0.15 is a reasoned,
   boss-approved blend, not one back-tested against JHTV techs that *actually raised* from known VCs.
   Calibrating the weights to reproduce real matches remains the single highest-value fix.
2. **No dry-powder / fund-cycle, university-spin-out, lead-vs-participant, or portfolio-conflict
   signals** — all still absent.
3. **No penalty for over-generic VCs** that match nearly everything.
4. **Provisional (auto-researched) VCs lack scraped portfolios**, so they score on the `stated`
   basis (capped at 0.75) and are ranked beside portfolio-backed curated firms.

---

## Stage 5 — RETURN (how results reach the user)

`findVCsForTech()` (`index.html`) ranks the VCs and the UI presents them:

- **Tiers** (`fitTier`, `scoring.js`): **Strong ≥ 0.80**, **Good ≥ 0.60**, **Possible** otherwise.
  Anything below **0.45** is dropped — *unless* it's a curated brief match. The raw score renders as
  a **decimal beside the tier** (e.g. `Strong fit · 0.86`), so staff see the actual number.
- **Equally-strong ties** — `selectWithTies({ base: 4, max: 6 })` normally surfaces the top 4, but
  extends to as many as 6 when the trailing matches are genuinely indistinguishable (|Δscore| and
  |ΔtieKey| < 0.005). That cluster is labeled "equally strong — not rank-ordered" rather than
  implying a false ranking.
- **Human override:** a VC with a real PDF one-pager whose `matchedTechs` include this tech gets a
  gold **"In VC brief"** badge and a **+0.1 sort bonus**, so human-vetted picks float to the top.
- **JHTV backer badge** — a firm that has *actually funded* a JHTV/Hopkins company (from
  `data/jhtv_investors.json`) is flagged as a "JHTV backer"; on a tech it has already funded, it
  **pins to the top** with an "Already invested in {tech}" badge. See `#/backers` for the full list.
- **JHU connection pills** — warm intros surfaced by fuzzy-matching the firm name against the 827
  alumni.
- **Preliminary grant screen** — pulls the Grant Finder engine and deep-links prefilled.
- **One-pager download** — the source PDF/docx.

### Boss-facing curation — `#/curate`

A separate page (nav "Curate") lets a JHTV lead **pause/resume which technologies are eligible to
match** — a tech, a whole bucket, or a cohort at once. Paused techs drop out of every VC's matches
(`topTechsForVC` ranks over `activeTechs`) but still appear in the catalog with a muted "Paused"
badge. State is saved to `localStorage` immediately and best-effort committed to
`data/tech_status.json` via the backend, so choices persist across sessions and devices.

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
