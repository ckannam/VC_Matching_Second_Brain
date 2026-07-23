# Raw scores + de-saturation + recency tiebreaker + up-to-6 (design)

**Date:** 2026-07-22
**Status:** Approved design → implementation plan next.

## Context / why

Rubric v2 (`Fit = 0.55·Portfolio + 0.30·StageCheck + 0.15·Sector`) saturates for broad,
portfolio-heavy firms: many technologies land on the exact same score, so the top-4 is decided by an
alphabetical tie-break rather than genuine fit. Measured on the live tool (`vc_portfolios.json`):

- **2048 Ventures — 21 techs tied at 1.000**
- **Frazier Life Sciences — 23 techs tied at 0.910**
- (Felicis, NEA, Lux, 8VC spread out cleanly.)

Root cause: `portfolioFit` aggregates per-company credit as `min(1, credit / PORTFOLIO_K)` (K=6) — a
hard clamp, so once a firm has ≥6 matching companies every such tech pins to 1.0. Two more gaps: the
UI shows only tiers (no raw score), and the VC→tech cards show no score at all. Recency data (deal
dates) now exists for exactly the 12 curated firms that saturate.

This change (1) de-saturates the portfolio score so depth differentiates, (2) adds a recency +
uncapped-depth tiebreaker for residual ties, (3) shows up to 6 techs when >4 are genuinely
indistinguishable, and (4) surfaces the raw decimal score.

## Locked decisions

1. **Both:** de-saturate the portfolio score at the source AND keep a tiebreaker + up-to-6 backstop.
2. **Tiebreak signal:** recency + uncapped depth.
3. **Up-to-6:** extend to at most 6 only when the tiebreaker still can't separate the top cluster;
   render that run as a labeled "equally strong — not rank-ordered" group. Otherwise show 4.
4. **Score display:** decimal beside the tier — e.g. `Strong fit · 0.93` — in both directions.
5. Weights (0.55/0.30/0.15), StageCheck, and Sector are **unchanged**; only the portfolio
   aggregation + tie-break change.

## Components

### 1. De-saturate `portfolioFit` (`scoring.js`)

Replace the hard cap with a smooth, monotonic-in-depth saturating curve so more/closer matching
portfolio companies always yield a measurably higher score, asymptotically approaching (never
clamping at) 1.0.

- Keep per-company credit as today: shared domain + same stage-rung → 1.0 · adjacent rung → 0.75 ·
  shared domain w/ unknown/distant stage → 0.5 · no shared domain → 0. Aggregate to
  `credit = Σ per-company weight` (unchanged).
- Replace `score = min(1, credit / PORTFOLIO_K)` with a smooth curve, e.g.
  `score = 1 - Math.exp(-credit / K_SAT)` (or an equivalent concave, monotonic, asymptote-to-1
  function). Choose `K_SAT` so the tier distribution stays sane against real data (see Tuning).
- Return the **uncapped `credit`** (call it `depth`) alongside `score` and `hits`, for the tiebreak.

**Tuning (implementation step, not a guess):** pick `K_SAT` by running all 12 curated firms and
eyeballing that (a) genuine deep/pure-play firms still reach Strong (≥0.80), (b) 2048's and Frazier's
ceiling clusters visibly spread, (c) rankings don't churn wholesale for the already-clean firms. This
mirrors how `PORTFOLIO_K`/`STATED_MAX` were originally tuned. Present a before/after table for review.

### 2. Recency data (`scripts/build_vc_recency.js` → `data/vc_recency.json`)

New offline script (reuses the baseline's `PB_INDUSTRY_TO_DOMAIN` + `data/source/vc_deals.json`).
For each firm with deal data, compute a **per-JHTV-domain recency weight** from its deal dates:
`recency(vc, domain) = decay(mostRecentDealDate in that domain)`, where `decay` maps a recent deal
(≤1 yr) → 1.0 down to a floor (e.g. 0.5) for old/absent activity (linear over ~6 yr). Output:

```json
{ "generatedAt", "note", "byVc": { "<vcId>": { "<domain>": <0.5..1.0>, … }, … } }
```

npm script `"build-vc-recency"`. Domain-level (not company-level) recency avoids fragile name
matching between the scraped `vc_portfolios.json` companies and the PitchBook deal list.

### 3. Tiebreaker + up-to-6 (`scoring.js` + `index.html`)

- `index.html` `loadData()` fail-soft-fetches `data/vc_recency.json` → `RECENCY_BY_VC` (Map
  vcId→{domain→weight}); missing file ⇒ neutral (all weights 1.0), no behavior change.
- **Tiebreak key** for a (vc, tech) pair: `tieKey = depth · recencyForTechDomains`, where
  `recencyForTechDomains` = max recency weight across the tech's `sectors` for that VC (1.0 if no
  recency data). Higher `tieKey` ranks first. This is ordering-only — it never changes `score`/tier.
- **Ranking** (`topTechsForVC` and `findVCsForTech`): sort by `score` desc, then `tieKey` desc, then
  name. Return `{ tech/vc, score, tier, tieKey }` (thread the score through — `topTechsForVC`
  currently drops it).
- **Up-to-6 selection** (shared helper, e.g. `selectWithTies(ranked, base=4, max=6, eps)`): take the
  top `base`; while `< max` and the next item is indistinguishable from the last shown (|Δscore| < eps
  **and** |ΔtieKey| < eps), include it. Mark the trailing indistinguishable run as `tied: true`. If
  the tiebreaker separates cleanly by item 4, the result is exactly 4.

### 4. Display (`index.html` + `style.css`)

- **Decimal score:** render `score.toFixed(2)` beside the tier — tech→VC list badge becomes
  `${tier.label} · ${score.toFixed(2)}`; VC→tech cards gain a small score line (thread `score`
  through `topTechsForVC` → `foundHTML`/`techCardHTML`). One-line disclaimer near the list that
  scores are model outputs, not probabilities (stated-only caps at 0.75).
- **Tied group:** when `selectWithTies` returns a `tied` run, render those items under a subtle
  divider/label "Equally strong — not rank-ordered" (a `.tied-group` style). Non-tied items render
  as today.

## Testing

- `test/scoring.test.js`: update portfolio-credit cases for the smooth curve (monotonic in depth,
  asymptote < 1, deeper portfolio → strictly higher score); assert weights/tiers thresholds
  unchanged; assert `portfolioFit` returns `depth`.
- New `test/tiebreak.test.js` (or extend scoring.test): `tieKey` orders equal-score items by
  depth×recency; `selectWithTies` returns 4 when separable, extends to ≤6 and flags `tied` when not.
- `test/build_vc_recency.test.js`: recency weights in [floor,1.0], recent domain > old domain, all 12
  firms present.
- Browser verification: 2048 and Frazier no longer show a flat 1.0 / 0.91 block; scores render as
  decimals in both directions; a genuine tie shows the "equally strong" group; clean firms (NEA,
  Felicis) unchanged in shape; no console errors.

## Conventions

- `scoring.js` stays a dual classic-script + `module.exports` module; recency is passed in (like
  `portfolioCompanies`), not fetched inside the scorer, so tests stay pure.
- New fetch fail-soft (missing `vc_recency.json` ⇒ neutral recency, no visible change).
- Regeneration: edit deal source → `npm run build-vc-recency` → commit. Document in `CLAUDE.md`
  (Scoring + Data files sections), and note the de-saturation supersedes the `PORTFOLIO_K` hard-cap
  description.

## Deferred / out of scope

- Switching the live scoring basis from scraped `vc_portfolios.json` to deals-derived portfolios
  (keep the hand-classified portfolios; recency stays a domain-level side signal).
- Company-level (vs domain-level) recency.
- Re-tuning `STATED_MAX` or the stage/sector components.

## Verification

- `npm run build-vc-recency` writes `data/vc_recency.json` (12 firms).
- `node test/scoring.test.js && node test/tiebreak.test.js && node test/build_vc_recency.test.js`
  pass; existing suites stay green.
- `npx serve .` → 2048 / Frazier top lists spread apart with decimal scores; an indistinguishable
  cluster renders as the "equally strong" group of up to 6; no console errors.
