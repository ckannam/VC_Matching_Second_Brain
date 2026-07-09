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

**Frontend (`index.html` + `style.css`):** All search, matching, and rendering happen client-side. On load, `loadData()` fetches `data/vcs.json` and `data/technologies.json` into `VCS` and `TECHS` arrays.

**Routing (hash-based):** `#/` home · `#/domain/<sector>` · `#/all` · `#/briefs` · `#/vc/<id>` · `#/tech/<id>`. Convention: public functions referenced from inline `onclick`s (`viewTech`, `viewDomain`, `viewAllTechs`, `showSavedBriefs`, `showDomainBrowse`) only set `location.hash`; the `hashchange` listener dispatches to `render*` counterparts (`renderTech`, `renderVc`, `renderDomain`, `renderAllTechs`, `renderSavedBriefs`, `renderHome`). `loadData()` calls `dispatchRoute()` so deep links and refresh work. The fuzzy "did you mean" view renders directly and syncs the hash with `history.replaceState` (fires no hashchange).

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
- *Investor fit:* one ranked list of all VCs scored by a client-side port of the `scoreTech()` weights from `scripts/generate_vc.js` (`INDUSTRY_TO_DOMAIN` table is duplicated in `index.html` — keep in sync). Scores display as tiers, not percentages: ≥0.80 Strong fit · ≥0.60 Good fit · ≥0.45 Possible fit · below excluded. A hand-reviewed PDF match (`vc.vcOnePager` set AND tech in `matchedTechs`) gets a gold "In VC brief" badge and +0.1 sort bonus; provisional firms' `matchedTechs` get neither (it came from the same scoring). VCs without profile data surface only via a brief match at fixed sort 0.75. Top 4 rows render; the rest sit behind a "Show N more matches" toggle. Each row shows a JHU-connection count pill.
- *Preliminary grant screen:* fetches `grant_engine.js` + `grants_live.json` from the **Grant Finder site** (`https://ckannam.github.io/jhtv-grant-finder` — same GitHub Pages origin, defined as `GRANT_FINDER_URL`). `techToGrantInput()` maps tech stage/sector onto the engine's form fields (`jhtv:'yes'`, `jhuSchool:'other_jhu'` are safe constants for portfolio techs; founder-specific fields stay blank). Cards deep-link to the Grant Finder prefilled via URL hash (`#stage=pre_co&ventureStage=…`).

Cross-repo dependency: renaming/moving `grant_engine.js` or changing `getGrants()`'s signature in the Grant Finder repo breaks this section (it fails soft with a link to the Grant Finder).

**Backend (`server.js`):** Express with in-memory job store (lost on restart). Two endpoints:
- `POST /api/research-vc` — fire-and-forget, returns `{ jobId }`
- `GET /api/job/:jobId` — returns `{ status: 'running'|'done'|'error', result?, error? }`

**Scoring (`scripts/generate_vc.js`):** Weights: 37.5% industry match, 30% stage compatibility, 22.5% check size, 10% geography.
- `mapFocusTodomains()` — maps VC `investmentFocus` strings → JHTV's 8 domains via `INDUSTRY_TO_DOMAIN` keyword table
- `stageScore()` — maps VC investment rounds to compatible tech financing stages (e.g. Seed VC → NewCo/Pre-Seed/Seed techs score 1.0; mismatches score 0.2)
- `geographyScore()` — Mid-Atlantic/East Coast = 1.0; National = 0.8; West Coast = 0.4 (uniform across all techs)
- `checkSizeScore()` — uses hardcoded domain maturity tier (Therapeutics/CleanTech = "early", others = "mid")

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

## Scripts

```bash
node scripts/populate_technologies.js   # rebuilds technologies.json from *.docx filenames
node scripts/populate_vcs.js            # rebuilds vcs.json from VC PDFs (requires pdfminer.six)
node scripts/generate_vc.js "Firm Name" # CLI: research one VC and append to vcs.json
node scripts/enrich_tech_data.js        # re-extract stage/pi/description from .docx via Claude Haiku
node scripts/enrich_curated_vcs.js      # one-time: fill profile data on PDF-curated VCs (preserves matchedTechs)
```

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

**Phase 1 — Integrate (keep both sites; NO fold, NO retire).** `jhtv-grant-finder` stays live and
canonical — its `grant_engine.js` + `grants_live.json` + CI (`refresh_grants.yml`, `fetch_grants.js`)
+ `stress_test.js` are unchanged. Second Brain *consumes* the shared engine/data (existing cross-repo
link kept, but **hardened** from the current fetch-text + `new Function` eval) and embeds the grant
experience: the per-tech auto-screen (already present) plus the deep-check questionnaire UI. No CI
migration, no data move, no repo retirement. Keep the Render backend and `.nojekyll`.

**Phase 2 — Rubric refactor (prereq for data work).** Extract the rubric (weights + component fns +
`INDUSTRY_TO_DOMAIN` + `DOMAIN_MATURITY`) into **one shared module** used by both the browser and
`generate_vc.js`, ending the two-copy drift (catch-all industry case: flat `0.5` in `generate_vc.js`
vs `max(fraction, 0.5)` in `index.html`). **Weights become a visible config block.** Principle:
**graceful degradation** — richer logic only when enriched data is present, else today's logic.

**Phase 3 — PitchBook/Bloomberg data upgrades (conditional on getting data).** Ingest via the
existing JHU `xlsx → conversion script → JSON` pattern (PitchBook MCP is auth-blocked, so manual
export → script). New files: `data/round_benchmarks.json` (median/IQR round size by domain × stage);
`data/vc_pitchbook.json` (enrichment keyed by VC id: `stageDistribution, recentDeals, fundVintage?,
sectorAllocation?` — kept separate from curated `vcs.json`, merged at load); Bloomberg export →
fills `data/jhtv_relationships.json`. Each rubric component upgrades behind an "if data present"
guard: **industry** → any/primary-domain match (multi-domain never penalized) + optional
`sectorAllocation` weighting; **stage** → smooth score from real stage-distribution %,
recency-weighted; **check size** → interval overlap of VC check vs expected round size; **geography**
unchanged.

**Phase 4 — Taxonomy revamp (optional, last).** Map techs + VCs onto PitchBook verticals as a shared
tag layer under the 8 display buckets, removing the lossy `INDUSTRY_TO_DOMAIN` translation.

**Open/deferred:** naming/branding of the two tools; how far to harden the cross-repo engine
consumption (keep fetch+eval vs. a cleaner include); exact PitchBook export schema (finalize
conversion scripts once a sample export exists). Full design spec:
`~/.claude/plans/nice-jsut-out-of-floofy-stream.md`.

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
