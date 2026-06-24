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

**Nav links:** "Catalog" → `showDomainBrowse()` | "Saved briefs" → `showSavedBriefs()`

**Default state:** `#domainBrowse` is visible, `#results` is hidden. `renderDomainBrowse()` groups `TECHS` by all entries in `sectors[]` (not just `sectors[0]`) into 8 domain cards — dual-sector techs appear in both their domain cards.

**Domain colors:** `DOMAIN_COLORS` maps each of the 8 domains to a hex color. Used at two intensities:
- *Landing cards:* 10% opacity tint on the icon background (`${color}18`), full color on the SVG stroke via `currentColor`
- *Domain catalog view:* solid left-border stripe on the header block, 20% tint on the icon, full color on the domain name, 3px top border on each tech card, colored sector tag pills

**Clicking a domain card** calls `viewDomain(sector)` — hides `#domainBrowse`, shows `#results` with a color-coded header and filtered tech grid. "← Back to domains" restores the browse.

**Search flow:**
1. Exact substring match on `vc.name` and `vc.aliases`
2. If no exact match → Levenshtein fuzzy match across all VCs (threshold: `max(2, floor(query.length × 0.4))`)
3. Fuzzy hit → auto-show that VC's results with a "Did you mean X?" banner
4. No match → `notFoundHTML()` — shows "Research this VC →" button (see provisional flow below)
5. On any result: `#domainBrowse` hides, `#results` shows

**Downloads:** `downloadTech(filename)` and `downloadVC(filename)` construct `<a>` tags and `.click()` them. `downloadAllTech()` staggers clicks 800ms apart. Downloads are always individually user-triggered.

## Data files

**`data/technologies.json`** — 74 entries:
```json
{ "id", "name", "sectors", "stage", "pi", "description", "onePager" }
```
`sectors[]` is an array of domain names — most techs have one, three have two (3Dnamics, Biolinco, Infinity Bio). `onePager` is the bare filename, resolved to `one-pagers/Tech One Pagers/<filename>` at download time. `stage` is currently empty for all entries.

**`data/vcs.json`** — 12 base entries (plus provisional entries added by `generate_vc.js`):
```json
{ "id", "name", "aliases", "focus", "sectors", "stage", "matchedTechs", "vcOnePager", "provisional?" }
```
Each active VC has exactly 4 `matchedTechs` IDs. `vcOnePager` is the bare PDF filename. `provisional: true` entries (from `generate_vc.js`) also carry `checkSize: { min, max }` and trigger a yellow banner in the UI.

## Domain assignments (all 74 techs)

| Domain | Count | Key techs |
|---|---|---|
| Therapeutics | 23 | Accelevir, AgeneBio, Ashvattha, 3Dnamics†, Biolinco† … |
| Medical Devices | 15 | BrainBox Solutions, Phantom Neuro, Virtuoso Surgical … |
| Digital Health | 17 | Astropath, Bullfrog AI, Circlage, EpiWatch … |
| Diagnostics | 12 | 28Bio, CardioWise, Delfi Diagnostics, Infinity Bio† … |
| Research Technologies | 3 | 3Dnamics†, Biolinco†, Infinity Bio† (all dual-sector) |
| Clean Tech | 3 | EDAC Labs, Etch, Geothermal Technologies |
| Cybersecurity | 3 | Avoid, ForagerOne, Read-Ahead |
| Agricultural Tech | 1 | Deep Root BioLabs |

† Dual-sector: appears in both domain cards.

## Scripts

Run when one-pagers are added or updated, then review and commit the output JSON.

```bash
node scripts/populate_technologies.js   # rebuilds data/technologies.json from *.docx filenames
node scripts/populate_vcs.js            # rebuilds data/vcs.json from VC PDFs
```

`populate_vcs.js` requires Python/pdfminer (`pip3 install pdfminer.six`). It finds the "JHTV PORTFOLIO MATCHES" → "WHO WE ARE MEETING WITH" section in each VC PDF and matches company names to tech IDs via exact normalized match then 8-char prefix match. VC names come from filenames, not PDF text (which is all-caps).

## Adding a new technology

1. Drop the `.docx` into `one-pagers/Tech One Pagers/`
2. Run `node scripts/populate_technologies.js` — regenerates the full list from filenames
3. Manually add a `sectors` value to the new entry in `data/technologies.json`
4. Commit and push

## Adding a researched VC (with one-pager PDF)

1. Drop the PDF into `one-pagers/VC One Pagers/Completed One Pagers /` (trailing space)
2. Run `node scripts/populate_vcs.js` — expect 4 matched techs per VC in console output
3. Review/correct `matchedTechs` and add `aliases[]` for common name variations in `data/vcs.json`
4. Commit and push

## Provisional VC research flow (unresearched firms)

When a searched VC isn't in the database, `notFoundHTML()` shows a "Research this VC →" button. Clicking calls `triggerResearch(vcName)` which reveals a terminal command block. The user runs:

```bash
ANTHROPIC_API_KEY=sk-... node scripts/generate_vc.js "Firm Name"
```

`generate_vc.js` uses Claude Opus with the `web_search_20250305` tool to research the firm, then scores all 74 technologies and picks the top 4. Scoring: 50% industry match (`INDUSTRY_TO_DOMAIN` keyword table), 30% stage compatibility, 20% check-size vs domain maturity tier. Appends a `provisional: true` entry to `data/vcs.json`. User commits and pushes; the app then shows the result with a yellow "Provisional — no Pitchbook data" banner.

**Phase 2B:** replace `triggerResearch()` body with `fetch('/api/research-vc', { method:'POST', body: JSON.stringify({ vcName }) })` pointing at a Vercel serverless function. No other changes needed.

## Deployment

- GitHub Pages source: `main` branch, root `/`
- No build step — push to `main` = live in ~1 minute

## Deferred

| Feature | Notes |
|---|---|
| Populate `pi`, `description` in tech JSON | Requires reading `.docx` content via Claude API |
| Vercel backend for in-browser VC research | Swap `triggerResearch()` — see Phase 2B above |
| Tech one-pagers shift from `.docx` to `.pdf` | When files are ready; update `downloadTech()` path |
