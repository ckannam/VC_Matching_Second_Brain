# Tech Curation Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `#/curate` page where staff pause/resume which JHTV techs are matched to VCs — per tech, per bucket-in-cohort, per cohort, and per bucket across all cohorts — with shared/authoritative state committed to `data/tech_status.json` via the backend.

**Architecture:** Pure helpers (`activeTechs`, `groupByCohortBucket`) live in a new dual-mode `curation.js` (classic-script + `module.exports`, like `scoring.js`). A `cohort` field is added to each tech; mutable pause state lives in a separate `data/tech_status.json` (so catalog rebuilds don't clobber it), fetched fail-soft into a `PAUSED` set. Matching (`topTechsForVC`) filters paused techs out; the catalog shows them with a muted "paused" marker. The curation page edits an in-memory working set and POSTs it to a new `server.js` endpoint that commits the file (mirroring `commitVcEntry`).

**Tech Stack:** Static `index.html` + `style.css` (classic scripts), `curation.js` (dual module), Express `server.js`, Node CLI scripts, plain-Node `assert` tests.

## Global Constraints

- **Persistence:** shared/authoritative — pause state is committed to `data/tech_status.json` via the Render backend (reuse the `commitVcEntry` GitHub-contents-PUT pattern). Client picks backend URL via the existing `RESEARCH_SERVER` constant (`index.html:83`).
- **Exclusion:** matching-only. Paused techs are excluded from `topTechsForVC`; still listed in the catalog with a muted "Paused — not matching" marker.
- **Grouping:** Cohort → bucket. Four pause scopes: one tech, a bucket within a cohort, a whole cohort, a bucket across all cohorts.
- **Data separation:** `cohort` lives only in `data/technologies.json`; pause state only in `data/tech_status.json` (`{ "pausedTechIds": [...], "updatedAt": "…" }`). Missing/empty status ⇒ everything active (fail-soft).
- **UI:** reuse existing look — navy headers, `--muted`/gold accents, `DOMAIN_COLORS` dots, soft pills, `catalog-section`/`section-label` frame, existing `.btn` styles, `show*`/`render*` router convention.
- Tests: plain Node `assert`, `process.exit(fail?1:0)`, like `test/scoring.test.js`. Backend network commit is verified manually (like the research flow); its input validator is unit-tested.

---

### Task 1: Data — `cohort` field, `tech_status.json`, populate preserves cohort

**Files:**
- Modify: `data/technologies.json` (add `cohort` to all 74)
- Create: `data/tech_status.json`
- Modify: `scripts/populate_technologies.js` (merge by id, preserve fields incl. `cohort`)

**Interfaces:**
- Produces: every tech has a non-empty `cohort` (existing → `"Cohort 1"`); `data/tech_status.json` = `{ pausedTechIds: [], updatedAt: null }`.

- [ ] **Step 1: Add `cohort` to every tech.** Run:

```bash
node -e "
const fs=require('fs'); const p='data/technologies.json';
const t=JSON.parse(fs.readFileSync(p,'utf8'));
for(const x of t) if(!x.cohort) x.cohort='Cohort 1';
fs.writeFileSync(p, JSON.stringify(t,null,2));
console.log('cohort set on', t.length, 'techs');"
```
Expected: `cohort set on 74 techs`.

- [ ] **Step 2: Create `data/tech_status.json`:**

```json
{
  "pausedTechIds": [],
  "updatedAt": null
}
```

- [ ] **Step 3: Make `populate_technologies.js` merge by id** (so a rebuild preserves `sectors`/`stage`/`pi`/`description`/`cohort` instead of wiping them). Replace the `const techs = files.map(...)` block (`scripts/populate_technologies.js:25-40`) with:

```javascript
const existing = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : [];
const byId = new Map(existing.map(t => [t.id, t]));

const techs = files.map(filename => {
  const base = filename.replace(/_One_Pager\.docx$/i, '').replace(/\.docx$/i, '');
  const id   = slugify(base);
  const name = humanize(base);
  const prev = byId.get(id) || {};
  return {
    id,
    name,
    sectors:     prev.sectors     || [],
    stage:       prev.stage       || '',
    pi:          prev.pi          || '',
    description: prev.description || '',
    cohort:      prev.cohort      || 'Cohort 1',
    onePager:    filename,
  };
});
```

- [ ] **Step 4: Verify populate is non-destructive.** Run:

```bash
node scripts/populate_technologies.js && node -e "
const t=require('./data/technologies.json');
console.log('techs:', t.length, '| all have cohort:', t.every(x=>x.cohort), '| all have sectors:', t.every(x=>Array.isArray(x.sectors)));
const e=t.find(x=>x.id==='epiwatch'); console.log('epiwatch sectors preserved:', JSON.stringify(e.sectors), '| cohort:', e.cohort);"
```
Expected: 74 techs, all have cohort, `epiwatch` still shows `["Digital Health"]` and `Cohort 1` (proves the merge preserved enriched data). Then `git diff --stat data/technologies.json` should show only the `cohort` additions.

- [ ] **Step 5: Commit.**

```bash
git add data/technologies.json data/tech_status.json scripts/populate_technologies.js
git commit -m "feat: add cohort field + tech_status.json; populate merges by id"
```

---

### Task 2: `curation.js` pure helpers + tests

**Files:**
- Create: `curation.js`
- Test: `test/curation.test.js`

**Interfaces:**
- Produces: `activeTechs(techs, paused)` → techs not in `paused` (Set or array of ids); `groupByCohortBucket(techs)` → `[{ cohort, buckets: [{ bucket, techs: [] }] }]` (cohorts sorted, buckets sorted, a multi-sector tech appears under each of its sectors).

- [ ] **Step 1: Write `curation.js`:**

```javascript
'use strict';
/* Pure helpers for the tech curation feature (pause/resume matching, cohort grouping).
 * Dual classic-script + module.exports, same pattern as scoring.js — the browser loads
 * it via <script defer>, Node requires it in tests. */

// Techs whose id is NOT in the paused set. `paused` may be a Set or an array of ids.
function activeTechs(techs, paused) {
  const set = paused instanceof Set ? paused : new Set(paused || []);
  return (techs || []).filter(t => !set.has(t.id));
}

// Group techs → [{ cohort, buckets: [{ bucket, techs }] }]. Cohorts sorted (Cohort 1
// first), buckets alphabetical, techs by name. A tech with multiple sectors appears
// under each; a tech with no sectors goes under "(unassigned)".
function groupByCohortBucket(techs) {
  const cohorts = new Map(); // cohort → Map(bucket → techs[])
  for (const t of techs || []) {
    const cohort = t.cohort || 'Cohort 1';
    if (!cohorts.has(cohort)) cohorts.set(cohort, new Map());
    const buckets = cohorts.get(cohort);
    const secs = (t.sectors && t.sectors.length) ? t.sectors : ['(unassigned)'];
    for (const b of secs) {
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(t);
    }
  }
  return [...cohorts.keys()].sort().map(cohort => ({
    cohort,
    buckets: [...cohorts.get(cohort).keys()].sort().map(bucket => ({
      bucket,
      techs: cohorts.get(cohort).get(bucket).slice().sort((a, b) => a.name.localeCompare(b.name)),
    })),
  }));
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { activeTechs, groupByCohortBucket };
```

- [ ] **Step 2: Write the failing test** `test/curation.test.js`:

```javascript
'use strict';
const assert = require('assert');
const { activeTechs, groupByCohortBucket } = require('../curation.js');
const TECHS = require('../data/technologies.json');
const STATUS = require('../data/tech_status.json');

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

const sample = [
  { id: 'a', name: 'A', sectors: ['Therapeutics'], cohort: 'Cohort 1' },
  { id: 'b', name: 'B', sectors: ['Therapeutics', 'Diagnostics'], cohort: 'Cohort 1' },
  { id: 'c', name: 'C', sectors: ['Digital Health'], cohort: 'Cohort 2' },
];

check('activeTechs excludes exactly the paused ids', () => {
  const out = activeTechs(sample, new Set(['b']));
  assert.deepStrictEqual(out.map(t => t.id), ['a', 'c']);
  assert.strictEqual(activeTechs(sample, []).length, 3);
});

check('groupByCohortBucket groups by cohort then bucket, multi-sector under each', () => {
  const g = groupByCohortBucket(sample);
  assert.deepStrictEqual(g.map(x => x.cohort), ['Cohort 1', 'Cohort 2']);
  const c1 = g[0].buckets;
  assert.deepStrictEqual(c1.map(x => x.bucket), ['Diagnostics', 'Therapeutics']);
  assert.deepStrictEqual(c1.find(x => x.bucket === 'Therapeutics').techs.map(t => t.id), ['a', 'b']);
  assert.deepStrictEqual(c1.find(x => x.bucket === 'Diagnostics').techs.map(t => t.id), ['b']);
});

check('every real tech has a non-empty cohort', () => {
  for (const t of TECHS) assert.ok(t.cohort, `${t.id} missing cohort`);
});

check('tech_status.pausedTechIds is a string[] of real tech ids', () => {
  const ids = new Set(TECHS.map(t => t.id));
  assert.ok(Array.isArray(STATUS.pausedTechIds));
  for (const id of STATUS.pausedTechIds) {
    assert.strictEqual(typeof id, 'string');
    assert.ok(ids.has(id), `paused id ${id} not in catalog`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the test.**

Run: `node test/curation.test.js`
Expected: `4 passed, 0 failed`.

- [ ] **Step 4: Commit.**

```bash
git add curation.js test/curation.test.js
git commit -m "feat: curation.js pure helpers (activeTechs, groupByCohortBucket) + tests"
```

---

### Task 3: Backend endpoint `POST /api/tech-status`

**Files:**
- Modify: `server.js` (add `STATUS_API`, `commitTechStatus`, the route; validator extracted for testing)
- Test: `test/tech_status_endpoint.test.js`

**Interfaces:**
- Produces: `validatePausedIds(body)` → `{ ok:true, pausedTechIds } | { ok:false, error }`; `POST /api/tech-status` commits `data/tech_status.json` and returns `{ ok:true, updatedAt }`.

- [ ] **Step 1: Add the GitHub helper + validator + route.** In `server.js`, after the `commitVcEntry` function (line 89), add:

```javascript
const STATUS_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/data/tech_status.json`;

function validatePausedIds(body) {
  const ids = body && body.pausedTechIds;
  if (!Array.isArray(ids) || !ids.every(x => typeof x === 'string'))
    return { ok: false, error: 'pausedTechIds must be an array of strings' };
  return { ok: true, pausedTechIds: ids };
}

async function commitTechStatus(pausedTechIds) {
  const doc = JSON.stringify({ pausedTechIds, updatedAt: new Date().toISOString() }, null, 2);
  const put = async (sha) => fetch(STATUS_API, {
    method: 'PUT', headers: ghHeaders(),
    body: JSON.stringify({
      message: `chore: update tech pause status (${pausedTechIds.length} paused)`,
      content: Buffer.from(doc).toString('base64'), sha, branch: 'main',
    }),
  });
  const getRes = await fetch(STATUS_API, { headers: ghHeaders() });
  let sha; if (getRes.ok) sha = (await getRes.json()).sha; // undefined if file doesn't exist yet
  let res = await put(sha);
  if (res.status === 409) { // stale SHA — refetch + retry once
    const fresh = await fetch(STATUS_API, { headers: ghHeaders() });
    res = await put((await fresh.json()).sha);
  }
  if (!res.ok) throw new Error(`GitHub PUT tech_status.json failed: ${res.status}`);
  return JSON.parse(doc).updatedAt;
}
```

- [ ] **Step 2: Add the route.** After the `GET /api/job/:jobId` handler (line 133), add:

```javascript
// POST /api/tech-status  Body: { pausedTechIds: string[] }  → commits data/tech_status.json
app.post('/api/tech-status', async (req, res) => {
  const v = validatePausedIds(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const updatedAt = await commitTechStatus(v.pausedTechIds);
    res.json({ ok: true, updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message || 'commit failed' });
  }
});
```

- [ ] **Step 3: Export the validator for testing.** At the very bottom of `server.js`, after `app.listen(...)`, add:

```javascript
if (typeof module !== 'undefined' && module.exports) module.exports = { validatePausedIds };
```

- [ ] **Step 4: Write the validator test** `test/tech_status_endpoint.test.js`:

```javascript
'use strict';
const assert = require('assert');
const { validatePausedIds } = require('../server.js');
let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('accepts an array of strings', () => {
  const v = validatePausedIds({ pausedTechIds: ['a', 'b'] });
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual(v.pausedTechIds, ['a', 'b']);
});
check('accepts empty array', () => assert.strictEqual(validatePausedIds({ pausedTechIds: [] }).ok, true));
check('rejects non-array / non-strings / missing', () => {
  assert.strictEqual(validatePausedIds({ pausedTechIds: 'x' }).ok, false);
  assert.strictEqual(validatePausedIds({ pausedTechIds: [1, 2] }).ok, false);
  assert.strictEqual(validatePausedIds({}).ok, false);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

> Note: `server.js` starts the Express listener at require time. That's fine for a quick unit test (the process exits after the asserts), matching the repo's simple test style. Do not add network calls to this test.

- [ ] **Step 5: Run the test.**

Run: `node test/tech_status_endpoint.test.js`
Expected: `3 passed, 0 failed` (the server also logs "JHTV research server on port 3000" — ignore it).

- [ ] **Step 6: Commit.**

```bash
git add server.js test/tech_status_endpoint.test.js
git commit -m "feat: POST /api/tech-status commits data/tech_status.json"
```

---

### Task 4: Load + filter matching + catalog "paused" marker

**Files:**
- Modify: `index.html` — `<script>` include (`~12`), `loadData` (`~96-115`), `PAUSED` global (`~91`), `topTechsForVC` (`~630`), `techCardHTML` (`~896-917`)
- Modify: `style.css` — `.paused-badge`, `.tech-card.paused`

**Interfaces:**
- Consumes: `activeTechs` (curation.js), `data/tech_status.json`.
- Produces: `PAUSED` (Set of paused ids); paused techs excluded from `topTechsForVC`; catalog cards show the marker.

- [ ] **Step 1: Load `curation.js`.** Add before the `scoring.js` script tag (`index.html:12`):

```html
  <script src="curation.js" defer></script>
```

- [ ] **Step 2: Declare `PAUSED`.** Beside `let RECENCY_BY_VC = {};` (`index.html:92`):

```javascript
  let PAUSED = new Set();  // tech ids paused from matching (data/tech_status.json)
```

- [ ] **Step 3: Fetch status in `loadData`.** Add an 8th fetch to the `Promise.all` and assign after `RECENCY_BY_VC`:

```javascript
        fetch('data/tech_status.json').then(r => r.ok ? r.json() : { pausedTechIds: [] }).catch(() => ({ pausedTechIds: [] })),
```
Add `statusRaw` to the destructured list and below `RECENCY_BY_VC = recencyRaw.byVc || {};`:
```javascript
      PAUSED = new Set((statusRaw.pausedTechIds) || []);
```

- [ ] **Step 4: Exclude paused from matching.** In `topTechsForVC` (`index.html:630`), change the source list from `TECHS` to `activeTechs(TECHS, PAUSED)`:

```javascript
    const ranked = activeTechs(TECHS, PAUSED)
      .map(t => { const fit = vcFitScore(vc, t, portfolio); return fit ? { t, score: fit.score, fit, tieKey: fit.depth * techDomainRecency(rec, t) } : null; })
```

- [ ] **Step 5: Mark paused techs in the catalog.** In `techCardHTML` (`index.html:896`), compute a paused flag and render a badge + class. Replace the `return \`` line and the opening `<div class="tech-card"...>`/`<h3>` with:

```javascript
    const paused = PAUSED.has(t.id);
    return `
      <div class="tech-card${paused ? ' paused' : ''}" style="${topBorder}">
        <h3 class="tech-card-title" onclick="viewTech('${t.id}')" title="View funding profile">${t.name}${typeof score === 'number' ? ` <span class="tech-score${tied ? ' tied' : ''}">${score.toFixed(2)}</span>` : ''}${paused ? ` <span class="paused-badge">Paused — not matching</span>` : ''}</h3>
```
(Leave the rest of the card body unchanged.)

- [ ] **Step 6: Styles** in `style.css` (near `.tied-group`):

```css
.paused-badge {
  font-size: .68rem; font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
  color: var(--muted); background: var(--paper); border: 1px solid var(--border);
  border-radius: 999px; padding: 1px 8px; vertical-align: middle;
}
.tech-card.paused { opacity: .6; }
.tech-card.paused .tech-card-title { color: var(--muted); }
```

- [ ] **Step 7: Verify.**

```bash
python3 -m http.server 8095 >/tmp/sb.log 2>&1 &
```
Temporarily pause a tech to test: `node -e "const fs=require('fs');fs.writeFileSync('data/tech_status.json', JSON.stringify({pausedTechIds:['epiwatch'],updatedAt:null},null,2))"`. Open `http://localhost:8095/index.html?v=1#/` (cache-bust) → catalog shows EpiWatch dimmed with "Paused — not matching". Open a Digital-Health VC (e.g. `#/vc/nea`) → EpiWatch is absent from matched techs. Revert: `node -e "const fs=require('fs');fs.writeFileSync('data/tech_status.json', JSON.stringify({pausedTechIds:[],updatedAt:null},null,2))"`. `pkill -f "http.server 8095"`. No console errors.

- [ ] **Step 8: Commit.**

```bash
git add index.html style.css data/tech_status.json
git commit -m "feat: exclude paused techs from matching; show 'paused' marker in catalog"
```

---

### Task 5: Curation page (`#/curate`)

**Files:**
- Modify: `index.html` — nav (`~24-27`), router `dispatchRoute` (`~565`), new `showCurate`/`renderCurate` + handlers + save
- Modify: `style.css` — curation layout

**Interfaces:**
- Consumes: `groupByCohortBucket`, `DOMAIN_COLORS`, `RESEARCH_SERVER`, `PAUSED`, `showResults`.
- Produces: `showCurate()`, `renderCurate()`, `_curationWorking` (Set), toggle handlers, `curationSave()`.

- [ ] **Step 1: Nav button.** After the "JHTV backers" button (`index.html:25`):

```html
      <button class="nav-link" onclick="showCurate()">Curate</button>
```

- [ ] **Step 2: Route.** In `dispatchRoute` after the `#/backers` line (`~565`):

```javascript
    if (h === '#/curate')       return renderCurate();
```

- [ ] **Step 3: Add the page + handlers** near `renderBackers` (after it). Working state is an in-memory Set; every handler mutates it and re-renders (simple + correct for 74 techs):

```javascript
  let _curationWorking = null; // Set of paused ids being edited
  let _curationSaving  = false;

  function showCurate() { location.hash = '#/curate'; }

  function curationDirty() {
    if (!_curationWorking) return false;
    if (_curationWorking.size !== PAUSED.size) return true;
    for (const id of _curationWorking) if (!PAUSED.has(id)) return true;
    return false;
  }
  const techsInBucketGlobal = (bucket) => TECHS.filter(t => (t.sectors || []).includes(bucket));
  const techsInCohort       = (cohort) => TECHS.filter(t => (t.cohort || 'Cohort 1') === cohort);
  const techsInBucketCohort = (cohort, bucket) => techsInCohort(cohort).filter(t => (t.sectors || []).includes(bucket));

  function _curationSet(ids, pause) { for (const id of ids) pause ? _curationWorking.add(id) : _curationWorking.delete(id); renderCurate(); }
  function curationToggleTech(id) { _curationWorking.has(id) ? _curationWorking.delete(id) : _curationWorking.add(id); renderCurate(); }
  function curationToggleBucketGlobal(bucket, pause) { _curationSet(techsInBucketGlobal(bucket).map(t => t.id), pause); }
  function curationToggleCohort(cohort, pause)       { _curationSet(techsInCohort(cohort).map(t => t.id), pause); }
  function curationToggleBucketCohort(cohort, bucket, pause) { _curationSet(techsInBucketCohort(cohort, bucket).map(t => t.id), pause); }

  // A group is "all active" when none of its techs are paused; "all paused" when all are.
  const groupState = (techs) => {
    const paused = techs.filter(t => _curationWorking.has(t.id)).length;
    return paused === 0 ? 'active' : paused === techs.length ? 'paused' : 'mixed';
  };
  const groupToggle = (state) => state === 'active';   // checked when all active; click pauses all
  const escId = (s) => s.replace(/'/g, "\\'");

  async function curationSave() {
    if (_curationSaving || !curationDirty()) return;
    _curationSaving = true; renderCurate();
    try {
      const res = await fetch(RESEARCH_SERVER + '/api/tech-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pausedTechIds: [..._curationWorking] }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      PAUSED = new Set(_curationWorking);       // new authoritative baseline
      _curationSaving = false; renderCurate();
    } catch (e) {
      _curationSaving = false;
      alert('Save failed: ' + e.message + '\\n(The matching server may be waking up — wait ~30s and try again.)');
      renderCurate();
    }
  }

  function renderCurate() {
    if (!_curationWorking) _curationWorking = new Set(PAUSED);
    const grouped = groupByCohortBucket(TECHS);
    const buckets = [...new Set(TECHS.flatMap(t => t.sectors || []))].sort();

    const bucketStrip = buckets.map(b => {
      const st = groupState(techsInBucketGlobal(b));
      const dot = DOMAIN_COLORS[b] || '#64748B';
      return `<button class="curate-bucket-chip ${st}" onclick="curationToggleBucketGlobal('${escId(b)}', ${st !== 'paused'})">
                <span class="pill-dot" style="background:${dot}"></span>${b}
                <span class="curate-chip-state">${st === 'active' ? 'on' : st === 'paused' ? 'off' : 'mixed'}</span>
              </button>`;
    }).join('');

    const cohortSections = grouped.map(({ cohort, buckets: bks }) => {
      const cSt = groupState(techsInCohort(cohort));
      const bucketBlocks = bks.filter(b => b.bucket !== '(unassigned)').concat(bks.filter(b => b.bucket === '(unassigned)')).map(({ bucket, techs }) => {
        const bSt = groupState(techsInBucketCohort(cohort, bucket));
        const dot = DOMAIN_COLORS[bucket] || '#64748B';
        const rows = techs.map(t => {
          const active = !_curationWorking.has(t.id);
          return `<label class="curate-tech${active ? '' : ' paused'}">
                    <input type="checkbox" ${active ? 'checked' : ''} onchange="curationToggleTech('${t.id}')"> ${t.name}
                  </label>`;
        }).join('');
        return `<div class="curate-bucket">
            <div class="curate-bucket-head">
              <span><span class="pill-dot" style="background:${dot}"></span>${bucket} <span class="curate-count">(${techs.length})</span></span>
              <label class="curate-selall"><input type="checkbox" ${bSt === 'active' ? 'checked' : ''} onchange="curationToggleBucketCohort('${escId(cohort)}','${escId(bucket)}', ${!groupToggle(bSt)})"> select all</label>
            </div>
            <div class="curate-tech-list">${rows}</div>
          </div>`;
      }).join('');
      return `<div class="catalog-section">
          <div class="catalog-header">
            <h2>${cohort}</h2>
            <label class="curate-selall"><input type="checkbox" ${cSt === 'active' ? 'checked' : ''} onchange="curationToggleCohort('${escId(cohort)}', ${!groupToggle(cSt)})"> select all in cohort</label>
          </div>
          ${bucketBlocks}
        </div>`;
    }).join('');

    const dirty = curationDirty();
    showResults().innerHTML = `
      <div class="catalog-section">
        <div class="catalog-header"><h2>Curate matching</h2>
          <button class="view-all-link" onclick="showDomainBrowse()">← Back to catalog</button></div>
        <p class="section-label">Uncheck a technology to pause it from VC matching. Paused techs still appear in the catalog, marked "paused".</p>
        <p class="section-label">Buckets — all cohorts</p>
        <div class="curate-strip">${bucketStrip}</div>
      </div>
      ${cohortSections}
      <div class="curate-savebar">
        <button class="btn btn-gold" onclick="curationSave()" ${(!dirty || _curationSaving) ? 'disabled' : ''}>
          ${_curationSaving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
      </div>`;
    // Reflect "mixed" groups as indeterminate checkboxes (visual only).
    document.querySelectorAll('.curate-selall input, .curate-bucket-chip').forEach(() => {});
  }
```

- [ ] **Step 4: Set indeterminate states after render.** The simplest correct approach: after building `showResults().innerHTML`, mark mixed group checkboxes. Replace the trailing `document.querySelectorAll(...)` no-op with:

```javascript
    for (const [sel, groupFn] of [
      ['.curate-cohort-selall', null], // handled inline below
    ]) void sel, groupFn;
    // Mixed cohort/bucket "select all" checkboxes → indeterminate.
    grouped.forEach(({ cohort, buckets: bks }, ci) => {
      const secEl = document.querySelectorAll('.catalog-section')[ci + 1]; // +1 skips the header section
      if (!secEl) return;
      const cInput = secEl.querySelector('.catalog-header .curate-selall input');
      if (cInput) cInput.indeterminate = groupState(techsInCohort(cohort)) === 'mixed';
      bks.forEach((b, bi) => {
        const bInput = secEl.querySelectorAll('.curate-bucket .curate-selall input')[bi];
        if (bInput) bInput.indeterminate = groupState(techsInBucketCohort(cohort, b.bucket)) === 'mixed';
      });
    });
```

> The bucket-strip chips already show `on/off/mixed` text, so they need no indeterminate handling. This step is cosmetic; if the index math proves brittle, skip it — the checked/unchecked + chip text already convey state.

- [ ] **Step 5: Styles** in `style.css`:

```css
.curate-strip { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 4px; }
.curate-bucket-chip { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: .82rem;
  padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--paper); cursor: pointer; }
.curate-bucket-chip.paused { opacity: .55; text-decoration: line-through; }
.curate-bucket-chip.mixed { border-style: dashed; }
.curate-chip-state { color: var(--muted); font-size: .72rem; text-transform: uppercase; }
.curate-bucket { margin: 6px 0 12px; }
.curate-bucket-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: var(--blue); margin-bottom: 4px; }
.curate-count { color: var(--muted); font-weight: 400; }
.curate-selall { font-size: .78rem; color: var(--muted); font-weight: 400; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.curate-tech-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 2px 16px; }
.curate-tech { display: flex; align-items: center; gap: 7px; font-size: .9rem; padding: 3px 0; cursor: pointer; }
.curate-tech.paused { color: var(--muted); text-decoration: line-through; }
.curate-savebar { position: sticky; bottom: 0; padding: 12px 0; background: linear-gradient(transparent, var(--bg, #fff) 40%); text-align: right; }
```

- [ ] **Step 6: Verify in the browser.**

```bash
python3 -m http.server 8095 >/tmp/sb.log 2>&1 &
```
Open `http://localhost:8095/index.html?v=2#/curate`. Expected: the "Buckets — all cohorts" strip of domain chips; a "Cohort 1" section grouped by bucket with per-bucket and per-cohort "select all" and per-tech checkboxes; unchecking a tech dims it; a bucket chip toggles that whole domain across the page; "Save changes" enables when dirty. (Saving requires the backend — start it locally with `ANTHROPIC_API_KEY=x GITHUB_TOKEN=x node server.js` only if you want to exercise the commit; otherwise verify the button state transitions and that a failed save shows the wake-up message.) No console errors. `pkill -f "http.server 8095"`.

- [ ] **Step 7: Commit.**

```bash
git add index.html style.css
git commit -m "feat: #/curate page — pause/resume matching at 4 scopes, backend save"
```

---

### Task 6: Docs — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the feature.** Under Data files, add `data/tech_status.json` (`{ pausedTechIds, updatedAt }`, fail-soft → `PAUSED`, source of pause truth) and note the new `cohort` field on `technologies.json`. Under a new "Tech curation (`#/curate`)" note in Architecture/Scoring: the page pauses matching at tech / bucket-in-cohort / cohort / bucket-across-cohorts scopes via `curation.js` helpers; paused techs are excluded from `topTechsForVC` (`activeTechs`) but shown "paused" in the catalog; Save POSTs to `server.js` `POST /api/tech-status`, which commits the file. Document the **add-a-cohort flow**: drop the new `.docx`s, run `node scripts/populate_technologies.js` (now merges by id, defaults new techs to `"Cohort 1"`), then set the new techs' `cohort` to the new label; commit.

- [ ] **Step 2: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs: tech curation page + cohort field + tech_status.json"
```

---

## Self-Review

**Spec coverage:** cohort field + tech_status.json + populate-preserve (Task 1) · pure helpers (Task 2) · backend commit endpoint (Task 3) · load/fail-soft + matching exclusion + catalog paused marker (Task 4) · `#/curate` page with all four pause scopes, sync, sticky Save, cold-start handling (Task 5) · CLAUDE.md incl. add-a-cohort flow (Task 6) · tests for helpers/data/validator (Tasks 2, 3) · fail-soft + data separation + UI reuse (Global Constraints). All spec sections map to a task.

**Placeholder scan:** every code/test step is complete; browser steps give exact URLs, a pause-a-tech probe, and expected results; Task 5 Step 4's indeterminate polish is explicitly marked optional-if-brittle (not a TODO — a real, bounded fallback).

**Type consistency:** `activeTechs(techs, paused)` and `groupByCohortBucket(techs)` defined in Task 2, consumed in Tasks 4/5; `PAUSED` (Set) from Task 4 used in Task 5; `validatePausedIds(body)→{ok,pausedTechIds|error}` defined + exported + tested in Task 3; `data/tech_status.json` shape `{ pausedTechIds, updatedAt }` identical across the client fetch (Task 4), the endpoint (Task 3), and the tests. `_curationWorking` (Set) and the `curationToggle*` handler names are consistent within Task 5.
