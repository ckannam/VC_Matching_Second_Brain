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

Everything runs client-side. `index.html` fetches `data/vcs.json` and `data/technologies.json` on load into `VCS` and `TECHS` arrays. Search and matching are purely in-browser with no API calls.

**Search flow:** user types → case-insensitive substring match on `vc.name` and `vc.aliases` → resolves `matchedTechs` IDs against a `techMap` → renders cards.

**Downloads:** `downloadTech(filename)` and `downloadVC(filename)` construct `<a>` tags and `.click()` them. `downloadAllTech()` staggers clicks 800ms apart. Downloads are always user-triggered — never fire automatically.

## Data files

**`data/technologies.json`** — array of:
```json
{ "id", "name", "sectors", "stage", "pi", "description", "onePager" }
```
`onePager` is the bare filename (e.g. `"My_Tech_One_Pager.docx"`); resolved to `one-pagers/Tech One Pagers/<filename>` at download time.

**`data/vcs.json`** — array of:
```json
{ "id", "name", "aliases", "focus", "sectors", "stage", "matchedTechs", "vcOnePager" }
```
`matchedTechs` is an array of technology IDs. Each VC should have exactly 4. `vcOnePager` is the bare PDF filename.

## Scripts

These scripts regenerate the JSON data files from the source files. Run them when one-pagers are added or updated, then review and commit the resulting JSON.

```bash
node scripts/populate_technologies.js   # rebuilds data/technologies.json from *.docx filenames
node scripts/populate_vcs.js            # rebuilds data/vcs.json by extracting text from VC PDFs
```

`populate_vcs.js` uses Python/pdfminer (`pip3 install pdfminer.six`) to extract PDF text. It finds the "JHTV PORTFOLIO MATCHES" → "WHO WE ARE MEETING WITH" section in each VC PDF, then matches company names to tech IDs using:
1. Exact normalized match (lowercase, strip non-alphanumeric)
2. 8-char prefix match — handles partial names like "BrainBox" matching `brainbox-solutions`

VC names are derived from filenames (not PDF text, which is all-caps). `nameFromFilename()` handles edge cases like `8_VC_One_Pager.pdf` → `"8VC"` and `emergence_capital.pdf` → `"Emergence Capital"`.

## Adding a new VC

**Manual (Phase 1):**
1. Drop the PDF into `one-pagers/VC One Pagers/Completed One Pagers /` (note trailing space)
2. Run `node scripts/populate_vcs.js` — check the console for match count; expect 4 per VC
3. Review and correct `matchedTechs` in `data/vcs.json` if needed
4. Add search aliases to `aliases[]` for common name variations
5. Commit and push

**AI-assisted (Phase 2 — not yet implemented):**
```bash
ANTHROPIC_API_KEY=... node scripts/generate_vc.js "VC Name"
```

## Adding a new technology

1. Drop the `.docx` into `one-pagers/Tech One Pagers/`
2. Run `node scripts/populate_technologies.js` — this regenerates the full list from filenames
3. Commit and push

## Deployment

- GitHub Pages source: `main` branch, root `/`
- No build step — push to `main` is immediately live
- `.github/workflows/` may contain deployment config

## Future work (deferred)

| Feature | Status |
|---|---|
| Populate `pi`, `description`, `sectors` in tech JSON | Phase 2 — requires reading `.docx` content via Claude API |
| `generate_vc.js` — auto-research VC and match techs | Phase 2 — Claude API + web fetch |
| Tech one-pagers shift from `.docx` to `.pdf` | When files are ready; update `downloadTech()` path |
| Sector / stage filter in browse mode | Client-side dropdown on `TECHS` array |
