# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A fully static GitHub Pages web app that acts as a "second brain" for JHTV staff. Type in a VC firm name and get back matched JHTV technology one-pagers as downloadable PDFs, tailored to that VC's investment focus. No build step, no backend — just HTML, CSS, JS, JSON, and PDFs.

Deployed at: `https://ckannam.github.io/VC_Matching_Second_Brain/`

## Running locally

Open `index.html` directly in a browser **won't work** due to `fetch()` CORS restrictions on `file://` URLs. Use a local server instead:

```bash
npx serve .          # or: python3 -m http.server 8080
```

## Architecture

Everything is client-side. On page load, `index.html` fetches `data/vcs.json` and `data/technologies.json` into memory (`VCS` and `TECHS` variables). Search and matching run entirely in the browser.

**Search flow:** user types VC name → case-insensitive substring match on `vc.name` and `vc.aliases` → returns matched VC + technologies from `techMap`.

**PDF downloads:** direct links to `one-pagers/<filename>` — no server involved.

**Browse mode:** "Browse all technologies" toggle renders all `TECHS` as cards using the same `techCardHTML()` function.

## Data files

**`data/technologies.json`** — array of technology objects:
```json
{ "id", "name", "sectors", "stage", "pi", "description", "onePager" }
```
`onePager` is the filename only (e.g. `"my-tech.pdf"`), resolved against `one-pagers/`.

**`data/vcs.json`** — array of VC objects:
```json
{ "id", "name", "aliases", "focus", "sectors", "stage", "matchedTechs" }
```
`matchedTechs` is an array of technology IDs from `technologies.json`.

## Adding a new technology one-pager

1. Drop the PDF into `one-pagers/`
2. Add an entry to `data/technologies.json` with a unique `id` and `"onePager": "filename.pdf"`
3. Commit and push — GitHub Pages updates automatically

## Adding a new VC (manual)

1. Add an entry to `data/vcs.json` with `matchedTechs` pointing to the relevant technology IDs
2. Add common name variations to `aliases` so search is forgiving
3. Commit and push

## Adding a new VC (AI-assisted, Phase 2)

```bash
ANTHROPIC_API_KEY=... node scripts/generate_vc.js "VC Name"
```

Currently stubs out the entry shape and prints it for manual review. Full implementation will use the Claude API + `web_fetch` to research the VC and auto-match technologies.

## GitHub Pages deployment

- Source: `main` branch, root `/`
- `index.html` at root is served automatically
- No build step — push to `main` = live update

## Future features (architecture notes)

| Feature | Approach |
|---|---|
| Sector / stage filter in browse mode | Add dropdown UI to `index.html`, filter `TECHS` client-side |
| Export bundle (zip of all matching PDFs) | Add JSZip from CDN — no build step needed |
| VC / tech detail pages | Hash routing (`#vc/blueprint-health`) handled in `index.html` |
| AI VC generation in CI | GitHub Actions workflow running `scripts/generate_vc.js` |
| Auth / private data | Requires a real backend at that point (Render/Vercel) |
