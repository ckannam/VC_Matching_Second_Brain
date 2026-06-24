# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A fully static GitHub Pages web app for JHTV staff. Type a VC firm name → get the matched JHTV technology one-pagers as individual downloads. No build step, no backend — just HTML, CSS, JS, JSON, and files.

Deployed at: `https://ckannam.github.io/VC_Matching_Second_Brain/`

## Running locally

`index.html` cannot be opened directly — `fetch()` fails on `file://` URLs. Use a local server:

```bash
npx serve .          # or: python3 -m http.server 8080
```

## File paths (critical details)

- **Tech one-pagers:** `one-pagers/Tech One Pagers/*.docx` — currently `.docx`, will shift to `.pdf` later
- **VC one-pagers:** `one-pagers/VC One Pagers/Completed One Pagers /` — **trailing space in folder name is real and must be preserved**
- **Fusion Fund** (`Fusion_Fund_OnePager.pdf`) is intentionally excluded from matching — its PDF lacks the "JHTV PORTFOLIO MATCHES" section. Set `matchedTechs: []` and leave it alone.

## Architecture

Everything runs client-side. `index.html` fetches `data/vcs.json` and `data/technologies.json` on load into `VCS` and `TECHS` arrays. All search, matching, and rendering happen in the browser.

**Page layout:** sticky white nav → full-width navy hero (headline + search + popular chips) → `#results` or `#domainBrowse` section below.

**Default state:** `#domainBrowse` is visible, `#results` is hidden. `renderDomainBrowse()` groups `TECHS` by all entries in `sectors[]` into 8 domain cards. Clicking a domain card calls `viewDomain(sector)` which renders a filtered catalog for that domain.

**Search flow:**
1. Exact substring match on `vc.name` and `vc.aliases`
2. If no exact match → Levenshtein fuzzy match across all VCs (threshold: `max(2, floor(query.length × 0.4))`)
3. Fuzzy hit → auto-show that VC's results with a "Did you mean X?" banner
4. No match → not-found state
5. On any search result: `#domainBrowse` hides, `#results` shows. "Catalog" nav link restores browse.

**Downloads:** `downloadTech(filename)` and `downloadVC(filename)` construct `<a>` tags and `.click()` them. `downloadAllTech()` staggers clicks 800ms apart. Downloads are always user-triggered.

## Data files

**`data/technologies.json`** — 74 entries:
```json
{ "id", "name", "sectors", "stage", "pi", "description", "onePager" }
```
`sectors[0]` is the primary domain used for browse grouping. `onePager` is the bare filename, resolved to `one-pagers/Tech One Pagers/<filename>` at download time.

**`data/vcs.json`** — 12 entries (plus provisional entries added by `generate_vc.js`):
```json
{ "id", "name", "aliases", "focus", "sectors", "stage", "matchedTechs", "vcOnePager", "provisional?" }
```
`matchedTechs` is an array of technology IDs — each active VC has exactly 4. `vcOnePager` is the bare PDF filename. `provisional: true` triggers a yellow banner in the UI for AI-generated entries (no Pitchbook data). Provisional entries also have `checkSize: { min, max }` for the matching score.

## Scripts

Run when one-pagers are added or updated, then review and commit the output JSON.

```bash
node scripts/populate_technologies.js   # rebuilds data/technologies.json from *.docx filenames
node scripts/populate_vcs.js            # rebuilds data/vcs.json from VC PDFs
```

`populate_vcs.js` requires Python/pdfminer (`pip3 install pdfminer.six`). It finds the "JHTV PORTFOLIO MATCHES" → "WHO WE ARE MEETING WITH" section in each VC PDF and matches company names to tech IDs via:
1. Exact normalized match (lowercase, strip non-alphanumeric)
2. 8-char prefix match — handles partial names like "BrainBox" → `brainbox-solutions`

VC names come from filenames, not PDF text (which is all-caps). `nameFromFilename()` handles `8_VC_One_Pager.pdf` → `"8VC"`, `emergence_capital.pdf` → `"Emergence Capital"`, etc.

## Adding a new technology

1. Drop the `.docx` into `one-pagers/Tech One Pagers/`
2. Run `node scripts/populate_technologies.js` — regenerates the full list from filenames
3. Manually add a `sectors` value to the new entry in `data/technologies.json` (determines which domain card it appears under)
4. Commit and push

## Adding a new VC

1. Drop the PDF into `one-pagers/VC One Pagers/Completed One Pagers /` (trailing space)
2. Run `node scripts/populate_vcs.js` — expect 4 matched techs per VC in console output
3. Review/correct `matchedTechs` and add `aliases[]` for common name variations in `data/vcs.json`
4. Commit and push

## Deployment

- GitHub Pages source: `main` branch, root `/`
- No build step — push to `main` = live in ~1 minute

## Future work (deferred)

| Feature | Status |
|---|---|
| `generate_vc.js` — auto-research and match | **Implemented** — requires `ANTHROPIC_API_KEY` env var; run from terminal |
| Not-found → provisional research prompt | **Implemented** — shows terminal command, `triggerResearch()` is the swap point for Phase 2B (Vercel) |
| Provisional result banner | **Implemented** — yellow banner when `vc.provisional === true` |
| Domain cards → filtered catalog | **Implemented** — `viewDomain(sector)` |
| Populate `pi`, `description` in tech JSON | Phase 2 — requires reading `.docx` content via Claude API |
| Vercel backend for in-browser research | Phase 2B — swap `triggerResearch()` to `fetch('/api/research-vc')` |
| Tech one-pagers shift from `.docx` to `.pdf` | When files are ready; update `downloadTech()` path |
| "Saved briefs" and "Contact JHTV" nav links | Currently placeholders — no functionality |

## Provisional VC research flow

When a searched VC isn't in the database, `notFoundHTML()` shows a "Research this VC →" button. Clicking it calls `triggerResearch(vcName)` which reveals a terminal command block. The user runs:

```bash
ANTHROPIC_API_KEY=sk-... node scripts/generate_vc.js "Firm Name"
```

`generate_vc.js` uses Claude's `web_search_20250305` tool to research the firm, scores all 74 technologies (50% industry match, 30% stage, 20% check size), and appends a `provisional: true` entry to `data/vcs.json`. The user then commits and pushes.

**Matching logic:** `INDUSTRY_TO_DOMAIN` maps VC focus strings (e.g. "Life Sciences") to JHTV tech domains. Domain maturity tiers (`DOMAIN_MATURITY`) inform check-size scoring. Tech `stage` field is currently empty for most entries — those default to 0.5 (neutral) in the stage score.

**Phase 2B swap:** replace the `triggerResearch()` function body with a `fetch('/api/research-vc', ...)` call to a Vercel serverless function. No other changes needed.
