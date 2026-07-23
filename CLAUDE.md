# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A GitHub Pages web app for JHTV staff. Type a VC firm name → get the top 4 matched JHTV technology one-pagers as downloads. Known VCs are matched from a curated database; unknown firms trigger in-browser auto-research via a Render backend.

- **Frontend:** `https://ckannam.github.io/VC_Matching_Second_Brain/` (static, no build step)
- **Backend:** `https://vc-matching-second-brain.onrender.com` (Express on Render free tier — spins down after 15 min, ~30s cold start)

## Running locally

`index.html` cannot be opened directly — `fetch()` fails on `file://` URLs:

```bash
npx serve .          # or: python3 -m http.server 8080
```

Start the backend locally for research features:

```bash
ANTHROPIC_API_KEY=sk-... GITHUB_TOKEN=ghp-... node server.js
```

## File paths (critical)

- **Tech one-pagers:** `one-pagers/Tech One Pagers/*.docx`
- **VC one-pagers:** `one-pagers/VC One Pagers/Completed One Pagers /` — **trailing space in folder name is real and must be preserved**
- **Fusion Fund** (`Fusion_Fund_OnePager.pdf`) is intentionally excluded from matching — its PDF lacks the "JHTV PORTFOLIO MATCHES" section. Keep `matchedTechs: []`.

## Architecture

**Frontend (`index.html` + `style.css`):** All search, matching, and rendering happen client-side. On load, `loadData()` fetches (in parallel, all fail-soft except the first two) `data/vcs.json`, `data/technologies.json`, `data/jhu_connections.json`, `data/jhtv_relationships.json`, and `data/vc_portfolios.json` → `VCS`, `TECHS`, `JHU_CONNECTIONS`, `JHTV_RELATIONSHIPS`, and the `PORTFOLIO_BY_VC` map.

**Routing (hash-based):** `#/` home · `#/domain/<sector>` · `#/all` · `#/briefs` · `#/grants` · `#/vc/<id>` · `#/tech/<id>`. Convention: public functions referenced from inline `onclick`s (`viewTech`, `viewDomain`, `viewAllTechs`, `showSavedBriefs`, `showDomainBrowse`, `showGrantChecker`) only set `location.hash`; the `hashchange` listener dispatches to `render*` counterparts (`renderTech`, `renderVc`, `renderDomain`, `renderAllTechs`, `renderSavedBriefs`, `renderGrantChecker`, `renderHome`). `loadData()` calls `dispatchRoute()` so deep links and refresh work. The fuzzy "did you mean" view renders directly and syncs the hash with `history.replaceState` (fires no hashchange).

**Search flow (`search()`):**
1. Exact substring match on `vc.name`/`vc.aliases` → route to `#/vc/<id>`
2. Tech name substring match → route to `#/tech/<id>`
3. Levenshtein fuzzy match on VC names (threshold: `max(2, floor(query.length × 0.4))`) → "Did you mean X?" banner with escape-hatch link to research the original query
4. No match → `notFoundHTML()` → "Research "X" as a new VC firm" button → `triggerResearch(vcName)`

**Typeahead:** `buildSearchIndex()` (after data load) indexes firms (name+aliases), technologies, unique people from `jhu_connections.json`, and the 8 domains. `querySuggestions()` ranks prefix > word-prefix > substring, ties by type (firm > technology > domain > person), max 8. Selecting a person resolves their sheet firm to a VC entry via the JHU name matcher (`goToFirm`); unresolved firms go straight to the research offer (deliberately skipping the whole-string fuzzy, which produces false "did you mean" hits on generic suffixes like "Capital Management"). Keyboard: ↓/↑/Enter/Esc.

**Auto-research flow (Phase 2B — live):**
- `triggerResearch()` POSTs to `/api/research-vc` → server returns `jobId` immediately
- Client polls `GET /api/job/:jobId` every 3s until `status === 'done'`
- Server runs Claude Opus + `web_search_20250305` in the background, commits result to `data/vcs.json` via GitHub API, returns the new VC entry
- `RESEARCH_SERVER` constant auto-selects local vs production based on `location.hostname`

**JHU connections (`findJHUConnections()` in `index.html`):** Every rendered VC (including provisional) is matched client-side against `data/jhu_connections.json` (JHU alums at VC firms, sourced from PitchBook). Matching compares `vc.name` + `vc.aliases` against firm names using: parenthetical variants (`"NEA (New Enterprise Associates)"` → 3 variants), whole-name containment (multi-token names only), typo-tolerant key-token coverage (edit distance 1 with transpositions, tokens ≥5 chars), and anchored single-token prefix ("Flagship" → "Flagship Pioneering" — primary names only, never one-word aliases like "Tiger"/"GC", token ≥4 chars). Cards show "Listed as: {firm}" when the sheet name differs from `vc.name`. Test harness pattern: extract the code between the `// ── JHU Connections ──` and `// ── Search ──` markers and `eval` it in node.

**JHU connections data:** source of truth is `/Users/colekannam/Documents/JHU VC DATABASE/JHU_VC_Network.xlsx` (sheet "JHU VC Network"; firm-header rows have an empty Firm column and are intentionally skipped). After editing the sheet, run `node scripts/convert_jhu_connections.js` to regenerate `data/jhu_connections.json`, then commit.

**JHTV relationships (`data/jhtv_relationships.json`):** firms JHTV works with, hand-edited by the team: `[{ "firm", "tier"?, "note"? }]`. `firm` is joined to `vcs.json` entries by the JHU name matcher (`vcMatchingName()`), so spelling variants/aliases resolve; `tier` is free text rendered verbatim as a navy badge (no enum); `note` shows as a detail line. Resolved once at load (`resolveRelationships()` → `REL_BY_VC`, `UNMATCHED_RELS`). Tech profiles split investor fit into "JHTV relationships" (all matched picks, on top; unmatched list firms appear as research chips) and "New prospects" (top-4 + show-more). VC pages show the badge under the header. Empty list = no visible change anywhere. Note: a relationship firm only appears on a tech's profile if it clears the normal fit floor (score ≥ 0.45 or brief match).

**Tech Funding Profile (`viewTech()` in `index.html`):** reverse view — click any tech name (cards, domain lists) to see its funding landscape. Two parts:
- *Investor fit (`findVCsForTech`):* one ranked list of all VCs scored by the shared `scoring.js` `vcFitScore(vc, tech, PORTFOLIO_BY_VC.get(vc.id))` (rubric **v2**, portfolio-led — see the Scoring section; no duplicated logic in `index.html`). Scores display as tiers, not percentages: ≥0.80 Strong · ≥0.60 Good · ≥0.45 Possible · below the 0.45 floor excluded. A VC is included when `fit.score ≥ 0.45` **OR** it's an "In VC brief" match (`vc.vcOnePager` set AND tech in `matchedTechs`) — the brief match gets a gold badge and a +0.1 sort bonus, so PDF-picked techs stay visible even when they score below the floor (a 0.00-scoring brief match still renders as "Possible fit" — a known display quirk). A VC with neither stated profile nor portfolio and no brief match returns `null` and is dropped. Top 4 rows render; the rest sit behind a "Show N more matches" toggle; each row shows a JHU-connection count pill and, when portfolio evidence exists, a "has N portfolio companies like this" detail line.
- *Preliminary grant screen:* `renderTechGrants()` runs the shared engine (`loadGrantEngine()`) with a `techToGrantInput()`-built input (`jhtv:'yes'`, `jhuSchool:'other_jhu'` are safe constants for portfolio techs; founder-specific fields stay blank), and lists likely-eligible grants. A **"Refine eligibility →"** button opens the embedded Grant Checker prefilled for that tech (`refineGrantsForTech()`); a secondary "Open in Grant Finder ↗" link still deep-links out.

**Grant integration — Second Brain side (`grant_checker.js` + `index.html`):** the eligibility *logic* is single-sourced in Grant Finder's `grant_engine.js`; Second Brain only holds the form UI and consumes the engine.
- `loadGrantEngine()` (in `index.html`) fetches `grant_engine.js` + `grants_live.json` from `GRANT_FINDER_URL` (`https://ckannam.github.io/jhtv-grant-finder` — same Pages origin) and `new Function`-evals it, returning `{ getGrants, applyLiveData }`.
- **CRITICAL GOTCHA:** the *deployed* `grant_engine.js` exports **only `getGrants`** — `applyLiveData` exists only in Grant Finder's *uncommitted* local working tree, never deployed. So `loadGrantEngine` guards it (`applyLiveData: null` when absent) and callers use `const apply = applyLiveData || overlayLive` — `overlayLive(grant, liveMap)` in `grant_checker.js` is the local deadline-overlay fallback. **Do not assume the engine exports anything beyond `getGrants`; do not couple to `applyLiveData`.**
- `grant_checker.js`: `GRANT_FIELDS` (declarative 17-field schema; ids must match `grant_engine.js` `collectData()` keys), `renderGrantCheckerForm()`, `collectGrantData()`, `runGrantCheck()` (browser); `emptyGrantData()`, `techToGrantPrefill()`, `overlayLive()` (pure, `module.exports`-guarded for Node tests). It's a classic (non-module) script loaded with `defer`, so its `function` decls are globally visible to `index.html`'s inline `onclick`s.
- The standalone **Grant checker** (`#/grants`, nav button) and the per-tech **Refine eligibility** both render the same questionnaire; `_grantPrefill` carries the per-tech prefill and is consumed once.

Cross-repo dependency: renaming/moving `grant_engine.js` or changing `getGrants()`'s signature/`d`-input keys in the Grant Finder repo breaks this (it fails soft with a link to the Grant Finder). `test/grant_checker.test.js` guards the schema↔engine contract by requiring the sibling `../Grant Finder/grant_engine.js`.

**Backend (`server.js`):** Express with in-memory job store (lost on restart). Two endpoints:
- `POST /api/research-vc` — fire-and-forget, returns `{ jobId }`
- `GET /api/job/:jobId` — returns `{ status: 'running'|'done'|'error', result?, error? }`

**Scoring (`scoring.js` — SINGLE source of truth):** the VC↔tech rubric lives in ONE module at repo root, consumed by BOTH the browser (`index.html` loads it via `<script defer>`) and the backend (`scripts/generate_vc.js` `require`s it). Classic-script + `module.exports` guard (same dual pattern as `grant_checker.js`). **Do not re-duplicate scoring logic in either consumer.**
- **Rubric v2 — portfolio-led (SHIPPED July 16, 2026).** `WEIGHTS = { portfolio: 0.55, stageCheck: 0.30, sector: 0.15 }` — **geography removed from scoring** (still shown on VC pages/one-pager as informational). Tune weights there.
- `vcFitScore(vc, tech, portfolioCompanies?)` — the scorer. `portfolioCompanies` is the VC's entry from `data/vc_portfolios.json` (see Data files). Renormalizes over available evidence and returns `{ score, sharedDomains, stageOk, basis, portfolioHits }` or `null`:
  - stated profile **and** portfolio → `0.55·P + 0.30·SC + 0.15·Sec`, `basis:'full'`
  - portfolio only (the 12 curated firms' shape) → `P`, `basis:'portfolio'`
  - stated only → `(0.30·SC + 0.15·Sec)/0.45` **capped at `STATED_MAX` = 0.75**, `basis:'stated'` (no portfolio evidence can't earn Strong — revealed > stated)
  - neither → `null`
- `portfolioFit(companies, tech)` — per company: shared domain + same stage-ladder rung → 1.0 · adjacent rung → 0.75 · shared domain w/ unknown/distant stage → 0.5 · no shared domain → 0. Aggregate via a **smooth de-saturating curve `1 − exp(−credit / PORTFOLIO_K)`, `PORTFOLIO_K = 3`** (replaces the old hard `min(1, credit/K)` clamp that pinned deep portfolios to a flat 1.0 — e.g. 2048 had 21 techs tied at 1.0). Monotonic in depth, asymptote < 1, so deeper/closer portfolios always score higher; returns the **uncapped `depth`** for the tiebreak. `techStageToRung()` maps tech milestone strings onto the round ladder.
- **Ranking + ties (SHIPPED July 23, 2026):** both directions rank by `score` then `tieKey = depth × domain recency` (`RECENCY_BY_VC`, from `data/vc_recency.json`), then name. `selectWithTies(ranked, {base:4, max:6})` extends past 4 **only** when the trailing items are genuinely indistinguishable (|Δscore| and |ΔtieKey| < 0.005), flagging that cluster so the UI labels it "equally strong — not rank-ordered". Scores render as **decimals beside the tier** (`Strong fit · 0.86`) in the tech→VC list and on the VC page's matched-tech cards. Recency is ordering-only — it never changes `score`/tier.
- `stageCheck = 0.5·techStageScore + 0.5·checkSizeScore` (both prior heuristics, extracted; PitchBook round benchmarks slot into `checkSizeScore` later behind a data-present guard).
- **sector**: `mapFocusToDomains` returns `{ primary, secondary, matchesAll }`; **primary-bucket overlap → 1.0, secondary-only overlap → 0.5**, catch-all-only → 0.5, none → 0. Multi-domain techs are not penalized (v1's `hits/length` fraction is gone). The keyword dictionary is now the **324-keyword venture taxonomy** (`taxonomy.js`, see "Sector taxonomy" below), NOT the old inline `INDUSTRY_TO_DOMAIN` table.
- `fitTier()` (≥0.80 Strong / ≥0.60 Good / else Possible) and `DOMAIN_MATURITY` live in `scoring.js`; the sector keyword map + crosswalk live in `taxonomy.js`. Tests: `test/scoring.test.js`, `test/taxonomy.test.js`, `test/generate_vc.buildentry.test.js`.
- The backend `generate_vc.js` calls `vcFitScore(vc, tech)` without a portfolio (new firms have none) → the capped `'stated'` path; buildEntry still picks top-4 `matchedTechs`.
- **VC→techs direction (`topTechsForVC(vc, n=4)` in `index.html`):** the VC page's "matched technologies" is now **rubric-driven** — it ranks ALL techs by `vcFitScore(vc, tech, PORTFOLIO_BY_VC.get(vc.id))` and takes the top n with **no floor cutoff**, so it always returns 4 (never zero). Pure data: the static `vc.matchedTechs` no longer drives this list (it still powers the tech-side "In VC brief" badge). The 8 JHTV **domain names round-trip** through `mapFocusToDomains` (guarded by a test) since enriched `sectors` are written as those names.

**Branding colors** (from `style.css`): navy `#003B6F`, light blue `#005A9C`, gold `#C8973A`. Domain colors live in `DOMAIN_COLORS` in `index.html`.

## Data files

**`data/technologies.json`** — 74 entries:
```json
{ "id", "name", "sectors", "stage", "pi", "description", "cohort", "onePager" }
```
`sectors[]` uses JHTV's 8 domain names. Three techs are dual-sector (3Dnamics, Biolinco, Infinity Bio). `stage` is a financing round string (e.g. `"Seed"`, `"Series A"`, `"NewCo"`, `"Commercial"`). `onePager` is the bare `.docx` filename.

**`data/vcs.json`** — base entries + provisional entries from auto-research:
```json
{ "id", "name", "aliases", "focus", "sectors", "stage", "matchedTechs", "vcOnePager", "geographicFocus", "checkSize": { "min", "max" }, "provisional?" }
```
Provisional entries have `provisional: true`, `vcOnePager: null`, and trigger a yellow banner in the UI.

**`data/vc_portfolios.json`** — rubric v2 portfolio data, keyed by `vcId` (matches `vcs.json` id), fail-soft-loaded in `index.html` `loadData()` → `PORTFOLIO_BY_VC`:
```json
{ "vcId", "sourceUrl", "scrapedAt", "note", "companies": [{ "name", "domains": [], "stage"? }] }
```
`domains[]` uses JHTV's 8 domain names (empty = out-of-scope, scores 0); `stage` is a round-ladder string (`Seed`/`Series A`/…, omit if unknown → domain-only credit). Currently the **12 curated PDF firms** (160 companies, scraped from firm websites, hand-classified). Not consumed by the backend. Out-of-scope companies add 0 credit and are omitted. Cole can hand-edit this file.

**`data/tech_status.json`** — **tech curation state** (`{ "pausedTechIds": [...], "updatedAt" }`). The single source of pause truth, kept **separate** from `technologies.json` so a catalog rebuild never clobbers it. Fail-soft-loaded in `index.html` → `PAUSED` (Set); missing/empty ⇒ everything active. Paused techs are excluded from matching (`topTechsForVC` ranks over `activeTechs(TECHS, PAUSED)` from `curation.js`) but still shown in the catalog with a muted "Paused — not matching" badge. Written by the boss-facing **`#/curate`** page (nav "Curate"): pause/resume at four scopes — a tech, a bucket within a cohort, a whole cohort, and a bucket across all cohorts — grouped Cohort → bucket via `curation.js`'s `groupByCohortBucket`. "Save changes" POSTs the paused list to `server.js` `POST /api/tech-status`, which commits this file via the same GitHub-contents-PUT path as `commitVcEntry` (needs the Render backend up; ~30s cold start). `technologies.json` now carries a **`cohort`** field on every tech (existing 74 = `"Cohort 1"`). **Add a new cohort:** drop the new `.docx`s → `node scripts/populate_technologies.js` (now *merges by id*, preserving enriched fields; new techs default to `"Cohort 1"`) → set the new techs' `cohort` to the new label → commit.

**`data/vc_recency.json`** — per-VC, per-JHTV-domain recency weight (`{ byVc: { vcId: { domain: 0.5..1.0 } } }`) derived from `data/source/vc_deals.json` deal dates by `scripts/build_vc_recency.js` (`npm run build-vc-recency`). Fail-soft-loaded in `index.html` → `RECENCY_BY_VC`; missing file ⇒ neutral (1.0). **Tiebreak-only** — orders same-score matches by how recently the firm invested in the tech's domain (9 firms with health/bio deals; the other 3 curated firms have none → neutral). Regenerate after refreshing the deals export.

**`data/vc_pitchbook.json`** — standalone catalog of 391 PitchBook investors (from `scripts/ingest_pitchbook.js`); NOT loaded by the live UI. Future rubric-benchmark source. See memory + `scripts/ingest_pitchbook.js`.

**`data/jhtv_investors.json`** — **JHTV backers (revealed co-investment).** Firms that have actually written checks into JHTV/Hopkins companies (626 deals, 312 investors, 99 companies, 2006–2026), aggregated per investor:
```json
{ "meta": { "counts": { "venture", "angel", "foundation", "public" } },
  "investors": [{ "investor", "type", "companiesBacked":[], "companyCount", "dealCount",
                  "totalInvested", "firstDate", "lastDate", "deals":[{company,amount,date,series,roundBucket}] }] }
```
Sorted by `companyCount` desc then `dealCount`. **Only `type ∈ {venture, angel}` (299 firms) enter the UI**; `foundation` (5) + `public` (8) stay in the JSON but are filtered out at load (deferred). This is the strongest relationship signal (revealed > stated) and is the **primary** relationships layer now that `jhtv_relationships.json` is empty (that file stays as an optional manual supplement — both can render).
- **Regenerate:** edit `data/source/Venture_Funding_-_Grouped_By_Investor.xlsx` → `npm run convert-jhtv-investors` (`scripts/convert_jhtv_investors.js`, uses the `xlsx` dev dep). Counts must stay 299 live / 13 deferred (guarded by `test/convert_jhtv_investors.test.js`).
- **Load + resolve (`index.html`, mirrors `resolveRelationships`):** `loadData()` fail-soft-fetches it → `JHTV_INVESTORS` (filtered to venture/angel). `resolveInvestors()` joins each to `vcs.json` via `vcMatchingName()` → `INVESTORS_BY_VC` (Map vcId→record, **12 of 299** resolve today) + `UNMATCHED_INVESTORS` (the rest, browse-only) + `BACKERS_BY_COMPANY` (normalized company → backers, powers the exact-tech pin). All live inside the `// ── JHU Connections`↔`// ── Search` eval-marker region, tested by `test/jhtv_investors_resolve.test.js`.
- **VC page:** emerald `.backer-badge` "JHTV backer · N companies" + detail line (companies, `$XM` total via `fmtMoney`, "last check {year}"). Distinct from gold "In VC brief" and navy relationship badges.
- **`#/backers` page** (`showBackers`/`renderBackers`, nav button): all 299 firms ranked by `companyCount`; resolved link to `#/vc/<id>`, unresolved get a "research" chip.
- **Tech→firm (`findVCsForTech`, scoring.js weights unchanged):** exact-tech investors (`backersForTech`) **pin to the top** with an "Already invested in {tech}" badge — profiled firms as scored rows, unprofiled as non-scored research rows (22 of 74 techs have such a match; Delfi Diagnostics has 25 backers). Resolved backers that did NOT fund this exact tech get a `.backer-pill` "has funded N JHTV companies" + a **capped +0.1 sort bonus** (`relationshipBonus`, does NOT stack with the in-brief +0.1). NEA got a `"New Enterprise Associates"` alias in `vcs.json` so the marquee backer resolves.

## Scripts

```bash
node scripts/populate_technologies.js   # rebuilds technologies.json from *.docx filenames
node scripts/populate_vcs.js            # rebuilds vcs.json from VC PDFs (requires pdfminer.six)
node scripts/generate_vc.js "Firm Name" # CLI: research one VC and append to vcs.json
node scripts/enrich_tech_data.js        # re-extract stage/pi/description from .docx via Claude Haiku
node scripts/enrich_curated_vcs.js      # one-time: fill profile data on PDF-curated VCs (preserves matchedTechs)

node test/grant_checker.test.js         # grant schema ↔ engine contract test (requires sibling ../Grant Finder checkout)
```

No test runner is configured — tests are plain Node scripts that assert and `exit(1)` on failure (mirrors Grant Finder's `stress_test.js`). The JHU name-matcher is tested via the eval-marker pattern: extract the code between the `// ── JHU Connections ──` and `// ── Search ──` markers in `index.html` and `eval` it in Node.

`populate_vcs.js` requires Python: `pip3 install pdfminer.six`. It reads "JHTV PORTFOLIO MATCHES" → "WHO WE ARE MEETING WITH" from each PDF and fuzzy-matches company names to tech IDs. VC names come from filenames (PDF text is all-caps and unreliable).

`generate_vc.js` exports `researchVC(name)` and `buildEntry(vcProfile, techs)` for use by `server.js`, and also runs as a CLI via `require.main === module`.

## Adding a new technology

1. Drop the `.docx` into `one-pagers/Tech One Pagers/`
2. `node scripts/populate_technologies.js` — adds a stub entry
3. Manually set `sectors[]` in `data/technologies.json`
4. Run `node scripts/enrich_tech_data.js` to populate `stage`, `pi`, `description` from the docx
5. Commit and push

## Adding a researched VC (with one-pager PDF)

1. Drop the PDF into `one-pagers/VC One Pagers/Completed One Pagers /` (trailing space)
2. `node scripts/populate_vcs.js` — expect 4 matched techs per VC
3. Review/correct `matchedTechs` and add `aliases[]` in `data/vcs.json`
4. Commit and push

## Deployment

- **Frontend:** push to `main` = live in ~1 min. No build step. `.nojekyll` prevents Jekyll processing.
- **Backend:** Render auto-deploys from `main` via `render.yaml`. Env vars required: `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` (fine-grained PAT, Contents: read+write, scoped to this repo).

## Deferred: live-sync JHU network from Excel (NOT YET IMPLEMENTED)

The JHU connections data (`data/jhu_connections.json`, 827 people / 736 firms) is refreshed
**manually** and should eventually self-update. **None of the automation below exists yet** — this
is a spec for later. Do not assume any sync is running; the manual flow is the only live path.

**Today (manual, working — leave intact):** edit the local Excel file
`/Users/colekannam/Documents/JHU VC DATABASE/JHU_VC_Network.xlsx` → run
`node scripts/convert_jhu_connections.js` → commit. The source lives on Cole's Mac, outside the repo.

**Future (automated — to build):** keep editing in **Excel** (boss preference — no Google Sheets).
The file is now hosted in Cole's JH SharePoint (OneDrive), share link:
`https://livejohnshopkins-my.sharepoint.com/:x:/r/personal/ckannam3_jh_edu/_layouts/15/Doc.aspx?sourcedoc=%7BAAAF3985-B231-4588-BB5E-CD06D99C6D8E%7D&file=JHU_VC_Network.xlsx`
(drive-item GUID `AAAF3985-B231-4588-BB5E-CD06D99C6D8E`).

**IMPORTANT — a plain anonymous `fetch()` of that link does NOT work.** Tested 2026-07-09: the
"anyone with the link" share on the managed `livejohnshopkins` tenant redirects to
`login.microsoftonline.com` ("Sign in to your account") and returns an HTML login page, not the
xlsx. So CI needs **authentication**. Two realistic paths (pick when building):

- **Graph API + Azure AD app registration (proper CI path):** register an app, grant it read on
  that SharePoint drive, store client ID/secret as GitHub repo secrets. The Action gets a token,
  downloads the drive item by GUID via Microsoft Graph, then runs the converter. Robust but needs
  JH IT to permit the app registration.
- **Local watcher (no cloud auth):** point the converter at the OneDrive-**synced** copy on Cole's
  Mac and run it from a `launchd`/cron job (or file-watcher) that regenerates + commits + pushes on
  change. Simple, but only runs while his machine is on. (Power Automate could also drive this, but
  committing to GitHub from it is fiddly.)

Converter change is the same either way: add a source mode to
`scripts/convert_jhu_connections.js` — when the file arrives as a downloaded buffer,
`XLSX.read(buffer, { type: 'buffer' })` reading the **"JHU VC Network"** sheet by name; otherwise
fall back to the existing local `XLSX.readFile(...)`. Downstream is unchanged — the
`r['Firm'] && r['Name']` filter (drops empty-Firm header rows), the 5-field mapping, and the JSON
output all stay as-is. Then add npm script `"convert-jhu"` and, for the Graph path, a
`.github/workflows/sync-jhu.yml` (hourly `schedule` + `workflow_dispatch`, commit only if changed —
schedule/dispatch-triggered so its own commit won't loop).

**Prereqs when built:** the `.xlsx` keeps the 5 headers unchanged (`Name`, `Firm`,
`Connection to Johns Hopkins`, `Role at Firm`, `Entity Type`); auth creds in repo secrets (Graph
path); and the live site's hosting restored (currently 404 after the repo went private — a separate
deferred decision: make public, GitHub Pro, or move to Netlify/Vercel).

## Planned: unified tool + data roadmap (DESIGN ONLY — NOT BUILT)

Approved design (via brainstorm) to **unify** with the **Grant Finder** tool and to plug in
**PitchBook/Bloomberg** data later. **No code exists yet** — implement phase by phase in future
sessions. Decisions: primary user = **JHTV staff** (internal, no access control); organizing model
= **tech-centric hub**; **keep TWO separate live sites** — internal **Second Brain** (staff) AND
external **Grant Finder** (professors self-serve), with **Grant Finder canonical** for the grant
engine/data (NOT folded in, NOT retired); **no reliable fundraising-outcome data** (so rubric
weights become tunable config, not validated).

**Two front doors, one grant brain.** JHTV staff → Second Brain; professors/founders → Grant Finder
standalone. The eligibility *logic* has a single source of truth (`grant_engine.js` in the
`jhtv-grant-finder` repo) so the two sites can never drift.

**The product.** The **technology** is the hub of Second Brain: a tech profile shows **VC matches**
(dilutive) + **grants** (non-dilutive) + **JHU warm intros** + **one-pager**. The **landing page
stays as it is today** (`renderDomainBrowse` catalog) — the **grant checker** is added as a *peer
top-level entry point* alongside the catalog and saved briefs, so grants are reachable standalone
*and* auto-screened inside each tech profile. VC search is retained. Grant flow = auto-screen from
the tech's attributes (`techToGrantInput()` already maps stage/sector → engine inputs) + a "Refine
eligibility" action that opens the questionnaire **embedded here in Second Brain**, prefilled for
that tech, driven by the **shared `grant_engine.js`** (only the form UI lives here; scoring stays in
the shared engine).

**Phase 1 — Integrate — ✅ SHIPPED (July 9, 2026).** Second Brain now embeds the grant experience
(standalone Grant checker at `#/grants` + per-tech Refine eligibility) via the shared engine; see the
"Grant integration — Second Brain side" subsection above for the implementation and the deployed-engine
gotcha. `jhtv-grant-finder` stays live and canonical (unchanged). The remaining phases are NOT built.

**Phase 2 — Rubric refactor — ✅ SHIPPED (July 9, 2026).** Rubric extracted into `scoring.js` (see the
"Scoring" section above); two-copy drift fixed; weights are a `WEIGHTS` config block. The
graceful-degradation hook for Phase 3 is the existing `vcFitScore(...) || {score:0}` / `null` handling.

**Phase 3 — PitchBook/Bloomberg data upgrades (conditional on getting data).** Ingest via the
existing JHU `xlsx → conversion script → JSON` pattern (PitchBook MCP is auth-blocked, so manual
export → script). New files: `data/round_benchmarks.json` (median/IQR round size by domain × stage);
`data/vc_pitchbook.json` (enrichment keyed by VC id: `stageDistribution, recentDeals, fundVintage?,
sectorAllocation?` — kept separate from curated `vcs.json`, merged at load); Bloomberg export →
fills `data/jhtv_relationships.json`. Each rubric component upgrades behind an "if data present"
guard: **industry** → any/primary-domain match (multi-domain never penalized) + optional
`sectorAllocation` weighting; **stage** → smooth score from real stage-distribution %,
recency-weighted; **check size** → interval overlap of VC check vs expected round size; **geography**
unchanged. *Update July 2026:* `data/vc_pitchbook.json` now exists (391 investors, different shape —
see `scripts/ingest_pitchbook.js`; standalone catalog, NOT merged at load yet). ⚠ Phase 3's
per-component upgrade list is **superseded by "Rubric v2 — portfolio-led matching (SHIPPED)" below** where they conflict
(geography is now removed, weights restructured); the PitchBook benchmark upgrades survive but slot
inside v2's merged StageCheck component.

**Phase 4 — Taxonomy revamp (VC-side SHIPPED — see "Sector taxonomy" below).** The lossy inline
`INDUSTRY_TO_DOMAIN` table is gone; VC self-descriptions now map through the 324-keyword venture
taxonomy (`taxonomy.js`). Techs + portfolios still use JHTV's 8 display buckets (the taxonomy's 10
buckets crosswalk back to them), so this was done VC-mapping-only. Fully mapping techs onto PitchBook
verticals remains optional/future.

**Open/deferred:** naming/branding of the two tools; how far to harden the cross-repo engine
consumption (keep fetch+eval vs. a cleaner include); exact PitchBook export schema (finalize
conversion scripts once a sample export exists). Full design spec:
`~/.claude/plans/nice-jsut-out-of-floofy-stream.md`.

## Rubric v2 — portfolio-led matching (SHIPPED July 16, 2026)

Boss-approved reframe, now live: `Fit = 0.55·Portfolio + 0.30·StageCheck + 0.15·Sector`, geography
removed. Mechanics are documented in the **Scoring** section above and the data shape in **Data
files** (`vc_portfolios.json`). Pilot = the 12 curated PDF firms (160 classified companies).
Philosophy: revealed behavior (actual portfolio) beats stated preference; stated-only firms cap at
`STATED_MAX` (0.75) so only real portfolio evidence earns Strong. Two tunables were set by eyeballing
real rankings with Cole: `STATED_MAX = 0.75` (stated cap) and `PORTFOLIO_K` (portfolio curve —
**now 3** after the de-saturation change below; was 6 as a hard-cap count).
Rankings changed wholesale vs v1 by design (no golden parity). Spec/plan:
`~/.claude/plans/also-no-codde-just-hashed-dawn.md`.

**De-saturation + recency tiebreak + decimal scores (SHIPPED July 23, 2026).** `portfolioFit`'s hard
`min(1, credit/6)` clamp is replaced by the smooth `1 − exp(−credit/3)` curve (see the Scoring
section) so ceiling clusters (2048: 21 techs at 1.0 → top 0.99 with the rest spread) separate by
depth; `selectWithTies` shows up to 6 "equally strong" techs for genuine ties; `data/vc_recency.json`
supplies the ordering-only recency tiebreak; scores display as decimals beside tiers. Spec/plan:
`docs/superpowers/specs/2026-07-22-scores-desaturation-design.md` + `docs/superpowers/plans/2026-07-23-scores-desaturation.md`.

**VC→techs + enrich-the-12 (SHIPPED July 17, 2026).** The VC page now shows rubric-ranked top-4 techs (`topTechsForVC`, no floor → always 4) instead of the static PDF list. To give stage×check + sector something to score when portfolio overlap is thin, the **12 curated firms' stated profiles were populated** in `vcs.json` (`sectors`/`stage` derived from their `vc_portfolios.json` companies, `checkSize`/`focus` web-augmented; `matchedTechs`/`vcOnePager` preserved, not provisional). Effect: they score via `basis:'full'`, so no-overlap firms (e.g. Mayfield) get sensible stated-driven matches instead of an arbitrary zero. `INDUSTRY_TO_DOMAIN` gained `research technologies` + `agricultural tech` keys so all 8 domain names round-trip. Test: `test/vc_matched_techs.test.js` (never-zero guarantee). (`topTechsForVC` now returns 4–6 scored objects via `selectWithTies`, not a bare top-4 — see the July 23 de-saturation change.) **Recency** now lands as a domain-level tiebreak (`data/vc_recency.json`, ordering-only) rather than the originally-designed per-company recency weighting.

**Deferred follow-ups:** portfolios for the ~20 non-curated (provisional) firms; folding portfolio
collection into `generate_vc.js` auto-research so new firms arrive with portfolio data; `docs/HOW-IT-WORKS.md`
+ `docs/WORKFLOW.md` still describe v1 weights (update on next docs pass). Dimension's portfolio list
is partial (site didn't render server-side); Fusion Fund companies lack stage labels (domain-only credit).

## Sector taxonomy (SHIPPED — replaces INDUSTRY_TO_DOMAIN)

The 15% Sector sub-component of rubric v2 no longer uses the old ~46-key inline `INDUSTRY_TO_DOMAIN`
table. It now maps VC self-descriptions through the **324-keyword venture taxonomy** in **`taxonomy.js`**
(generated). **v2 weights and all portfolio logic are unchanged** — only the sector dictionary + its
scoring changed.

- **`taxonomy.js`** (dual classic-script + `module.exports`, loaded by `index.html` via `<script defer>`
  BEFORE `scoring.js`; `require`d by `scoring.js`/scripts in Node). Exports: `VC_KEYWORD_TAXONOMY`
  (`{ keyword: { primary, secondary[] } }`, 324 keys), `BUCKET_TO_DOMAIN` (crosswalk from the taxonomy's
  10 venture buckets → JHTV's 8 display domains; the 3 non-JHTV buckets — Robotics/AI/Software,
  Industrial & Manufacturing, Aerospace/Defense/Quantum — map to `null`), `CYBER_KEYWORDS` (overlay:
  the taxonomy folded Cybersecurity into Robotics/AI/Software, so cyber terms are re-mapped to the JHTV
  Cybersecurity domain), `DOMAIN_SELF_MAP` (8 domain names → themselves, guarantees enriched-sector
  round-trip), `CATCH_ALL` (`deep tech`/`healthcare`/`health care`).
- **Regenerate:** edit `data/source/VC_Keyword_Taxonomy_Venture_Grade.xlsx` (sheet "Keyword Summary")
  → `npm run convert-taxonomy` (`scripts/convert_keyword_taxonomy.js`, uses the `xlsx` dev dep). Do NOT
  hand-edit `taxonomy.js`; edit the crosswalk/overlay block inside the converter.
- **Scoring:** `mapFocusToDomains` returns `{ primary, secondary, matchesAll }` using whole-phrase
  (token-boundary) matching + phrase-priority (specific keyword beats component word). `vcFitScore`
  sector = primary overlap → 1.0 · secondary-only → 0.5 · catch-all-only → 0.5 · none → 0. Tests:
  `test/taxonomy.test.js` + sector cases in `test/scoring.test.js`.

## Baseline: old rubric (v1) vs new rubric (v2) — offline comparison artifact

`scripts/generate_v1_baseline.js` (`npm run baseline-v1`) writes **`data/baseline_v1_matches.json`** —
for each of the **12 curated saved-brief VCs**, an `oldRubricMatches` list and a `newRubricMatches`
object. Not loaded by the live UI; does not touch live scoring.

- **`oldRubricMatches`** — top-4 under the original **v1 four-dimension rubric** (industry 37.5% +
  stage 30% + check 22.5% + geography 10%, per `JHTV_Second_Brain_Matching.docx`), reconstructed with a
  **frozen** copy of the pre-taxonomy `INDUSTRY_TO_DOMAIN` table so it stays fixed. This is the "what v1
  *would* have picked" reference (the firms' `vcs.json.matchedTechs` came from PDF research, not a rubric).
- **`newRubricMatches`** — top-4 under the **live v2 rubric** (`vcFitScore` from `scoring.js`), scored
  against a **recent-deals portfolio** built from the PitchBook deals export at
  **`data/source/vc_deals.json`** (623 deals; source folder `vc json deal histories/`). `null` for firms
  the export doesn't cover. Deals → portfolio companies via `PB_INDUSTRY_TO_DOMAIN` (PitchBook industry
  label → JHTV domains; non-JHTV labels → `[]`, ignored by the saturating count) + `dealTypeToStage`
  (Series letter is the true round). Each firm's `stageFocus` (vc.stage[]) is **derived from its own deals**
  (`deriveStageFocus`, stages ≥10% of rounds), except a `STAGE_FOCUS_OVERRIDE` for **2048 Ventures**
  (Seed/Early 95% · Series A 5%, read off its one-pager). Firms are mapped by `DEALS_FIRM_TO_VCID`.
  **All 12** curated firms now have deals (`data/source/vc_deals.json`, 799 deals).
- Because these firms have both a stated profile and a portfolio, v2 scores via `basis:'full'` and can
  exceed the 0.75 stated-only cap. **Saturation caveat:** broad multi-domain funds (8VC, Felicis, Frazier,
  NEA) hit the score ceiling on many techs at once — `topScoreTies` (recorded per firm) shows how many
  tied at the top; for those the surfaced top-4 is decided by tie-break (portfolio overlap, then domains,
  then name), so it's less discriminating than for focused funds (Lux, Dimension, 2048). Firms whose recent
  deals show **no** JHTV-relevant investing (Hanabi, Mayfield, Emergence) have an all-out-of-scope
  portfolio, so the 55% portfolio term is 0 and they cap at 0.45 (Possible) — revealed behavior beats a
  stated health thesis.
- **Purpose:** diff v1 vs v2 to show how the rubric evolved. Refresh by re-exporting deals into
  `data/source/vc_deals.json` and rerunning `npm run baseline-v1`.

## One-pager generator (built, button hidden)

`generateOnePager(vc, techs)` lives at the bottom of `index.html` (above `// ── Init ──`). It opens a new tab with a print-ready HTML one-pager that mirrors the PDF layout: navy header, auto-generated gold banner, 3-box stats row, Hopkins connection box, two-column body (FIRM OVERVIEW + LAST 10 INVESTMENTS left; SECTOR FOCUS + JHTV PORTFOLIO MATCHES right), partner placeholder, footer.

Fields that need PitchBook (fund size, AUM, dry powder, active cos, TTM investments, last 10 investments, partner bios) render as italic gray `—*` placeholders.

The "Build One-Pager" button is intentionally removed from `foundHTML()` and `showSavedBriefs()` — the function is ready but not yet exposed in the UI. To re-add, insert in `foundHTML()`:
```js
window[`_vcTechs_${vc.id}`] = techs; // at top of foundHTML
// then in vc-actions div:
`<button class="btn btn-dark" onclick="generateOnePager(VCS.find(v=>v.id==='${vc.id}'),window['_vcTechs_${vc.id}'])">Build One-Pager</button>`
```

## Deferred

| Feature | Notes |
|---|---|
| Live-sync JHU network from Excel | Excel in OneDrive/SharePoint → GitHub Action regenerates `jhu_connections.json`. Spec above; not yet built |
| Tech one-pagers shift from `.docx` to `.pdf` | When files are ready; update `downloadTech()` path |
| Redis job store for backend | In-memory jobs lost on Render restart; low priority on free plan |
| Public + foundation funding sources | Surface `jhtv_investors.json` `type: public\|foundation` (TEDCO, Maryland Venture Fund, Abell, NIH, Wellcome…) as a separate non-dilutive/public category. Already tagged; a UI/categorization pass, not a re-parse |
| Domain-tag the 99 backed companies | Classify historical backed companies into the 8 JHTV domains → co-investment domain-overlap signal in tech→firm (beyond the exact-tech pin) |
| Add marquee unmatched backers to `vcs.json` | OrbiMed, Third Rock, Osage, Camden… resolve to VC pages instead of only the `#/backers` list |
| Design spec + plan | `docs/superpowers/specs/2026-07-22-jhtv-backers-design.md` + `docs/superpowers/plans/2026-07-22-jhtv-backers.md` |
