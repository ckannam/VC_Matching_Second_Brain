# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Node.js/Express web app that acts as a "second brain" for JHTV staff — type in a VC firm name and get back matched JHTV technology one-pagers as downloadable PDFs, tailored to that VC's investment focus. Deployed on Render.com.

## Running things

```bash
npm install          # first time only
npm start            # production (node server.js)
npm run dev          # development with auto-reload (node --watch)
```

Server runs on `http://localhost:3000` by default. Set `PORT` env var to override.

## Architecture

**`server.js`** — Express entry point. Mounts `/api/search`, `/api/download`, and the Phase 2 stub `/api/generate-vc`. Serves `public/` as static files.

**`routes/search.js`** — `GET /api/search?vc=<name>` reads `data/vcs.json` and `data/technologies.json` on every request (no caching — files are small). Returns `{ found, vc, technologies }`. Matching is case-insensitive substring against `name` and `aliases`.

**`routes/download.js`** — `GET /api/download/:techId` looks up the technology's `onePager` filename in `technologies.json` and streams the PDF from `one-pagers/`.

**`public/index.html`** — entire frontend in one file. No framework. Calls `/api/search` on submit, renders result cards, triggers PDF downloads via `window.location.href`.

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

## Adding a new VC

1. Add an entry to `data/vcs.json` with `matchedTechs` pointing to the relevant technology IDs
2. Add common name variations to `aliases` so search is forgiving

## PDF files and git

PDFs in `one-pagers/` are committed to the repo (they are the source of truth for the live site). If files become large, consider git-lfs.

## Phase 2 (not yet implemented)

`POST /api/generate-vc` is stubbed with a 501 response. When implemented, it will:
1. Use the Claude API + `web_fetch` tool to research the VC from public sources
2. Score each technology in `technologies.json` against the VC's investment thesis
3. Save the result to `vcs.json` for future lookups

## Deployment (Render.com)

- Connect the GitHub repo in Render dashboard
- Build command: `npm install`
- Start command: `node server.js`
- Set `PORT` env var if needed (Render injects it automatically)
