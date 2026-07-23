# JHTV backers — revealed co-investment layer (design)

**Date:** 2026-07-22
**Status:** Approved design → implementation plan next.

## Context / why

We now have the full catalog of firms that have **actually written checks into JHTV/Hopkins
companies** — 626 deals, 312 investors, 99 companies, 2006–2026, grouped by investor. This is
*revealed co-investment history*: the strongest relationship signal we have (revealed > stated —
the same philosophy behind rubric v2's portfolio-led scoring). It becomes a new first-class
relationship layer in the Second Brain, distinct from:

- `jhu_connections.json` — warm-intro paths (JHU alums at firms), and
- `jhtv_relationships.json` — hand-edited/stated JHTV partner firms (currently empty `[]`).

Since `jhtv_relationships.json` is empty, `jhtv_investors.json` becomes the live relationships layer.
`jhtv_relationships.json` stays intact as an optional manual-supplement layer (both can render;
revealed-investor data is primary).

## Locked decisions

1. **Investor type:** surface only `type ∈ {venture, angel}` (299 firms). `foundation` (5) and
   `public` (8) stay in the JSON but are filtered out of **all** UI behind the type flag (deferred
   later pass — see Deferred).
2. **Relationships layering:** `jhtv_investors.json` is primary; `jhtv_relationships.json` kept as
   optional supplement. Do not delete it.
3. **Name matching:** join `investor` names to `vcs.json` via the existing `vcMatchingName()`
   (same matcher as the JHU sheet: `"New Enterprise Associates, inc."` → NEA, etc.).
4. **Case-a pin (tech→firm):** a firm that funded THIS exact tech is pinned to the top **even if it
   isn't in `vcs.json`** — rendered as a non-scored pinned row with a "research this firm" action.
5. **Sort bonus:** case-a exact-tech investors pin to the absolute top (companyCount order). Case-b
   "is a JHTV backer" adds **+0.1, capped** — it does **not** stack with the in-brief +0.1 (a firm on
   both signals gets +0.1 total, not +0.2).
6. **Browse scope:** the new "JHTV backers" page lists **all 299** venture/angel backers; resolved
   firms link to their VC page, unresolved render as plain rows.
7. **Badge color:** JHTV-backer badge is a **distinct emerald/teal** — not gold (that's
   "In VC brief") and not navy (that's `rel-badge`).

## Data shape — `data/jhtv_investors.json`

```json
{
  "meta": { "generatedAt", "source", "note",
            "counts": { "venture", "angel", "foundation", "public" } },
  "investors": [
    {
      "investor": "New Enterprise Associates, inc.",
      "type": "venture",
      "companiesBacked": ["Redox", "..."],
      "companyCount": 6,
      "dealCount": 11,
      "totalInvested": 506000000,
      "firstDate": "2009-11-10",
      "lastDate": "2022-11-28",
      "deals": [ { "company", "amount", "date", "series", "roundBucket" } ]
    }
  ]
}
```
Sorted by `companyCount` desc, then `dealCount` (revealed commitment).

## Build artifacts (commit as-is)

- `scripts/convert_jhtv_investors.js` — converter (already written/validated).
- `data/jhtv_investors.json` — its output (regenerable via the converter).
- `data/source/Venture_Funding_-_Grouped_By_Investor.xlsx` — source export.
- npm script `"convert-jhtv-investors": "node scripts/convert_jhtv_investors.js"`.

> **Implementation blocker:** these three files are not yet on disk. They must be provided (dropped
> into the repo) before implementation; the design/plan do not need them.

## Components

### 1. Load + resolve — `index.html` (mirror `resolveRelationships`)

- In `loadData()`, add a fail-soft fetch of `data/jhtv_investors.json` (pattern of
  `jhtv_relationships.json` at `index.html:100`) → `JHTV_INVESTORS`.
- **Filter to `type ∈ {venture, angel}` at load** — foundation/public never enter the UI.
- `resolveInvestors()` (mirrors `resolveRelationships`, `index.html:431`) →
  - `INVESTORS_BY_VC` — `Map(vcId → investor record)` via `vcMatchingName(inv.investor)`.
  - `UNMATCHED_INVESTORS` — investors with no `vcs.json` entry (list, used by the browse page and
    case-a pins).
  - Called right after `resolveRelationships()` in `loadData()`.
- **Company→backers index** for case-a: a Map from a normalized company key to the backer records
  that funded it, so a tech can be matched to backers whose `companiesBacked` includes it. Reuse /
  mirror the company→tech name normalization (lowercase, strip punctuation/suffixes) used elsewhere.
- Guard: because filtering happens at load, foundation/public can never appear in `INVESTORS_BY_VC`,
  `UNMATCHED_INVESTORS`, or the company→backers index.

### 2. VC page — "JHTV backer" badge

- New badge class `.backer-badge` (emerald/teal, e.g. `#0E9F6E`), reading **"JHTV backer · N
  companies"** (`N = companyCount`).
- Detail line under it: companies backed (cap ~6 + "show more" if longer), `totalInvested`
  formatted `$XM`, and "last check {year}" (`lastDate`).
- Renders alongside any existing `rel-badge` (revealed-investor first/primary). Placed with the
  existing relationship badge block near `index.html:755`.

### 3. Browse page — new top-level "JHTV backers"

- Nav button "JHTV backers" (peer to Catalog / Saved briefs / Grant checker, `index.html:24`),
  public `showBackers()` sets `location.hash = '#/backers'`; `renderBackers()` dispatched from the
  hashchange router (same convention as `showDomainBrowse`/`renderDomainBrowse`).
- Ranked list of **all 299** venture/angel backers by `companyCount` desc then `dealCount`.
  Resolved firms → link to `#/vc/<id>`; unresolved → plain row + optional "research this firm"
  action (mirrors the unmatched-relationship chips at `index.html:1015`).
- Each row: name, `companyCount`, `dealCount`, `totalInvested` (`$XM`), date range
  (`firstDate`–`lastDate` years), truncated companies-backed list.

### 4. Tech → firm — `findVCsForTech` (scoring.js weights unchanged)

Layer signals on top of `vcFitScore` via the existing `sortScore` mechanism (the in-brief +0.1
bonus, `index.html:871`):

- **Case (a) — already invested in this tech:** via the company→backers index, find backers whose
  `companiesBacked` matches the current tech (normalized name/aliases). **Pin all such firms to the
  absolute top**, companyCount order, with an **"Already invested in {tech}"** badge.
  - Profiled (in `vcs.json`) → normal pinned row (with fit/tier if it scores).
  - Unprofiled → pinned **non-scored** row with a "research this firm" action.
- **Case (b) — is a JHTV backer at all:** for VC rows that resolve via `INVESTORS_BY_VC`, add a
  **"has funded N JHTV companies"** pill and **+0.1 sort bonus, capped** so it does not stack with
  the in-brief +0.1 (relationship bonus is `max(inBrief?0.1:0, backer?0.1:0)`, not a sum). Case (b)
  must **not** manufacture a below-floor match — only case-a can add a firm below the 0.45 floor.
- **No regressions:** confirm `findVCsForTech` and `topTechsForVC` still score via
  `vcFitScore(vc, tech, PORTFOLIO_BY_VC.get(vc.id))`, tiers render, and top-4 / show-more behavior
  is unchanged.

### 5. Tests (plain Node asserts, `exit(1)` on fail)

- `test/convert_jhtv_investors.test.js` — converter output counts (venture+angel = 299,
  foundation+public = 13) and well-formed records (required fields, sorted order).
- Name-matcher eval test (extend the JHU eval-marker harness or add a sibling):
  - **Resolve** (in `vcs.json`): NEA ← "New Enterprise Associates, inc.", Catalio ←
    "Catalio Capital Management, LP", Lux, Andreessen/a16z.
  - **Expected-unmatched** (not in `vcs.json`): OrbiMed, Third Rock, Osage, Camden land in
    `UNMATCHED_INVESTORS`. *(Corrects the original spec, which listed these as resolving — the
    join has no target for them until they're added to `vcs.json`.)*
- Guard test: no `foundation`/`public` investor ever appears in the resolved `INVESTORS_BY_VC`.

### 6. Conventions

- Classic-script + `module.exports` guard anywhere shared with Node (converter, any helper the tests
  import).
- All new fetches fail-soft (empty/missing `jhtv_investors.json` ⇒ no visible change anywhere).
- Regeneration path: edit the xlsx in `data/source/` → `node scripts/convert_jhtv_investors.js`
  (`npm run convert-jhtv-investors`) → commit.
- `CLAUDE.md`: add a "JHTV backers (revealed co-investment)" subsection under **Data files** + the
  load/resolve note; add the two deferred items below to the **Deferred** table.

## Deferred (record in CLAUDE.md; do NOT build now)

1. **Public + foundation funding sources** (TEDCO, Maryland Venture Fund, Abell, BioHealth
   Innovation, Ben Franklin, NIH, Wellcome Trust, …) — surface as a separate non-dilutive/public
   category. Already tagged (`type: public|foundation`); a UI + categorization pass, not a re-parse.
2. **Domain-tag the 99 backed companies** so tech→firm matching can use *co-investment domain
   overlap* (a firm that funded JHTV companies in the same domain as this tech = strong warm
   prospect). Requires classifying the historical companies (only ~2 are current techs) into the 8
   JHTV domains. Unlocks a rubric signal beyond the exact-tech pin.
3. *(Candidate)* Add marquee unmatched backers (OrbiMed, Third Rock, Osage, Camden, …) to
   `vcs.json` so they resolve to VC pages instead of only appearing in the browse list.

## Verification

- `node scripts/convert_jhtv_investors.js` regenerates `data/jhtv_investors.json` with the expected
  counts.
- `node test/convert_jhtv_investors.test.js` + the name-matcher eval test + guard test all pass.
- `npx serve .` → a resolved backer's VC page shows the emerald "JHTV backer · N companies" badge +
  detail; `#/backers` lists all 299 ranked; a tech whose historical company matches a backer shows
  the pinned "Already invested in {tech}" row; other tech profiles show the "has funded N JHTV
  companies" pill on resolved backers with sensible re-ranking; no regression to top-4/show-more.
- No console errors; foundation/public firms never render anywhere.
