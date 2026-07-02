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

**Search flow:**
1. Exact substring match on `vc.name` and `vc.aliases`
2. Levenshtein fuzzy match (threshold: `max(2, floor(query.length × 0.4))`) → "Did you mean X?" banner with escape-hatch link to research the original query
3. No match → `notFoundHTML()` → "Research this VC" button → `triggerResearch(vcName)`

**Auto-research flow (Phase 2B — live):**
- `triggerResearch()` POSTs to `/api/research-vc` → server returns `jobId` immediately
- Client polls `GET /api/job/:jobId` every 3s until `status === 'done'`
- Server runs Claude Opus + `web_search_20250305` in the background, commits result to `data/vcs.json` via GitHub API, returns the new VC entry
- `RESEARCH_SERVER` constant auto-selects local vs production based on `location.hostname`

**JHU connections (`findJHUConnections()` in `index.html`):** Every rendered VC (including provisional) is matched client-side against `data/jhu_connections.json` (JHU alums at VC firms, sourced from PitchBook). Matching compares `vc.name` + `vc.aliases` against firm names using: parenthetical variants (`"NEA (New Enterprise Associates)"` → 3 variants), whole-name containment (multi-token names only), typo-tolerant key-token coverage (edit distance 1 with transpositions, tokens ≥5 chars), and anchored single-token prefix ("Flagship" → "Flagship Pioneering" — primary names only, never one-word aliases like "Tiger"/"GC", token ≥4 chars). Cards show "Listed as: {firm}" when the sheet name differs from `vc.name`. Test harness pattern: extract the code between the `// ── JHU Connections ──` and `// ── Search ──` markers and `eval` it in node.

**JHU connections data:** source of truth is `/Users/colekannam/Documents/JHU VC DATABASE/JHU_VC_Network.xlsx` (sheet "JHU VC Network"; firm-header rows have an empty Firm column and are intentionally skipped). After editing the sheet, run `node scripts/convert_jhu_connections.js` to regenerate `data/jhu_connections.json`, then commit.

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
| Tech one-pagers shift from `.docx` to `.pdf` | When files are ready; update `downloadTech()` path |
| Redis job store for backend | In-memory jobs lost on Render restart; low priority on free plan |
