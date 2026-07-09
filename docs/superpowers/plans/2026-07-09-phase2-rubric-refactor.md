# Phase 2 — Rubric Refactor (single shared scoring module) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the two duplicated, drifted copies of the VC↔tech scoring rubric with ONE shared module (`scoring.js`) consumed by both the browser (`index.html`) and the backend (`scripts/generate_vc.js`), with weights as a visible config block — without changing the user-facing tech-profile rankings.

**Architecture:** New classic/Node-dual module `scoring.js` at repo root (same pattern as `grant_checker.js`: `function`/`const` declarations for the browser + `module.exports` guard for Node). `index.html` loads it with `<script defer>` and deletes its inline copy; `scripts/generate_vc.js` `require`s it and deletes its inline copy. The **browser's** current behavior is canonical (it's user-facing), so `index.html` rankings are unchanged by construction; the backend's `matchedTechs` generation changes only for the rare "catch-all keyword + specific match" VC (a bug fix).

**Tech Stack:** Vanilla JS, no build step, GitHub Pages; Node for tests (plain assert-and-exit scripts, like `stress_test.js`).

## Global Constraints

- `scoring.js` must be **byte-for-byte behavior-identical** to the current `index.html` scoring (the canonical source). Preserve the exact weight-multiplication order `industry, stage, geography, checkSize` to avoid float drift.
- Weights live in one config object: `WEIGHTS = { industry: 0.375, stage: 0.30, checkSize: 0.225, geography: 0.10 }`.
- The shared `vcFitScore(vc, tech)` operates on the **stored VC shape**: `{ sectors[], stage[], checkSize:{min,max}, geographicFocus, focus }`, and `tech` = `{ sectors[], stage }`. It returns `{ score, sharedDomains, stageOk }` or `null` when the VC has no profile data.
- The backend's `vcProfile` shape (`{ investmentFocus, stages, checkSizeMin, checkSizeMax, geographicFocus }`) must be **adapted to the stored VC shape** before scoring — do NOT add a second code path inside `scoring.js`.
- Reconciled behavior (the one intentional change): when `matchesAll` is true AND there are specific domain matches, `industryScore = Math.max(fraction, 0.5)` (the browser rule), NOT the backend's old flat `0.5`.
- Classic scripts share global scope; `scoring.js` loads with `defer`, so its globals are available to `index.html`'s inline functions at call time (proven by the Phase-1 `grant_checker.js`).

---

### Task 1: Create `scoring.js` + Node test (the canonical rubric)

**Files:**
- Create: `scoring.js`
- Create: `test/scoring.test.js`

**Interfaces:**
- Produces (browser globals + `module.exports`): `WEIGHTS`, `INDUSTRY_TO_DOMAIN`, `DOMAIN_MATURITY`, `mapFocusToDomains(focusStrings)→{matched:Set,matchesAll:bool}`, `techStageScore(vcStages,techStage)→number`, `vcFitScore(vc,tech)→{score,sharedDomains,stageOk}|null`, `fitTier(score)→{label,cls}`.

- [ ] **Step 1: Write the failing test** — `test/scoring.test.js`:

```javascript
'use strict';
const assert = require('assert');
const { WEIGHTS, vcFitScore, fitTier, mapFocusToDomains } = require('../scoring.js');

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Weights sum to 1.
check('weights sum to 1.0', () => {
  assert(near(WEIGHTS.industry + WEIGHTS.stage + WEIGHTS.checkSize + WEIGHTS.geography, 1.0));
});

// Perfect fit → 1.0, Strong tier.
check('perfect-fit VC scores 1.0 / Strong', () => {
  const vc = { sectors:['Therapeutics'], stage:['Seed'], checkSize:{min:1,max:10}, geographicFocus:'Mid-Atlantic' };
  const tech = { sectors:['Therapeutics'], stage:'Seed' };
  const r = vcFitScore(vc, tech);
  assert(near(r.score, 1.0), `got ${r.score}`);
  assert.strictEqual(fitTier(r.score).cls, 'strong');
});

// Reconciled drift case: catch-all keyword ('healthcare') + full specific match
// must use max(fraction,0.5) = 1.0 (browser rule), NOT the backend's old flat 0.5.
check('catch-all + full specific match uses max(fraction,0.5)=1.0 industry', () => {
  const vc = { sectors:['healthcare','oncology'], stage:['Seed'], checkSize:{min:1,max:10}, geographicFocus:'Mid-Atlantic' };
  const tech = { sectors:['Therapeutics','Diagnostics'], stage:'Seed' };
  const r = vcFitScore(vc, tech);
  // industry=1.0, stage=1, geo=1.0, check: tech[0]=Therapeutics→early, max10≤15 →1  ⇒ full 1.0
  assert(near(r.score, 1.0), `got ${r.score}`);
});

// No-profile VC → null.
check('VC with no sectors/focus → null', () => {
  assert.strictEqual(vcFitScore({ sectors:[], focus:'' }, { sectors:['Therapeutics'], stage:'Seed' }), null);
});

// Poor fit dropped below 0.45.
check('wrong-sector wrong-stage VC scores low', () => {
  const vc = { sectors:['Digital Health'], stage:['Growth'], checkSize:{min:10,max:100}, geographicFocus:'West Coast' };
  const tech = { sectors:['Therapeutics'], stage:'Seed' };
  const r = vcFitScore(vc, tech);
  assert(r.score < 0.45, `got ${r.score}`);
});

// mapFocusToDomains catch-all flag + tolerant of null entries.
check('mapFocusToDomains flags catch-all and maps specifics', () => {
  const { matched, matchesAll } = mapFocusToDomains(['healthcare', 'oncology']);
  assert.strictEqual(matchesAll, true);
  assert(matched.has('Therapeutics') && matched.has('Diagnostics'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it, confirm it fails** — `node test/scoring.test.js` → FAIL `Cannot find module '../scoring.js'`.

- [ ] **Step 3: Create `scoring.js`** (copy the tables verbatim from `index.html:838-887`; functions from `index.html:889-961` with weights extracted to `WEIGHTS`, preserving multiply order):

```javascript
'use strict';
/* Shared VC↔tech scoring rubric — the SINGLE source of truth used by BOTH the
 * browser (index.html) and the backend (scripts/generate_vc.js). Previously the
 * logic was duplicated and had drifted (catch-all industry case: flat 0.5 in the
 * backend vs max(fraction,0.5) in the browser). The browser behavior is canonical.
 * Classic script for the browser + module.exports for Node. */

// Tunable weights (must sum to 1.0). Change scoring emphasis HERE — one place.
const WEIGHTS = { industry: 0.375, stage: 0.30, checkSize: 0.225, geography: 0.10 };

const INDUSTRY_TO_DOMAIN = {
  'life sciences':       ['Therapeutics','Diagnostics','Digital Health','Medical Devices'],
  'life science':        ['Therapeutics','Diagnostics','Digital Health','Medical Devices'],
  'biotech':             ['Therapeutics','Diagnostics','Research Technologies'],
  'biotechnology':       ['Therapeutics','Diagnostics','Research Technologies'],
  'biopharma':           ['Therapeutics','Diagnostics'],
  'pharma':              ['Therapeutics'],
  'drug discovery':      ['Therapeutics','Research Technologies'],
  'therapeutics':        ['Therapeutics'],
  'diagnostics':         ['Diagnostics'],
  'digital health':      ['Digital Health'],
  'healthcare it':       ['Digital Health'],
  'health it':           ['Digital Health'],
  'healthtech':          ['Digital Health'],
  'health tech':         ['Digital Health'],
  'medtech':             ['Medical Devices'],
  'medical device':      ['Medical Devices'],
  'medical technology':  ['Medical Devices'],
  'surgical':            ['Medical Devices'],
  'oncology':            ['Diagnostics','Therapeutics'],
  'cancer':              ['Diagnostics','Therapeutics'],
  'neurology':           ['Medical Devices','Digital Health'],
  'neurotech':           ['Medical Devices','Digital Health'],
  'cardiovascular':      ['Medical Devices','Diagnostics'],
  'cardiology':          ['Medical Devices','Diagnostics'],
  'cleantech':           ['Clean Tech'],
  'clean tech':          ['Clean Tech'],
  'climate':             ['Clean Tech'],
  'sustainability':      ['Clean Tech'],
  'energy':              ['Clean Tech'],
  'agtech':              ['Agricultural Tech'],
  'agriculture':         ['Agricultural Tech'],
  'food tech':           ['Agricultural Tech'],
  'cybersecurity':       ['Cybersecurity'],
  'security':            ['Cybersecurity'],
  'infosec':             ['Cybersecurity'],
  'research tools':      ['Research Technologies','Diagnostics'],
  'lab tech':            ['Research Technologies'],
  'ai in healthcare':    ['Digital Health','Medical Devices'],
  'ai health':           ['Digital Health'],
  'deep tech':           null,
  'healthcare':          null,
  'health care':         null,
};

const DOMAIN_MATURITY = {
  'Therapeutics': 'early', 'Diagnostics': 'mid', 'Medical Devices': 'mid',
  'Digital Health': 'mid', 'Research Technologies': 'early', 'Clean Tech': 'early',
  'Agricultural Tech': 'early', 'Cybersecurity': 'mid',
};

function mapFocusToDomains(focusStrings) {
  const matched = new Set();
  let matchesAll = false;
  for (const f of focusStrings) {
    const fl = (f || '').toLowerCase();
    for (const [keyword, domains] of Object.entries(INDUSTRY_TO_DOMAIN)) {
      if (fl.includes(keyword)) {
        if (domains === null) matchesAll = true;
        else domains.forEach(d => matched.add(d));
      }
    }
  }
  return { matched, matchesAll };
}

function techStageScore(vcStages, techStage) {
  if (!techStage) return 0.5;
  const techNorm = techStage.toLowerCase();
  const stageMap = {
    'seed':       ['pre-seed','newco','seed','pre-clinical','pre-product','concept','early','ind-enabling'],
    'series a':   ['seed','series a','pre-clinical','clinical','mvp','pilot','phase i','phase 1','phase ii','phase 2'],
    'series b':   ['series a','series b','clinical','commercial','revenue','phase ii','phase 2','phase iii','phase 3','fda'],
    'growth':     ['series b','series c','series d','growth','commercial','revenue','scale','fda-cleared'],
    'late stage': ['series b','series c','series d','growth','commercial','revenue','scale','public'],
  };
  for (const vs of vcStages) {
    const compatible = stageMap[vs.toLowerCase()] || [];
    if (compatible.some(s => techNorm.includes(s))) return 1;
  }
  return 0.2;
}

// vc: { sectors[], stage[], checkSize:{min,max}, geographicFocus, focus }
// tech: { sectors[], stage }
function vcFitScore(vc, tech) {
  const focus = (vc.sectors && vc.sectors.length) ? vc.sectors : (vc.focus ? [vc.focus] : []);
  if (!focus.length) return null;  // curated entries carry no profile data to score

  const { matched, matchesAll } = mapFocusToDomains(focus);
  const techDomains = tech.sectors || [];

  let industryScore;
  if (matchesAll && matched.size === 0) industryScore = 0.3;
  else {
    const hits = techDomains.filter(d => matched.has(d)).length;
    industryScore = techDomains.length ? hits / techDomains.length : 0;
    if (matchesAll) industryScore = Math.max(industryScore, 0.5);
  }

  const stageOk = techStageScore(vc.stage || [], tech.stage);

  const g = (vc.geographicFocus || '').toLowerCase();
  const geo = (!g || g.includes('national')) ? 0.8
    : (g.includes('mid-atlantic') || g.includes('east coast')) ? 1.0
    : (g.includes('west coast') || g.includes('international')) ? 0.4 : 0.7;

  const maturity = DOMAIN_MATURITY[techDomains[0]] || 'mid';
  const min = vc.checkSize ? vc.checkSize.min : undefined;
  const max = vc.checkSize ? vc.checkSize.max : undefined;
  let checkSz = 0.4;
  if (maturity === 'early' && max <= 15) checkSz = 1;
  else if (maturity === 'mid' && min >= 1 && max <= 50) checkSz = 1;

  return {
    score: WEIGHTS.industry * industryScore + WEIGHTS.stage * stageOk + WEIGHTS.geography * geo + WEIGHTS.checkSize * checkSz,
    sharedDomains: techDomains.filter(d => matched.has(d)),
    stageOk: stageOk === 1,
  };
}

function fitTier(score) {
  if (score >= 0.80) return { label: 'Strong fit',   cls: 'strong' };
  if (score >= 0.60) return { label: 'Good fit',     cls: 'good' };
  return { label: 'Possible fit', cls: 'possible' };
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { WEIGHTS, INDUSTRY_TO_DOMAIN, DOMAIN_MATURITY, mapFocusToDomains, techStageScore, vcFitScore, fitTier };
```

- [ ] **Step 4: Run the test** — `node test/scoring.test.js` → `6 passed, 0 failed`.

- [ ] **Step 5: Commit** — `git add scoring.js test/scoring.test.js && git commit -m "feat: shared scoring.js rubric module + tests (browser behavior canonical)"`

---

### Task 2: `index.html` consumes `scoring.js` (delete the inline copy)

**Files:** Modify `index.html`.

**Interfaces:** Consumes globals from `scoring.js` (Task 1). `findVCsForTech()` (stays in `index.html`) calls `vcFitScore`; render code calls `fitTier`.

- [ ] **Step 1: Load the module** — add in `<head>` next to the other module scripts:

```html
  <script src="scoring.js" defer></script>
```

- [ ] **Step 2: Delete the inline duplicate.** Remove the block from the comment `// Ported from scripts/generate_vc.js — keep the two tables in sync.` through the end of `fitTier()` (currently `index.html:837`–`961`: `INDUSTRY_TO_DOMAIN`, `DOMAIN_MATURITY`, `mapFocusToDomains`, `techStageScore`, `vcFitScore`, `fitTier`). **Keep** `GRANT_FINDER_URL` (line 835) and **keep** `findVCsForTech()` (line 967+) — it uses the now-global `vcFitScore`.

- [ ] **Step 3: Confirm no dangling references.** Search `index.html` for `INDUSTRY_TO_DOMAIN`, `DOMAIN_MATURITY`, `mapFocusToDomains`, `techStageScore` — there must be **zero** remaining uses (they lived only inside the deleted functions). `vcFitScore` and `fitTier` may remain (now resolved from `scoring.js`).

Run: `grep -nE "INDUSTRY_TO_DOMAIN|DOMAIN_MATURITY|mapFocusToDomains|techStageScore" index.html`
Expected: no output.

- [ ] **Step 4: Golden parity check (browser).** Serve locally (`python3 -m http.server 5055`) and, via the browser, run on a tech profile page:

```javascript
// paste a couple real VC/tech pairs and confirm scores are unchanged vs production
JSON.stringify(VCS.slice(0,5).map(vc => {
  const t = TECHS.find(x=>x.id==='3dnamics');
  const f = vcFitScore(vc, t);
  return { vc: vc.name, score: f && +f.score.toFixed(4), tier: f && fitTier(f.score).label };
}));
```
Expected: identical scores/tiers to the current production site for the same pairs (spot-compare against `https://ckannam.github.io/VC_Matching_Second_Brain/#/tech/3dnamics`). Confirm the tech profile's ranked VC list renders unchanged and no console errors.

- [ ] **Step 5: Commit** — `git add index.html && git commit -m "refactor: index.html uses shared scoring.js; delete inline rubric copy"`

---

### Task 3: `scripts/generate_vc.js` consumes `scoring.js` (delete the inline copy)

**Files:** Modify `scripts/generate_vc.js`. Add: `test/generate_vc.buildentry.test.js`.

**Interfaces:** Consumes `vcFitScore`, `mapFocusToDomains` from `scoring.js`. `buildEntry(vcProfile, techs)` and `researchVC` keep their exported signatures (used by `server.js`).

- [ ] **Step 1: Write the failing integration test** — `test/generate_vc.buildentry.test.js`:

```javascript
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildEntry } = require('../scripts/generate_vc.js');

const techs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/technologies.json'), 'utf8'));
let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('buildEntry produces a 4-tech provisional entry via shared scoring', () => {
  const profile = {
    fullName: 'Test Bio Ventures', aliases: ['TBV'],
    investmentFocus: ['Therapeutics','Oncology'], stages: ['Seed','Series A'],
    checkSizeMin: 1, checkSizeMax: 10, thesis: 'test', geographicFocus: 'Mid-Atlantic',
  };
  const e = buildEntry(profile, techs);
  assert.strictEqual(e.provisional, true);
  assert.strictEqual(e.vcOnePager, null);
  assert.strictEqual(e.matchedTechs.length, 4, `got ${e.matchedTechs.length}`);
  assert.deepStrictEqual(e.checkSize, { min: 1, max: 10 });
  assert(e.matchedTechs.every(id => techs.some(t => t.id === id)), 'matchedTechs are real ids');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it, confirm it fails** — `node test/generate_vc.buildentry.test.js` → FAIL (buildEntry still uses the not-yet-refactored path — actually it passes today; run anyway to record the BASELINE `1 passed`, then refactor must keep it passing). Note: this test guards that the refactor doesn't break buildEntry.

- [ ] **Step 3: Refactor `generate_vc.js`.** At the top, replace the inline rubric with a require:

Delete `INDUSTRY_TO_DOMAIN`, `DOMAIN_MATURITY`, `mapFocusTodomains`, `stageScore`, `geographyScore`, `checkSizeScore`, `scoreTech` (the block `scripts/generate_vc.js:15-145`). Add after the `Anthropic` require:

```javascript
const { vcFitScore, mapFocusToDomains } = require('../scoring.js');
```

Rewrite `buildEntry` to adapt the profile to the stored VC shape and score via the shared function:

```javascript
function buildEntry(vcProfile, techs) {
  const vc = {
    sectors:         vcProfile.investmentFocus,
    stage:           vcProfile.stages,
    checkSize:       { min: vcProfile.checkSizeMin, max: vcProfile.checkSizeMax },
    geographicFocus: vcProfile.geographicFocus,
  };
  const { matched } = mapFocusToDomains(vcProfile.investmentFocus);
  const scored = techs
    .map(t => ({ tech: t, score: (vcFitScore(vc, t) || { score: 0 }).score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.tech.sectors.filter(d => matched.has(d)).length
           - a.tech.sectors.filter(d => matched.has(d)).length;
    });

  const slug = vcProfile.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id:              slug,
    name:            vcProfile.fullName,
    aliases:         vcProfile.aliases || [],
    focus:           vcProfile.thesis  || '',
    sectors:         vcProfile.investmentFocus,
    stage:           vcProfile.stages,
    checkSize:       { min: vcProfile.checkSizeMin, max: vcProfile.checkSizeMax },
    geographicFocus: vcProfile.geographicFocus || 'National',
    matchedTechs:    scored.slice(0, 4).map(({ tech }) => tech.id),
    vcOnePager:      null,
    provisional:     true,
  };
}
```

In the CLI `main()` (the `require.main === module` block), replace the top-4 display computation that used `scoreTech`/`mapFocusTodomains` with the same `vc`-adapter + `vcFitScore(vc, t).score` pattern (build the `vc` object from `vcProfile` exactly as in `buildEntry`, then `scored = techs.map(t => ({ tech:t, score:(vcFitScore(vc,t)||{score:0}).score })).sort((a,b)=>b.score-a.score)`).

- [ ] **Step 4: Run both Node tests**

Run: `node test/generate_vc.buildentry.test.js && node test/scoring.test.js`
Expected: both pass (`1 passed` and `6 passed`).

- [ ] **Step 5: Confirm no dangling references + server import still resolves**

Run: `grep -nE "scoreTech|mapFocusTodomains|geographyScore|checkSizeScore|INDUSTRY_TO_DOMAIN" scripts/generate_vc.js` → no output.
Run: `node -e "require('./server.js') && 0" 2>&1 | head -3` is NOT safe (starts a server). Instead: `node -e "const m=require('./scripts/generate_vc.js'); console.log(typeof m.buildEntry, typeof m.researchVC)"` → `function function`.

- [ ] **Step 6: Commit** — `git add scripts/generate_vc.js test/generate_vc.buildentry.test.js && git commit -m "refactor: generate_vc.js uses shared scoring.js; reconcile catch-all industry drift"`

---

### Task 4: End-to-end verification + deploy

**Files:** none (verification + merge/push, on user approval).

- [ ] **Step 1: All Node tests green** — `node test/scoring.test.js && node test/generate_vc.buildentry.test.js && node test/grant_checker.test.js` (Phase-1 test still passes).

- [ ] **Step 2: Grant Finder untouched** — `git -C "../Grant Finder" diff --name-only` shows no `grant_engine.js` change from us (only pre-existing).

- [ ] **Step 3: Browser regression (deployed).** After merge+push and Pages build, load `https://ckannam.github.io/VC_Matching_Second_Brain/#/tech/3dnamics` and confirm the ranked investor-fit list + tiers are **identical** to before the refactor (the whole point: no user-facing change). Confirm zero console errors and that `#/grants`, VC search, catalog all still work.

- [ ] **Step 4: Merge to `main` and deploy** (only on user go-ahead): merge the feature branch `--no-ff`, `git pull --rebase origin main`, `git push origin main`.

## Self-Review

- **Spec coverage:** one shared module (Task 1), both consumers refactored (Tasks 2–3), weights as config (`WEIGHTS`), drift reconciled to browser behavior (Task 1 test + Task 3), graceful-degradation scaffolding is the `vcFitScore(...)||{score:0}` / `null` handling already present. ✅
- **No user-facing change:** `index.html` scoring is byte-identical (same code moved), so tech-profile rankings are unchanged; the only behavior delta is backend `matchedTechs` for catch-all+specific VCs (documented, intended). ✅
- **Placeholder scan:** none. **Type consistency:** `vcFitScore`, `mapFocusToDomains`, `fitTier`, `WEIGHTS` names consistent across tasks. ✅
- **Risk:** cross-script global visibility — mitigated by the proven `grant_checker.js` defer pattern and Task 2 Step 3/4 checks.
- **Deferred:** the enriched-data upgrades (Phase 3) build ON this module later; not in scope here.
