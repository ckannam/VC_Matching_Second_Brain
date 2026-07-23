# Tech curation page — pause/resume matching, cohort-grouped (design)

**Date:** 2026-07-23
**Status:** Approved design → implementation plan next.

## Context / why

JHTV staff (primarily the boss) need to control which JHTV technologies are *actively being
matched to VCs* at a given time. A tech may need to be paused for reasons the tool can't know — IP
timing, a founder's wishes, a deal in progress — i.e. "circumstances beyond the scope of information
we have." Today all 74 techs always match. This adds a curation page where the boss can pause/resume
individual techs, whole buckets (within a cohort or across all cohorts), or whole cohorts, and that
curation is shared and authoritative for everyone using the tool.

It also introduces a **cohort** dimension: the current 74 techs are Cohort 1; future non-confidential
("non-con") deck intakes become new cohorts, and the page groups by the cohort each tech was added in.

## Locked decisions

1. **Persistence:** shared & authoritative. Selections are committed to a repo file via the existing
   Render backend GitHub-commit path (same mechanism as auto-researched VCs), not localStorage.
2. **Exclusion scope:** matching-only. A paused tech is excluded from all VC matching but still shown
   in the catalog with a muted "Paused — not matching" marker (staff can see it exists and why it's
   not surfacing).
3. **Grouping:** Cohort → bucket. Select-all at three scopes: a tech, a bucket within a cohort, a
   whole cohort, **and a bucket across all cohorts** (a global control strip).
4. **UI:** reuse the existing look (navy headers, `--muted`/gold accents, `DOMAIN_COLORS` dots, soft
   pills, `catalog-section`/`section-label` frame, existing button styles). No new visual language.

## Data model

- **`cohort` field on each tech in `data/technologies.json`** (intrinsic catalog metadata). Existing
  74 → `"Cohort 1"`. Future batches → a new label (e.g. `"Cohort 2 — Fall 2026"`), set when the tech
  is added. `scripts/populate_technologies.js` and `scripts/enrich_tech_data.js` must **preserve an
  existing `cohort`** on regen (merge by id; default missing → `"Cohort 1"`), so a catalog rebuild
  never drops it.
- **New `data/tech_status.json`** — mutable curation state, kept **separate** from the regenerated
  catalog so populate scripts never clobber it:
  ```json
  { "pausedTechIds": ["egret-therapeutics", "…"], "updatedAt": "2026-07-23T…Z" }
  ```
  Missing/empty ⇒ nothing paused ⇒ everything matches (fail-soft). `pausedTechIds` is the source of
  truth; "active" = not in the set.

## Components

### 1. Load + filter (`index.html`)

- `loadData()` fail-soft-fetches `data/tech_status.json` → `PAUSED` (a `Set` of ids); missing/empty
  ⇒ empty set. Pure helper `activeTechs(techs, paused)` = `techs.filter(t => !paused.has(t.id))`
  (2-arg so it's unit-testable); `index.html` calls `activeTechs(TECHS, PAUSED)`.
- **Matching excludes paused:** `topTechsForVC(vc)` ranks over `activeTechs(TECHS, PAUSED)` so a paused tech
  never surfaces as a VC's match. A paused tech's own `#/tech/<id>` funding-profile page still renders
  (reachable from the catalog) but shows the "Paused — not matching" marker in its header.
- **Catalog shows paused:** `renderDomainBrowse`, `renderAllTechs`, `renderDomain` still list paused
  techs, rendered with a muted `.paused-badge` ("Paused — not matching"); they are visually de-
  emphasized (e.g. reduced opacity) but not removed.

### 2. Curation page (`#/curate`)

- Nav button "Curate" (peer to Catalog / Saved briefs / JHTV backers / Grant checker). `showCurate()`
  sets `location.hash = '#/curate'`; `renderCurate()` dispatched from the hashchange router.
- **Global bucket strip** (top): one toggle per domain present in the catalog, each showing a
  `DOMAIN_COLORS` dot; clicking pauses/resumes **every** tech in that bucket across all cohorts.
- **Cohort sections** (below): one `catalog-section` per cohort (sorted, Cohort 1 first), each with a
  "select all" for the cohort; within each, bucket sub-groups (domain-dot header + per-bucket "select
  all"); within each bucket, a compact checkbox list of techs (checked = active). Paused techs show
  the muted marker.
- **State + sync:** current pause state loads into an in-memory working set; edits are local until
  Save. All controls stay in sync — a global bucket toggle updates every matching checkbox and the
  per-cohort/per-bucket toggles; unchecking the last active tech in a group updates its parent
  toggles (indeterminate/unchecked states).
- **Save:** a sticky "Save changes" button, disabled until the working set differs from loaded state.
  On click it POSTs the full `pausedTechIds` to the backend once (not per-toggle), shows saving →
  saved / error states, and tolerates the backend cold-start (spinner + "still saving…" after a few
  seconds). On success the working set becomes the new baseline. Uses the same local-vs-prod backend
  selection as the research flow (`RESEARCH_SERVER`/hostname check).

### 3. Backend (`server.js`)

- New `POST /api/tech-status` — body `{ pausedTechIds: string[] }`. Validates it's an array of
  strings, then `commitTechStatus(pausedTechIds)` mirroring `commitVcEntry()`: GET the file SHA (if
  present), PUT `data/tech_status.json` (`{ pausedTechIds, updatedAt }`) to the GitHub contents API
  with `GITHUB_TOKEN`, retrying once on SHA conflict. Returns `{ ok: true, updatedAt }`. CORS already
  allows the Pages origin. `require.main === module` unaffected.

### 4. Scripts / regeneration

- `scripts/populate_technologies.js`: when rebuilding `technologies.json`, read any existing file
  first and carry each tech's `cohort` (and other enriched fields it already preserves) by id;
  default new/unknown → `"Cohort 1"`. Document the "add a new cohort" flow: drop the new `.docx`
  files, run populate (they default to Cohort 1), then set their `cohort` to the new label (a one-
  line manual edit or a `--cohort "Cohort 2 — …"` flag on the populate script for the new files).

## Testing

- `test/tech_curation.test.js` (plain Node):
  - `activeTechs(techs, pausedSet)` excludes exactly the paused ids and nothing else.
  - A cohort→bucket grouping helper (extract it as a pure function, e.g. `groupByCohortBucket(techs)`)
    returns cohorts in order, buckets per cohort, techs per bucket; a tech with multiple sectors
    appears under each of its buckets.
  - `data/tech_status.json` schema guard (if committed): `pausedTechIds` is an array of strings that
    all exist in `technologies.json`.
  - Every tech in `technologies.json` has a non-empty `cohort`.
- Backend `POST /api/tech-status` is verified manually (network commit), like the existing research
  flow; a lightweight input-validation unit (array-of-strings) may be added if the handler is
  factored to a pure validator.
- Browser: pause a tech → it drops from a VC's matched list and from tech→VC investor lists, and
  shows the paused marker in the catalog; global bucket toggle pauses a whole domain across cohorts;
  Save persists (commit appears) and reload reflects it; fail-soft (no backend / no file → everything
  active). No console errors.

## Conventions

- All new fetches fail-soft; classic-script functions; router `show*`/`render*` convention preserved.
- `tech_status.json` is the single source of pause truth; `cohort` lives only in `technologies.json`.
- CLAUDE.md: document the Curate page, the two files, the backend endpoint, the filter points, and
  the add-a-cohort flow; note that `populate_technologies.js` now preserves `cohort`.

## Out of scope / deferred

- Access control on `#/curate` (the site is internal with no auth per project norms; the route is
  simply unadvertised).
- Per-tech pause reasons/notes, scheduled auto-resume, audit log of who paused what.
- Reordering or renaming cohorts in the UI (cohorts are set in the data).

## Verification

- Pause/resume at all four scopes works and stays in sync; Save commits `data/tech_status.json`;
  a fresh load reads it and excludes paused techs from matching while the catalog shows them paused.
- `node test/tech_curation.test.js` passes; existing suites stay green.
- Missing `tech_status.json` or offline backend ⇒ no visible change (everything active).
