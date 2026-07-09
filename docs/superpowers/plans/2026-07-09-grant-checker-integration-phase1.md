# Grant Checker Integration (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a full grant-eligibility questionnaire inside the Second Brain (internal staff) tool — as a standalone "Grant checker" landing entry point AND as the per-tech "Refine eligibility" deep-check — driven by Grant Finder's shared `grant_engine.js`, while keeping Grant Finder live and canonical.

**Architecture:** Grant Finder (`ckannam/jhtv-grant-finder`) stays the single source of truth for the eligibility *logic* (`grant_engine.js`) and live data (`grants_live.json`). Second Brain consumes them at runtime over the shared GitHub Pages origin. The questionnaire *form UI* is rendered in Second Brain from a declarative field schema in a new `grant_checker.js` module; the *scoring* is never duplicated — it calls the shared engine's `getGrants(d)` + `applyLiveData(grant, live)`. A Node contract-test guards the form schema against the engine's input contract so the two can't silently drift.

**Tech Stack:** Vanilla JS (no framework, no build step), GitHub Pages static hosting, hash-based routing, Node for tests (no test runner — plain `node script.js` asserting, matching the existing `stress_test.js` pattern).

## Global Constraints

- No build step; everything runs as static files served over HTTP. `index.html` must be loaded via a local server (`npx serve .`), never `file://` (fetch fails otherwise).
- Grant Finder repo is **not modified** in Phase 1. `grant_engine.js` and `grants_live.json` stay canonical there.
- Grant eligibility **logic** is never duplicated — only the form UI and result rendering live in Second Brain. All scoring goes through the shared `getGrants` / `applyLiveData`.
- The engine's input object `d` uses exactly these keys (from Grant Finder `collectData()`): `ventureStage, entityType, technologyType, jhuSchool, leadRole, jhtv, licensing, siteMiner, siteMinerDays, marylandBased, baltimoreArea, teamSize, dilutive, sedi, stemCells, diseaseArea, hasSbirPhaseI`. Field element ids MUST match these keys.
- Follow existing Second Brain conventions: `view*()`/`show*()` set `location.hash`; `render*()` do the work; new routes are added to `dispatchRoute()`.
- Local dev-time Node tests reference the sibling Grant Finder checkout at `../Grant Finder/grant_engine.js` (both repos live under `~/Documents/`).

---

### Task 1: Harden the shared-engine loader to expose `applyLiveData`

Today `loadGrantEngine()` evals the engine but only returns `getGrants`, then Second Brain hand-rolls the live-deadline overlay. Return **both** exported functions and use the shared `applyLiveData` so the live-data logic lives only in the engine.

**Files:**
- Modify: `index.html` — `loadGrantEngine()` (currently ~lines 985–997) and `renderTechGrants()` (currently ~lines 1026–1061)

**Interfaces:**
- Produces: `loadGrantEngine()` → resolves to `{ getGrants, applyLiveData }` (both from the shared engine). `_grantsLive` global remains the parsed `grants` map.

- [ ] **Step 1: Replace `loadGrantEngine()` to return both engine functions**

Replace the existing function:

```javascript
  async function loadGrantEngine() {
    if (_grantEngine) return _grantEngine;
    const [src, live] = await Promise.all([
      fetch(GRANT_FINDER_URL + '/grant_engine.js').then(r => {
        if (!r.ok) throw new Error('grant engine HTTP ' + r.status);
        return r.text();
      }),
      fetch(GRANT_FINDER_URL + '/grants_live.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    _grantEngine = new Function(src + '; return getGrants;')();
    _grantsLive  = (live && live.grants) || {};
    return _grantEngine;
  }
```

with:

```javascript
  async function loadGrantEngine() {
    if (_grantEngine) return _grantEngine;
    const [src, live] = await Promise.all([
      fetch(GRANT_FINDER_URL + '/grant_engine.js').then(r => {
        if (!r.ok) throw new Error('grant engine HTTP ' + r.status);
        return r.text();
      }),
      fetch(GRANT_FINDER_URL + '/grants_live.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    // Shared engine exports getGrants + applyLiveData; return both so the
    // live-data overlay logic is never re-implemented here.
    _grantEngine = new Function(src + '; return { getGrants, applyLiveData };')();
    _grantsLive  = (live && live.grants) || {};
    return _grantEngine;
  }
```

- [ ] **Step 2: Update `renderTechGrants()` to use the shared `applyLiveData`**

In `renderTechGrants()`, replace:

```javascript
    const getGrants = await loadGrantEngine();
    const d = techToGrantInput(tech);
    const results = getGrants(d).map(g => {
      const live = _grantsLive[g.id];
      return live && live.deadlineLabel ? { ...g, deadline: live.deadlineLabel } : g;
    });
```

with:

```javascript
    const { getGrants, applyLiveData } = await loadGrantEngine();
    const d = techToGrantInput(tech);
    const results = getGrants(d).map(g => applyLiveData(g, _grantsLive));
```

- [ ] **Step 3: Verify locally that the per-tech screen still works**

Run: `cd "/Users/colekannam/Documents/JHTV Second Brain" && npx serve . -l 5055` (background), then load `http://localhost:5055/#/tech/curveassure` in the browser (use the browser MCP or manually).
Expected: the "Non-dilutive funding — preliminary screen" still lists grants with deadlines (identical to before — this is a refactor, no behavior change). If it errors on CORS from localhost, that's expected in local dev; confirm instead against the deployed site after Task 5's deploy.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "refactor: grant loader returns shared applyLiveData; use it in tech screen"
```

---

### Task 2: Create `grant_checker.js` — declarative field schema + pure helpers (Node-tested)

A new focused module holding the questionnaire field schema and the pure functions that build/read the engine input. Kept Node-requirable (guarded `module.exports`) so its contract with the engine is unit-tested without a browser. No DOM code in this task.

**Files:**
- Create: `grant_checker.js`
- Create: `test/grant_checker.test.js`

**Interfaces:**
- Produces:
  - `GRANT_FIELDS`: array of `{ id, label, type: 'select'|'radio'|'number', options?: [{value,label}], hint?, dependsOn?: {field, value} }`. Every `id` is one of the 17 engine input keys.
  - `techToGrantPrefill(tech)` → `{ ventureStage, technologyType, jhtv, jhuSchool }` (same mapping the tech screen already uses; centralized here).
  - `emptyGrantData()` → object with every engine key present (empty string default).

- [ ] **Step 1: Write the failing test**

Create `test/grant_checker.test.js`:

```javascript
'use strict';
const assert = require('assert');
const path = require('path');
const { GRANT_FIELDS, techToGrantPrefill, emptyGrantData } = require('../grant_checker.js');
// The shared engine, loaded from the sibling Grant Finder checkout (local dev only).
const { getGrants } = require(path.resolve(__dirname, '../../Grant Finder/grant_engine.js'));

const ENGINE_KEYS = [
  'ventureStage','entityType','technologyType','jhuSchool','leadRole','jhtv',
  'licensing','siteMiner','siteMinerDays','marylandBased','baltimoreArea',
  'teamSize','dilutive','sedi','stemCells','diseaseArea','hasSbirPhaseI',
];

let pass = 0, fail = 0;
function check(name, fn){ try { fn(); pass++; console.log('✓', name); } catch(e){ fail++; console.log('✗', name, '—', e.message); } }

// 1. Every schema field id is a real engine key (no typos, no drift).
check('schema field ids ⊆ engine input keys', () => {
  for (const f of GRANT_FIELDS) assert(ENGINE_KEYS.includes(f.id), `unknown field id: ${f.id}`);
});

// 2. emptyGrantData covers every engine key.
check('emptyGrantData has every engine key', () => {
  const d = emptyGrantData();
  for (const k of ENGINE_KEYS) assert(k in d, `missing key: ${k}`);
});

// 3. A filled data object drives the shared engine to 28 grants.
check('getGrants(filled data) returns all 28 grants', () => {
  const d = Object.assign(emptyGrantData(), {
    ventureStage:'seed', technologyType:'therapeutic', jhuSchool:'som',
    jhtv:'yes', marylandBased:'yes', diseaseArea:'cancer',
  });
  const grants = getGrants(d);
  assert.strictEqual(grants.length, 28, `got ${grants.length}`);
  assert(grants.every(g => ['eligible','conditional','ineligible'].includes(g.s)), 'bad status');
});

// 4. techToGrantPrefill maps a seed therapeutic tech correctly.
check('techToGrantPrefill maps stage + sector', () => {
  const d = techToGrantPrefill({ stage:'Seed', sectors:['Therapeutics'] });
  assert.strictEqual(d.ventureStage, 'seed');
  assert.strictEqual(d.technologyType, 'therapeutic');
  assert.strictEqual(d.jhtv, 'yes');
  assert.strictEqual(d.jhuSchool, 'other_jhu');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "/Users/colekannam/Documents/JHTV Second Brain" && node test/grant_checker.test.js`
Expected: FAIL — `Cannot find module '../grant_checker.js'`.

- [ ] **Step 3: Create `grant_checker.js` with the schema and pure helpers**

```javascript
'use strict';
/* Grant Checker — questionnaire field schema + pure input helpers.
 * The eligibility LOGIC lives in Grant Finder's shared grant_engine.js;
 * this module only describes the form and builds the engine input `d`.
 * Field ids MUST match grant_engine.js collectData() keys. */

const GRANT_FIELDS = [
  { id:'ventureStage', label:'Venture stage', type:'select', options:[
    {value:'ideation',label:'Idea / pre-incorporation'},
    {value:'forming',label:'Actively incorporating'},
    {value:'pre_seed',label:'Pre-seed'},
    {value:'seed',label:'Seed'},
    {value:'growth',label:'Growth'} ]},
  { id:'entityType', label:'Entity type', type:'select', options:[
    {value:'llc_corp',label:'LLC / Corp'},
    {value:'partnership',label:'Partnership'},
    {value:'sole_prop',label:'Sole proprietor'},
    {value:'none',label:'Not yet incorporated'} ]},
  { id:'technologyType', label:'Technology type', type:'select', options:[
    {value:'therapeutic',label:'Therapeutic'},
    {value:'device',label:'Device'},
    {value:'digital_health',label:'Digital health'},
    {value:'life_tools',label:'Life sciences tools'},
    {value:'synbio',label:'Synthetic biology'},
    {value:'non_medical',label:'Non-medical'} ]},
  { id:'jhuSchool', label:'JHU school', type:'select', options:[
    {value:'wse',label:'Whiting (WSE)'},{value:'som',label:'Medicine (SOM)'},
    {value:'bsph',label:'Public Health (BSPH)'},{value:'krieger',label:'Krieger'},
    {value:'nursing',label:'Nursing'},{value:'other_jhu',label:'Other JHU'},
    {value:'none',label:'No JHU affiliation'} ]},
  { id:'leadRole', label:'Lead inventor role', type:'select', options:[
    {value:'faculty',label:'Faculty'},{value:'postdoc',label:'Postdoc'},
    {value:'student',label:'Student'},{value:'external',label:'External'} ]},
  { id:'jhtv', label:'JHTV invention disclosure filed?', type:'select', options:[
    {value:'yes',label:'Yes — formally disclosed'},{value:'no',label:'No'} ]},
  { id:'licensing', label:'Licensing status', type:'select', options:[
    {value:'unlicensed',label:'Unlicensed'},{value:'lt12',label:'Licensed <12 months'},
    {value:'gt12',label:'Licensed >12 months'},{value:'noip',label:'No IP'} ]},
  { id:'siteMiner', label:'TEDCO Site Miner engagement', type:'radio', hint:'(required for MII)', options:[
    {value:'yes',label:'Yes — engaged a Site Miner'},{value:'no',label:'No — not yet'} ]},
  { id:'siteMinerDays', label:'Days since Site Miner engagement', type:'number',
    dependsOn:{field:'siteMiner', value:'yes'} },
  { id:'marylandBased', label:'Maryland-based?', type:'select', options:[
    {value:'yes',label:'Yes — MD principal office'},{value:'planning',label:'Planning MD presence'},
    {value:'no',label:'No'} ]},
  { id:'baltimoreArea', label:'Baltimore City / County?', type:'radio', hint:'(for BII)',
    dependsOn:{field:'marylandBased', value:'yes'}, options:[
    {value:'yes',label:'Yes — Baltimore City or County'},{value:'no',label:'No — elsewhere in MD'} ]},
  { id:'teamSize', label:'Team size', type:'select', options:[
    {value:'founders_only',label:'Founders only'},{value:'1_5',label:'1–5 FTE'},
    {value:'6_15',label:'6–15'},{value:'16_50',label:'16–50'},{value:'over_50',label:'50+'} ]},
  { id:'dilutive', label:'Dilutive funding raised', type:'select', options:[
    {value:'0',label:'$0'},{value:'lt500k',label:'<$500K'},{value:'lt2m',label:'$500K–$2M'},
    {value:'lt5m',label:'$2M–$5M'},{value:'gt5m',label:'>$5M'} ]},
  { id:'sedi', label:'Founder SEDI / rural status', type:'select', options:[
    {value:'sedi',label:'SEDI'},{value:'rural',label:'Rural'},
    {value:'both',label:'Both'},{value:'none',label:'Neither'} ]},
  { id:'stemCells', label:'Involves stem cells?', type:'radio', options:[
    {value:'yes',label:'Yes'},{value:'no',label:'No'} ]},
  { id:'diseaseArea', label:'Disease area', type:'select', options:[
    {value:'cardio',label:'Cardiovascular'},{value:'neuro',label:'Neuro'},
    {value:'cancer',label:'Cancer'},{value:'cf',label:'Cystic fibrosis'},
    {value:'amr',label:'AMR'},{value:'womens',label:"Women's health"},
    {value:'peds',label:'Pediatrics'},{value:'veterans',label:'Veterans'},
    {value:'global',label:'Global health'},{value:'other',label:'Other'} ]},
  { id:'hasSbirPhaseI', label:'Active SBIR/STTR Phase I?', type:'radio', options:[
    {value:'yes',label:'Yes — active Phase I'},{value:'no',label:'No'} ]},
];

function emptyGrantData() {
  const d = {};
  for (const f of GRANT_FIELDS) d[f.id] = '';
  return d;
}

const SECTOR_TO_TYPE = {
  'Therapeutics':'therapeutic','Medical Devices':'device','Diagnostics':'device',
  'Digital Health':'digital_health','Research Technologies':'life_tools',
  'Agricultural Tech':'synbio','Clean Tech':'non_medical','Cybersecurity':'non_medical',
};

function techToGrantPrefill(tech) {
  const s = (tech.stage || '').toLowerCase();
  let ventureStage = 'forming';
  if (s.includes('pre-seed') || s.includes('pre-clinical')) ventureStage = 'pre_seed';
  else if (s.includes('seed')) ventureStage = 'seed';
  else if (s.includes('series') || s.includes('growth') || s.includes('commercial')) ventureStage = 'growth';
  return {
    ventureStage,
    technologyType: SECTOR_TO_TYPE[(tech.sectors || [])[0]] || 'non_medical',
    jhtv: 'yes',
    jhuSchool: 'other_jhu',
  };
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { GRANT_FIELDS, emptyGrantData, techToGrantPrefill, SECTOR_TO_TYPE };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "/Users/colekannam/Documents/JHTV Second Brain" && node test/grant_checker.test.js`
Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add grant_checker.js test/grant_checker.test.js
git commit -m "feat: grant_checker field schema + engine-contract test"
```

---

### Task 3: Render the embedded questionnaire + wire the "Grant checker" landing entry point

Add the DOM rendering (form + live results) to `grant_checker.js` (browser-only functions, after the exports guard so Node ignores them), load the module in `index.html`, add the nav button + route, and add a small CSS block.

**Files:**
- Modify: `grant_checker.js` (append browser render/collect functions)
- Modify: `index.html` — add `<script src="grant_checker.js" defer></script>`; nav button; `showGrantChecker()`, `renderGrantChecker()`; add `#/grants` to `dispatchRoute()`
- Modify: `style.css` — append a `.grant-form` block

**Interfaces:**
- Consumes: `GRANT_FIELDS`, `emptyGrantData`, `techToGrantPrefill` (Task 2); `loadGrantEngine()` (Task 1).
- Produces: browser globals `renderGrantCheckerForm(container, prefill)`, `collectGrantData()`, `runGrantCheck()`; and `renderGrantChecker(prefill)` in `index.html`.

- [ ] **Step 1: Append the browser render/collect functions to `grant_checker.js`**

Add BELOW the `module.exports` guard (so Node never touches the DOM):

```javascript
// ── Browser-only rendering (ignored by Node) ─────────────────────────
function grantFieldHTML(f) {
  const hint = f.hint ? ` <span class="gf-hint">${f.hint}</span>` : '';
  const wrapAttrs = f.dependsOn ? ` data-depends="${f.dependsOn.field}" data-depends-val="${f.dependsOn.value}" style="display:none"` : '';
  let control;
  if (f.type === 'select') {
    control = `<select id="${f.id}" onchange="runGrantCheck()">
      <option value="">—</option>
      ${f.options.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
    </select>`;
  } else if (f.type === 'number') {
    control = `<input type="number" id="${f.id}" min="0" placeholder="e.g. 30" oninput="runGrantCheck()">`;
  } else { // radio
    control = `<div class="gf-radios">${f.options.map(o =>
      `<label class="gf-radio"><input type="radio" name="${f.id}" value="${o.value}" onchange="runGrantCheck()"> ${o.label}</label>`
    ).join('')}</div>`;
  }
  return `<div class="gf-field"${wrapAttrs}><label>${f.label}${hint}</label>${control}</div>`;
}

function collectGrantData() {
  const d = emptyGrantData();
  for (const f of GRANT_FIELDS) {
    if (f.type === 'radio') {
      const el = document.querySelector(`input[name="${f.id}"]:checked`);
      d[f.id] = el ? el.value : '';
    } else {
      const el = document.getElementById(f.id);
      d[f.id] = el ? el.value : '';
    }
  }
  return d;
}

function updateGrantDependents() {
  document.querySelectorAll('.gf-field[data-depends]').forEach(w => {
    const dep = w.getAttribute('data-depends');
    const want = w.getAttribute('data-depends-val');
    const cur = (document.querySelector(`input[name="${dep}"]:checked`) || document.getElementById(dep) || {}).value;
    w.style.display = cur === want ? '' : 'none';
  });
}

function renderGrantCheckerForm(container, prefill) {
  container.innerHTML = `<div class="grant-form">${GRANT_FIELDS.map(grantFieldHTML).join('')}</div>
    <div id="grantCheckResults" class="grant-rows"></div>`;
  if (prefill) {
    for (const [k, v] of Object.entries(prefill)) {
      const sel = document.getElementById(k);
      if (sel && sel.tagName === 'SELECT') { sel.value = v; continue; }
      const radio = document.querySelector(`input[name="${k}"][value="${v}"]`);
      if (radio) radio.checked = true;
    }
  }
  updateGrantDependents();
  runGrantCheck();
}

async function runGrantCheck() {
  updateGrantDependents();
  const box = document.getElementById('grantCheckResults');
  if (!box) return;
  const d = collectGrantData();
  const answered = Object.values(d).some(v => v && v !== '');
  if (!answered) { box.innerHTML = `<p class="gf-empty">Answer the questions above to screen all 28 programs.</p>`; return; }
  try {
    const { getGrants, applyLiveData } = await loadGrantEngine();
    const results = getGrants(d).map(g => applyLiveData(g, _grantsLive));
    const order = { eligible:0, conditional:1, ineligible:2 };
    const shown = results.filter(g => g.s !== 'ineligible').sort((a,b)=>order[a.s]-order[b.s]);
    const ineligible = results.length - shown.length;
    box.innerHTML = shown.map(g => `
      <div class="grant-row">
        <span class="grant-status ${g.s}"></span>
        <div class="grant-row-main">
          <a class="grant-row-title" href="${g.applyUrl}" target="_blank" rel="noopener">${g.title}</a>
          <div class="grant-row-meta">${g.org} · ${g.amount}${g.deadline ? ` · ${g.deadline}` : ''}</div>
        </div>
        <span class="pill grant-pill-${g.s}">${g.s === 'eligible' ? 'Eligible' : 'Conditional'}</span>
      </div>`).join('') + `<p class="gf-empty">${ineligible} programs screened out.</p>`;
  } catch (err) {
    box.innerHTML = `<p class="gf-empty">Couldn't reach the grant engine (${err.message}). <a href="${typeof GRANT_FINDER_URL!=='undefined'?GRANT_FINDER_URL:'#'}" target="_blank" rel="noopener">Open Grant Finder directly</a>.</p>`;
  }
}
```

- [ ] **Step 2: Load the module and add the nav button in `index.html`**

Add before the closing `</head>` (near the `<script src>`/style link, ~line 10):

```html
  <script src="grant_checker.js" defer></script>
```

In the nav links block, replace:

```html
      <button class="nav-link" onclick="showSavedBriefs()">Saved briefs</button>
```

with:

```html
      <button class="nav-link" onclick="showSavedBriefs()">Saved briefs</button>
      <button class="nav-link" onclick="showGrantChecker()">Grant checker</button>
```

- [ ] **Step 3: Add the entry-point + render functions in `index.html`**

After `renderSavedBriefs()` (near line 256), add:

```javascript
  function showGrantChecker() { location.hash = '#/grants'; }

  function renderGrantChecker(prefill) {
    showResults().innerHTML = `
      <div class="catalog-section">
        <div class="catalog-header">
          <h2>Grant Checker</h2>
          <button class="view-all-link" onclick="showDomainBrowse()">← Back to catalog</button>
        </div>
        <p class="grant-disclaimer">Screens all 28 Maryland, federal, and foundation programs against your answers. Shared engine with the founder-facing Grant Finder.</p>
        <div id="grantCheckerMount"></div>
      </div>`;
    renderGrantCheckerForm(document.getElementById('grantCheckerMount'), prefill || null);
  }
```

- [ ] **Step 4: Add the route to `dispatchRoute()`**

In `dispatchRoute()`, before the final `renderHome();`, add:

```javascript
    if (h === '#/grants')       return renderGrantChecker(_grantPrefill);
```

And near the other top-level `let` data globals (~line 83), add:

```javascript
  let _grantPrefill = null; // set by "Refine eligibility" before routing to #/grants
```

- [ ] **Step 5: Append the `.grant-form` CSS to `style.css`**

```css
/* Grant checker questionnaire */
.grant-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:14px 20px; margin:14px 0 18px; }
.gf-field label { display:block; font:600 12px/1.4 var(--sans); color:var(--text); margin-bottom:5px; }
.gf-hint { font-weight:400; color:var(--muted); }
.gf-field select, .gf-field input[type=number] { width:100%; padding:7px 9px; border:1px solid var(--border); border-radius:3px; font:14px var(--sans); background:#fff; }
.gf-radios { display:flex; gap:14px; flex-wrap:wrap; }
.gf-radio { font:13px var(--sans); color:var(--text); display:flex; align-items:center; gap:5px; }
.gf-empty { color:var(--muted); font:13px var(--sans); margin:10px 0; }
```

- [ ] **Step 6: Verify in the browser (local server)**

Run: `cd "/Users/colekannam/Documents/JHTV Second Brain" && npx serve . -l 5055` (background). Load `http://localhost:5055/#/grants`.
Expected: the questionnaire renders all 17 fields; the Site Miner-days and Baltimore fields are hidden until their parent = "yes". Selecting answers populates a results list (grants engine loads from the live Grant Finder origin; if localhost CORS blocks it, the graceful error link shows — confirm full results against the deployed site in Task 5).

- [ ] **Step 7: Commit**

```bash
git add grant_checker.js index.html style.css
git commit -m "feat: embedded Grant Checker view + landing entry point"
```

---

### Task 4: Point per-tech "Refine eligibility" at the embedded questionnaire (prefilled)

Replace the tech screen's outbound deep-link CTA with an in-tool action that opens the embedded Grant Checker prefilled from the tech.

**Files:**
- Modify: `index.html` — `renderTechGrants()` CTA (the "Run the full eligibility check in Grant Finder →" button)

**Interfaces:**
- Consumes: `techToGrantPrefill(tech)` (Task 2), `renderGrantChecker(prefill)` + `_grantPrefill` (Task 3).

- [ ] **Step 1: Add a helper that opens the checker prefilled**

After `renderGrantChecker()` (Task 3), add:

```javascript
  function refineGrantsForTech(techId) {
    const tech = TECHS.find(t => t.id === techId);
    _grantPrefill = tech ? techToGrantPrefill(tech) : null;
    location.hash = '#/grants';
  }
```

- [ ] **Step 2: Swap the CTA in `renderTechGrants()`**

Replace:

```javascript
      <a class="btn btn-secondary btn-sm" style="margin-top:10px" href="${link}" target="_blank" rel="noopener">Run the full eligibility check in Grant Finder →</a>`;
```

with:

```javascript
      <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="refineGrantsForTech('${tech.id}')">Refine eligibility →</button>
      <a class="grant-external-link" href="${link}" target="_blank" rel="noopener">Open in Grant Finder ↗</a>`;
```

(`link` is still computed earlier in the function via `grantDeepLink(d)`; keep it as the secondary external link.)

- [ ] **Step 3: Clear stale prefill when leaving the checker**

In `renderGrantChecker(prefill)` (Task 3), add as the first line of the function body:

```javascript
    _grantPrefill = null; // consume once; don't leak into a later manual open
```

(The `prefill` argument still carries this open's values because `dispatchRoute` reads `_grantPrefill` into the call before this runs — verify order in Step 4.)

- [ ] **Step 4: Verify prefill flow in the browser**

Run the local server (Task 3 Step 6). Load `http://localhost:5055/#/tech/curveassure`, wait for the grant screen, click **Refine eligibility →**.
Expected: routes to `#/grants` with Venture stage / Technology type / JHTV / JHU school preset from the tech; results reflect the prefill. Then click **Grant checker** in the nav — the form opens blank (prefill was consumed, not leaked).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: per-tech 'Refine eligibility' opens embedded checker prefilled"
```

---

### Task 5: End-to-end verification on the deployed site + regression check

Local dev can't fully exercise the cross-origin engine fetch; production (same GitHub Pages origin) can. Deploy, then verify.

**Files:** none (verification + push).

- [ ] **Step 1: Re-run the Node contract test**

Run: `cd "/Users/colekannam/Documents/JHTV Second Brain" && node test/grant_checker.test.js`
Expected: `4 passed, 0 failed`.

- [ ] **Step 2: Confirm Grant Finder's own tests still pass (no engine change, sanity)**

Run: `cd "/Users/colekannam/Documents/Grant Finder" && node stress_test.js`
Expected: `224/224 checks passed` (proves we didn't touch the canonical engine).

- [ ] **Step 3: Push and let Pages deploy**

```bash
cd "/Users/colekannam/Documents/JHTV Second Brain"
git pull --rebase origin main && git push origin main
```

Wait ~1–2 min for the Pages build.

- [ ] **Step 4: Verify the live site with the browser MCP**

Load `https://ckannam.github.io/VC_Matching_Second_Brain/#/grants`.
Expected: questionnaire renders; answering fields (e.g. ventureStage=seed, technologyType=therapeutic, jhtv=yes, marylandBased=yes, jhuSchool=som) yields a live results list with real deadlines; conditional/eligible pills show.
Then load `.../#/tech/curveassure`, click **Refine eligibility →** → prefilled checker. Confirm **Grant Finder external site still works**: load `https://ckannam.github.io/jhtv-grant-finder/` and confirm the standalone questionnaire is unaffected.

- [ ] **Step 5: Cross-engine parity spot check**

For one persona (seed / therapeutic / som / jhtv=yes / marylandBased=yes), compare the eligible-grant set shown by the embedded checker vs. the standalone Grant Finder with the same answers.
Expected: identical eligibility results (proves both consume the same shared engine).

---

## Self-Review

- **Spec coverage:** Phase 1 of the design = "embed the grant experience (auto-screen + deep-check questionnaire) into Second Brain, harden the cross-repo consumption of the shared engine; Grant Finder stays as-is." Covered: harden loader (Task 1), embed questionnaire + landing entry point (Tasks 2–3), per-tech deep-check prefill (Task 4), Grant-Finder-unchanged verification (Task 5 Steps 2 & 4). ✅
- **Placeholder scan:** no TBD/TODO; all steps carry real code/commands. ✅
- **Type consistency:** `GRANT_FIELDS`, `emptyGrantData`, `techToGrantPrefill`, `collectGrantData`, `runGrantCheck`, `renderGrantCheckerForm`, `renderGrantChecker`, `refineGrantsForTech`, `_grantPrefill`, `loadGrantEngine()→{getGrants,applyLiveData}` used consistently across tasks. ✅
- **Known risk:** localhost CORS may block the cross-origin engine fetch during local steps — flagged in Global Constraints and Tasks 1/3; authoritative verification is on the deployed same-origin site (Task 5).
- **Deferred (not Phase 1):** hoisting the field schema into the shared `grant_engine.js` for full form-DRY (would touch Grant Finder); the rubric/data phases (2–4).
