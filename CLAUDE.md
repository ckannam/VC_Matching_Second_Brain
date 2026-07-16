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
- `portfolioFit(companies, tech)` — per company: shared domain + same stage-ladder rung → 1.0 · adjacent rung → 0.75 · shared domain w/ unknown/distant stage → 0.5 · no shared domain → 0. Aggregate = `min(1, credit / PORTFOLIO_K)`, **`PORTFOLIO_K = 6`** (saturating count — a fraction would punish diversified firms; K tuned so deep/pure-play = Strong, small relevant arm = Good). `techStageToRung()` maps tech milestone strings onto the round ladder.
- `stageCheck = 0.5·techStageScore + 0.5·checkSizeScore` (both prior heuristics, extracted; PitchBook round benchmarks slot into `checkSizeScore` later behind a data-present guard).
- **sector**: `mapFocusToDomains` + **any shared domain → 1.0** (catch-all-only → 0.5). Multi-domain techs are no longer penalized (v1's `hits/length` fraction is gone).
- `fitTier()` (≥0.80 Strong / ≥0.60 Good / else Possible), `INDUSTRY_TO_DOMAIN`, `DOMAIN_MATURITY` also live here. Tests: `test/scoring.test.js` (18), `test/generate_vc.buildentry.test.js`.
- The backend `generate_vc.js` calls `vcFitScore(vc, tech)` without a portfolio (new firms have none) → the capped `'stated'` path; buildEntry still picks top-4 `matchedTechs`.

**Branding colors** (from `style.css`): navy `#003B6F`, light blue `#005A9C`, gold `#C8973A`. Domain colors live in `DOMAIN_COLORS` in `index.html`.

## Data files

**`data/technologies.json`** — 74 entries:
```json
{ "id", "name", "sectors", "stage", "pi", "description", "onePager" }
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
`domains[]` uses JHTV's 8 domain names (empty = out-of-scope, scores 0); `stage` is a round-ladder string (`Seed`/`Series A`/…, omit if unknown → domain-only credit). Currently the **12 curated PDF firms** (160 companies, scraped from firm websites, hand-classified). Not consumed by the backend. Since scoring uses a saturating count, out-of-scope companies have no effect and are omitted. Cole can hand-edit this file.

**`data/vc_pitchbook.json`** — standalone catalog of 391 PitchBook investors (from `scripts/ingest_pitchbook.js`); NOT loaded by the live UI. Future rubric-benchmark source. See memory + `scripts/ingest_pitchbook.js`.

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

**Phase 4 — Taxonomy revamp (optional, last).** Map techs + VCs onto PitchBook verticals as a shared
tag layer under the 8 display buckets, removing the lossy `INDUSTRY_TO_DOMAIN` translation.

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
real rankings with Cole: `PORTFOLIO_K = 6` (saturation) and `STATED_MAX = 0.75` (stated cap).
Rankings changed wholesale vs v1 by design (no golden parity). Spec/plan:
`~/.claude/plans/also-no-codde-just-hashed-dawn.md`.

**Deferred follow-ups:** portfolios for the ~20 non-curated (provisional) firms; folding portfolio
collection into `generate_vc.js` auto-research so new firms arrive with portfolio data; `docs/HOW-IT-WORKS.md`
+ `docs/WORKFLOW.md` still describe v1 weights (update on next docs pass). Dimension's portfolio list
is partial (site didn't render server-side); Fusion Fund companies lack stage labels (domain-only credit).

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
