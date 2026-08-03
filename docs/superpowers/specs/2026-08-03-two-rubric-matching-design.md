# Two-Rubric Matching + Deal-Data Pipeline — Design

**Date:** 2026-08-03
**Status:** Approved (design), pending implementation plan

## Problem / context

We manually acquired ~3 years of PitchBook deal history for ~50 important firms that
have backed JHTV/Hopkins companies (the `jhtv_investors.json` backers), cataloged as
`vc json deal histories/by_firm/*.json` (46 backer firms across two channels + the 12
curated PDF firms already in `data/source/vc_deals.json`). Deal history lets us run the
**portfolio-led v2 rubric** on these firms (revealed behavior). Firms **without** deal
data (auto-researched / preliminary firms) have only a stated profile, so they must fall
back to the **old v1 four-dimension rubric**.

There is **no PitchBook API** — deal data is hand-acquired — so this two-rubric split is
the durable interim design: strong (deal-verified) matching where we invested the manual
effort, preliminary (stated) matching everywhere else. The v1 rubric will be revised in a
later pass; for now it is ported faithfully.

## Guiding principles

- **Per-firm dispatch, no score-blending.** Each firm is scored by whichever rubric its
  data supports and presents *that* rubric's findings. There is no attempt to reconcile
  v1 and v2 scores into one comparable scale. A tech's VC list simply ranks each firm by
  its own applicable rubric's score.
- **Deal data present → v2. Absent → v1.** Data availability, not firm type, decides.
- **Rerunnable.** Adding new *technologies* later must re-find best matches with no manual
  rework. Matching is client-side over the tech set, so it already recomputes. The
  deals→derived-data step is a committed script, rerun only when *deal data* changes.
- **Leave the validated pilot alone.** The 12 curated firms keep their hand-classified
  portfolios (higher quality than auto-derived); the derivation script skips any firm
  already hand-classified.

## Architecture

### 1. Rubric dispatch (`scoring.js`)

Add one entry point, the single place the choice is made:

```
scoreVC(vc, tech, portfolio)
  portfolio present  → vcFitScore(vc, tech, portfolio)   // v2, unchanged
  no portfolio       → vcFitScoreV1(vc, tech)            // v1, ported
```

- **Port v1 into `scoring.js`** as `vcFitScoreV1(vc, tech)`: the genuine four-dimension
  formula from `scripts/generate_v1_baseline.js`
  (`Fit = 0.375·Industry + 0.30·Stage + 0.225·Check + 0.10·Geography`,
  `V1_WEIGHTS`, the FROZEN `INDUSTRY_TO_DOMAIN` table, and the industry/stage/check/geo
  sub-scorers). Reintroduces geography (v2 dropped it). Returns the same shape v2 returns
  (`{ score, basis:'v1', … }`) so consumers are rubric-agnostic.
- The current **degraded-v2 'stated' path is retired** — `no portfolio` now routes to v1
  instead of the `STATED_MAX`-capped stated path.
- Both consumers call `scoreVC`, not `vcFitScore` directly:
  - `index.html` `topTechsForVC` (line ~826) and `findVCsForTech` (line ~1200)
  - `scripts/generate_vc.js` (new researched firms → no portfolio → v1)
- `basis` on the result (`'full'`/`'portfolio'` = v2, `'v1'`) lets the UI label
  confidence if desired later, but no UI split is required.

### 2. Deal data → committed + derived (`scripts/build_deal_derived.js`, new)

**Source of truth (committed):** all deal-data firms' deals live in
`data/source/vc_deals.json`. It already holds the 12 curated (799 deals); extend it to
also contain the 46 backers (merge from the gitignored `by_firm/*.json` staging files).
`by_firm/` remains the local staging area.

**Derivation script** reads `data/source/vc_deals.json` and, for each deal-data firm
**not already hand-classified**, emits:

- **Derived portfolio** → merged into `data/vc_portfolios.json` (keyed by `vcId`):
  companies with `domains[]` (via the existing `PB_INDUSTRY_TO_DOMAIN` label map) and
  round `stage` (via `dealTypeToStage`). Out-of-scope PitchBook labels → `[]`.
- **Stage focus** → `vcs.json` `stage[]` via `deriveStageFocus` (VC stages ≥10% of
  rounds). Stage mapping honors the standing rules baked into the catalog: Early Stage
  VC→Series A, Later Stage VC→Series B, Angel/Accelerator/Incubator→Seed.
- **Recency** → `data/vc_recency.json` via the existing `build_vc_recency` logic
  (ordering-only tiebreak).
- **Last-10** → `data/vc_recent_deals.json` (new): `{ vcId: { dealCount, deals: [{ date,
  company, sector, round, sizeMusd }] } }` — the 10 most recent deals as captured in this
  upload (top of the firm's file, newest-first). `sector` = derived JHTV domain(s) or the
  PitchBook industry label when out-of-scope; `round` = the resolved stage string.

**Rerun contract:** run this script only when deal data changes (new firm / refreshed
deals). Adding **techs** requires **no** re-derivation — the browser recomputes matches
over `TECHS` at load. Guarded by a test.

### 3. Firm entries (`vcs.json`)

Add entries for the 46 backer firms (id, `name`, `aliases` sourced from the backer
records / firm labels used during cataloging). They are **not** `provisional`,
`vcOnePager: null`. `sectors`/`stage`/`checkSize` are populated by the derivation where
available. A firm-name→`vcId` map (mirroring `DEALS_FIRM_TO_VCID`) drives the
deals→entry join and lives with the derivation script.

### 4. Last-10 UI (`renderVc` in `index.html`)

A **collapsed** "Recent activity" block on the VC page, shown **only for deal-data
firms** (present in `vc_recent_deals.json`). Branding: navy `#003B6F` subhead, gold
`#C8973A` accent, gray detail text — consistent with the app. Compact table, one line per
deal:

```
Recent activity ▾
  Jul 2026   Claris Bio          Drug Discovery   Series B   $118M
  … up to 10 rows …
```

Columns: **date (Mon YYYY) · company · sector · round · size** (size omitted gracefully
when null). Collapsed by default so it is available but not distracting.

- **Low-coverage caveat:** when `dealCount < 10`, show a subtle line
  "Based on N deals — all PitchBook logged." No score down-weighting (display only) for
  now. Applies to Blackbird (3), Blue Jay (5), Barer & Son (5), Piedmont (8), etc.
- Stale firms (all deals old) are not specially styled beyond the visible dates.

## Data flow

```
by_firm/*.json (gitignored staging)
    └─(merge)→ data/source/vc_deals.json (committed, all deal-data firms)
                    └─ scripts/build_deal_derived.js ─┬→ data/vc_portfolios.json (46 derived, 12 hand kept)
                                                       ├→ vcs.json (stage[], entries)
                                                       ├→ data/vc_recency.json
                                                       └→ data/vc_recent_deals.json (last-10 + dealCount)

Browser load (index.html):
    PORTFOLIO_BY_VC ← vc_portfolios.json
    scoreVC(vc, tech, PORTFOLIO_BY_VC.get(id))  → v2 if portfolio else v1
    renderVc → Recent activity block ← vc_recent_deals.json
```

## Testing

- `test/scoring.test.js`: `scoreVC` dispatch (portfolio→v2, none→v1); `vcFitScoreV1`
  ported-formula parity against `generate_v1_baseline.js` on a fixture firm.
- New `test/build_deal_derived.test.js`: deals→portfolio domain/stage mapping, stage-focus
  derivation, last-10 selection (newest 10, correct fields), `dealCount`.
- Rerun guarantee: adding a tech changes matches without re-deriving deal data (assert the
  derived files are tech-independent).
- Never-mix guarantee: a firm with a portfolio never scores via v1 and vice-versa.

## Out of scope / deferred

- Revising the v1 formula (explicitly a later pass — ported faithfully for now).
- Re-deriving the 12 curated firms from deals (kept hand-classified).
- Score down-weighting for low-coverage/stale firms (display caveat only).
- Full-3yr backfill for the partial firms (Catalio, Osage, Jump Start Foundry) — data
  task, not a code dependency.

## Open items

- Exact `vcs.json` alias set per backer firm (resolve during implementation from the
  backer records already grepped during cataloging).
- Whether `data/source/vc_deals.json` stays one file or splits curated vs backers
  (default: one file, `firm` field distinguishes).
